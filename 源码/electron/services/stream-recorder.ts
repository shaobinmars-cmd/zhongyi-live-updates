// 单路直播间录制。7×24 场景的三件事都在这里：
//   1) 按时长自动切段（ffmpeg segment），断一次只丢一段，不会毁掉一整场
//   2) 断流自动重连：ffmpeg 自己带一层重连，退出后我们再取一次流重启，带退避
//   3) 读写超时（-rw_timeout），避免连接卡死时进程永远不退出、连重连都触发不了

import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { loadConfig, getEffectiveOutputPath } from './record-config'
import { getPullUrl } from './live-stream'
import { resolveGenericPullUrl } from './platform'
import * as logger from './logger'

const LOG_MODULE = 'StreamRecorder'

/** 连续重连失败多少次就判定「已下播」并停止 */
const MAX_RETRY = 10
const RETRY_BASE_SEC = 5
const RETRY_MAX_SEC = 30
/** 多久没有任何数据就判定抓流卡死，杀掉重启 */
/** 实测：断流时 ffmpeg 会自己死等，不会退出，所以这一步必须有 */
const STALL_MS = 120 * 1000
/** 累加器里最多保留多少段/多少字节用于展示 */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export interface RecorderHooks {
  onStatus: (text: string) => void
  /** 彻底结束（用户停止 / 判定下播 / 放弃重连） */
  onFinished: (reason: string) => void
}

export class StreamRecorder {
  public isRecording = false
  public outputDir = ''
  public lastSegment = ''
  public currentFileSize = 0
  public quality = ''

  private proc: ChildProcess | null = null
  private stopping = false
  private finished = false
  private retryCount = 0
  private prefix = ''
  /** 分段起始编号：断流重连时往后跳，否则 ffmpeg 会从 _000 重新开始写、把已录好的覆盖掉 */
  private segStart = 0
  private doneMs = 0
  /** ffmpeg 最后一行输出（出问题时用来告诉运营到底怎么了） */
  private lastFfmpegLine = ''
  private lastWarnAt = 0
  private runStart = 0
  private lastProgressAt = 0
  /** 本次启动 ffmpeg 之前已经录到的字节数：用它判断“这一轮到底写出东西没” */
  private sizeAtSpawn = 0
  private tickTimer: ReturnType<typeof setInterval> | null = null

  private hooks: RecorderHooks

  constructor(
    private roomId: string,
    private nickname: string,
    private format: string,
    hooks: RecorderHooks,
    private platform: string = 'douyin',
    private sourceUrl: string = ''
  ) {
    this.hooks = hooks
  }

  private get safeName(): string {
    return safeRecordingName(this.nickname, this.roomId)
  }

  start(pullUrl: string): boolean {
    const cfg = loadConfig()
    const rootDir = getEffectiveOutputPath(cfg)
    try {
      fs.mkdirSync(rootDir, { recursive: true })
    } catch (ex) {
      logger.error(LOG_MODULE, `建目录失败 ${rootDir}`, ex)
      this.hooks.onStatus('无法创建录制目录')
      return false
    }

    // 文件名用本机时间戳（以前用 UTC，运营按文件名找场次会对不上号）
    const stamp = localStamp()
    const session = recordingSessionPath(rootDir, this.nickname, this.roomId, stamp)
    this.prefix = session.prefix
    // 一场直播一个文件夹：同名主播的不同场次按开播时间分开。
    this.outputDir = session.dir
    try {
      fs.mkdirSync(this.outputDir, { recursive: true })
    } catch (ex) {
      logger.error(LOG_MODULE, `建场次目录失败 ${this.outputDir}`, ex)
      this.hooks.onStatus('无法创建本场录制文件夹')
      return false
    }
    // 写一份旁注：这场录的是哪个房间、什么时候开始。
    // 拆解时靠它把「弹幕/礼物」按时间段并进素材包（没有它就对不上号）。
    try {
      fs.writeFileSync(
        path.join(this.outputDir, `${this.prefix}.meta.json`),
        JSON.stringify({
          roomId: this.roomId,
          nickname: this.nickname,
          platform: this.platform,
          sourceUrl: this.sourceUrl,
          format: this.format,
          startedAtUtc: new Date().toISOString().replace('T', ' ').substring(0, 19),
          startedAtLocal: new Date().toLocaleString('zh-CN')
        }, null, 2),
        'utf-8'
      )
    } catch (ex: any) {
      logger.warn(LOG_MODULE, `写录制旁注失败：${ex.message}`)
    }
    this.stopping = false
    this.finished = false
    this.doneMs = 0

    const ok = this.spawnFfmpeg(pullUrl)
    if (!ok) return false

    this.isRecording = true
    this.tickTimer = setInterval(() => this.tick(), 1000)
    return true
  }

