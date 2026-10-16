/**
 * 打包版逐页截图（开发用）
 * 用法：ELECTRON_RUN_AS_NODE=1 electron.exe _dev工具\shot.js <CDP端口> [文件名前缀]
 * 前置：应用需以 APP_DEBUG_PORT=<端口> 启动
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const PORT = Number(process.argv[2] || 9333)
const PREFIX = process.argv[3] || 'shot'
const OUT = path.join(__dirname, 'e2e-out', 'shots')
fs.mkdirSync(OUT, { recursive: true })

const PAGES = [
  ['dashboard', '仪表盘'],
  ['rooms', '直播间'],
  ['danmu', '弹幕'],
  ['teardown', '拆解'],
  ['incubate', '孵化'],
  ['incubate', '孵化-运营考核',
    "(()=>{const t=Array.from(document.querySelectorAll('.n-tabs-tab')).find(e=>e.textContent.includes('运营考核'));if(t)t.click();return !!t})()",
    "(()=>{const b=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='算分');if(b)b.click();return !!b})()"],
  ['incubate', '孵化-资产与课表',
    "(()=>{const t=Array.from(document.querySelectorAll('.n-tabs-tab')).find(e=>e.textContent.includes('资产与课表'));if(t)t.click();return !!t})()"],
  ['recording', '录制'],
  ['settings', '设置'],
  ['about', '关于']
]

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
  let list = []
  for (let i = 0; i < 30; i++) {
    try {
      list = await getJson(`http://127.0.0.1:${PORT}/json/list`)
      if (list.find((t) => t.type === 'page')) break
    } catch { /* 等启动 */ }
    await sleep(1000)
  }
  const page = list.find((t) => t.type === 'page' && /index\.html/i.test(t.url)) || list.find((t) => t.type === 'page')
  if (!page) { console.log('[FAIL] 没连上调试端口'); process.exit(1) }

  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
  let id = 0
  const pending = new Map()
  const errors = []
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString())
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') errors.push(String(m.params.args?.map((a) => a.value ?? a.description).join(' ')).slice(0, 200))
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION: ' + String(m.params?.exceptionDetails?.text || '').slice(0, 200))
  })
  const send = (method, params) => new Promise((resolve) => {
    const myId = ++id
    pending.set(myId, resolve)
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }))
  })
  await new Promise((r) => ws.on('open', r))
  await send('Runtime.enable')
  await send('Page.enable')
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    return r.result?.result?.value
  }

  console.log('页面：' + page.url.slice(0, 80) + '…')
  const first = String(await ev('document.body.innerText.slice(0,120)'))
  if (/激活|机器码/.test(first)) { console.log('[WARN] 当前停在激活页，截图意义有限') }

  for (const page of PAGES) {
    const [hash, label] = page
    await ev(`location.hash = '#/${hash}'`)
    await sleep(1400)
    // 第三个元素开始是「进页面后再点的操作」（比如切到运营考核、点算分）
    for (const pre of page.slice(2)) {
      await ev(pre)
      await sleep(900)
    }
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    if (!shot.result?.data) { console.log('[FAIL] ' + label); continue }
    const file = path.join(OUT, `${PREFIX}-${label}.png`)
    fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
    console.log('[OK] ' + label + ' → ' + file)
  }
  console.log('\nconsole 错误 ' + errors.length + ' 条' + (errors.length ? '：' + errors.slice(0, 3).join(' || ') : ''))
  ws.close()
  process.exit(0)
}

main().catch((e) => { console.log('[EXCEPTION]', e && e.stack ? e.stack : e); process.exit(1) })
