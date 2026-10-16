// 打包版终极测试：连跑两场完整拆解 + 空文件拦截 + 列表合并 + 临时文件清理
// 用法：node test-packaged2.mjs [调试端口]
import { createRequire } from 'module'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const APP_PKG = 'H:/360MoveData/Users/Administrator/Documents/ChatGPT/直播间拆解项目github/douyin-live-info/package.json'
const require = createRequire(APP_PKG)
const WebSocket = require('ws')

const PORT = Number(process.argv[2] || 9456)
const DIR = 'H:\\迅雷下载'
const FFMPEG = 'D:\\直播拆解工具\\bin\\ffmpeg\\bin\\ffmpeg.exe'
const SRC = 'D:\\直播拆解工具\\录像\\直播_九九🍷（经典老歌）_344779995264_20261010_1926\\chunk_05.ts'
const ROOM_A = { id: '7696729443973843727', name: 'S码的Teacher牛', start: '2026-10-15 04:28:02' }
const ROOM_B = { id: '7696743951100857124', name: '小妖晶🦋', start: '2026-10-15 04:28:00' }
const SESS = [
  { key: '二测甲_20261015130000', off: 15, room: ROOM_A },
  { key: '二测乙_20261015130000', off: 60, room: ROOM_B }
]

const LOGFILE = path.join(os.tmpdir(), 'test-packaged2.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  console.log(s)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- 准备：每场两个分段 + 旁注 ----------
for (const s of SESS) {
  const seg1 = path.join(DIR, `${s.key}_001.mp4`)
  const seg2 = path.join(DIR, `${s.key}_002.mp4`)
  if (!fs.existsSync(seg1)) {
    execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(s.off), '-t', '40',
      '-i', SRC, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-c:a', 'aac', '-b:a', '96k',
      '-movflags', '+frag_keyframe+empty_moov+default_base_moof', seg1])
  }
  if (!fs.existsSync(seg2)) fs.copyFileSync(seg1, seg2)
  const size = fs.statSync(seg1).size
  if (size < 100 * 1024) throw new Error(`${s.key} 素材太小：${size}`)
  fs.writeFileSync(path.join(DIR, `${s.key}.meta.json`), JSON.stringify({
    roomId: s.room.id, nickname: s.key, format: 'mp4', startedAtUtc: s.room.start, startedAtLocal: '测试'
  }, null, 2), 'utf-8')
  log(`素材：${s.key} — 2 分段 × ${(size / 1024 / 1024).toFixed(1)}MB，绑定房间「${s.room.name}」`)
}

// ---------- 连打包版 ----------
async function pickPage() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const page = list.find((t) => t.type === 'page' && !/devtools/.test(t.url || ''))
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* 等 */ }
    await sleep(1000)
  }
  throw new Error('连不上打包版')
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
  if (r.result?.exceptionDetails) return 'EX: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 250)
  return r.result?.result?.value
}
await send('Runtime.enable')
await sleep(1200)

const ver = await ev(`(() => { const m = (document.body.innerText||'').match(/V\\s*[0-9.]+/); return m ? m[0] : '无' })()`)
log('\n版本：' + ver)

log('\n=== 列表（一场只显示一条） ===')
log(await ev(`(async () => { const l = await window.electronAPI.teardownList(); const t = l.filter(r => /二测/.test(r.path)); return '共 ' + l.length + ' 条；本批 ' + t.length + ' 条：' + t.map(r => r.name).join(' , ') })()`))

log('\n=== 空文件拦截 ===')
const tiny = path.join(DIR, '二测空文件_20261015130000_001.mp4')
fs.writeFileSync(tiny, Buffer.alloc(1500))
log(await ev(`(async () => { const s = await window.electronAPI.teardownStart(${JSON.stringify(tiny)}, 'small'); return '阶段=' + s.stage + '｜' + (s.error || '') })()`))

const reports = []
for (const s of SESS) {
  const seg1 = path.join(DIR, `${s.key}_001.mp4`)
  log(`\n=== 拆「${s.room.name}」那场 ===`)
  log(await ev(`(async () => { const st = await window.electronAPI.teardownStart(${JSON.stringify(seg1)}, 'small'); return '已启动：' + st.stage })()`))
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
  const info = await ev(`(async () => {
    const p = await window.electronAPI.teardownPacket(${JSON.stringify(seg1)})
    if (!p) return JSON.stringify({ ok: false })
    const t = p.content || ''
    return JSON.stringify({ ok: true, 路径: p.packetPath, 字数: t.length, 第七节: t.includes('## 七、弹幕与礼物'), 礼物汇总: t.includes('### 礼物汇总'), 网格: (p.grids||[]).length })
  })()`)
  let o = {}
  try { o = JSON.parse(info) } catch { o = { ok: false } }
  log('   素材包：' + (o.ok ? `${o.字数} 字，第七节=${o.第七节}，礼物汇总=${o.礼物汇总}，网格图=${o.网格}\n   ${o.路径}` : '没找到素材包 ✗'))
  reports.push({ key: s.key, dir: o.路径 ? path.dirname(o.路径) : '', size: o.字数 || 0, mergedFile: path.join(DIR, `${s.key}.mp4`) })
}

log('\n=== 汇总检查 ===')
log('   两场素材包在不同目录：' + (reports[0].dir && reports[0].dir !== reports[1].dir ? '是 ✓' : '不是 ✗'))
log('   两场都有内容：' + (reports.every((r) => r.size > 500) ? '是 ✓' : '否 ✗'))
for (const r of reports) {
  log(`   ${r.key} 的合并临时文件：` + (fs.existsSync(r.mergedFile) ? '还在 ✗' : '已自动清理 ✓'))
}

ws.close()
// 清理
for (const s of SESS) {
  for (const f of [`${s.key}_001.mp4`, `${s.key}_002.mp4`, `${s.key}.meta.json`]) { try { fs.unlinkSync(path.join(DIR, f)) } catch { /* ignore */ } }
  try { fs.rmSync(path.join(DIR, `work_${s.key}`), { recursive: true, force: true }) } catch { /* ignore */ }
}
try { fs.unlinkSync(tiny) } catch { /* ignore */ }
try { fs.rmSync(path.join(DIR, 'work_二测空文件_20261015130000'), { recursive: true, force: true }) } catch { /* ignore */ }
log('\n（测试素材已清理）')