  private buildArgs(url: string): string[] {
    const cfg = loadConfig()
    const ext = this.format
    const out = path.join(this.outputDir, `${this.prefix}_%03d.${ext}`)
    const args: string[] = ['-hide_banner', '-loglevel', 'warning']

    // 网络层的自愈：断线重连 + 读写超时（卡死 15 秒就当断流处理）
    args.push(
      '-reconnect', '1',
      '-reconnect_at_eof', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-rw_timeout', '15000000'
    )
    args.push('-i', url)

    if (ext === 'mp3' || ext === 'wav') args.push('-vn')
    if (ext === 'mp3') args.push('-acodec', 'libmp3lame', '-q:a', '2')
    else if (ext === 'wav') args.push('-acodec', 'pcm_s16le')
    else args.push('-c', 'copy')

    args.push('-f', 'segment', '-segment_format', ext)
    if (this.segStart > 0) args.push('-segment_start_number', String(this.segStart))
    if (ext === 'mp4') {
      // 分段 mp4 用 fragmentation，中断时文件也是可播的
      args.push('-segment_format_options', 'movflags=+frag_keyframe+empty_moov+default_base_moof')
    }
    if (cfg.segmentMinutes > 0) args.push('-segment_time', String(Math.round(cfg.segmentMinutes * 60)))
    args.push('-reset_timestamps', '1')
    args.push('-y', out)
    return args
  }

