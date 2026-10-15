/**
 * 弹幕采集（浏览器旁听方案）
 *
 * 背景：抖音 webcast 推送接口的签名算法经常变，靠自己算签名连 `wss://webcast.../im/push/v2/`
 * 会时不时「连上了但一条不推」。这里改成：让 App 自己开一个看不见的浏览器窗口打开直播间页面，
 * 页面自己会去连官方的弹幕推送通道；我们用 Chromium 调试协议（CDP）在旁边把收到的
 * WebSocket 二进制帧捞出来解码。页面怎么连、签名怎么算，都不用我们管。
 *
 * 窗口技巧：实测 `show:false`（完全隐藏）时页面不会去连弹幕通道，
 * 必须是「页面自己认为可见」的窗口。所以这里用 透明度 0 + 不进任务栏 + 不抢焦点 的窗口，
 * 用户看不见、点不到，但页面行为跟正常打开浏览器一致。
 */

import { BrowserWindow, session, Session } from 'electron'
import { gunzipSync } from 'zlib'
import * as logger from './logger'

const LOG_MODULE = 'DanmuTap'

/** 专用会话（持久化，攒下抖音的 cookie 更像正常访客） */
const DANMU_PARTITION = 'persist:douyin-danmu'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** 单帧上限，超过就丢掉，防止异常大包把内存顶爆 */
const MAX_FRAME_BYTES = 4 * 1024 * 1024

/** 多久没收到任何帧就刷新页面（7x24 自愈） */
const IDLE_RELOAD_MS = 4 * 60 * 1000

/** 看门狗检查间隔 */
const WATCHDOG_INTERVAL_MS = 60 * 1000

/** 是否拦截图片/视频/字体——弹幕通道不依赖它们，拦掉能省大量带宽和 CPU */
const BLOCK_HEAVY_RESOURCES = true

/** 诊断开关：设 DANMU_DEBUG=1 时把每一帧都写进日志 */
const DEBUG = process.env.DANMU_DEBUG === '1'

export interface RawDanmuMessage {
  method: string
  msgId: string
  payload: Buffer
}

export interface TapHandlers {
  onMessages: (msgs: RawDanmuMessage[]) => void
  onStatus: (status: string) => void
  onError: (reason: string) => void
}

// ---------------------------------------------------------------------------
// 二进制安全的 protobuf 读取
// 抖音的帧结构：PushFrame(bytes.payload) -> gzip -> Response.messagesList[] -> Message{method, payload}
// ---------------------------------------------------------------------------

interface ProtoField {
  no: number
  wire: number
  value: bigint | Buffer
}

function readVarint(buf: Buffer, offset: number): { value: bigint; next: number } {
  let value = 0n
  let shift = 0n
  let i = offset
  while (i < buf.length) {
    const b = buf[i++]
    value |= BigInt(b & 0x7f) << shift
    if ((b & 0x80) === 0) return { value, next: i }
    shift += 7n
    if (shift > 70n) throw new Error('varint 过长')
  }
  throw new Error('varint 越界')
}

function readFields(buf: Buffer): ProtoField[] {
  const out: ProtoField[] = []
  let offset = 0
  while (offset < buf.length) {
    const tagR = readVarint(buf, offset)
    offset = tagR.next
    const tag = Number(tagR.value)
    const no = tag >> 3
    const wire = tag & 7
    if (no === 0) break
    if (wire === 0) {
      const r = readVarint(buf, offset)
      offset = r.next
      out.push({ no, wire, value: r.value })
    } else if (wire === 1) {
      if (offset + 8 > buf.length) break
      out.push({ no, wire, value: buf.readBigUInt64LE(offset) })
      offset += 8
    } else if (wire === 2) {
      const l = readVarint(buf, offset)
      offset = l.next
      const len = Number(l.value)
      if (len < 0 || offset + len > buf.length) break
      out.push({ no, wire, value: buf.subarray(offset, offset + len) })
      offset += len
    } else if (wire === 5) {
      if (offset + 4 > buf.length) break
      out.push({ no, wire, value: BigInt(buf.readUInt32LE(offset)) })
      offset += 4
    } else {
      // 不认识的 wire type，放弃这一帧（不影响其它帧）
      break
    }
  }
  return out
}

