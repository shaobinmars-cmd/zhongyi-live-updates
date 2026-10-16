// 双通道 + 多房间验证：
//  - 通道A：生产代码 DanmuService（App 里真正用的）
//  - 通道B：探针写法（同一进程、同一时刻、同一房间）当对照
// 运行：electron test-danmu-dual.cjs 房间1 [房间2 房间3 ...]

const { app, BrowserWindow, session } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

const LOGFILE = path.join(os.tmpdir(), 'test-danmu-dual.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  try { process.stdout.write(String(s) + '\n') } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => log('UNCAUGHT: ' + ((e && e.stack) || e)))
process.on('unhandledRejection', (e) => log('UNHANDLED: ' + ((e && e.stack) || e)))

const ROOMS = process.argv.slice(2).filter((a) => /^\d+$/.test(a))
const SECONDS = Number(process.env.TEST_SECONDS || 90)

app.commandLine.appendSwitch('disable-features', 'FontFlash')

app.whenReady().then(async () => {
  const { DanmuService } = require('../dist-electron/services/danmu.js')
  const { decodePushFrame } = require('../dist-electron/services/danmu-capture.js')

  const counters = {}
  const services = []

  for (const rid of ROOMS) {
    counters[rid] = { chat: 0, gift: 0, member: 0, stats: 0, other: 0 }
    const svc = new DanmuService()
    svc.onStatusChanged = (s) => log(`[${rid}] 状态 ${s}`)
    svc.onDisconnected = (r) => log(`[${rid}] 断开 ${r}`)
    svc.onMessage = (msg) => {
      const c = counters[rid]
      if (msg.type === 'Chat') { c.chat++; if (c.chat <= 5) log(`  [${rid}] 弹幕 ${msg.userName}：${msg.content}`) }
      else if (msg.type === 'Gift') c.gift++
      else if (msg.type === 'Member') c.member++
      else if (msg.type === 'Stats') c.stats++
      else c.other++
    }
    services.push({ rid, svc })
  }

  // ---- 对照通道B：探针写法（只对第一个房间） ----
  const REF = ROOMS[0]
  const refStats = { binary: 0, messages: 0, chat: 0 }
  if (REF) {
    const REF_PARTITION = process.env.REF_PARTITION || 'persist:danmu-ref'
    const part = session.fromPartition(REF_PARTITION)
    part.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
    const win = new BrowserWindow({
      show: true, width: 1280, height: 800, x: 20, y: 20, skipTaskbar: true, focusable: false, opacity: 0,
      webPreferences: { partition: REF_PARTITION, backgroundThrottling: false }
    })
    win.setIgnoreMouseEvents(true)
    win.webContents.setAudioMuted(true)
    const dbg = win.webContents.debugger
    try { dbg.attach('1.3') } catch { /* ignore */ }
    dbg.on('message', (_e, method, params) => {
      if (method !== 'Network.webSocketFrameReceived') return
      if (params?.response?.opcode !== 2) return
      let raw
      try { raw = Buffer.from(params.response.payloadData || '', 'base64') } catch { return }
      refStats.binary++
      try {
        const msgs = decodePushFrame(raw)
        refStats.messages += msgs.length
        for (const m of msgs) if (m.method.includes('WebcastChatMessage')) refStats.chat++
      } catch { /* ignore */ }
    })
    dbg.sendCommand('Network.enable').catch(() => { /* ignore */ })
    win.loadURL('https://live.douyin.com/' + REF).catch(() => { /* ignore */ })
    log(`[对照] 探针窗口已打开房间 ${REF}`)
  }

  for (const { rid, svc } of services) {
    svc.connect('test-' + rid, rid, '测试').catch((ex) => log(`[${rid}] 连接异常 ${ex.message}`))
  }

  setTimeout(() => {
    log('')
    log('===== 结果 =====')
    for (const { rid } of services) log(`[${rid}] ${JSON.stringify(counters[rid])}`)
    log(`[对照探针 ${REF}] ${JSON.stringify(refStats)}`)
    for (const { svc } of services) svc.disconnect()
    setTimeout(() => app.exit(0), 800)
  }, SECONDS * 1000)
}).catch((e) => log('whenReady 失败: ' + ((e && e.stack) || e)))
