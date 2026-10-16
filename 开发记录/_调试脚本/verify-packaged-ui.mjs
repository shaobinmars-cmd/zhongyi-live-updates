// 驱动打包好的 App 界面，检查「弹幕」页的登录提示是什么颜色/文案。
// 用法：node verify-packaged-ui.mjs [调试端口]

import { createRequire } from 'module'

const APP_PKG = 'H:/360MoveData/Users/Administrator/Documents/ChatGPT/直播间拆解项目github/douyin-live-info/package.json'
const require = createRequire(APP_PKG)
const WebSocket = require('ws')

const PORT = Number(process.argv[2] || 9444)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pickPage() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const page = list.find((t) => t.type === 'page' && !/devtools/.test(t.url || ''))
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* 还没起来 */ }
    await sleep(1000)
  }
  throw new Error('没找到 App 窗口（带 APP_DEBUG_PORT 启动了吗？）')
}

const page = await pickPage()
console.log('已连上窗口：' + page.url)

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
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value
}

await send('Runtime.enable')
await sleep(1000)

const nav = await evalJs(`JSON.stringify([...document.querySelectorAll('*')].filter(e => !e.children.length && e.textContent.trim()).map(e => e.textContent.trim()).slice(0, 40))`)
console.log('界面上的文字样本：' + nav)

// 直接切到弹幕页（用 hash 路由最稳，点元素容易点错到仪表盘上那个同名卡片）
await evalJs(`location.hash = '#/danmu'`)
console.log('已切到 #/danmu')
await sleep(3000)

const banner = await evalJs(`(() => {
  const t = document.body.innerText || ''
  const lines = t.split('\\n').map(s => s.trim()).filter(Boolean)
  const hit = lines.filter(s => /登录|弹幕通道|收不到/.test(s)).slice(0, 8)
  return JSON.stringify(hit)
})()`)
console.log('弹幕页上的登录相关文字：' + banner)

const state = await evalJs(`(() => { const t = document.body.innerText || ''; return JSON.stringify({ 已登录: t.includes('抖音已登录'), 未登录: t.includes('还没登录抖音'), 换号按钮: t.includes('更换账号'), 登录按钮: t.includes('立即登录抖音') }) })()`)
console.log('判定：' + state)

ws.close()