function firstBytes(fields: ProtoField[], no: number): Buffer | null {
  for (const f of fields) {
    if (f.no === no && Buffer.isBuffer(f.value)) return f.value
  }
  return null
}

function allBytes(fields: ProtoField[], no: number): Buffer[] {
  const out: Buffer[] = []
  for (const f of fields) {
    if (f.no === no && Buffer.isBuffer(f.value)) out.push(f.value)
  }
  return out
}

function firstString(fields: ProtoField[], no: number): string {
  const b = firstBytes(fields, no)
  return b ? b.toString('utf8') : ''
}

function firstNumber(fields: ProtoField[], no: number): number {
  for (const f of fields) {
    if (f.no === no && typeof f.value === 'bigint') return Number(f.value)
  }
  return 0
}

function isGzip(buf: Buffer): boolean {
  return buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b
}

/** 把一帧 WebSocket 二进制数据解成「原始消息列表」 */
export function decodePushFrame(raw: Buffer): RawDanmuMessage[] {
  const frameFields = readFields(raw)

  const headers: Record<string, string> = {}
  for (const hb of allBytes(frameFields, 5)) {
    const hf = readFields(hb)
    const key = firstString(hf, 1)
    if (key) headers[key] = firstString(hf, 2)
  }

  const payloadType = firstString(frameFields, 7)
  if (payloadType !== 'msg' && payloadType !== 'push') return []

  let payload = firstBytes(frameFields, 8)
  if (!payload || payload.length === 0) return []
  if (headers['compress_type'] === 'gzip' || isGzip(payload)) {
    try {
      payload = gunzipSync(payload)
    } catch (ex: any) {
      logger.warn(LOG_MODULE, `解压失败：${ex.message}`)
      return []
    }
  }

  const messages: RawDanmuMessage[] = []
  const responseFields = readFields(payload)
  for (const msgBytes of allBytes(responseFields, 1)) {
    const mf = readFields(msgBytes)
    const method = firstString(mf, 1)
    if (!method) continue
    const body = firstBytes(mf, 2)
    if (!body || body.length === 0) continue
    messages.push({ method, msgId: String(firstNumber(mf, 3)), payload: body })
  }
  return messages
}

// ---------------------------------------------------------------------------
// 单个直播间的旁听窗口
// ---------------------------------------------------------------------------

