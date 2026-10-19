// 更新安全专项：磁盘不足拒绝下载、残缺安装包拒绝启动。
const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const temp = path.join(os.tmpdir(), `zy-updater-smoke-${Date.now()}`)
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

    const disk = await updater.downloadManifest({
      version: '999.0.0',
      url: 'http://127.0.0.1:1/never.exe',
      size: 10 * 1024 ** 4
    })
    assert(!disk.ok && String(disk.message).includes('磁盘空间不足'), '磁盘不足时在下载前拒绝更新')

    const missing = updater.install(path.join(temp, 'missing.exe'))
    assert(!missing.ok && String(missing.message).includes('不存在'), '更新包不存在时拒绝启动安装')

    const small = path.join(temp, 'small.exe')
    fs.writeFileSync(small, Buffer.alloc(1024))
    const bad = updater.install(small)
    assert(!bad.ok && String(bad.message).includes('不完整'), '残缺更新包拒绝启动安装')

    assert(fs.existsSync(path.join(temp, 'douyin-live-info', 'updates')), '更新包使用固定用户目录')
    console.log('UPDATER SAFETY OK')
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* ignore */ }
    app.exit(0)
  } catch (e) {
    console.error(e && e.stack ? e.stack : e)
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* ignore */ }
    app.exit(1)
  }
})