  private spawnFfmpeg(url: string): boolean {
    const args = this.buildArgs(url)
    const ffmpegExe = resolveFfmpegPath()
    logger.info(LOG_MODULE, `用这个 ffmpeg 录制：${ffmpegExe} roomId=${this.roomId}`)

    try {
      this.proc = spawn(ffmpegExe, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    } catch (ex: any) {
      logger.error(LOG_MODULE, `启动 ffmpeg 失败: ${ex.message}`)
      this.hooks.onStatus(`启动 ffmpeg 失败：${ex.message}`)
      return false
    }

    this.runStart = Date.now()
    this.lastProgressAt = Date.now()

    // 这一轮开始前已经录了多少：退出时拿它比一下，就知道本轮是否真的写出了数据。
    this.sizeAtSpawn = this.measureSize()

    this.proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      // ffmpeg 每开一个新分段都会打这条，用它跟踪「当前正在写哪个文件」
      const m = /Opening '([^']+)' for writing/.exec(text)
      if (m) {
        this.lastSegment = m[1]
        this.currentFileSize = 0
      }
      const line = text.trim().split('\n').pop() || ''
      if (line && !/^\s*$/.test(line)) this.lastFfmpegLine = line.substring(0, 200)
      if (line) logger.info(LOG_MODULE, `ffmpeg: ${line.substring(0, 200)}`)
    })

    this.proc.on('error', (err) => {
      logger.error(LOG_MODULE, 'ffmpeg 进程错误', err)
      // 这种是「根本没启动起来」（ffmpeg 缺失/被杀软拦截），必须让运营直接看到
      this.lastFfmpegLine = `无法启动 ffmpeg：${err.message}`
      this.hooks.onStatus(this.lastFfmpegLine)
    })

    this.proc.on('exit', (code) => {
      this.accumulate()
      this.proc = null
      this.onExit(code)
    })

    this.hooks.onStatus('正在录制...')
    return true
  }

  private accumulate(): void {
    if (this.runStart) {
      this.doneMs += Date.now() - this.runStart
      this.runStart = 0
    }
  }

  private onExit(code: number | null): void {
    if (this.stopping || this.finished) return

    // 本轮到底录出东西了没有？这是区分【真断流】和【主播已下播】的唯一依据：
    // 下播之后抖音接口**仍然会给一个拉流地址**，只是这个地址播不了（404）。
    // 以前只看“地址拿到没”，于是会无限重连（实测一天 694 次），界面一直显示在录。
    const grew = this.measureSize() > this.sizeAtSpawn
    const cfg = loadConfig()
    if (!cfg.autoReconnect) {
      this.finish(code === 0 ? '录制已结束' : `录制异常退出 (code=${code})`)
      return
    }
    if (grew) this.retryCount = 0                              // 真录到东西了，才清零
    else this.hooks.onStatus('这一轮没取到流，正在重新取流…')   // 没录到：累计失败次数
    this.scheduleReconnect()
  }

  /** 本场录像在磁盘上的总大小（跨分段 / 跨重连累加） */
  private measureSize(): number {
    let size = 0
    try {
      for (const f of fs.readdirSync(this.outputDir)) {
        if (!f.startsWith(this.prefix + '_')) continue
        try { size += fs.statSync(path.join(this.outputDir, f)).size } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    return size
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.finished) return
    this.retryCount++
    if (this.retryCount > MAX_RETRY) {
      this.finish('连续重连失败，主播可能已下播')
      return
    }
    const wait = Math.min(RETRY_BASE_SEC * this.retryCount, RETRY_MAX_SEC)
    this.hooks.onStatus(`断流，${wait} 秒后重连（第 ${this.retryCount}/${MAX_RETRY} 次）`)
    logger.warn(LOG_MODULE, `断流，${wait}s 后重连 roomId=${this.roomId} 第 ${this.retryCount} 次`)

    setTimeout(async () => {
      if (this.stopping || this.finished) return
      const resolved = this.platform === 'douyin'
        ? await getPullUrl(this.roomId)
        : await resolveGenericPullUrl(this.sourceUrl)
      const { success, pullUrl } = resolved
      if (this.stopping || this.finished) return
      if (!success || !pullUrl) {
        this.scheduleReconnect()
        return
      }
      this.retryCount = 0
      // 注意：这里**不能**把 retryCount 清零 ——
      // “能拿到地址”不等于“能录”（下播时地址照样返回，只是打开就 404），
      // 清零改到 onExit 里按“本轮有没有真的写出数据”判断。
      logger.info(LOG_MODULE, `取流成功，重启抓流 roomId=${this.roomId}`)
      // 关键：换个分段号，绝不能从 _000 重写（不然会把前面录好的文件截断成 0 字节）
      this.segStart += 1000
      if (!this.spawnFfmpeg(pullUrl)) this.scheduleReconnect()
    }, wait * 1000)
  }

  private tick(): void {
    try {
      // 直接看磁盘上这场录像的总大小。
      // 以前是抓 ffmpeg 的 "Opening ... for writing" 日志来判断，但那条是 info 级，
      // 我们用 -loglevel warning 跑，永远抓不到 —— 界面就一直显示 0 B。
      const size = this.measureSize()
      if (size > this.currentFileSize) this.lastProgressAt = Date.now()
      this.currentFileSize = size

      // 录了半天一个字节都没写出来：把原因直接显示在界面上（以前只写日志，运营看不到）
      if (size === 0 && this.isRecording && this.runStart && Date.now() - this.runStart > 20000) {
        if (Date.now() - this.lastWarnAt > 30000) {
          this.lastWarnAt = Date.now()
          const why = this.lastFfmpegLine ? this.lastFfmpegLine : 'ffmpeg 没报错，但也没写出数据（可能流地址失效）'
          this.hooks.onStatus(`没录出数据：${why}`)
          logger.warn(LOG_MODULE, `录制 20 秒仍为 0 字节 roomId=${this.roomId}：${why}`)
        }
      }
    } catch { /* ignore */ }

    // 卡死看门狗：文件长时间不长大，说明流已经断了但 ffmpeg 还挂着。
    // 杀掉它，交给 onExit 里的重连逻辑重启。
    if (!this.isRecording || this.stopping || !this.proc || this.lastProgressAt <= 0) return
    if (Date.now() - this.lastProgressAt <= STALL_MS) return

    logger.warn(LOG_MODULE, `超过 ${STALL_MS / 1000}s 没收到数据，杀掉 ffmpeg 准备重连 roomId=${this.roomId}`)
    this.hooks.onStatus('长时间没有数据，正在重启抓流…')
    this.lastProgressAt = Date.now()
    const p = this.proc
    this.proc = null
    try { p?.kill() } catch { /* ignore */ }
  }

  /** 停止：不再重连，并结束当前 ffmpeg */
  stop(): void {
    if (this.finished) return
    this.stopping = true
    this.accumulate()
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null }

    const p = this.proc
    if (p && !p.killed) {
      try {
        p.stdin?.write('q')
        p.stdin?.end()
      } catch { /* ignore */ }
      setTimeout(() => {
        try { if (p && !p.killed) p.kill() } catch { /* ignore */ }
      }, 5000)
    }
    this.proc = null
    this.isRecording = false
    this.finished = true
    this.hooks.onStatus('已停止')
    this.hooks.onFinished('已停止')
  }

  private finish(reason: string): void {
    if (this.finished) return
    this.stopping = true
    this.finished = true
    this.isRecording = false
    this.accumulate()
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null }
    this.hooks.onStatus(reason)
    this.hooks.onFinished(reason)
    logger.info(LOG_MODULE, `录制结束：${reason} roomId=${this.roomId}`)
  }

  /** 已录时长（跨重连累计） */
  getDurationText(): string {
    const total = Math.floor((this.doneMs + (this.runStart ? Date.now() - this.runStart : 0)) / 1000)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  getDurationMs(): number {
    return this.doneMs + (this.runStart ? Date.now() - this.runStart : 0)
  }

  /** 本场录像的文件名前缀（磁盘清理要避开正在录的场次，所以对外暴露一下） */
  get filePrefix(): string {
    return this.prefix
  }
}