export class RoomTap {
  private win: BrowserWindow | null = null
  private disposed = false
  private ready = false
  private lastFrameAt = 0
  /** 上一次真正收到弹幕帧的时间（刷页面不会重置它，用于判断登录是否失效） */
  private lastRealFrameAt = Date.now()
  private watchdog: ReturnType<typeof setInterval> | null = null
  private reloadTimer: ReturnType<typeof setTimeout> | null = null
  private loadFailCount = 0
  private frameCount = 0
  private messageCount = 0
  private lastStatsLog = 0
  private destroyedReported = false
  private debugTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly roomId: string,
    private readonly webRid: string,
    private readonly handlers: TapHandlers
  ) {}

  get isAlive(): boolean {
    return !this.disposed && !!this.win && !this.win.isDestroyed()
  }

  async start(): Promise<void> {
    const part = session.fromPartition(DANMU_PARTITION)
    part.setUserAgent(USER_AGENT)
    if (BLOCK_HEAVY_RESOURCES) this.applyResourceBlock(part)

    const win = new BrowserWindow({
      // 必须一开始就「显示」（下一行马上把不透明度设成 0），
      // 用 show:false + showInactive 的写法实测页面不会去订阅弹幕推送流。
      show: true,
      x: 20,
      y: 20,
      width: 1280,
      height: 800,
      skipTaskbar: true,
      focusable: false,
      opacity: 0,
      webPreferences: {
        partition: DANMU_PARTITION,
        backgroundThrottling: false
      }
    })

    this.win = win

    // 用户看不见、点不到，但页面以为自己是正常可见窗口
    try {
      win.setIgnoreMouseEvents(true)
      win.setOpacity(0)
    } catch (ex: any) {
      logger.warn(LOG_MODULE, `窗口隐身设置失败：${ex.message}`)
    }

    win.webContents.setAudioMuted(true)
    win.webContents.setUserAgent(USER_AGENT)

    const dbg = win.webContents.debugger
    try {
      dbg.attach('1.3')
    } catch (ex: any) {
      logger.warn(LOG_MODULE, `调试协议挂载失败：${ex.message}`)
    }

    dbg.on('message', (_event, method, params) => {
      if (method === 'Network.webSocketCreated') {
        if (DEBUG) logger.info(LOG_MODULE, `[调试] WS建立 ${String(params?.url || '').slice(0, 110)}`)
        return
      }
      if (method === 'Network.webSocketFrameReceived') {
        this.onWsFrame(params)
      }
    })

    // 注意：这里绝对不能 await！导航开始前这个命令会一直挂着不返回，
    // 一旦 await 住，页面就永远不会加载，弹幕自然一条都没有。
    dbg.sendCommand('Network.enable')
      .then(() => { if (DEBUG) logger.info(LOG_MODULE, `Network.enable 完成 房间=${this.roomId}`) })
      .catch((ex: any) => logger.warn(LOG_MODULE, `Network.enable 失败：${ex.message}`))

    win.webContents.on('did-finish-load', () => {
      this.loadFailCount = 0
      this.ready = true
      this.lastFrameAt = Date.now()
      // 注意：这里不要再调 Network.enable，重复开启会把 WebSocket 事件丢掉
      this.handlers.onStatus('已连接')
      logger.info(LOG_MODULE, `弹幕窗口就绪 房间=${this.roomId}`)
    })

    win.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
      if (!isMainFrame) return
      this.loadFailCount++
      logger.warn(LOG_MODULE, `弹幕页面加载失败 房间=${this.roomId} code=${code} ${desc} 第${this.loadFailCount}次`)
      if (this.disposed) return
      if (this.loadFailCount <= 5) {
        setTimeout(() => this.reload('加载失败重试'), 8000)
      } else {
        this.handlers.onError(`弹幕页面连续加载失败：${desc || code}`)
      }
    })

    win.webContents.on('render-process-gone', (_e, details) => {
      if (this.disposed) return
      logger.warn(LOG_MODULE, `弹幕渲染进程退出 房间=${this.roomId} 原因=${details.reason}`)
      this.rebuild('渲染进程退出')
    })

    win.on('closed', () => {
      this.win = null
    })

    this.lastFrameAt = Date.now()
    this.lastStatsLog = Date.now()
    this.startWatchdog()

    const url = `https://live.douyin.com/${this.webRid}`
    logger.info(LOG_MODULE, `打开弹幕通道 房间=${this.roomId} url=${url}`)
    await win.loadURL(url).catch((ex: any) => {
      // 首帧加载失败交给 did-fail-load 重试，这里不打断
      logger.warn(LOG_MODULE, `loadURL 异常 房间=${this.roomId}：${ex.message}`)
    })

    if (!this.ready) {
      // 有些情况下 did-finish-load 会稍晚，兜底放行，避免前端一直卡在「正在连接」
      this.handlers.onStatus('已连接')
    }
  }

  private applyResourceBlock(part: Session): void {
    try {
      part.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
        const t = details.resourceType
        callback({ cancel: t === 'image' || t === 'media' || t === 'font' })
      })
    } catch (ex: any) {
      logger.warn(LOG_MODULE, `资源拦截注册失败：${ex.message}`)
    }
  }

  private onWsFrame(params: any): void {
    if (this.disposed) return
    const opcode = params?.response?.opcode
    if (opcode !== 2) return // 只要二进制帧
    const b64: string = params?.response?.payloadData || ''
    if (!b64 || b64.length > MAX_FRAME_BYTES * 2) return

    let raw: Buffer
    try {
      raw = Buffer.from(b64, 'base64')
    } catch {
      return
    }
    if (raw.length === 0 || raw.length > MAX_FRAME_BYTES) return

    this.frameCount++
    this.lastFrameAt = Date.now()
    this.lastRealFrameAt = this.lastFrameAt

    let messages: RawDanmuMessage[]
    try {
      messages = decodePushFrame(raw)
    } catch (ex: any) {
      if (DEBUG) logger.info(LOG_MODULE, `[调试] 帧解不开 ${raw.length}B：${ex.message}`)
      return // 非弹幕帧（心跳、握手等）
    }
    if (messages.length === 0) return
    if (DEBUG) {
      logger.info(LOG_MODULE, `[调试] 帧 ${raw.length}B 消息=${messages.length}：${messages.map((m) => m.method).slice(0, 6).join('|')}`)
    }

    this.messageCount += messages.length
    try {
      this.handlers.onMessages(messages)
    } catch (ex: any) {
      logger.error(LOG_MODULE, `消息处理异常 房间=${this.roomId}：${ex.message}`)
    }

    // 每 5 分钟记一条流量日志，方便排查
    const now = Date.now()
    if (now - this.lastStatsLog > 5 * 60 * 1000) {
      this.lastStatsLog = now
      logger.info(LOG_MODULE, `弹幕心跳 房间=${this.roomId} 帧=${this.frameCount} 消息=${this.messageCount}`)
    }
  }

  private startWatchdog(): void {
    this.stopWatchdog()
    if (DEBUG) {
      this.debugTimer = setInterval(() => {
        const alive = !!this.win && !this.win.isDestroyed()
        const vis = alive ? this.win!.isVisible() : false
        const url = alive ? this.win!.webContents.getURL() : '-'
        logger.info(LOG_MODULE, `[调试] 房间=${this.roomId} 窗口=${alive ? '在' : '没了'} 可见=${vis} 就绪=${this.ready} 帧=${this.frameCount} 消息=${this.messageCount} url=${url.slice(0, 60)}`)
        if (alive) {
          this.win!.webContents.executeJavaScript("({vis:document.visibilityState,hidden:document.hidden,videos:document.querySelectorAll('video').length,playing:Array.from(document.querySelectorAll('video')).filter(v=>!v.paused).length,title:document.title.slice(0,30)})", true)
            .then((info: any) => logger.info(LOG_MODULE, `[调试] 页面状态 ${JSON.stringify(info)}`))
            .catch((ex: any) => logger.info(LOG_MODULE, `[调试] 页面状态取不到：${ex.message}`))
        }
      }, 15000)
    }
    this.watchdog = setInterval(() => {
      if (this.disposed) return
      if (!this.win || this.win.isDestroyed()) {
        if (!this.destroyedReported) {
          this.destroyedReported = true
          this.handlers.onError('弹幕窗口已关闭')
        }
        return
      }
      if (this.ready && Date.now() - this.lastFrameAt > IDLE_RELOAD_MS) {
        logger.warn(LOG_MODULE, `超过 ${Math.round(IDLE_RELOAD_MS / 60000)} 分钟没收到弹幕帧，刷新弹幕窗口 房间=${this.roomId}`)
        this.reload('长时间无数据')
      }
      // 长时间没数据时顺便看看是不是抖音登录掉了（未登录的话再怎么刷也收不到）
      if (this.ready && Date.now() - this.lastRealFrameAt > 10 * 60 * 1000) {
        douyinLoginState()
          .then((s) => {
            if (!s.loggedIn && !this.disposed) this.handlers.onStatus('未登录抖音（或登录已失效），弹幕收不到')
          })
          .catch(() => { /* ignore */ })
      }
    }, WATCHDOG_INTERVAL_MS)
  }

  private stopWatchdog(): void {
    if (this.debugTimer) clearInterval(this.debugTimer)
    this.debugTimer = null
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = null
  }

  private reload(reason: string): void {
    if (this.disposed || !this.win || this.win.isDestroyed()) return
    if (this.reloadTimer) return
    logger.info(LOG_MODULE, `重开弹幕窗口 房间=${this.roomId} 原因=${reason}`)
    this.handlers.onStatus('弹幕通道重连中…')
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null
      if (this.disposed || !this.win || this.win.isDestroyed()) return
      this.ready = false
      this.lastFrameAt = Date.now()
      this.win.loadURL(`https://live.douyin.com/${this.webRid}`).catch(() => { /* 交给 did-fail-load */ })
    }, 3000)
  }

  private rebuild(reason: string): void {
    if (this.disposed) return
    logger.info(LOG_MODULE, `重建弹幕窗口 房间=${this.roomId} 原因=${reason}`)
    const handlers = this.handlers
    const roomId = this.roomId
    const webRid = this.webRid
    this.disposeInternal()
    setTimeout(() => {
      const tap = new RoomTap(roomId, webRid, handlers)
      taps.set(roomId, tap)
      tap.start().catch((ex: any) => {
        logger.error(LOG_MODULE, `重建弹幕窗口失败 房间=${roomId}：${ex.message}`)
        handlers.onError(`弹幕窗口重建失败：${ex.message}`)
      })
    }, 5000)
  }

  private disposeInternal(): void {
    this.disposed = true
    this.stopWatchdog()
    if (this.reloadTimer) clearTimeout(this.reloadTimer)
    this.reloadTimer = null
    if (this.win && !this.win.isDestroyed()) {
      try {
        if (this.win.webContents.debugger.isAttached()) this.win.webContents.debugger.detach()
      } catch { /* ignore */ }
      try {
        this.win.removeAllListeners()
        this.win.destroy()
      } catch { /* ignore */ }
    }
    this.win = null
  }

  /** 外部要求重开（比如刚登录完抖音，需要带着新登录态重新拉流） */
  refresh(reason: string): void {
    this.reload(reason)
  }

  dispose(): void {
    if (this.disposed) return
    logger.info(LOG_MODULE, `关闭弹幕通道 房间=${this.roomId}`)
    this.disposeInternal()
  }
}

