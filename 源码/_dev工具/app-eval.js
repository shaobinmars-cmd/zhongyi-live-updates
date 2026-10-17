const http = require('http')
const WebSocket = require('ws')

const port = Number(process.argv[2] || 9555)
const rawExpression = String(process.argv[3] || "document.body.innerText.slice(0,2000)")
const expression = rawExpression.startsWith('b64:') ? Buffer.from(rawExpression.slice(4), 'base64').toString('utf-8') : rawExpression
const waitMs = Number(process.argv[4] || 300)

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let s = ''
      res.on('data', (d) => (s += d))
      res.on('end', () => { try { resolve(JSON.parse(s)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}

async function main() {
  const list = await getJson(`http://127.0.0.1:${port}/json/list`)
  const page = list.find((t) => t.type === 'page' && /index\.html/i.test(t.url)) || list.find((t) => t.type === 'page')
  if (!page) throw new Error('没有找到应用页面')
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
  let id = 0
  const pending = new Map()
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString())
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  })
  await new Promise((r) => ws.on('open', r))
  const send = (method, params = {}) => new Promise((resolve) => {
    const n = ++id
    pending.set(n, resolve)
    ws.send(JSON.stringify({ id: n, method, params }))
  })
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs))
  const out = r.result?.result?.value
  console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2))
  ws.close()
}

main().catch((e) => { console.error(e?.stack || e); process.exit(1) })
