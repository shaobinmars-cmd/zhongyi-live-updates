// 全新电脑模拟测试（2.4.7）：
//   空 user-data 目录（没有配置、没有授权、没有弹幕登录）+ 干净 PATH（没有 ffmpeg/python）
//   链路：激活 → 默认录制格式 → AI 设置+测试连接 → 连直播 → 录 60s → 拆解（故意选 GPU，验证自动回退 CPU）→ 素材包
// 用法：node fresh-e2e.mjs [调试端口]
import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'
import os from 'os'

const APP_PKG = 'H:/360MoveData/Users/Administrator/Documents/ChatGPT/直播间拆解项目github/douyin-live-info/package.json'
const require = createRequire(APP_PKG)
const WebSocket = require('ws')

const PORT = Number(process.argv[2] || 9460)
const ROOMS = [
  'https://live.douyin.com/443854703170',
  'https://live.douyin.com/782430460186',
  'https://live.douyin.com/669216278289'
]
const REC_SECONDS = 60
const REC_DIR = path.join(os.homedir(), 'Desktop', '直播录制')
const LICENSE_FILE = 'H:/360MoveData/Users/Administrator/Documents/ChatGPT/直播间拆解项目github/douyin-live-info/授权_管理员_0DD8-FD0F-CC3E-8587-795F.json'
const TEST_KEY = 'sk-282d6643acb04ce9ba06ed0fc5083b17'

const LOGFILE = path.join(os.tmpdir(), 'fresh-e2e.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  console.log(s)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- CDP
async function pickPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const page = list.find((t) => t.type === 'page' && !/devtools/.test(t.url || ''))
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* 等 */ }
    await sleep(1000)
  }
  throw new Error('连不上调试端口，应用没起来？')
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

log('=== 0) 应用与授权状态 ===')
log('   标题：' + await ev(`document.title`))
log('   版本：' + await ev(`(() => { const m = (document.body.innerText||'').match(/V\\s*[0-9.]+/); return m ? m[0] : '未显示' })()`))

let lic = await ev(`(async () => { const s = await window.electronAPI.licenseStatus(); return JSON.stringify(s) })()`)
log('   授权：' + lic)

try {
  const o = JSON.parse(lic)
  const okNow = o && (o.valid === true || o.ok === true || o.activated === true)
  if (!okNow) {
    log('   → 未激活（符合"全新电脑"预期），用管理员授权文件激活…')
    const text = fs.readFileSync(LICENSE_FILE, 'utf-8')
    log('   激活结果：' + await ev(`(async () => { try { const r = await window.electronAPI.licenseActivate(${JSON.stringify(text)}); return JSON.stringify(r) } catch (e) { return 'EX ' + e.message } })()`))
    await sleep(1000)
    await ev(`location.reload()`)
    await sleep(3000)
    log('   激活后：' + await ev(`(async () => { const s = await window.electronAPI.licenseStatus(); return JSON.stringify(s) })()`))
  } else {
    log('   ⚠ 已经是激活状态：说明临时 APPDATA 没生效，现在跑的就是真实资料——立即中止，避免改动你的配置！')
    ws.close()
    process.exit(2)
  }
} catch (e) { log('   授权解析失败：' + e.message) }

log('\n=== 1) 默认录制格式（全新配置应为 mp4） ===')
log('   ' + await ev(`(async () => { const c = await window.electronAPI.configLoad(); return JSON.stringify({ outputFormat: c.outputFormat, outputPath: c.outputPath, segmentMinutes: c.segmentMinutes }) })()`))

log('\n=== 2) AI 设置：保存 + 测试连接 ===')
const saveRes = await ev(`(async () => { try { const r = await window.electronAPI.aiConfigSet({ baseUrl: 'https://api.deepseek.com/v1', apiKey: ${JSON.stringify(TEST_KEY)}, model: 'deepseek-chat' }); return '保存 OK：' + JSON.stringify(r).slice(0, 160) } catch (e) { return '保存失败(克隆类错误就是它)：' + e.message } })()`)
log('   ' + saveRes)
const testRes = await ev(`(async () => { try { const r = await window.electronAPI.aiTest({ baseUrl: 'https://api.deepseek.com/v1', apiKey: ${JSON.stringify(TEST_KEY)}, model: 'deepseek-chat' }); return JSON.stringify(r) } catch (e) { return '测试失败(克隆类错误就是它)：' + e.message } })()`)
log('   测试连接：' + testRes)

log('\n=== 3) 连直播 + 录制 ===')
const roomsRaw = await ev(`(async () => { const r = await window.electronAPI.roomFetch(${JSON.stringify(ROOMS)}); return JSON.stringify(r) })()`)
let rooms = []
try { rooms = JSON.parse(roomsRaw) } catch { log('   解析失败：' + String(roomsRaw).slice(0, 200)) }
for (const r of rooms) log(`   ${r.nickname}（${r.enterRoomId}）roomStatus=${r.roomStatus}${r.error ? ' 错误=' + r.error : ''}`)
const live = rooms.filter((r) => !r.error && r.roomStatus !== 2)
if (!live.length) { log('   没有正在播的房间，后面录制/拆解跳过'); }

