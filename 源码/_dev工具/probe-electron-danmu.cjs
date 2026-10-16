// 用 App 自带的 Electron 隐藏窗口抓抖音直播间 WebSocket 帧，验证「不用外部 Chrome」这条路。
// 运行：node_modules\electron\dist\electron.exe probe-electron-danmu.cjs
// 结果写到 %TEMP%\probe-electron-danmu.log

const { app, BrowserWindow, session } = require('electron')
const { gunzipSync } = require('zlib')
const fs = require('fs')
const path = require('path')
const os = require('os')

const LOGFILE = process.env.PROBE_LOGFILE || path.join(os.tmpdir(), 'probe-electron-danmu.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  try { process.stdout.write(String(s) + '\n') } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => log('UNCAUGHT: ' + ((e && e.stack) || e)))
process.on('unhandledRejection', (e) => log('UNHANDLED: ' + ((e && e.stack) || e)))

const ROOM = process.env.PROBE_ROOM || '166871145084'
const SECONDS = Number(process.env.PROBE_SECONDS || 45)
const MODE = process.env.PROBE_MODE || 'hidden'

app.commandLine.appendSwitch('disable-features', 'FontFlash')

function readVarint(buf, off) {
  let v = 0n, shift = 0n
  while (off < buf.length) {
    const b = buf[off++]
    v |= BigInt(b & 0x7f) << shift
    if ((b & 0x80) === 0) return { value: v, next: off }
    shift += 7n
    if (shift > 70n) throw new Error('varint too long')
  }
  throw new Error('varint eof')
}
function readFields(buf) {
  const out = []
  let off = 0
  while (off < buf.length) {
    const t = readVarint(buf, off); off = t.next
    const tag = Number(t.value), no = tag >> 3, wire = tag & 7
    if (no === 0) break
    if (wire === 0) { const r = readVarint(buf, off); off = r.next; out.push({ no, wire, value: r.value }) }
    else if (wire === 1) { out.push({ no, wire, value: buf.readBigUInt64LE(off) }); off += 8 }
    else if (wire === 2) { const l = readVarint(buf, off); off = l.next; const n = Number(l.value); out.push({ no, wire, value: buf.subarray(off, off + n) }); off += n }
    else if (wire === 5) { out.push({ no, wire, value: BigInt(buf.readUInt32LE(off)) }); off += 4 }
    else throw new Error('bad wire ' + wire)
  }
  return out
}
const fields = (b) => { const m = {}; for (const f of readFields(b)) (m[f.no] ||= []).push(f.value); return m }
const one = (m, n) => (m[n] ? m[n][0] : undefined)
const str = (m, n) => { const v = one(m, n); return v == null ? '' : (Buffer.isBuffer(v) ? v.toString('utf8') : String(v)) }
const num = (m, n) => { const v = one(m, n); return v == null ? 0 : Number(v) }
const maybeGunzip = (b) => (b && b.length > 2 && b[0] === 0x1f && b[1] === 0x8b) ? gunzipSync(b) : b

function decodeFrame(buf) {
  const f = fields(buf)
  const headers = {}
  for (const hb of f[5] ?? []) { const hm = fields(hb); const k = str(hm, 1); if (k) headers[k] = str(hm, 2) }
  const payloadType = str(f, 7)
  const payload = maybeGunzip(one(f, 8))
  const messages = []
  if (payloadType === 'msg' || payloadType === 'push') {
    const r = fields(payload)
    for (const mb of r[1] ?? []) {
      const mm = fields(mb)
      messages.push({ method: str(mm, 1), msgId: num(mm, 3), payload: one(mm, 2) })
    }
  }
  return { headers, payloadType, messages }
}
function decodeUser(buf) {
  const u = fields(buf)
  let avatar = ''
  const af = one(u, 9)
  if (af) { try { avatar = str(fields(af), 1) } catch { /* ignore */ } }
  return { nickname: str(u, 3), secUid: str(u, 46), avatar }
}
function decodeBody(method, payload) {
  const b = fields(maybeGunzip(payload))
  if (method.includes('ChatMessage')) return { kind: 'Chat', ...(one(b, 2) ? decodeUser(one(b, 2)) : {}), content: str(b, 3) }
  if (method.includes('MemberMessage')) return { kind: 'Member', ...(one(b, 2) ? decodeUser(one(b, 2)) : {}) }
  if (method.includes('GiftMessage')) {
    const g = one(b, 15) ? fields(one(b, 15)) : {}
    return { kind: 'Gift', ...(one(b, 7) ? decodeUser(one(b, 7)) : {}), giftName: str(g, 16), count: num(b, 5) || num(b, 4) || 1 }
  }
  if (method.includes('LikeMessage')) return { kind: 'Like', ...(one(b, 5) ? decodeUser(one(b, 5)) : {}) }
  if (method.includes('SocialMessage')) return { kind: 'Social', ...(one(b, 2) ? decodeUser(one(b, 2)) : {}) }
  if (method.includes('RoomUserSeqMessage')) return { kind: 'Stats', total: num(b, 3), totalUser: num(b, 7) }
  return { kind: 'Other', method }
}

app.whenReady().then(async () => {
  log('app ready')
  setTimeout(() => { log('硬超时退出'); app.exit(0) }, (SECONDS + 25) * 1000)

  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  const PART = process.env.PROBE_PARTITION || 'persist:danmu-probe'
  const part = session.fromPartition(PART)
  part.setUserAgent(ua)

  if (process.env.PROBE_BLOCK === '1') {
    part.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
      const t = details.resourceType
      cb({ cancel: t === 'image' || t === 'media' || t === 'font' })
    })
    log('已开启资源拦截（image/media/font）')
  }

  const W = Number(process.env.PROBE_W || 1280)
  const H = Number(process.env.PROBE_H || 800)
  const opts = { show: false, width: W, height: H, webPreferences: { partition: PART, backgroundThrottling: false } }
  if (MODE === 'offscreen') { opts.show = true; opts.x = -2600; opts.y = -2600; opts.skipTaskbar = true }
  if (MODE === 'visible') opts.show = true
  if (MODE === 'ghost') { opts.show = true; opts.skipTaskbar = true; opts.opacity = 0; opts.focusable = false; opts.x = 20; opts.y = 20 }
  if (MODE === 'min') { opts.show = true; opts.skipTaskbar = true }

  const win = new BrowserWindow(opts)
  if (MODE === 'ghost') { try { win.setIgnoreMouseEvents(true); win.setOpacity(0) } catch (e) { log('ghost 设置失败: ' + e.message) } }
  if (MODE === 'min') { win.minimize() }
  win.webContents.setAudioMuted(true)
  win.webContents.setUserAgent(ua)

  const dbg = win.webContents.debugger
  try { dbg.attach('1.3'); log('debugger attached') } catch (e) { log('debugger attach 失败: ' + e.message) }

  const stats = { frames: 0, text: 0, binary: 0, decoded: 0, failed: 0, kinds: {} }
  const wsUrls = {}
  dbg.on('message', (_e, method, params) => {
    if (method === 'Network.webSocketCreated') {
      const u = String(params && params.url || '').slice(0, 90)
      wsUrls[u] = (wsUrls[u] || 0) + 1
      log('  [WS建立] ' + u)
    }
  })
  dbg.on('message', (_e, method, params) => {
    if (method !== 'Network.webSocketFrameReceived') return
    const opcode = params && params.response ? params.response.opcode : undefined
    stats.frames++
    if (opcode === 1) { stats.text++; return }
    stats.binary++
    let buf
    try { buf = Buffer.from(params.response.payloadData || '', 'base64') } catch { return }
    let dec
    try { dec = decodeFrame(buf) } catch (e) { stats.failed++; return }
    stats.decoded++
    for (const m of dec.messages) {
      let body
      try { body = decodeBody(m.method, m.payload) } catch { continue }
      stats.kinds[body.kind] = (stats.kinds[body.kind] || 0) + 1
      if (body.kind === 'Chat') log('  [弹幕] ' + body.nickname + '：' + body.content)
      else if (body.kind === 'Gift') log('  [礼物] ' + body.nickname + ' 送出 ' + body.giftName + ' x' + body.count)
      else if (body.kind === 'Stats') log('  [统计] 在线 ' + body.totalUser + ' 热度 ' + body.total)
    }
  })

  dbg.sendCommand('Network.enable').then(() => log('Network.enable 完成')).catch((e) => log('Network.enable 失败: ' + e.message))

  log('模式=' + MODE + ' 房间=' + ROOM + ' 监听 ' + SECONDS + ' 秒…')
  win.loadURL('https://live.douyin.com/' + ROOM).catch((e) => log('loadURL 异常: ' + e.message))
  win.webContents.on('did-finish-load', () => log('  页面加载完成'))
  win.webContents.on('did-fail-load', (_e, code, desc) => log('  加载失败 ' + code + ' ' + desc))

  setTimeout(() => {
    log('')
    log('===== 结果 =====')
    log('总帧 ' + stats.frames + '（文本 ' + stats.text + ' / 二进制 ' + stats.binary + '） 解帧成功 ' + stats.decoded + ' 失败 ' + stats.failed)
    log('类型分布 ' + JSON.stringify(stats.kinds))
    log('WS 连接：' + JSON.stringify(wsUrls))
    log(stats.kinds.Chat ? '结论：Electron 这条路可行，收到 ' + stats.kinds.Chat + ' 条弹幕 OK' : '结论：没收到弹幕 FAIL')
    app.exit(0)
  }, SECONDS * 1000)
}).catch((e) => log('whenReady 失败: ' + ((e && e.stack) || e)))
