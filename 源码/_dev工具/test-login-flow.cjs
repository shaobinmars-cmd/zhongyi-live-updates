// 完整验证「运营第一次用」的登录流程：清掉登录态 → 打开登录窗口（应保持打开）→ 关掉 → 再恢复登录态。
// 运行：electron test-login-flow.cjs

const { app, BrowserWindow, session } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

const LOGFILE = path.join(os.tmpdir(), 'test-login-flow.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  try { process.stdout.write(String(s) + '\n') } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => log('UNCAUGHT: ' + ((e && e.stack) || e)))

const PART = 'persist:douyin-danmu'
const SRC = 'persist:danmu-probe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.commandLine.appendSwitch('disable-features', 'FontFlash')
app.on('window-all-closed', () => { /* 测试期间别退出 */ })

async function copyCookies(from, to) {
  const src = session.fromPartition(from)
  const dst = session.fromPartition(to)
  const cookies = await src.cookies.get({})
  let ok = 0
  for (const c of cookies) {
    const url = `${c.secure ? 'https' : 'http'}://${String(c.domain || '').replace(/^\./, '')}${c.path || '/'}`
    try {
      await dst.cookies.set({
        url, name: c.name, value: c.value, domain: c.domain, path: c.path,
        secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, expirationDate: c.expirationDate
      })
      ok++
    } catch { /* ignore */ }
  }
  return ok
}

app.whenReady().then(async () => {
  const { douyinLoginState, openDouyinLogin } = require('../dist-electron/services/danmu-capture.js')

  log('步骤1：清掉登录态，模拟新装软件')
  await session.fromPartition(PART).clearStorageData()
  log('  现在登录态 = ' + JSON.stringify(await douyinLoginState()))

  log('步骤2：调用 App 的「登录抖音」（窗口应保持打开，等人扫码）')
  const pending = openDouyinLogin()
  await sleep(9000)
  const wins = BrowserWindow.getAllWindows()
  log('  打开窗口数=' + wins.length)
  for (const w of wins) {
    log('  标题=' + w.getTitle())
    log('  网址=' + String(w.webContents.getURL()).slice(0, 70))
    log('  可见=' + w.isVisible())
    try {
      const info = await w.webContents.executeJavaScript(`({text:(document.body.innerText||'').replace(/\\s+/g,' ').slice(0,200), canvases:document.querySelectorAll('canvas').length, imgs:document.querySelectorAll('img').length})`, true)
      log('  页面文字=' + info.text)
      log('  canvas数=' + info.canvases + ' img数=' + info.imgs)
    } catch (ex) { log('  取页面内容失败: ' + ex.message) }
  }
  log('  仍在等待登录（窗口没被自动关掉）=' + (wins.length > 0 ? '对' : '不对'))

  log('步骤3：模拟用户放弃登录，直接关窗')
  for (const w of wins) w.destroy()
  log('  openDouyinLogin 返回：' + JSON.stringify(await pending))

  log('步骤4：恢复登录态（正式使用时应由用户扫码完成）')
  const n = await copyCookies(SRC, PART)
  log('  恢复 cookie ' + n + ' 个，登录态 = ' + JSON.stringify(await douyinLoginState()))

  log('完成')
  app.exit(0)
}).catch((e) => log('失败: ' + ((e && e.stack) || e)))