export function safeRecordingName(nickname: string, roomId = ''): string {
  return String(nickname || roomId || '主播').replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim() || '主播'
}

export function recordingSessionPath(rootDir: string, nickname: string, roomId = '', stamp = ''): { prefix: string; dir: string } {
  const safe = safeRecordingName(nickname, roomId)
  const prefix = `${safe}_${stamp || localStamp()}`
  return { prefix, dir: path.join(rootDir, prefix) }
}

/** 本机时间戳 YYYYMMDDHHMMSS */
function localStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function resolveFfmpegPath(): string {
  const c: string[] = []
  // 打包后 ffmpeg 在 resources/ 下（extraResources），以前没找这里 ——
  // 结果别的电脑上找不到 ffmpeg，录制静默失败，界面一直 0 B。
  try {
    const res = (process as any).resourcesPath
    if (res) {
      c.push(path.join(res, 'ffmpeg.exe'))
      c.push(path.join(res, 'engine', 'bin', 'ffmpeg', 'bin', 'ffmpeg.exe'))
    }
  } catch { /* ignore */ }
  c.push(path.join(__dirname, 'ffmpeg.exe'))
  try { c.push(path.join(path.dirname(process.execPath), 'ffmpeg.exe')) } catch { /* ignore */ }
  c.push(path.join(process.cwd(), 'ffmpeg.exe'))

  for (const p of c) {
    try { if (fs.existsSync(p)) return p } catch { /* ignore */ }
  }
  // 最后一个兵：让系统 PATH 去找（开发机上常常这样）
  logger.warn(LOG_MODULE, `没在程序目录里找到 ffmpeg.exe，尝试用系统 PATH 里的 ffmpeg：${c.join(' | ')}`)
  return 'ffmpeg'
}