const beforeFiles = fs.existsSync(REC_DIR) ? new Set(fs.readdirSync(REC_DIR)) : new Set()
let fresh = []
if (!live.length) {
  log('\n=== 4~6) 跳过（无直播间） ===')
} else {
  for (const r of live) {
    log('   弹幕连接：' + r.nickname + ' → ' + await ev(`(async () => { try { await window.electronAPI.danmuConnect(${JSON.stringify(r.enterRoomId)}, ${JSON.stringify(r.nickname)}); return '已连接' } catch (e) { return '失败：' + e.message } })()`))
  }
  log('   开录：' + await ev(`(async () => { const r = await window.electronAPI.recordStartAll(${JSON.stringify([live[0]])}); return JSON.stringify(r).slice(0, 160) })()`))
  for (let i = 0; i < REC_SECONDS / 10; i++) {
    await sleep(10000)
    const st = await ev(`(async () => { const s = await window.electronAPI.recordGetState(); return JSON.stringify({ n: s.count, items: (s.items||[]).map(x => x.nickname + ':' + x.sizeText + ' ' + x.statusText) }) })()`)
    log(`   ${(i + 1) * 10}s  ${st}`)
  }
  await ev(`(async () => { await window.electronAPI.recordStopAll(); return 'stop' })()`)
  await sleep(4000)
  const after = fs.existsSync(REC_DIR) ? fs.readdirSync(REC_DIR) : []
  fresh = after.filter((f) => !beforeFiles.has(f) && /\.(mp4|mkv|ts|mp3)$/i.test(f))
  log('   新文件：' + (fresh.length ? fresh.map((f) => `${f}（${(fs.statSync(path.join(REC_DIR, f)).size / 1024 / 1024).toFixed(1)}MB）`).join('、') : '无 ✗'))

  if (!fresh.length) {
    log('\n   没录出文件，拆解跳过')
  } else {
    const rec = path.join(REC_DIR, fresh[0])
    log('\n=== 5) 拆解（故意把设备设成 cuda，验证自动回退 CPU） ===')
    log('   设置：' + await ev(`(async () => { const r = await window.electronAPI.teardownConfigSet({ whisperDevice: 'cuda' }); return JSON.stringify(r) })()`))
    log('   启动：' + await ev(`(async () => { const s = await window.electronAPI.teardownStart(${JSON.stringify(rec)}, 'small'); return 'stage=' + s.stage })()`))
    const t0 = Date.now()
    for (;;) {
      await sleep(6000)
      const raw = await ev(`(async () => { const s = await window.electronAPI.teardownGetState(); return JSON.stringify({ r: s.running, stage: s.stage, err: s.error }) })()`)
      let o = {}
      try { o = JSON.parse(raw) } catch { o = { r: true, stage: String(raw).slice(0, 60) } }
      const secs = Math.round((Date.now() - t0) / 1000)
      if (o.r) { if (secs % 30 < 7) log(`   …${secs}s  ${o.stage}`); continue }
      log(`   跑完 ${secs}s：stage=${o.stage}${o.err ? '｜err=' + o.err : ''}`)
      break
    }
    log('\n=== 6) 素材包 ===')
    const res = await ev(`(async () => {
      const p = await window.electronAPI.teardownPacket(${JSON.stringify(rec)})
      if (!p) return JSON.stringify({ ok: false })
      const t = p.content || ''
      const i7 = t.indexOf('## 七、弹幕与礼物')
      return JSON.stringify({ ok: true, packetPath: p.packetPath, chars: t.length, danmu: i7 >= 0 })
    })()`)
    log('   ' + res)
    log('   恢复设备=CPU：' + await ev(`(async () => { const r = await window.electronAPI.teardownConfigSet({ whisperDevice: 'cpu' }); return JSON.stringify(r) })()`))
  }
}

log('\n=== 7) 收尾 ===')
log('   ' + await ev(`(async () => { await window.electronAPI.danmuDisconnectAll(); return '已断开弹幕' })()`))
for (const f of fresh) {
  try { fs.unlinkSync(path.join(REC_DIR, f)) } catch { /* ignore */ }
  const meta = path.join(REC_DIR, f.replace(/\.(mp4|mkv|ts|mp3)$/i, '.meta.json'))
  try { if (fs.existsSync(meta)) fs.unlinkSync(meta) } catch { /* ignore */ }
  const wd = path.join(REC_DIR, 'work_' + f.replace(/\.(mp4|mkv|ts|mp3)$/i, '').replace(/_\d{3,4}$/, ''))
  try { if (fs.existsSync(wd)) fs.rmSync(wd, { recursive: true, force: true }) } catch { /* ignore */ }
}
log('   测试文件已清理：' + (fresh.length ? fresh.join('、') : '无'))
ws.close()
process.exit(0)
