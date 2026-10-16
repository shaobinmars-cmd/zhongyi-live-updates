// 验证「批量拆解」对多分段录像的处理：
//   造一场两段（_000/_001 各 30 秒）的假录像，走 App 的批量拆解，
//   看引擎到底分析的是「两段合并后 60 秒」还是「只有第一段 30 秒」。
// 用法：node batch-merge-test.mjs [调试端口]
import { createRequire } from 'module'

const APP_PKG = 'H:/360MoveData/Users/Administrator/Documents/ChatGPT/直播间拆解项目github/douyin-live-info/package.json'
const require = createRequire(APP_PKG)
const WebSocket = require('ws')

const PORT = Number(process.argv[2] || 9462)
const TARGET = 'H:\\360MoveData\\Users\\Administrator\\Documents\\ChatGPT\\直播间拆解项目github\\_调试脚本\\_批量测试\\测试主播_20260101000000_000.mp4'

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
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
let id = 0
const pend = new Map()
ws.on('message', (raw) => {
  let m
  try { m = JSON.parse(raw.toString()) } catch { return }
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
})
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return 'EX: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)
  return r.result?.result?.value
}
await send('Runtime.enable')
await sleep(1000)

console.log('版本：' + await ev(`(() => { const m = (document.body.innerText||'').match(/V\\s*[0-9.]+/); return m ? m[0] : '未显示' })()`))

console.log('\n入队：' + await ev(`(async () => {
  const r = await window.electronAPI.batchAdd([{ path: ${JSON.stringify(TARGET)}, name: '批量合段测试' }], 'small', false)
  return JSON.stringify({ added: r && r.added, total: r && r.total })
})()`))

let lastStage = ''
let allLines = []
const t0 = Date.now()
for (;;) {
  await sleep(5000)
  const raw = await ev(`(async () => {
    const st = await window.electronAPI.teardownGetState()
    const b = await window.electronAPI.batchState()
    const lines = (st.lines || [])
    window.__seen = window.__seen || []
    for (const l of lines) if (!window.__seen.includes(l)) window.__seen.push(l)
    return JSON.stringify({ running: b.running, done: b.done, total: b.total, cur: b.currentName, stage: st.stage, n: window.__seen.length })
  })()`)
  let o = {}
  try { o = JSON.parse(raw) } catch { o = { raw: String(raw).slice(0, 120) } }
  const secs = Math.round((Date.now() - t0) / 1000)
  if (o.stage !== lastStage) { console.log(`  ${secs}s  stage=${o.stage}  队列 ${o.done}/${o.total}`); lastStage = o.stage }
  if (!o.running && o.total > 0) break
  if (secs > 900) { console.log('超时退出'); break }
}

allLines = await ev(`JSON.stringify(window.__seen || [])`)
let lines = []
try { lines = JSON.parse(allLines) } catch { /* ignore */ }
console.log('\n=== 引擎关键日志 ===')
for (const l of lines) {
  if (/视频：|时长|合并|work_|转写完成|素材包|—— /.test(l)) console.log('  ' + l)
}
console.log('\n=== 队列结果 ===')
console.log('  ' + await ev(`(async () => JSON.stringify((await window.electronAPI.batchState()).items))()`))

console.log('\n清理队列：' + await ev(`(async () => { const r = await window.electronAPI.batchClear(); return JSON.stringify({ items: r.items.length }) })()`))
ws.close()
process.exit(0)
