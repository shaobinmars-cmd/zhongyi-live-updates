// 三页签逐一检查 + 截图
import { createRequire } from 'module'
import fs from 'fs'
const require = createRequire('H:/众艺直播运营工具/源码/package.json')
const WebSocket = require('ws')
const PORT = Number(process.argv[2] || 9485)
const OUT = 'H:\\众艺直播运营工具\\开发记录\\_调试脚本\\shots-2.7.6'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })
const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = list.find((t) => t.type === 'page' && !/devtools/.test(t.url || ''))
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
await new Promise((r) => ws.on('open', r))
let id = 0
const pend = new Map()
ws.on('message', (raw) => { let m; try { m = JSON.parse(raw.toString()) } catch { return } if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value
const shot = async (name) => { await send('Page.enable'); const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '\\' + name + '.png', Buffer.from(r.result.data, 'base64')); console.log('截图 ' + name) }

await sleep(600)
console.log('进孵化：' + await ev(`(() => { const h = Array.from(document.querySelectorAll('span,a,div')).find(e => e.textContent.trim() === '孵化' && e.offsetParent); if (h) { h.click(); return 'ok' } return 'not found' })()`))
await sleep(2000)
for (const label of ['+ 添加主播', '导入报告并生成 60 天计划', '粘贴报告']) {
  console.log('  ' + label + ' → ' + (await ev(`document.body.innerText.includes(${JSON.stringify(label)})`)))
}
await shot('01-主播跟踪-顶部')

for (const [tab, file] of [['运营区域', '02-运营区域'], ['知识库', '03-知识库']]) {
  console.log('切 ' + tab + '：' + await ev(`(() => { const t = Array.from(document.querySelectorAll('div')).find(e => e.textContent.trim() === ${JSON.stringify(tab)} && e.offsetParent); if (t) { t.click(); return 'ok' } return 'not found' })()`))
  await sleep(1200)
  await shot(file)
}
ws.close()
process.exit(0)
