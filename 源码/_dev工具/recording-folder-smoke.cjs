// 一场直播一个文件夹专项：目录命名 + 拆解列表识别。
const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const temp = path.join(os.tmpdir(), `zy-recording-folder-${Date.now()}`)
app.setPath('userData', temp)
app.on('window-all-closed', () => { /* 测试脚本自己退出 */ })

function assert(ok, message) {
  if (!ok) throw new Error(message)
  console.log('[OK] ' + message)
}

app.whenReady().then(() => {
  try {
    const sr = require('../dist-electron/services/stream-recorder.js')
    const cfg = require('../dist-electron/services/record-config.js')
    const td = require('../dist-electron/services/teardown.js')
    const root = path.join(temp, '录像')
    fs.mkdirSync(root, { recursive: true })
    cfg.saveConfig({ outputPath: root })

    const stamp = '20261019153000'
    const session = sr.recordingSessionPath(root, '测试 主播', '123456', stamp)
    assert(path.basename(session.dir) === '测试 主播_20261019153000', '场次文件夹用主播名和开播时间命名')
    assert(session.prefix === '测试 主播_20261019153000', '文件名前缀与文件夹同名')

    fs.mkdirSync(session.dir, { recursive: true })
    fs.writeFileSync(path.join(session.dir, `${session.prefix}.meta.json`), JSON.stringify({ roomId: '123456', nickname: '测试 主播', startedAtUtc: '2026-10-19 07:30:00' }))
    fs.writeFileSync(path.join(session.dir, `${session.prefix}_000.mp4`), Buffer.alloc(1024))
    fs.writeFileSync(path.join(session.dir, `${session.prefix}_001.mp4`), Buffer.alloc(1024))

    const list = td.listRecordings()
    const hit = list.find((x) => path.resolve(x.path) === path.resolve(session.dir))
    assert(!!hit, '拆解列表把整场文件夹识别为一条录像')
    assert(hit.nickname === '测试 主播', '拆解列表能从场次旁注读出主播名')

    console.log('RECORDING FOLDER OK')
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* ignore */ }
    app.exit(0)
  } catch (e) {
    console.error(e && e.stack ? e.stack : e)
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* ignore */ }
    app.exit(1)
  }
})
