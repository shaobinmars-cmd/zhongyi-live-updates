// 验证「正式软件的数据目录」里的弹幕环境：登录态能不能读到 + 真能收到弹幕。
// 这个脚本会先把 userData 指到 %APPDATA%\douyin-live-info（和打包后的软件一致）。
// 运行：electron check-app-partition.cjs [房间号...]

const { app, session } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

app.setPath('userData', path.join(app.getPath('appData'), 'douyin-live-info'))
app.commandLine.appendSwitch('disable-features', 'FontFlash')
app.on('window-all-closed', () => { /* 别退 */ })

const LOGFILE = path.join(os.tmpdir(), 'check-app-partition.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  try { process.stdout.write(String(s) + '\n') } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => log('UNCAUGHT: ' + ((e && e.stack) || e)))
process.on('unhandledRejection', (e) => log('UNHANDLED: ' + ((e && e.stack) || e)))

const ROOMS = process.argv.slice(2).filter((a) => /^\d+$/.test(a))
const SECONDS = Number(process.env.CHECK_SECONDS || 90)

app.whenReady().then(async () => {
  log('userData = ' + app.getPath('userData'))

  const part = session.fromPartition('persist:douyin-danmu')
  const cookies = await part.cookies.get({})
  const loggedIn = cookies.some((c) => c.name === 'sessionid' && String(c.value || '').length > 8)
  log(`弹幕会话 cookie 数=${cookies.length}　已登录抖音=${loggedIn ? '是' : '否'}`)

  const { DanmuService } = require('../dist-electron/services/danmu.js')
  const counters = {}

  for (const rid of ROOMS) {
    counters[rid] = { chat: 0, gift: 0, member: 0, stats: 0 }
    const svc = new DanmuService()
    svc.onStatusChanged = (s) => log(`[${rid}] 状态 ${s}`)
    svc.onDisconnected = (r) => log(`[${rid}] 断开 ${r}`)
    svc.onMessage = (msg) => {
      const c = counters[rid]
      if (msg.type === 'Chat') { c.chat++; if (c.chat <= 3) log(`  [${rid}] 弹幕 ${msg.userName}：${msg.content}`) }
      else if (msg.type === 'Gift') c.gift++
      else if (msg.type === 'Member') c.member++
      else if (msg.type === 'Stats') c.stats++
    }
    svc.connect('check-' + rid, rid, '自检').catch((ex) => log(`[${rid}] 连接异常 ${ex.message}`))
  }

  setTimeout(() => {
    log('')
    log('===== 结果 =====')
    let total = 0
    for (const rid of ROOMS) {
      log(`[${rid}] ${JSON.stringify(counters[rid])}`)
      total += counters[rid].chat
    }
    log(total > 0 ? `结论：正式数据目录里能正常收弹幕，共 ${total} 条 ✅` : '结论：这个时间段没拿到弹幕（换房间或稍后再试）')
    app.exit(0)
  }, SECONDS * 1000)
}).catch((e) => log('失败: ' + ((e && e.stack) || e)))
