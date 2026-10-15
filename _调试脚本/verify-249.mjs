// 2.4.9 专项验证：P4(时间显示本机) / P6(崩溃恢复) / P12(文件名本地时间)
// 用法：node verify-249.mjs <调试端口> <start|resume>
import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'

const APP_PKG = 'H:/360MoveData/Users/Administrator/Documents/ChatGPT/直播间拆解项目github/douyin-live-info/package.json'
const require = createRequire(APP_PKG)
const WebSocket = require('ws')

const PORT = Number(process.argv[2] || 9470)
const MODE = process.argv[3] || 'start'
const OUT_DIR = 'H:\\迅雷下载'
const STATE = path.join(process.env.APPDATA, 'douyin-live-info', 'record-state.json')
const ROOMS = ['https://live.douyin.com/443854703170', 'https://live.douyin.com/782430460186']
// 可以再传一个直播间链接作为第 4 个参数（老板临时给的房号）
if (process.argv[4]) ROOMS.unshift(process.argv[4])
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
  if (r.result?.exceptionDetails) return 'EX: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 200)
  return r.result?.result?.value
}
await sleep(800)

const nowLocal = new Date()
const pad = (n) => String(n).padStart(2, '0')
const localPrefix = `${nowLocal.getFullYear()}${pad(nowLocal.getMonth() + 1)}${pad(nowLocal.getDate())}`

if (MODE === 'start') {
  console.log('=== P4 时间显示（应为本机时间，比库里的 UTC 晚 8 小时）===')
  const rooms = await ev(`(async () => JSON.stringify(await window.electronAPI.dbGetRooms()))()`)
  let list = []
  try { list = JSON.parse(rooms) } catch { /* ignore */ }
  for (const r of list.slice(0, 4)) console.log(`   房间 ${r.nickname}：最后活跃 ${r.lastActive}（${r.messageCount} 条）`)
  if (list[0]) {
    const msgs = await ev(`(async () => JSON.stringify((await window.electronAPI.dbGetMessages(${JSON.stringify(list[0].roomId)})).slice(-2)))()`)
    console.log('   最近两条：' + msgs)
  }

  console.log('\n=== P6 开始录制一场，验证状态落盘 ===')
  const fetched = await ev(`(async () => JSON.stringify(await window.electronAPI.roomFetch(${JSON.stringify(ROOMS)})))()`)
  let fr = []
  try { fr = JSON.parse(fetched) } catch { /* ignore */ }
  const live = fr.filter((r) => !r.error && r.roomStatus !== 2)
  for (const r of fr) console.log(`   ${r.nickname || r.url}：roomStatus=${r.roomStatus}`)
  if (!live.length) { console.log('   没有在播的房间，跳过录制测试'); ws.close(); process.exit(1) }
  console.log('   开录：' + await ev(`(async () => JSON.stringify(await window.electronAPI.recordStartAll(${JSON.stringify([live[0]])})))()`))
  for (let i = 0; i < 3; i++) {
    await sleep(8000)
    console.log(`   ${(i + 1) * 8}s：` + await ev(`(async () => { const s = await window.electronAPI.recordGetState(); return JSON.stringify((s.items||[]).map(x => x.nickname + ' ' + x.sizeText)) })()`))
  }
  console.log('\n   record-state.json：' + (fs.existsSync(STATE) ? fs.readFileSync(STATE, 'utf-8').replace(/\n\s*/g, ' ') : '（没有！）'))
  console.log('\n现在去强杀进程，再重开跑 resume 模式')
  ws.close()
  process.exit(0)
}

// resume 模式：确认被清理的孤儿、恢复的录制、以及文件名是不是本地时间
console.log('=== P6/P12 重启后 ===')
const st = await ev(`(async () => { const s = await window.electronAPI.recordGetState(); return JSON.stringify({ count: s.count, items: (s.items||[]).map(x => x.nickname + ':' + x.sizeText + ' ' + x.statusText) }) })()`)
console.log('   录制状态：' + st)

await sleep(12000)
const st2 = await ev(`(async () => { const s = await window.electronAPI.recordGetState(); return JSON.stringify({ count: s.count, items: (s.items||[]).map(x => x.nickname + ':' + x.sizeText + ' ' + x.statusText) }) })()`)
console.log('   再过 12 秒：' + st2)

const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.mp4')).map((f) => ({ f, m: fs.statSync(path.join(OUT_DIR, f)).mtimeMs, size: fs.statSync(path.join(OUT_DIR, f)).size }))
files.sort((a, b) => b.m - a.m)
console.log('\n   最新 3 个录像文件：')
for (const x of files.slice(0, 3)) console.log(`     ${x.f}  ${(x.size / 1024 / 1024).toFixed(1)}MB  ${new Date(x.m).toLocaleTimeString()}`)
const newest = files[0]
if (newest) {
  const stamp = (newest.f.match(/_(\d{14})_/) || [])[1] || ''
  console.log(`\n   P12 文件名时间戳=${stamp}  今天本地日期前缀=${localPrefix}`)
  console.log('   → ' + (stamp.startsWith(localPrefix) ? '✅ 用的是本机时间' : '❌ 还是 UTC 时间'))
}
const stale = files.filter((x) => Date.now() - x.m > 3 * 60 * 1000)
console.log('\n   停止测试录制并清理：' + await ev(`(async () => { const s = await window.electronAPI.recordStopAll(); return 'count=' + s.count })()`))
await sleep(3000)
for (const x of files) {
  if (x.f.includes('测试') || (Date.now() - x.m < 10 * 60 * 1000)) {
    try { fs.unlinkSync(path.join(OUT_DIR, x.f)); console.log('   已删测试文件 ' + x.f) } catch { /* ignore */ }
  }
}
ws.close()
process.exit(0)
