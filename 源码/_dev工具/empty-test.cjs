const { app } = require('electron')
const path = require('path')
const fs = require('fs')
app.setPath('userData', path.join(app.getPath('appData'), 'douyin-live-info'))
process.env.TEARDOWN_ENGINE = 'H:\\众艺传媒运营工具\\直播拆解引擎'
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const td = require('../dist-electron/services/teardown.js')
  const f = 'H:\\迅雷下载\\空文件测试_20261015130000_001.mp4'
  fs.writeFileSync(f, Buffer.alloc(1200))
  const s = td.start(f, 'small')
  console.log('阶段=' + s.stage)
  console.log('错误=' + s.error)
  console.log('是否在跑=' + s.running)
  try { fs.unlinkSync(f) } catch {}
  try { fs.rmSync('H:\\迅雷下载\\work_空文件测试_20261015130000', { recursive: true, force: true }) } catch {}
  app.exit(0)
}).catch(e => { console.log('失败: ' + e.message); app.exit(1) })