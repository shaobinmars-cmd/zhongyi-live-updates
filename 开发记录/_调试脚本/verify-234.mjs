// 验证打包版 2.3.4：版本号 + 设置页「分享给运营」区块
import { createRequire } from 'module'

const APP_PKG = 'H:/360MoveData/Users/Administrator/Documents/ChatGPT/直播间拆解项目github/douyin-live-info/package.json'
const require = createRequire(APP_PKG)
const WebSocket = require('ws')

const PORT = Number(process.argv[2] || 9447)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pickPage() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const page = list.find((t) => t.type === 'page' && !/devtools/.test(t.url || ''))
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* wait */ }
    await sleep(1000)
  }
  throw new Error('没找到 App 窗口')
}

const page = await pickPage()
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
await sleep(1500)

const version = await evalJs(`(() => { const m = (document.body.innerText||'').match(/V\\s*[0-9.]+/); return m ? m[0] : '没找到' })()`)
console.log('界面版本号：' + version)

await evalJs(`location.hash = '#/settings'`)
await sleep(3500)
const check = await evalJs(`(() => {
  const t = document.body.innerText || ''
  return JSON.stringify({
    有AI分析区块: t.includes('AI 分析（运营自己就能出报告）'),
    有分享区块: t.includes('分享给运营'),
    有开启共享: t.includes('开启共享'),
    有加一个运营按钮: t.includes('加一个运营'),
    有运营要填的地址: t.includes('运营要填的接口地址')
  })
})()`)
console.log('设置页检查：' + check)

const inputs = await evalJs(`JSON.stringify([...document.querySelectorAll('input')].map(i=>({p:i.placeholder||'', v:i.value||''})).slice(0,14))`)
console.log('输入框：' + inputs)

ws.close()
