// 验证 App 里的「登录抖音」入口：窗口能打开、能检测登录态、关闭后能正确返回。
// 运行：electron test-login-window.cjs

const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

const LOGFILE = path.join(os.tmpdir(), 'test-login-window.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  try { process.stdout.write(String(s) + '\n') } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => log('UNCAUGHT: ' + ((e && e.stack) || e)))

app.commandLine.appendSwitch('disable-features', 'FontFlash')

app.whenReady().then(async () => {
  const { douyinLoginState, openDouyinLogin } = require('../dist-electron/services/danmu-capture.js')

  log('登录态（应该是 true，本机之前已经登过）：' + JSON.stringify(await douyinLoginState()))

  const pending = openDouyinLogin()
  setTimeout(async () => {
    const wins = BrowserWindow.getAllWindows()
    log('打开的窗口数=' + wins.length)
    for (const w of wins) {
      log('  标题=' + w.getTitle())
      log('  网址=' + String(w.webContents.getURL()).slice(0, 60))
      log('  可见=' + w.isVisible())
      w.destroy()
    }
    const res = await pending
    log('openDouyinLogin 返回：' + JSON.stringify(res))
    log('检测完退出')
    app.exit(0)
  }, 12000)
}).catch((e) => log('失败: ' + ((e && e.stack) || e)))
