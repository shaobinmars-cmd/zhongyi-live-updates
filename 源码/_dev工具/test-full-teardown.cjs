// 端到端测试：用 App 自己的拆解流程跑一遍（含「弹幕/礼物并入素材包」）
// 运行：electron test-full-teardown.cjs
const { app } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

app.setPath('userData', path.join(app.getPath('appData'), 'douyin-live-info'))
process.env.TEARDOWN_ENGINE = 'H:\\众艺传媒运营工具\\直播拆解引擎'
app.on('window-all-closed', () => { /* 别退 */ })

const LOGFILE = path.join(os.tmpdir(), 'test-full-teardown.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  try { process.stdout.write(String(s) + '\n') } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => log('UNCAUGHT: ' + ((e && e.stack) || e)))

app.whenReady().then(async () => {
  const td = require('../dist-electron/services/teardown.js')

  const eng = td.engineStatus()
  log('引擎：ok=' + eng.ok + '  root=' + eng.root)
  if (!eng.ok) { log('引擎不可用，停'); app.exit(1); return }

  const list = td.listRecordings()
  log('拆解页列出 ' + list.length + ' 个录像：')
  for (const r of list.slice(0, 8)) log('  ' + (r.analyzed ? '[已拆]' : '[未拆]') + ' ' + path.basename(r.path))

  const target = list.find((r) => /测试主播/.test(r.path))
  if (!target) { log('没找到测试录像（测试主播_20261015120000_001.mp4）'); app.exit(1); return }
  log('\n开始拆解：' + target.path)

  td.setLogHandler((l) => log('  ' + l))
  td.setStateHandler((s) => { if (s.error) log('  [错误] ' + s.error) })
  td.start(target.path, 'small')

  const started = Date.now()
  const timer = setInterval(() => {
    const s = td.getState()
    const secs = Math.round((Date.now() - started) / 1000)
    if (secs % 30 < 6) log(`  …已跑 ${secs} 秒，阶段：${s.stage}`)
    if (s.running) return
    clearInterval(timer)
    setTimeout(() => {
      log(`\n跑完，用时 ${Math.round((Date.now() - started) / 1000)} 秒，最终阶段：${s.stage}`)
      const p = td.packetPathFor(target.path)
      log('素材包：' + p)
      if (p && fs.existsSync(p)) {
        const text = fs.readFileSync(p, 'utf-8')
        log('素材包字数=' + text.length)
        log('含第七节（弹幕/礼物）=' + text.includes('## 七、弹幕与礼物'))
        log('含礼物汇总表=' + text.includes('### 礼物汇总'))
        log('含每分钟互动密度=' + text.includes('### 每分钟互动密度'))
        const idx = text.indexOf('## 七、弹幕与礼物')
        if (idx >= 0) log('\n——— 第七节内容（节选）———\n' + text.slice(idx, idx + 1100))
      } else {
        log('没有生成素材包')
      }
      app.exit(0)
    }, 2000)
  }, 3000)
}).catch((e) => log('失败: ' + ((e && e.stack) || e)))
