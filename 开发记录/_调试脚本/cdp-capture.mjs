// 从"正在运行的 Chrome"里旁听抖音直播间的弹幕 WebSocket 帧。
// 原理：Chrome 带 --remote-debugging-port=9222 启动后，可以用 CDP 的
// Network.webSocketFrameReceived 事件看到页面收到的所有 WS 帧 —— 不改页面逻辑。
//
// 用法：node cdp-capture.mjs [监听秒数]

import { createRequire } from 'module'
import * as path from 'path'

const APP_PKG = 'H:/360MoveData/Users/Administrator/Documents/ChatGPT/直播间拆解项目github/douyin-live-info/package.json'
const require = createRequire(APP_PKG)
const WebSocket = require('ws')

const SECONDS = Number(process.argv[2]) || 40
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pickPage() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9222/json')).json()
      const page = list.find((t) => t.type === 'page' && /live\.douyin\.com/.test(t.url || ''))
      if (page?.webSocketDebuggerUrl) return page
      const any = list.find((t) => t.type === 'page')
      if (i > 20 && any) return any
    } catch { /* 还没起来 */ }
    await sleep(1000)
  }
  throw new Error('没找到页面目标（Chrome 是不是没带 --remote-debugging-port=9222 启动？）')
}

const page = await pickPage()
console.log('已连接页面: ' + page.url)

const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })

let id = 0
const send = (method, params = {}) => {
  ws.send(JSON.stringify({ id: ++id, method, params }))
}

const stats = { frames: 0, text: 0, binary: 0, bytes: 0, byUrl: {} }
const samples = []

ws.on('message', (raw) => {
  let msg
  try { msg = JSON.parse(raw.toString()) } catch { return }
  if (msg.method !== 'Network.webSocketFrameReceived') return
  const p = msg.params || {}
  const data = p.response?.payloadData || ''
  stats.frames++
  if (p.response?.opcode === 1) stats.text++
  else stats.binary++
  stats.bytes += data.length
  const url = (p.response?.url || '').slice(0, 70)
  stats.byUrl[url] = (stats.byUrl[url] || 0) + 1
  if (samples.length < 3) samples.push({ url, len: data.length, head: data.slice(0, 60) })
})

send('Network.enable')
send('Runtime.enable')

console.log(`开始旁听 ${SECONDS} 秒…（这段期间页面上有弹幕就会计到）`)
await sleep(SECONDS * 1000)

console.log('\n===== 结果 =====')
console.log(`总帧数: ${stats.frames}　文本帧: ${stats.text}　二进制帧: ${stats.binary}`)
console.log(`累计 payload 字符数: ${stats.bytes}`)
console.log('按连接分组:')
for (const [u, n] of Object.entries(stats.byUrl)) console.log(`  ${n} 帧  ${u}`)
if (samples.length) {
  console.log('样本:')
  for (const s of samples) console.log(`  len=${s.len}  ${s.head}`)
}
console.log(stats.frames > 0 ? '\n结论：能抓到弹幕帧 ✓' : '\n结论：这 ' + SECONDS + ' 秒内没抓到任何 WS 帧 ✗')
ws.close()
