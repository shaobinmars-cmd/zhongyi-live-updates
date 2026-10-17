const http = require('http')
const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const port = Number(process.argv[2] || 9555)
const prefix = process.argv[3] || 'long'
const out = path.join(__dirname, 'e2e-out', 'shots')
fs.mkdirSync(out, { recursive: true })
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
  const send = (method, params = {}) => new Promise((resolve) => {
    const n = ++id
    pending.set(n, resolve)
    ws.send(JSON.stringify({ id: n, method, params }))
  })
  await new Promise((r) => ws.on('open', r))
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    return r.result?.result?.value
  }
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    const file = path.join(out, `${prefix}-${name}.png`)
    fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'))
    console.log(file)
  }

  await ev("location.hash='#/settings'")
  await ev("location.hash='#/live'")
  await ev("location.hash='#/dashboard'")
  await sleep(700)
  await shot('dashboard')
  await ev("location.hash='#/live'")
  await sleep(1000)
  await shot('live')
  await sleep(900)
  await shot('settings-top')
  await ev("(()=>{const e=document.querySelector('.settings-page');if(e)e.scrollTop=700;return e?.scrollTop})()")
  await sleep(500)
  await shot('settings-mid')
  await ev("(()=>{const e=document.querySelector('.settings-page');if(e)e.scrollTop=e.scrollHeight;return e?.scrollTop})()")
  await sleep(500)
  await shot('settings-bottom')

  await ev("location.hash='#/incubate'")
  await sleep(1100)
  await shot('incubate-top')
  await ev("(()=>{const e=document.querySelector('.inc-page');if(e)e.scrollTop=650;return e?.scrollTop})()")
  await sleep(500)
  await shot('incubate-mid')
  await ev("(()=>{const e=document.querySelector('.inc-page');if(e)e.scrollTop=e.scrollHeight;return e?.scrollTop})()")
  await sleep(500)
  await shot('incubate-bottom')

  await ev("location.hash='#/teardown'")
  await sleep(900)
  await shot('teardown-top')
  await ev("(()=>{const b=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes('喂给 AI'));if(b)b.click();return !!b})()")
  await sleep(500)
  await shot('teardown-ai')
  await ev("(()=>{const e=document.querySelector('.td-page');if(e)e.scrollTop=e.scrollHeight;return e?.scrollTop})()")
  await sleep(500)
  await shot('teardown-bottom')

  ws.close()
}

main().catch((e) => { console.error(e?.stack || e); process.exit(1) })
