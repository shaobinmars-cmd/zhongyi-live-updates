// P7 验证：AI 分析能中途停止，且跑完的部分会落盘
// 用法：node ai-cancel-test.mjs [调试端口]
import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'

const APP_PKG = 'H:/360MoveData/Users/Administrator/Documents/ChatGPT/直播间拆解项目github/douyin-live-info/package.json'
const require = createRequire(APP_PKG)
const WebSocket = require('ws')

const PORT = Number(process.argv[2] || 9471)
const DIR = 'H:\\360MoveData\\Users\\Administrator\\Documents\\ChatGPT\\直播间拆解项目github\\_调试脚本\\_AI取消测试'
const VIDEO = path.join(DIR, '取消测试_20260101000000_000.mp4')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pickPage() {
  for (let i = 0; i < 30; i++) {
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
  if (r.result?.exceptionDetails) return 'EX: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 200)
  return r.result?.result?.value
}
await sleep(600)

// 1) 先确保有一份素材包
let packetPath = ''
const existing = await ev(`(async () => { const p = await window.electronAPI.teardownPacket(${JSON.stringify(VIDEO)}); return p ? p.packetPath : '' })()`)
if (existing && typeof existing === 'string' && existing.includes('素材包')) {
  packetPath = existing
} else {
  console.log('没有现成素材包，先拆解一个 30 秒测试片…')
  console.log('  ' + await ev(`(async () => 'stage=' + (await window.electronAPI.teardownStart(${JSON.stringify(VIDEO)}, 'small')).stage)()`))
  const t0 = Date.now()
  for (;;) {
    await sleep(5000)
    const raw = await ev(`(async () => { const s = await window.electronAPI.teardownGetState(); return JSON.stringify({ r: s.running, stage: s.stage }) })()`)
    let o = {}
    try { o = JSON.parse(raw) } catch { /* ignore */ }
    if (!o.r) { console.log(`  拆解结束（${Math.round((Date.now() - t0) / 1000)}s）：${o.stage}`); break }
    if (Date.now() - t0 > 300000) { console.log('  超时'); break }
  }
  const p = await ev(`(async () => { const p = await window.electronAPI.teardownPacket(${JSON.stringify(VIDEO)}); return p ? p.packetPath : '' })()`)
  if (p && typeof p === 'string') packetPath = p
}
console.log('素材包：' + packetPath)
if (!packetPath) { console.log('❌ 没拿到素材包，测试中止'); ws.close(); process.exit(1) }

// 2) 起分析 → 4 秒后点停止
console.log('\n开始 AI 分析（不等着它跑完）…')
// 注意：AI 分析接口要传「录像路径」（跟界面一样），它会自己去找那场的素材包
console.log('  ' + await ev(`(() => { window.__aiRes = null; window.__aiDone = false; window.__aiStart = Date.now(); window.__ai = window.electronAPI.aiAnalyze(${JSON.stringify(VIDEO)}); window.__ai.then(r => { window.__aiRes = r; window.__aiDone = true }).catch(e => { window.__aiRes = { ok: false, note: String(e) }; window.__aiDone = true }); return '已发起' })()`))
await sleep(4000)
console.log('  4 秒后点「停止分析」：' + await ev(`(async () => { const r = await window.electronAPI.aiCancel(); return JSON.stringify(r) })()`))
for (let i = 0; i < 20; i++) {
  await sleep(1500)
  const done = await ev(`JSON.stringify({ done: window.__aiDone, res: window.__aiRes, secs: Math.round((Date.now() - window.__aiStart) / 1000) })`)
  let o = {}
  try { o = JSON.parse(done) } catch { /* ignore */ }
  if (o.done) { console.log(`  分析在 ${o.secs} 秒时结束：` + JSON.stringify(o.res)); break }
  if (i === 19) console.log('  等了 30 秒还没结束（也可能接口太慢）')
}

// 3) 看报告文件
const reportPath = path.join(path.dirname(path.join(packetPath, '..', 'x')), 'AI分析报告.md')
const alt = path.join(path.dirname(packetPath), 'AI分析报告.md')
const rp = fs.existsSync(alt) ? alt : reportPath
if (fs.existsSync(rp)) {
  const txt = fs.readFileSync(rp, 'utf-8')
  console.log(`\n报告文件：${rp}（${txt.length} 字）`)
  console.log('  含「没有跑完」标记：' + (txt.includes('没有跑完') ? '✅' : '（说明是在第一片就停了，没写入部分内容）'))
} else {
  console.log('\n（没找到报告文件）')
}
ws.close()
process.exit(0)