// ---------------------------------------------------------------------------
// 管理器
// ---------------------------------------------------------------------------

const taps = new Map<string, RoomTap>()

export function openRoomTap(roomId: string, webRid: string, handlers: TapHandlers): Promise<void> {
  closeRoomTap(roomId)
  const tap = new RoomTap(roomId, webRid || roomId, handlers)
  taps.set(roomId, tap)
  return tap.start()
}

export function closeRoomTap(roomId: string): void {
  const tap = taps.get(roomId)
  if (tap) {
    tap.dispose()
    taps.delete(roomId)
  }
}

export function closeAllRoomTaps(): void {
  for (const [roomId, tap] of taps) {
    tap.dispose()
    taps.delete(roomId)
  }
}

export function tapCount(): number {
  return taps.size
}

export function refreshAllRoomTaps(reason: string): void {
  for (const [, tap] of taps) tap.refresh(reason)
}

// ---------------------------------------------------------------------------
// 抖音登录（弹幕通道的前提）
//
// 实测结论：抖音只给【已登录】的网页端推弹幕。没登录时页面会连上房间，
// 但一条推送都收不到（只有零星心跳帧）。所以运营电脑上需要扫码登录一次，
// 登录态存在 App 自己的会话目录里，不碰浏览器，也不用每次重登。
// ---------------------------------------------------------------------------

