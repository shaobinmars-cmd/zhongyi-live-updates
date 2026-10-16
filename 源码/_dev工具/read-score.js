/**
 * 读一眼「运营考核」表（开发用）：把算分结果逐列打出来，核对口径
 * 用法：ELECTRON_RUN_AS_NODE=1 electron.exe _dev工具\read-score.js <CDP端口>
 */
const http = require('http')
const WebSocket = require('ws')

const PORT = Number(process.argv[2] || 9333)

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
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400))
    return r.result?.result?.value
  }

  const month = new Date().toISOString().slice(0, 7)
  const rows = JSON.parse(await ev(`(async()=>JSON.stringify(await window.electronAPI.incubateScore('${month}')))()`) || '[]')
  console.log(`月份 ${month}：${rows.length} 个运营\n`)
  for (const r of rows) {
    console.log(`—— ${r['运营']}｜得分 ${r['得分']}（${r['等级']}）｜${r['结论']}`)
    console.log(`   主播 ${r['主播数']} 人｜应交 ${r['应交场次']}｜按时 ${r['按时提交']}｜补交 ${r['补交']}｜按时率 ${r['按时率']}｜成长 ${r['成长分']}｜学习 ${r['学习分']}`)
    console.log(`   说明：${r['说明']}\n`)
  }
  ws.close()
  process.exit(0)
}

main().catch((e) => { console.log('[EXCEPTION]', e && e.stack ? e.stack : e); process.exit(1) })
