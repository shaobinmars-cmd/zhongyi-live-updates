// 验证「已登录状态下点更换账号」：窗口应该停住等人扫码，而不是一秒就自己关掉。
// 运行：electron test-switch-account.cjs

const { app, BrowserWindow, session } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

app.setPath('userData', path.join(app.getPath('appData'), 'douyin-live-info'))
app.commandLine.appendSwitch('disable-features', 'FontFlash')
app.on('window-all-closed', () => { /* 测试期间别退出 */ })

const LOGFILE = path.join(os.tmpdir(), 'test-switch-account.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  try { process.stdout.write(String(s) + '\n') } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => log('UNCAUGHT: ' + ((e && e.stack) || e)))

app.whenReady().then(async () => {
  const { douyinLoginState, openDouyinLogin } = require('../dist-electron/services/danmu-capture.js')

  log('当前登录态：' + JSON.stringify(await douyinLoginState()))

  const pending = openDouyinLogin()
  await new Promise((r) => setTimeout(r, 9000))

  const wins = BrowserWindow.getAllWindows()
  log('9 秒后窗口数=' + wins.length + '（应该还是 1，说明没被自动关掉）')
  for (const w of wins) log('  网址=' + String(w.webContents.getURL()).slice(0, 70))

  for (const w of wins) w.destroy()
  log('关窗后返回：' + JSON.stringify(await pending))
  log('登录态仍然是：' + JSON.stringify(await douyinLoginState()))
  app.exit(0)
}).catch((e) => log('失败: ' + ((e && e.stack) || e)))
