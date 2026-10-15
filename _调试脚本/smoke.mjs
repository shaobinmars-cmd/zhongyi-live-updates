// 冒烟测试：启动的 App 能不能正常用（版本 / 授权 / 引擎 / 录制设置）
// 用法：node smoke.mjs [调试端口]
import { createRequire } from 'module'

const APP_PKG = 'H:/360MoveData/Users/Administrator/Documents/ChatGPT/直播间拆解项目github/douyin-live-info/package.json'
const require = createRequire(APP_PKG)
const WebSocket = require('ws')

const PORT = Number(process.argv[2] || 9466)
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
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res) => ws.on('open', res))
let id = 0
const pend = new Map()
ws.on('message', (raw) => {
  let m
  try { m = JSON.parse(raw.toString()) } catch { return }
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
})
const ev = (expr) => new Promise((res) => {
  const i = ++id
  pend.set(i, (m) => res(m.result?.result?.value))
  ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }))
})

const ver = await ev(`(() => { const m = (document.body.innerText||'').match(/V\\s*[0-9.]+/); return m ? m[0] : '页面未显示' })()`)
const lic = await ev(`(async () => { const s = await window.electronAPI.licenseStatus(); return s.licensed ? ('已激活，到期 ' + s.payload.到期) : ('未激活：' + s.reason) })()`)
const eng = await ev(`(async () => { const s = await window.electronAPI.teardownEngineStatus(); return JSON.stringify({ 引擎ok: s.ok, ffmpeg: s.ffmpegExists, 已缓存模型: s.models }) })()`)
const cfg = await ev(`(async () => JSON.stringify(await window.electronAPI.configLoad()))()`)

console.log('版本：' + ver)
console.log('授权：' + lic)
console.log('引擎：' + eng)
console.log('录制设置：' + cfg)
ws.close()
process.exit(0)
