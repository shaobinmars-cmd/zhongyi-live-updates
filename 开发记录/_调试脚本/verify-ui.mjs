// 检查孵化页下半部分（反馈 / 打分）并截一张图
import { createRequire } from 'module'
import fs from 'fs'
const require = createRequire('H:/众艺直播运营工具/源码/package.json')
const WebSocket = require('ws')
const PORT = Number(process.argv[2] || 9482)
const OUT = 'H:\\众艺直播运营工具\\开发记录\\_调试脚本\\shots-after'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = list.find((t) => t.type === 'page' && !/devtools/.test(t.url || ''))
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
await new Promise((r) => ws.on('open', r))
let id = 0
const pend = new Map()
ws.on('message', (raw) => { let m; try { m = JSON.parse(raw.toString()) } catch { return } if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value

console.log('关键区块：')
for (const label of ['今天孵化结果（运营填）', '保存今日反馈', '今日打分（可选：这一场五个分）', '最近记录']) {
  console.log('  ' + label + ' → ' + (await ev(`document.body.innerText.includes(${JSON.stringify(label)})`)))
}
console.log('滚动：' + await ev(`(() => { const el = document.querySelector('.inc-page'); const box = el; if (box) { box.scrollTop = 900; return 'ok ' + box.scrollTop } window.scrollTo(0, 900); return 'window' })()`))
await sleep(800)
await send('Page.enable')
const r = await send('Page.captureScreenshot', { format: 'png' })
const f = OUT + '\\02-下半部分.png'
fs.writeFileSync(f, Buffer.from(r.result.data, 'base64'))
console.log('已保存 ' + f)
ws.close()
process.exit(0)
