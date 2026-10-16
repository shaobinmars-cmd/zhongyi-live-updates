/**
 * 布局探针（开发用）：打印关键容器的宽度/溢出情况，定位横向溢出
 * 用法：ELECTRON_RUN_AS_NODE=1 electron.exe _dev工具\layout-probe.js <CDP端口> <路由hash>
 */
const http = require('http')
const WebSocket = require('ws')

const PORT = Number(process.argv[2] || 9333)
const ROUTE = process.argv[3] || 'incubate'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  const list = await getJson(`http://127.0.0.1:${PORT}/json/list`)
  const page = list.find((t) => t.type === 'page' && /index\.html/i.test(t.url)) || list.find((t) => t.type === 'page')
  if (!page) { console.log('[FAIL] 没连上调试端口'); process.exit(1) }

  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 32 * 1024 * 1024 })
  let id = 0
  const pending = new Map()
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString())
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  })
  const send = (method, params) => new Promise((resolve) => {
    const myId = ++id
    pending.set(myId, resolve)
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }))
  })
  await new Promise((r) => ws.on('open', r))
  await send('Runtime.enable')
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300))
    return r.result?.result?.value
  }

  await ev(`location.hash = '#/${ROUTE}'`)
  await sleep(1600)

  const info = await ev(`(() => {
    const q = (s) => document.querySelector(s)
    const m = (el) => el ? { w: Math.round(el.getBoundingClientRect().width), sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight, right: Math.round(el.getBoundingClientRect().right) } : null
    return JSON.stringify({
      route: location.hash,
      window: { inner: innerWidth + 'x' + innerHeight, docScrollW: document.documentElement.scrollWidth, bodyScrollW: document.body.scrollWidth },
      sidebar: m(q('.sidebar')),
      content: m(q('.app-content')),
      page: m(q('.inc-page') || q('.td-page') || q('.dashboard')),
      titlebar: m(q('.titlebar')),
      railBrand: m(q('.rail-brand')),
      railPulse: m(q('.rail-pulse')),
      controls: m(q('.titlebar-controls')),
      picker: m(q('.picker')),
      lastPickerChild: (() => { const p = q('.picker'); if (!p) return null; const c = p.lastElementChild; return c ? { tag: c.tagName, cls: c.className, w: Math.round(c.getBoundingClientRect().width), right: Math.round(c.getBoundingClientRect().right) } : null })(),
      font: getComputedStyle(document.body).fontFamily,
      fontReady: document.fonts.check('13px "ZY Sans SC"')
    }, null, 1)
  })()`)
  console.log(info)
  ws.close()
  process.exit(0)
}

main().catch((e) => { console.log('[EXCEPTION]', e && e.stack ? e.stack : e); process.exit(1) })
