/**
 * 打包产物端到端自测（开发用，v2：通用能力五项 + 赛道）
 * 用法：ELECTRON_RUN_AS_NODE=1 electron.exe _dev工具\e2e-packaged.js <CDP端口>
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const PORT = Number(process.argv[2] || 9333)
const OUT = path.join(__dirname, 'e2e-out')
fs.mkdirSync(OUT, { recursive: true })

let pass = 0
let fail = 0
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('[OK]   ' + label + (extra !== undefined ? '  → ' + extra : '')) }
  else { fail++; console.log('[FAIL] ' + label + (extra !== undefined ? '  → ' + extra : '')) }
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let s = ''
      res.on('data', (d) => (s += d))
      res.on('end', () => { try { resolve(JSON.parse(s)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  console.log('页面：' + page.url.slice(0, 90) + '…')

  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
  let id = 0
  const pending = new Map()
  const errors = []
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString())
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') errors.push(String(m.params.args?.map((a) => a.value ?? a.description).join(' ')).slice(0, 160))
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION: ' + String(m.params?.exceptionDetails?.text || '').slice(0, 160))
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

  const text0 = String(await ev('document.body.innerText.slice(0,160)') || '')
  ok('进入主界面（不是激活页）', !/激活|机器码/.test(text0))
  ok('侧边栏含「孵化」', String(await ev(`Array.from(document.querySelectorAll('.nav-label')).map(e=>e.textContent).join('|')`) || '').includes('孵化'))

  await ev(`location.hash = '#/incubate'`)
  await sleep(1500)
  const pt = String(await ev('document.body.innerText.slice(0,300)') || '')
  ok('孵化页渲染', /孵化/.test(pt) && /主播/.test(pt))

  ok('IPC 表结构（11 张）', Number(await ev(`(async()=>Object.keys(await window.electronAPI.incubateSchema()).length)()`)) === 11)
  const tk = String(await ev(`(async()=>{const t=await window.electronAPI.incubateTracks();return Object.keys(t.tracks).length+'/'+t.common.length})()`) || '')
  ok('IPC 赛道16 / 通用项7', tk === '16/7', tk)

  const seed = String(await ev(`(async()=>JSON.stringify((await window.electronAPI.incubateSeed()).seeded))()`) || '')
  ok('IPC 种子数据', seed.length > 0, seed)

  const roster = String(await ev(`(async()=>{await window.electronAPI.incubateImportStreamers('端测主播,小A,唱歌点歌','小A');const r=await window.electronAPI.incubateList('主播学籍');return JSON.stringify(r.map(x=>x['主播']+'/'+x['赛道']))})()`) || '')
  ok('IPC 名册导入（带赛道）', roster.includes('唱歌点歌'), roster)

  const saved = String(await ev(`(async()=>{const d=new Date().toISOString().slice(0,10);for(const [k,v] of Object.entries({话术熟练度:'4',BGM使用熟练度:'3',动作熟练度:'3',表情管理:'4',直播连贯性:'4',最长空档秒:'1.5',收尾完成:'是'})){await window.electronAPI.incubateAdd('场次记录',{日期:d,运营:'小A',主播:'端测主播',赛道:'唱歌点歌',指标:k,数值:v,提交时间:d+' 22:00'})}const rows=await window.electronAPI.incubateList('场次记录');return rows.length})()`) || '')
  ok('IPC 场次记录写入', Number(saved) >= 7, saved + ' 行')

  const score = String(await ev(`(async()=>{const r=await window.electronAPI.incubateScore('${new Date().toISOString().slice(0, 7)}');return JSON.stringify(r.map(x=>x['运营']+':'+x['得分']+x['结论']+'/'+x['进步率']))})()`) || '')
  ok('IPC 运营考核', score.includes('小A'), score)

  // 不假设默认值（真实电脑上可能本来就是开着的）：能开、并且能恢复原值就行
  const v5 = String(await ev(`(async()=>{const c=await window.electronAPI.teardownConfigGet();const before=!!c.useV5;await window.electronAPI.teardownConfigSet({useV5:true});const a=(await window.electronAPI.teardownConfigGet()).useV5;await window.electronAPI.teardownConfigSet({useV5:before});const back=(await window.electronAPI.teardownConfigGet()).useV5;return String(before)+'/'+String(a)+'/'+String(back)})()`) || '')
  const v5p = v5.split('/')
  ok('v5 开关（能开 → 并恢复原值）', v5p[1] === 'true' && v5p[0] === v5p[2], v5)
  const rc = String(await ev(`(async()=>JSON.stringify(await window.electronAPI.danmuReconnect()))()`) || '')
  ok('IPC 弹幕手动重连（掉线时不用等自动重连）', rc.includes('"ok":true'), rc)
  ok('v5 指令可取', Number(await ev(`(async()=>String(await window.electronAPI.incubateInstruction()).length)()`)) > 500)

  // 重新进入页面（名单非空 → 应自动选中第一个主播，表格出行）
  await ev(`location.hash = '#/dashboard'`); await sleep(600)
  await ev(`location.hash = '#/incubate'`); await sleep(1600)
  const rows = Number(await ev(`document.querySelectorAll('.n-data-table-tr').length`))
  const hasTable = await ev(`!!document.querySelector('.n-data-table')`)
  // 行数跟当前选中的主播有关（真实名单里第一个主播可能还没有记录），只要求表格和表头在
  ok('数据表渲染（表头/表格在，行数随选中主播）', hasTable === true && rows >= 1, rows + ' 行 / 表格=' + hasTable)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  if (shot.result?.data) {
    const p = path.join(OUT, 'incubate-v2.png')
    fs.writeFileSync(p, Buffer.from(shot.result.data, 'base64'))
    ok('截图', fs.statSync(p).size > 10000, p)
  } else ok('截图', false)

  ok('无 console 错误', errors.length === 0, errors.slice(0, 2).join(' || '))
  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`)
  ws.close()
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.log('[EXCEPTION]', e && e.stack ? e.stack : e); process.exit(1) })