let loginWindow: BrowserWindow | null = null

/** 当前这台机器有没有登录抖音（看 sessionid 这个 cookie） */
export async function douyinLoginState(): Promise<{ loggedIn: boolean }> {
  try {
    const part = session.fromPartition(DANMU_PARTITION)
    const cookies = await part.cookies.get({ name: 'sessionid' })
    return { loggedIn: cookies.some((c) => String(c.value || '').length > 8) }
  } catch {
    return { loggedIn: false }
  }
}

/** 打开一个真正的登录窗口让用户扫码登录；检测到登录成功会自动关窗并通知弹幕窗口刷新 */
function sessionIdOf(cookies: { value?: string }[]): string {
  const c = cookies.find((x) => String(x.value || '').length > 8)
  return c ? String(c.value) : ''
}

export async function openDouyinLogin(): Promise<{ ok: boolean; message: string }> {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.show()
    loginWindow.focus()
    return { ok: true, message: '登录窗口已经打开了' }
  }

  const part = session.fromPartition(DANMU_PARTITION)
  part.setUserAgent(USER_AGENT)

  // 打开前先记住现在登录的是哪个号：本机已经登录时，只有等 cookie 真的变了才算「换号成功」，
  // 否则窗口会因为「已经登录」在一秒内自己关掉，运营根本来不及扫码换号。
  const beforeSessionId = await part.cookies
    .get({ name: 'sessionid' })
    .then((cs) => sessionIdOf(cs))
    .catch(() => '')

  return new Promise((resolve) => {

    const win = new BrowserWindow({
      width: 1000,
      height: 740,
      title: '登录抖音（登录后才能收到弹幕）',
      backgroundColor: '#ffffff',
      autoHideMenuBar: true,
      webPreferences: {
        partition: DANMU_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    })
    loginWindow = win
    win.setMenuBarVisibility(false)
    win.webContents.setUserAgent(USER_AGENT)
    // 直接进个人页：未登录时会跳到扫码登录页，比首页少点几下
    win.loadURL('https://www.douyin.com/user/self').catch(() => { /* ignore */ })

    // 个别情况下没自动跳登录页，就帮用户把「登录」按钮点一下（点不到也无所谓）
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        win.webContents.executeJavaScript(`(() => { if (/login|passport|sso/i.test(location.href)) return 'already'; const nodes = Array.from(document.querySelectorAll('button, div, span, a')); const t = nodes.find(n => (n.innerText || '').trim() === '登录'); if (t) { t.click(); return 'clicked' } return 'not-found' })()`, true)
          .then((r: any) => logger.info(LOG_MODULE, `登录页自动操作结果：${r}`))
          .catch(() => { /* ignore */ })
      }, 3000)
    })
    logger.info(LOG_MODULE, '已打开抖音登录窗口')

    let settled = false
    const finish = (res: { ok: boolean; message: string }) => {
      if (settled) return
      settled = true
      clearInterval(timer)
      resolve(res)
    }

    const timer = setInterval(async () => {
      if (win.isDestroyed()) { finish({ ok: false, message: '登录窗口已关闭' }); return }
      const nowSessionId = sessionIdOf(await part.cookies.get({ name: 'sessionid' }).catch(() => []))
      // 本来没登录 → 出现登录态就算成功；本来就登录了 → 必须是换成了别的号
      const loggedIn = nowSessionId !== '' && (beforeSessionId === '' ? true : nowSessionId !== beforeSessionId)
      if (loggedIn) {
        logger.info(LOG_MODULE, '检测到抖音登录成功，刷新全部弹幕窗口')
        refreshAllRoomTaps('登录成功')
        setTimeout(() => { if (!win.isDestroyed()) win.close() }, 1500)
        finish({ ok: true, message: '登录成功' })
      }
    }, 1200)

    win.on('closed', () => {
      loginWindow = null
      finish({ ok: false, message: '登录窗口已关闭' })
    })
  })
}
