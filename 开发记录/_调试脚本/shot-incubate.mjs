// 截几张开孵化页的图，看看现在到底多挤
// 用法：node shot-incubate.mjs <调试端口> <输出目录>
import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'

const APP_PKG = 'H:/众艺直播运营工具/源码/package.json'
const require = createRequire(APP_PKG)
const WebSocket = require('ws')
const PORT = Number(process.argv[2] || 9481)
const OUT = process.argv[3] || 'H:\\众艺直播运营工具\\开发记录\\_调试脚本\\shots'
const LICENSE = 'H:\\众艺直播运营工具\\源码\\授权_管理员_0DD8-FD0F-CC3E-8587-795F.json'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })

async function pickPage() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const page = list.find((t) => t.type === 'page' && !/devtools/.test(t.url || ''))
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* 等 */ }
    await sleep(1000)
  }
  throw new Error('连不上调试端口')
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
  if (r.result?.exceptionDetails) return 'EX: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 200)
  return r.result?.result?.value
}
const shot = async (name) => {
  await send('Page.enable')
  const r = await send('Page.captureScreenshot', { format: 'png' })
  const b64 = r.result?.data || ''
  if (!b64) return console.log('截图失败 ' + name)
  const f = path.join(OUT, name + '.png')
  fs.writeFileSync(f, Buffer.from(b64, 'base64'))
  const size = fs.statSync(f).size
  console.log('已保存 ' + f + ' (' + Math.round(size / 1024) + 'KB)')
}
await send('Runtime.enable')
await sleep(600)

const lic = await ev(`(async () => { const s = await window.electronAPI.licenseStatus(); return JSON.stringify(s) })()`)
console.log('授权：' + lic)
const licObj = JSON.parse(lic || '{}')
if (!licObj.licensed) {
  const text = fs.readFileSync(LICENSE, 'utf-8')
  const r = await ev(`(async () => JSON.stringify(await window.electronAPI.licenseActivate(${JSON.stringify(text)})))()`)
  console.log('激活：' + r)
  await ev('location.reload()')
  await sleep(4000)
}

// 进孵化页
console.log('导航：' + await ev(`(() => {
  const cands = Array.from(document.querySelectorAll('a,button,div,span'))
  const hit = cands.find((e) => e.textContent.trim() === '孵化')
  if (hit) { hit.click(); return 'clicked' }
  location.hash = '#/incubate'
  return 'hash'
})()`))
await sleep(2500)
console.log('页面含培训计划：' + await ev(`document.body.innerText.includes('培训计划')`))
await shot('01-培训计划')

// 切到主播页
console.log('切主播：' + await ev(`(() => {
  const t = Array.from(document.querySelectorAll('div')).find((e) => e.textContent.trim() === '主播' && e.offsetParent)
  if (t) { t.click(); return 'clicked' }
  return 'not found'
})()`))
await sleep(1500)
await shot('02-主播页')

// 切到资产与课表
console.log('切资产：' + await ev(`(() => {
  const t = Array.from(document.querySelectorAll('div')).find((e) => e.textContent.trim() === '资产与课表' && e.offsetParent)
  if (t) { t.click(); return 'clicked' }
  return 'not found'
})()`))
await sleep(1500)
await shot('03-资产与课表')

ws.close()
process.exit(0)
