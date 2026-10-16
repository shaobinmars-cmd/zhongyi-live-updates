// 验证：把「能收弹幕」那个分区的抖音登录态搬到干净分区，看弹幕是否就能收到。
// 运行：electron test-login-transfer.cjs [房间号] [秒数]

const { app, BrowserWindow, session } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

const LOGFILE = path.join(os.tmpdir(), 'test-login-transfer.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  try { process.stdout.write(String(s) + '\n') } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => log('UNCAUGHT: ' + ((e && e.stack) || e)))
process.on('unhandledRejection', (e) => log('UNHANDLED: ' + ((e && e.stack) || e)))

const ROOM = process.argv[2] || '453001016610'
const SECONDS = Number(process.argv[3] || 55)
const SOURCE = 'persist:danmu-probe'
const TARGET = 'persist:verify-login'

app.commandLine.appendSwitch('disable-features', 'FontFlash')

app.whenReady().then(async () => {
  const { decodePushFrame } = require('../dist-electron/services/danmu-capture.js')

  const src = session.fromPartition(SOURCE)
  const dst = session.fromPartition(TARGET)

  const cookies = await src.cookies.get({})
  let ok = 0
  let fail = 0
  for (const c of cookies) {
    const url = `${c.secure ? 'https' : 'http'}://${String(c.domain || '').replace(/^\./, '')}${c.path || '/'}`
    try {
      await dst.cookies.set({
        url,
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
        expirationDate: c.expirationDate
      })
      ok++
    } catch (ex) {
      fail++
      if (fail <= 5) log(`  写入失败 ${c.name}@${c.domain}：${ex.message}`)
    }
  }
  log(`搬运 cookie：成功 ${ok}，失败 ${fail}`)
  const have = (await dst.cookies.get({ name: 'sessionid' })).length > 0
  log(`目标分区是否已登录：${have ? '是' : '否'}`)

  const part = dst
  part.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')

  const stats = { binary: 0, chat: 0, messages: 0, kinds: {} }
  const win = new BrowserWindow({
    show: true, width: 420, height: 260, x: 20, y: 20, skipTaskbar: true, focusable: false, opacity: 0,
    webPreferences: { partition: TARGET, backgroundThrottling: false }
  })
  win.setIgnoreMouseEvents(true)
  win.webContents.setAudioMuted(true)
  const dbg = win.webContents.debugger
  try { dbg.attach('1.3') } catch { /* ignore */ }
  dbg.on('message', (_e, method, params) => {
    if (method !== 'Network.webSocketFrameReceived') return
    if (params?.response?.opcode !== 2) return
    stats.binary++
    let raw
    try { raw = Buffer.from(params.response.payloadData || '', 'base64') } catch { return }
    try {
      for (const m of decodePushFrame(raw)) {
        stats.messages++
        const short = m.method.replace('Webcast', '').replace('Message', '')
        stats.kinds[short] = (stats.kinds[short] || 0) + 1
        if (m.method.includes('WebcastChatMessage')) stats.chat++
      }
    } catch { /* ignore */ }
  })
  dbg.sendCommand('Network.enable').catch(() => { /* ignore */ })
  win.loadURL('https://live.douyin.com/' + ROOM).catch(() => { /* ignore */ })
  log(`已在【验证分区】打开房间 ${ROOM}，监听 ${SECONDS} 秒…`)

  setTimeout(() => {
    log('')
    log('===== 结果 =====')
    log(`二进制帧 ${stats.binary}　消息 ${stats.messages}　弹幕 ${stats.chat}`)
    log('消息类型：' + JSON.stringify(stats.kinds))
    log(stats.chat > 0 ? '结论：登录态搬过去后能收到弹幕 ✅' : '结论：仍然收不到 ❌')
    app.exit(0)
  }, SECONDS * 1000)
}).catch((e) => log('whenReady 失败: ' + ((e && e.stack) || e)))
