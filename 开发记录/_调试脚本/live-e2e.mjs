// 已安装版 2.4.3 的真实链条测试：连直播间 → 收弹幕 → 录 90 秒 → 停 → 拆解 → 查素材包
// 用法：node live-e2e.mjs [调试端口]
import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'
import os from 'os'

const APP_PKG = 'H:/360MoveData/Users/Administrator/Documents/ChatGPT/直播间拆解项目github/douyin-live-info/package.json'
const require = createRequire(APP_PKG)
const WebSocket = require('ws')

const PORT = Number(process.argv[2] || 9457)
const ROOMS = [
  'https://live.douyin.com/443854703170',
  'https://live.douyin.com/669216278289'
]
const REC_DIR = 'H:\\迅雷下载'
const REC_SECONDS = 60

const LOGFILE = path.join(os.tmpdir(), 'live-e2e.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  console.log(s)
}
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
  throw new Error('连不上已安装版窗口')
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
await sleep(1200)

log('版本：' + await ev(`(() => { const m = (document.body.innerText||'').match(/V\\s*[0-9.]+/); return m ? m[0] : '无' })()`))
log('弹幕登录：' + await ev(`(async () => { const s = await window.electronAPI.danmuLoginState(); return s.loggedIn ? '已登录' : '未登录' })()`))

log('\n=== 1) 录入直播间 ===')
// 直接把原始房间对象留着（后面连弹幕/录制都要用它，不能自己改名）
const roomsRaw = await ev(`(async () => { const r = await window.electronAPI.roomFetch(${JSON.stringify(ROOMS)}); return JSON.stringify(r) })()`)
let rooms = []
try { rooms = JSON.parse(roomsRaw) } catch { log('解析失败：' + String(roomsRaw).slice(0, 200)) }
for (const r of rooms) log(`   ${r.nickname}（${r.enterRoomId}）roomStatus=${r.roomStatus}${r.error ? ' 错误=' + r.error : ''}`)
// roomStatus 的语义跟 App 里一致（2 = 已结束），所以取「不等于 2」的
const live = rooms.filter((r) => !r.error && r.roomStatus !== 2)
if (!live.length) { log('没有正在播的房间，停'); ws.close(); process.exit(1) }

log('\n=== 2) 连接弹幕 + 挂监听 ===')
for (const r of live) {
  log('   ' + r.nickname + ' → ' + await ev(`(async () => { try { await window.electronAPI.danmuConnect(${JSON.stringify(r.enterRoomId)}, ${JSON.stringify(r.nickname)}); return '已发连接' } catch (e) { return '失败：' + e.message } })()`))
}
await ev(`(() => { window.__c = { msg: 0, chat: 0, gift: 0, member: 0 }; window.electronAPI.onDanmuMessage((d) => { const m = d.msg || {}; window.__c.msg++; if (m.type === 'Chat') window.__c.chat++; if (m.type === 'Gift') window.__c.gift++; if (m.type === 'Member') window.__c.member++ }) ; return 'hooked' })()`)

log('\n=== 3) 开始录制（第一间，90 秒） ===')
const before = new Set(fs.readdirSync(REC_DIR).filter((f) => f.toLowerCase().endsWith('.mp4')))
log('   ' + await ev(`(async () => { const r = await window.electronAPI.recordStartAll(${JSON.stringify([live[0]])}); return '已下发录制：' + JSON.stringify(r && r.count !== undefined ? { 在录: r.count } : r).slice(0, 120) })()`))

for (let i = 0; i < REC_SECONDS / 10; i++) {
  await sleep(10000)
  const c = await ev(`(async () => { const s = await window.electronAPI.recordGetState(); return JSON.stringify({ n: s.count, items: (s.items||[]).map(i => i.nickname + ':' + i.sizeText + ' ' + i.statusText) }) })()`)
  const dm = await ev(`JSON.stringify(window.__c || {})`)
  log(`   ${(i + 1) * 10}s　录制=${c}　弹幕计数=${dm}`)
}

