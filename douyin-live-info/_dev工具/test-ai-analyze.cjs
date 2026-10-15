// 验证 AI 分析：配置接口 → 测试连接 → 对一份真实素材包跑分析
// 运行：electron test-ai-analyze.cjs "<素材包目录或视频路径>"
// 环境变量：AI_BASE / AI_KEY / AI_MODEL

const { app } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

app.setPath('userData', path.join(app.getPath('appData'), 'douyin-live-info'))
app.on('window-all-closed', () => { /* 别退 */ })

const LOGFILE = path.join(os.tmpdir(), 'test-ai-analyze.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  try { process.stdout.write(String(s) + '\n') } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => log('UNCAUGHT: ' + ((e && e.stack) || e)))

app.whenReady().then(async () => {
  const ai = require('../dist-electron/services/ai-analyze.js')

  if (process.env.AI_BASE) {
    const saved = ai.saveAiConfig({
      enabled: true,
      baseUrl: process.env.AI_BASE,
      apiKey: process.env.AI_KEY || '',
      model: process.env.AI_MODEL || 'deepseek-chat'
    })
    log('已写入 AI 配置：' + JSON.stringify({ baseUrl: saved.baseUrl, model: saved.model, hasKey: !!saved.apiKey }))
  } else {
    const cfg = ai.loadAiConfig()
    log('现有 AI 配置：' + JSON.stringify({ baseUrl: cfg.baseUrl, model: cfg.model, hasKey: !!cfg.apiKey }))
  }

  log('测试连接…')
  const t = await ai.testAiConnection()
  log('测试连接结果：' + JSON.stringify(t))
  if (!t.ok) { app.exit(2); return }

  const target = process.argv[2]
  if (!target) { log('没给素材包路径'); app.exit(3); return }
  log('开始分析：' + target)
  const started = Date.now()
  const res = await ai.analyzePacket(target, (p) => log('  [进度] ' + JSON.stringify(p)))
  log('分析返回：' + JSON.stringify(res))
  if (res.reportPath && fs.existsSync(res.reportPath)) {
    const st = fs.statSync(res.reportPath)
    log(`报告已生成：${res.reportPath}（${st.size} 字节，用时 ${Math.round((Date.now() - started) / 1000)} 秒）`)
    const text = fs.readFileSync(res.reportPath, 'utf-8')
    log('报告开头：\n' + text.split('\n').slice(0, 12).join('\n'))
  }
  app.exit(0)
}).catch((e) => log('失败: ' + ((e && e.stack) || e)))
