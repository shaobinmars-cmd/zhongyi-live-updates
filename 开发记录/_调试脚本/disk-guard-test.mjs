// 验证磁盘清理的「只删自己的文件」：在临时目录放三类文件，把配额调到极小，
// 走 App 真实的 record:start-all 触发清理，看谁被删、谁活着。
//   ① 我们的命名 + 旧时间   → 应该被删
//   ② 别人的视频（迅雷下载那种）→ 必须活着
//   ③ 我们的命名 + 刚刚改过   → 必须活着（2 分钟保护）
// 用法：node disk-guard-test.mjs [调试端口]
import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'

const APP_PKG = 'H:/360MoveData/Users/Administrator/Documents/ChatGPT/直播间拆解项目github/douyin-live-info/package.json'
const require = createRequire(APP_PKG)
const WebSocket = require('ws')

const PORT = Number(process.argv[2] || 9464)
const DIR = 'H:\\360MoveData\\Users\\Administrator\\Documents\\ChatGPT\\直播间拆解项目github\\_调试脚本\\_磁盘测试'
const F_OURS_OLD = path.join(DIR, '测试主播_20260101000000_000.mp4')
const F_FOREIGN = path.join(DIR, '别人的电影_1080p.mp4')
const F_OURS_NEW = path.join(DIR, '测试主播_20260101010000_000.mp4')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- 造现场 ----
fs.rmSync(DIR, { recursive: true, force: true })
fs.mkdirSync(DIR, { recursive: true })
const mk = (p, mb) => fs.writeFileSync(p, Buffer.alloc(mb * 1024 * 1024, 7))
mk(F_OURS_OLD, 2)
mk(F_FOREIGN, 2)
mk(F_OURS_NEW, 2)
const old = new Date(Date.now() - 60 * 60 * 1000)
fs.utimesSync(F_OURS_OLD, old, old)
fs.utimesSync(F_FOREIGN, old, old)   // 别人的文件也是旧的：以前就会删它
console.log('造好现场：')
for (const f of [F_OURS_OLD, F_FOREIGN, F_OURS_NEW]) console.log('  ' + path.basename(f) + '  ' + (fs.statSync(f).size / 1024 / 1024) + 'MB  mtime=' + fs.statSync(f).mtime.toLocaleTimeString())

// ---- 连 App ----
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
  if (r.result?.exceptionDetails) return 'EX: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 200)
  return r.result?.result?.value
}
await send('Runtime.enable')
await sleep(800)

const original = await ev(`(async () => JSON.stringify(await window.electronAPI.configLoad()))()`)
console.log('\n原配置：' + original)

try {
  console.log('临时改配置：outputPath=' + DIR + '  maxGB=0.0005（0.5MB，故意超）')
  console.log('  ' + await ev(`(async () => JSON.stringify(await window.electronAPI.configSave({ outputPath: ${JSON.stringify(DIR)}, maxGB: 0.0005 })))()`))

  console.log('\n触发清理（record:start-all，空房间列表）：')
  const r = await ev(`(async () => JSON.stringify(await window.electronAPI.recordStartAll([])))()`)
  console.log('  ' + r)
  await sleep(1500)

  const oursOld = fs.existsSync(F_OURS_OLD)
  const foreign = fs.existsSync(F_FOREIGN)
  const oursNew = fs.existsSync(F_OURS_NEW)
  console.log('\n=== 结果 ===')
  console.log(`  ① 我们的旧文件   被删掉？${!oursOld ? '是 ✅（应该删）' : '没删 ❌'}`)
  console.log(`  ② 别人的视频     活着？  ${foreign ? '是 ✅（必须活着）' : '被删了 ❌❌'}`)
  console.log(`  ③ 我们刚改过的   活着？  ${oursNew ? '是 ✅（2 分钟保护）' : '被删了 ❌'}`)
} finally {
  console.log('\n恢复原配置：' + await ev(`(async () => JSON.stringify(await window.electronAPI.configSave(${JSON.stringify(JSON.parse(original || '{}'))})))()`))
  ws.close()
}
process.exit(0)