log('\n=== 4) 停止录制 ===')
log('   ' + await ev(`(async () => { await window.electronAPI.recordStopAll(); return '已停止全部录制' })()`))
await sleep(3000)

const after = fs.readdirSync(REC_DIR).filter((f) => f.toLowerCase().endsWith('.mp4'))
const fresh = after.filter((f) => !before.has(f))
log('   新产生的录像：' + (fresh.length ? fresh.map((f) => `${f}（${(fs.statSync(path.join(REC_DIR, f)).size / 1024 / 1024).toFixed(1)}MB）`).join(', ') : '无 ✗'))
const metaFiles = fresh.map((f) => path.join(REC_DIR, f.replace(/_\d{3,4}\.mp4$/i, '.meta.json'))).filter((p) => fs.existsSync(p))
log('   录制旁注（.meta.json）：' + (metaFiles.length ? '有 ✓ ' + metaFiles.map((p) => path.basename(p)).join(',') : '没有 ✗（弹幕就并不进素材包）'))

if (!fresh.length) { log('\n没录出文件，停'); ws.close(); process.exit(1) }

log('\n=== 5) 拆解这场 ===')
const rec = path.join(REC_DIR, fresh[0])
log('   ' + await ev(`(async () => { const s = await window.electronAPI.teardownStart(${JSON.stringify(rec)}, 'small'); return '已启动：' + s.stage })()`))
const t0 = Date.now()
for (;;) {
  await sleep(6000)
  const raw = await ev(`(async () => { const s = await window.electronAPI.teardownGetState(); return JSON.stringify({ r: s.running, stage: s.stage, err: s.error }) })()`)
  let o = {}
  try { o = JSON.parse(raw) } catch { o = { r: true, stage: String(raw).slice(0, 50) } }
  const secs = Math.round((Date.now() - t0) / 1000)
  if (o.r) { if (secs % 30 < 7) log(`   …${secs}s　${o.stage}`); continue }
  log(`   跑完 ${secs}s，阶段=${o.stage}${o.err ? '｜' + o.err : ''}`)
  break
}

log('\n=== 6) 检查素材包 ===')
const res = await ev(`(async () => {
  const p = await window.electronAPI.teardownPacket(${JSON.stringify(rec)})
  if (!p) return JSON.stringify({ ok: false })
  const t = p.content || ''
  const idx = t.indexOf('## 七、弹幕与礼物')
  return JSON.stringify({ ok: true, 路径: p.packetPath, 字数: t.length, 含第七节: idx >= 0, 第七节片段: idx >= 0 ? t.slice(idx, idx + 420) : '' })
})()`)
let o = {}
try { o = JSON.parse(res) } catch { o = { ok: false, raw: String(res).slice(0, 200) } }
if (o.ok) {
  log(`   素材包：${o.字数} 字，含第七节=${o.含第七节}`)
  log('   ' + o.路径)
  if (o.第七节片段) log('\n——— 第七节开头 ———\n' + o.第七节片段)
} else {
  log('   没找到素材包：' + JSON.stringify(o).slice(0, 200))
}

log('\n=== 7) 收尾（断开弹幕、删测试录像） ===')
log('   ' + await ev(`(async () => { await window.electronAPI.danmuDisconnectAll(); return '已断开全部弹幕' })()`))
ws.close()
for (const f of fresh) { try { fs.unlinkSync(path.join(REC_DIR, f)) } catch { /* ignore */ } }
for (const p of metaFiles) { try { fs.unlinkSync(p) } catch { /* ignore */ } }
try { fs.rmSync(path.join(REC_DIR, 'work_' + fresh[0].replace(/\.mp4$/i, '').replace(/_\d{3,4}$/, '')), { recursive: true, force: true }) } catch { /* ignore */ }
log('   测试录像已删除')
