/**
 * 清理自测数据（开发用）：把 e2e-packaged.js 灌进去的「端测主播 / 小A」删掉
 * 用法：ELECTRON_RUN_AS_NODE=1 electron.exe _dev工具\clean-test-data.js <CDP端口> [--dry]
 */
const http = require('http')
const WebSocket = require('ws')

const PORT = Number(process.argv[2] || 9333)
const DRY = process.argv.includes('--dry')
const HIT = ['端测主播', '小A']

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

  const tables = await ev(`(async()=>Object.keys(await window.electronAPI.incubateSchema()))()`)
  let total = 0
  for (const t of tables) {
    const rows = await ev(`(async()=>JSON.stringify(await window.electronAPI.incubateList(${JSON.stringify(t)})))()`)
    const parsed = JSON.parse(rows || '[]')
    for (const row of parsed) {
      const s = JSON.stringify(row)
      if (!HIT.some((h) => s.includes(h))) continue
      total++
      console.log(`[命中] ${t} id=${row.id} ${s.slice(0, 120)}`)
      if (!DRY) await ev(`(async()=>window.electronAPI.incubateDelete(${JSON.stringify(t)}, ${JSON.stringify(row.id)}))()`)
    }
  }
  console.log(`\n${DRY ? '[试运行] 命中' : '已删除'} ${total} 行`)
  await sleep(300)
  const left = await ev(`(async()=>{const r={};for(const t of ${JSON.stringify(tables)}){r[t]=(await window.electronAPI.incubateList(t)).length}return JSON.stringify(r)})()`)
  console.log('剩余行数：' + left)
  ws.close()
  process.exit(0)
}

main().catch((e) => { console.log('[EXCEPTION]', e && e.stack ? e.stack : e); process.exit(1) })
