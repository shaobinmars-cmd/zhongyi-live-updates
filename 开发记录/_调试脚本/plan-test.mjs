// 2.7.4 孵化培训计划验证（在“全新数据目录”下跑）：
//   导入报告 → 建议赛道 → 生成 60 天计划 → 今日任务 → 保存反馈
// 用法：node plan-test.mjs <调试端口> <报告文件路径>
import { createRequire } from 'module'
import fs from 'fs'

const APP_PKG = 'H:/众艺直播运营工具/源码/package.json'
const require = createRequire(APP_PKG)
const WebSocket = require('ws')

const PORT = Number(process.argv[2] || 9480)
const REPORT = process.argv[3] || 'H:\\众艺直播运营工具\\开发记录\\_调试脚本\\测试报告_唱歌点歌.md'
const STREAMER = '测试主播A'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pickPage() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const page = list.find((t) => t.type === 'page' && !/devtools/.test(t.url || ''))
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* 等 */ }
    await sleep(1000)
  }
  throw new Error('连不上调试端口')
}

const page = await pickPage()
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 32 * 1024 * 1024 })
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
let id = 0
const pend = new Map()
ws.on('message', (raw) => {
  let m
  try { m = JSON.parse(raw.toString()) } catch { return }
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
})
const ev = async (expr) => {
  const i = ++id
  const r = await new Promise((res) => { pend.set(i, res); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } })) })
  if (r.result?.exceptionDetails) return 'EX: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)
  return r.result?.result?.value
}
await sleep(800)

console.log('版本：' + await ev(`(() => { const m = (document.body.innerText||'').match(/V\\s*[0-9.]+/); return m ? m[0] : '未显示' })()`))

// 1) 选报告文件导入（跟界面上「导入报告」按钮走同一个 IPC）
console.log('\n=== 1) 导入报告文件 ===')
const imp = await ev(`(async () => JSON.stringify(await window.electronAPI.incubateImport(${JSON.stringify(REPORT)})))()`)
console.log('  ' + imp)

// 2) 粘贴导入（另一条入口）
console.log('\n=== 2) 粘贴报告导入 ===')
const text = fs.readFileSync(REPORT, 'utf-8')
const imp2 = await ev(`(async () => JSON.stringify(await window.electronAPI.incubateImportText(${JSON.stringify(text)}, '粘贴测试报告')))()`)
console.log('  ' + imp2)

// 3) 生成 60 天计划
console.log('\n=== 3) 生成 60 天计划 ===')
const gen = await ev(`(async () => JSON.stringify(await window.electronAPI.incubateGeneratePlan({ streamer: ${JSON.stringify(STREAMER)}, track: '唱歌点歌', startDate: ${JSON.stringify(new Date().toISOString().slice(0, 10))}, source: '测试报告' })))()`)
console.log('  ' + gen)

// 4) 读计划
console.log('\n=== 4) 读计划 ===')
const planRaw = await ev(`(async () => JSON.stringify(await window.electronAPI.incubatePlan(${JSON.stringify(STREAMER)})))()`)
let plan = {}
try { plan = JSON.parse(planRaw) } catch { /* ignore */ }
console.log('  计划行：' + JSON.stringify(plan.plan))
console.log(`  课表天数：${(plan.days || []).length}  今天第 ${plan.dayIndex} 天  阶段：${plan.phase}`)
for (const d of (plan.days || []).slice(0, 3)) console.log(`   ${d['日期']} ${d['今天练什么']} ｜ 验收：${d['验收']}`)
console.log('   …')
for (const d of (plan.days || []).slice(-2)) console.log(`   ${d['日期']} ${d['今天练什么']}`)

// 5) 保存今日反馈 → 再读
console.log('\n=== 5) 保存今日反馈 ===')
const fbSave = await ev(`(async () => JSON.stringify(await window.electronAPI.incubateFeedbackSave({ 日期: ${JSON.stringify(new Date().toISOString().slice(0, 10))}, 主播: ${JSON.stringify(STREAMER)}, 运营: '测试运营', 今日任务: 'D1 定位与对标', 完成情况: '部分完成', 数据结果: '最长空档 2.5 秒，点名 12 次', 问题: '开场容易卡', 明日计划: '开场三句练 20 遍' })))()`)
console.log('  ' + fbSave)
const plan2Raw = await ev(`(async () => JSON.stringify(await window.electronAPI.incubatePlan(${JSON.stringify(STREAMER)})))()`)
let plan2 = {}
try { plan2 = JSON.parse(plan2Raw) } catch { /* ignore */ }
console.log('  反馈条数：' + (plan2.feedback || []).length)
if ((plan2.feedback || []).length) console.log('  最新反馈：' + JSON.stringify(plan2.feedback[0]))

// 6) 表结构确认
console.log('\n=== 6) 表结构 ===')
const schema = await ev('(async () => JSON.stringify(await window.electronAPI.incubateSchema()))()')
try {
  const s = JSON.parse(schema)
  console.log('  培训计划表：' + JSON.stringify(s['培训计划']))
  console.log('  孵化反馈表：' + JSON.stringify(s['孵化反馈']))
} catch { console.log('  ' + String(schema).slice(0, 200)) }

ws.close()
process.exit(0)
