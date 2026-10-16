// 直接问打包后的 App：今天新接的「数据汇总 / 一键升级」通道通不通
const http = require('http')
const WebSocket = require('ws')

const PORT = process.argv[2] || '9335'

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: Number(PORT), path, timeout: 8000 }, (r) => {
      let t = ''
      r.setEncoding('utf-8')
      r.on('data', (c) => { t += c })
      r.on('end', () => { try { resolve(JSON.parse(t)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}

const CASES = [
  ['collectServerStatus', 'window.electronAPI.collectServerStatus()'],
  ['collectServerGet', 'window.electronAPI.collectServerGet()'],
  ['collectConfigGet', 'window.electronAPI.collectConfigGet()'],
  ['collectResolve', 'window.electronAPI.collectResolve()'],
  ['updateCheck', 'window.electronAPI.updateCheck()'],
  ['licenseRecheck', 'window.electronAPI.licenseRecheck()']
]

;(async () => {
  const list = await getJson('/json/list')
  const page = list.find((t) => t.type === 'page')
  if (!page) throw new Error('没找到页面')
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
  let id = 0
  const pending = new Map()
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString())
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  })
  const call = (method, params) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })) })

  await new Promise((res) => ws.on('open', res))
  let pass = 0
  for (const [name, expr] of CASES) {
    const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    const err = r?.result?.exceptionDetails
    const v = r?.result?.result?.value
    if (err) { console.log(`[FAIL] ${name} → ${err.text} ${err.exception?.description || ''}`.slice(0, 160)); continue }
    console.log(`[OK]   ${name} → ${JSON.stringify(v).slice(0, 140)}`)
    pass++
  }
  console.log(`结果：通过 ${pass} / 失败 ${CASES.length - pass}`)
  ws.close()
  process.exit(pass === CASES.length ? 0 : 1)
})().catch((e) => { console.error('探查失败：', e.message); process.exit(1) })
