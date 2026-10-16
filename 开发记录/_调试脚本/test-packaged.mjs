// 终测：直接驱动「打包版」跑完整拆解（走 App 自己的接口，不是开发模块）
// 用法：node test-packaged.mjs [调试端口]
import { createRequire } from 'module'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const APP_PKG = 'H:/360MoveData/Users/Administrator/Documents/ChatGPT/直播间拆解项目github/douyin-live-info/package.json'
const require = createRequire(APP_PKG)
const WebSocket = require('ws')

const PORT = Number(process.argv[2] || 9454)
const DIR = 'H:\\迅雷下载'
const FFMPEG = 'D:\\直播拆解工具\\bin\\ffmpeg\\bin\\ffmpeg.exe'
const SRC = 'D:\\直播拆解工具\\录像\\直播_九九🍷（经典老歌）_344779995264_20261010_1926\\chunk_05.ts'
const NAME = '终测_20261015130000'
const ROOM_ID = '7696729443973843727'   // S码的Teacher牛（今天有弹幕数据）
const WINDOW_START = '2026-10-15 04:28:02'

const LOGFILE = path.join(os.tmpdir(), 'test-packaged.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  console.log(s)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- 准备测试素材（两个分段 + 旁注） ----------
const seg1 = path.join(DIR, `${NAME}_001.mp4`)
const seg2 = path.join(DIR, `${NAME}_002.mp4`)
if (!fs.existsSync(seg1)) {
  execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '20', '-t', '45',
    '-i', SRC, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof', seg1])
}
if (!fs.existsSync(seg2)) fs.copyFileSync(seg1, seg2)
const clipSize = fs.statSync(seg1).size
if (clipSize < 100 * 1024) throw new Error('测试素材太小：' + clipSize)
fs.writeFileSync(path.join(DIR, `${NAME}.meta.json`), JSON.stringify({
  roomId: ROOM_ID, nickname: NAME, format: 'mp4', startedAtUtc: WINDOW_START, startedAtLocal: '测试'
}, null, 2), 'utf-8')
log(`测试素材：2 个分段 × ${(clipSize / 1024 / 1024).toFixed(1)}MB + 旁注（绑定房间 S码的Teacher牛）`)

// ---------- 连上打包版 ----------
async function pickPage() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const page = list.find((t) => t.type === 'page' && !/devtools/.test(t.url || ''))
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* 等它起来 */ }
    await sleep(1000)
  }
  throw new Error('连不上打包版窗口')
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

log('\n=== 1) 版本 / 列表 ===')
log('版本：' + await ev(`(() => { const m = (document.body.innerText||'').match(/V\\s*[0-9.]+/); return m ? m[0] : '无' })()`))
log('拆解列表：' + await ev(`(async () => { const l = await window.electronAPI.teardownList(); const t = l.filter(r => /终测/.test(r.path)); return '共 ' + l.length + ' 条，其中本场 ' + t.length + ' 条：' + t.map(r => r.name).join(',') })()`))

log('\n=== 2) 空文件拦截 ===')
const tiny = path.join(DIR, '终测空文件_20261015130000_001.mp4')
fs.writeFileSync(tiny, Buffer.alloc(1500))
log(await ev(`(async () => { const s = await window.electronAPI.teardownStart(${JSON.stringify(tiny)}, 'small'); return '阶段=' + s.stage + '｜' + (s.error || '') })()`))

log('\n=== 3) 跑完整拆解（走打包版） ===')
log(await ev(`(async () => { const s = await window.electronAPI.teardownStart(${JSON.stringify(seg1)}, 'small'); return '已启动，阶段=' + s.stage })()`))

const started = Date.now()
for (;;) {
  await sleep(6000)
  const st = await ev(`(async () => { const s = await window.electronAPI.teardownGetState(); return JSON.stringify({ r: s.running, stage: s.stage, err: s.error }) })()`)
  let o = {}
  try { o = JSON.parse(st) } catch { o = { r: true, stage: String(st).slice(0, 60) } }
  const secs = Math.round((Date.now() - started) / 1000)
  if (o.r) { if (secs % 30 < 7) log(`   …${secs}s　${o.stage}`); continue }
  log(`   跑完，用时 ${secs} 秒，阶段=${o.stage}${o.err ? '｜错误=' + o.err : ''}`)
  break
}

log('\n=== 4) 检查素材包 ===')
log(await ev(`(async () => {
  const p = await window.electronAPI.teardownPacket(${JSON.stringify(seg1)})
  if (!p) return '找不到素材包 ✗'
  const t = p.content || ''
  return JSON.stringify({
    路径: p.packetPath,
    字数: t.length,
    含第七节弹幕礼物: t.includes('## 七、弹幕与礼物'),
    含礼物汇总: t.includes('### 礼物汇总'),
    含送礼榜: t.includes('### 送礼榜'),
    含每分钟密度: t.includes('### 每分钟互动密度'),
    有网格图: (p.grids || []).length
  }, null, 1)
})()`))

ws.close()

// ---------- 清理 ----------
for (const f of [seg1, seg2, tiny, path.join(DIR, `${NAME}.meta.json`)]) { try { fs.unlinkSync(f) } catch { /* ignore */ } }
for (const d of [`work_${NAME}`, 'work_终测空文件_20261015130000']) { try { fs.rmSync(path.join(DIR, d), { recursive: true, force: true }) } catch { /* ignore */ } }
log('\n（测试素材已清理）')
