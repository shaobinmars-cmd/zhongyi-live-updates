// 真的点界面验证 AI 设置：填地址/密钥/模型 → 点「测试连接」→ 点「保存」→ 读提示
// 用法：node ui-ai-test.mjs [调试端口] [说明用的key]
import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'
import os from 'os'

const APP_PKG = 'H:/360MoveData/Users/Administrator/Documents/ChatGPT/直播间拆解项目github/douyin-live-info/package.json'
const require = createRequire(APP_PKG)
const WebSocket = require('ws')

const PORT = Number(process.argv[2] || 9464)
const KEY = process.argv[3] || 'sk-282d6643acb04ce9ba06ed0fc5083b17'   // 张家宁那把（只发一次最小请求）

const LOGFILE = path.join(os.tmpdir(), 'ui-ai-test.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  console.log(s)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pickPage() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const page = list.find((t) => t.type === 'page' && !/devtools/.test(t.url || ''))
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* 等 */ }
    await sleep(1000)
  }
  throw new Error('连不上窗口')
}
const page = await pickPage()
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
let id = 0
const pend = new Map()
ws.on('message', (raw) => {
  let m
  try { m = JSON.parse(raw.toString()) } catch { return }
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
})
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return 'EX: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 250)
  return r.result?.result?.value
}
await send('Runtime.enable')
await sleep(1200)

log('版本：' + await ev(`(() => { const m = (document.body.innerText||'').match(/V\\s*[0-9.]+/); return m ? m[0] : '无' })()`))

// 进设置页
await ev(`location.hash = '#/settings'`)
await sleep(3000)

// 填三项（Vue 的 v-model 监听 input 事件）
const fill = await ev(`(() => {
  const setVal = (el, v) => { if (!el) return false; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); return true }
  const inputs = [...document.querySelectorAll('input')]
  const base = inputs.find(i => (i.placeholder||'').startsWith('https://api.deepseek.com'))
  const key = inputs.find(i => (i.placeholder||'') === 'sk-...')
  const model = inputs.find(i => (i.placeholder||'') === 'deepseek-chat')
  const a = setVal(base, 'https://api.deepseek.com/v1')
  const b = setVal(key, ${JSON.stringify(KEY)})
  const c = setVal(model, 'deepseek-chat')
  return JSON.stringify({ 地址: a, 密钥: b, 模型: c })
})()`)
log('填写结果：' + fill)

// 点「测试连接」
log('点击「测试连接」…')
log('  ' + await ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => (b.innerText||'').trim() === '测试连接')
  if (!btn) return '没找到按钮 ✗'
  btn.click()
  return '已点击 ✓'
})()`))

// 等结果（最多 90 秒）
let msg = ''
for (let i = 0; i < 30; i++) {
  await sleep(3000)
  msg = await ev(`(() => {
    const el = [...document.querySelectorAll('.success-text, .error-text')].map(e => (e.innerText||'').trim()).filter(Boolean)
    return el.join(' ｜ ')
  })()`)
  if (msg && !/正在测试/.test(msg)) break
}
log('测试连接提示：' + msg)

// 点「保存 AI 设置」
log('点击「保存 AI 设置」…')
log('  ' + await ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => (b.innerText||'').trim() === '保存 AI 设置')
  if (!btn) return '没找到按钮 ✗'
  btn.click()
  return '已点击 ✓'
})()`))
await sleep(2500)
log('保存后提示：' + await ev(`(() => [...document.querySelectorAll('.success-text, .error-text')].map(e => (e.innerText||'').trim()).filter(Boolean).join(' ｜ '))()`))

// 顺便测「一键填好」：把配置串框填成没带 ZYAI1 的格式，看能不能认出来
log('\n测「一键填好」（故意不写 ZYAI1 前缀）：')
const fill2 = await ev(`(() => {
  const ta = [...document.querySelectorAll('textarea')].find(t => (t.placeholder||'').includes('ZYAI1'))
  if (!ta) return '没找到配置串输入框 ✗'
  ta.value = 'https://api.deepseek.com/v1|${KEY}|deepseek-chat'
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return '已填入 ✓'
})()`)
log('  ' + fill2)
log('  ' + await ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => (b.innerText||'').trim() === '一键填好')
  if (!btn) return '没找到按钮 ✗'
  btn.click()
  return '已点击 ✓'
})()`))
await sleep(3000)
log('  提示：' + await ev(`(() => [...document.querySelectorAll('.success-text, .error-text')].map(e => (e.innerText||'').trim()).filter(Boolean).join(' ｜ '))()`))

ws.close()
