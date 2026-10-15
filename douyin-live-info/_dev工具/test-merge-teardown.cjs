// 验证：多分段合并 + 拆解 → 素材包（含弹幕/礼物）落在本场专属目录
const { app } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

app.setPath('userData', path.join(app.getPath('appData'), 'douyin-live-info'))
process.env.TEARDOWN_ENGINE = 'D:\\直播拆解工具'
app.on('window-all-closed', () => { /* 别退 */ })

const LOGFILE = path.join(os.tmpdir(), 'test-merge-teardown.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  try { process.stdout.write(String(s) + '\n') } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => log('UNCAUGHT: ' + ((e && e.stack) || e)))

const DIR = 'H:\\迅雷下载'
const SEG1 = path.join(DIR, '测试主播_20261015120000_001.mp4')
const SEG2 = path.join(DIR, '测试主播_20261015120000_002.mp4')

app.whenReady().then(async () => {
  const td = require('../dist-electron/services/teardown.js')
  td.setLogHandler((l) => log('  ' + l))

  // 造第二个分段（模拟「30 分钟切一段」或「断流重连又写了一段」）
  if (!fs.existsSync(SEG2)) fs.copyFileSync(SEG1, SEG2)
  log('两个分段：')
  for (const f of [SEG1, SEG2]) log('  ' + path.basename(f) + '  ' + (fs.statSync(f).size / 1024 / 1024).toFixed(1) + 'MB')

  log('\n--- 1) 合并分段 ---')
  const merged = await td.prepareInput(SEG1)
  log('prepareInput 返回：' + merged)
  if (merged && merged !== SEG1 && fs.existsSync(merged)) {
    log('合并文件：' + path.basename(merged) + '  ' + (fs.statSync(merged).size / 1024 / 1024).toFixed(1) + 'MB')
  }

  log('\n--- 2) 列表里看一下（应该只出现一条本场） ---')
  const list = td.listRecordings().filter((r) => /测试主播/.test(r.path))
  for (const r of list) log('  ' + (r.analyzed ? '[已拆]' : '[未拆]') + ' ' + path.basename(r.path))

  log('\n--- 3) 拆解（会自动用合并文件） ---')
  const started = Date.now()
  td.start(SEG1, 'small')
  const timer = setInterval(() => {
    const s = td.getState()
    if (s.running) return
    clearInterval(timer)
    setTimeout(() => {
      log(`\n跑完：${Math.round((Date.now() - started) / 1000)} 秒，阶段=${s.stage}`)
      const p = td.packetPathFor(SEG1)
      log('本场素材包路径：' + p)
      if (p && fs.existsSync(p)) {
        const text = fs.readFileSync(p, 'utf-8')
        log('素材包字数=' + text.length + '，含第七节=' + text.includes('## 七、弹幕与礼物'))
        log('所在目录：' + path.dirname(p))
      } else {
        log('没有生成素材包')
      }
      app.exit(0)
    }, 1500)
  }, 3000)
}).catch((e) => log('失败: ' + ((e && e.stack) || e)))
