// 验证开发态能自动找到 H 盘项目里的拆解引擎，不依赖 D 盘或环境变量。
const { app } = require('electron')
const path = require('path')
const os = require('os')

app.setPath('userData', path.join(os.tmpdir(), 'zhongyi-engine-path-smoke'))
app.on('window-all-closed', () => { /* 测试脚本自己退出 */ })

app.whenReady().then(() => {
  try {
    const td = require('../dist-electron/services/teardown.js')
    const status = td.engineStatus()
    console.log(JSON.stringify({
      ok: status.ok,
      root: status.root,
      pythonExists: status.pythonExists,
      scriptExists: status.scriptExists,
      ffmpegExists: status.ffmpegExists
    }, null, 2))
    const expected = path.resolve(__dirname, '..', '..', '直播拆解引擎')
    if (!status.ok || path.resolve(status.root) !== expected) {
      console.error(`FAIL：应找到 ${expected}`)
      app.exit(1)
      return
    }
    console.log('ENGINE PATH OK')
    app.exit(0)
  } catch (e) {
    console.error(e && e.stack ? e.stack : e)
    app.exit(1)
  }
})
