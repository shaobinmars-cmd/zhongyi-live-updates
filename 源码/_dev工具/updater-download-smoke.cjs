// 更新下载专项：真实从 GitHub 清单附件下载，验证代理优先、进度推进和落盘。
const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const temp = path.join(os.tmpdir(), `zy-updater-download-${Date.now()}`)
fs.mkdirSync(temp, { recursive: true })
process.env.LOCALAPPDATA = temp
app.setPath('userData', temp)
app.on('window-all-closed', () => { /* 测试脚本自己退出 */ })

function assert(ok, message) {
  if (!ok) throw new Error(message)
  console.log('[OK] ' + message)
}

app.whenReady().then(async () => {
  try {
    const updater = require('../dist-electron/services/updater.js')
    const progress = []
    const result = await updater.downloadManifest({
      version: 'probe',
      url: 'https://github.com/shaobinmars-cmd/zhongyi-live-updates/releases/download/v2.9.11/latest.json',
      size: 515
    }, (value) => progress.push(value))
    assert(result?.ok === true, 'GitHub 更新附件可下载')
    assert(fs.existsSync(result.path) && fs.statSync(result.path).size === 515, '下载文件大小正确')
    assert(progress.some((value) => Number(value) > 0), '下载进度会从 0 继续推进')
    assert(progress[progress.length - 1] === 100, '下载完成进度为 100%')
    console.log('UPDATER DOWNLOAD OK')
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* ignore */ }
    app.exit(0)
  } catch (error) {
    console.error(error?.stack || error)
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* ignore */ }
    app.exit(1)
  }
})
