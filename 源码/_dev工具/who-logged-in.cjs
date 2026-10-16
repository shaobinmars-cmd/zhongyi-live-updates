// 看一眼已登录会话是哪个抖音号（用于判断要不要给本机预置登录）
const { app, BrowserWindow, session } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

const LOGFILE = path.join(os.tmpdir(), 'who.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  try { process.stdout.write(String(s) + '\n') } catch { /* ignore */ }
}
app.on('window-all-closed', () => { /* 别退 */ })
app.commandLine.appendSwitch('disable-features', 'FontFlash')

const PART = process.argv[2] || 'persist:danmu-probe'

app.whenReady().then(async () => {
  const part = session.fromPartition(PART)
  part.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
  const win = new BrowserWindow({ show: true, width: 900, height: 600, x: 20, y: 20, skipTaskbar: true, opacity: 0, webPreferences: { partition: PART } })
  win.webContents.setAudioMuted(true)
  win.loadURL('https://www.douyin.com/user/self').catch(() => { /* ignore */ })
  setTimeout(async () => {
    try {
      const info = await win.webContents.executeJavaScript(`({title:document.title, text:(document.body.innerText||'').replace(/\\s+/g,' ').slice(0,160)})`, true)
      log('标题=' + info.title)
      log('页面文字=' + info.text)
    } catch (ex) { log('取不到: ' + ex.message) }
    win.destroy()
    app.exit(0)
  }, 14000)
}).catch((e) => log('失败: ' + ((e && e.stack) || e)))
