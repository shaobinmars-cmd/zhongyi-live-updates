// 用已经开着调试端口的 Chrome 打开抖音直播首页，抓一批正在直播的房间号。
// 用法：node cdp-rooms.mjs

import { createRequire } from 'module'

const APP_PKG = 'H:/360MoveData/Users/Administrator/Documents/ChatGPT/直播间拆解项目github/douyin-live-info/package.json'
const require = createRequire(APP_PKG)
const WebSocket = require('ws')
const PORT = Number(process.env.CDP_PORT || 9222)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = list.find((t) => t.type === 'page' && /live\.douyin\.com/.test(t.url || ''))
if (!page) throw new Error('没有 live.douyin.com 页面')

const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })

let id = 0
const pending = new Map()
ws.on('message', (raw) => {
  let m
  try { m = JSON.parse(raw.toString()) } catch { return }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send = (method, params = {}) => new Promise((res) => {
  const myId = ++id
  pending.set(myId, res)
  ws.send(JSON.stringify({ id: myId, method, params }))
})

await send('Page.enable')
await send('Page.navigate', { url: 'https://live.douyin.com/' })
await sleep(9000)

const res = await send('Runtime.evaluate', {
  expression: `JSON.stringify(Array.from(document.querySelectorAll('a[href]')).map(a=>a.getAttribute('href')).filter(h=>/^\\/\\d+$/.test(h)).slice(0,25))`,
  returnByValue: true
})
const hrefs = JSON.parse(res.result?.result?.value || '[]')
const rids = [...new Set(hrefs.map((h) => String(h).replace(/^https?:\/\/live\.douyin\.com\//, '').replace(/^\//, '')))]
console.log('找到 ' + rids.length + ' 个房间号：')
for (const r of rids) console.log('  ' + r)

const dump = await send('Runtime.evaluate', {
  expression: `JSON.stringify(Array.from(document.querySelectorAll('a[href]')).slice(0,40).map(a=>((a.getAttribute('href')||'')+' || '+(a.innerText||'').replace(/\\s+/g,' ').slice(0,40))))`,
  returnByValue: true
})
console.log('页面链接样本：')
for (const t of JSON.parse(dump.result?.result?.value || '[]')) console.log('  ' + t)

const body = await send('Runtime.evaluate', {
  expression: `JSON.stringify([...new Set((document.documentElement.innerHTML||'').match(/"web_rid"\\s*:\\s*"?(\\d{5,})/g)||[])].slice(0,25))`,
  returnByValue: true
})
console.log('HTML 里的 web_rid：' + (body.result?.result?.value || ''))

const ids = await send('Runtime.evaluate', {
  expression: `JSON.stringify([...new Set((document.documentElement.innerHTML||'').match(/live\\.douyin\\.com\\/(\\d{5,})/g)||[])].slice(0,25))`,
  returnByValue: true
})
console.log('HTML 里的直播间链接：' + (ids.result?.result?.value || ''))
ws.close()
