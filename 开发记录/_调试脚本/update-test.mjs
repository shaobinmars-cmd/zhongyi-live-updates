// 测试公网更新：检查清单 + 分卷下载 + 校验
import { createRequire } from 'module'
import fs from 'fs'
const require = createRequire('H:/众艺直播运营工具/源码/package.json')
const WebSocket = require('ws')
const PORT = Number(process.argv[2] || 9490)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = list.find((t) => t.type === 'page' && !/devtools/.test(t.url || ''))
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
await new Promise((r) => ws.on('open', r))
let id = 0
const pend = new Map()
ws.on('message', (raw) => { let m; try { m = JSON.parse(raw.toString()) } catch { return } if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value

console.log('版本：' + await ev(`(async () => JSON.stringify(await window.electronAPI.appVersion ? await window.electronAPI.appVersion() : '') )()`).catch(() => ''))
const chk = await ev(`(async () => JSON.stringify(await window.electronAPI.updateCheckUrl('https://gitee.com/BATULU861/zhongyi-live-updates/releases/download/v2.7.9/latest.json')))()`)
console.log('检查更新：' + chk)
let info = {}
try { info = JSON.parse(chk) } catch { /* ignore */ }
if (info.parts && info.parts.length && process.env.UPDATE_DL === "1") {
  console.log('开始下载 ' + info.parts.length + ' 个分卷（约 ' + Math.round((info.size || 0) / 1048576) + 'MB）…')
  const t0 = Date.now()
  const d = await ev(`(async () => JSON.stringify(await window.electronAPI.updateDownloadManifest(${JSON.stringify({ version: info.latest, parts: info.parts, sha256: info.sha256, size: info.size })})))()`)
  console.log('下载结果：' + d + '（' + Math.round((Date.now() - t0) / 1000) + ' 秒）')
  try {
    const o = JSON.parse(d)
    if (o.path && fs.existsSync(o.path)) {
      console.log('文件大小：' + (fs.statSync(o.path).size / 1048576).toFixed(1) + 'MB')
      fs.unlinkSync(o.path)
      console.log('测试文件已删除')
    }
  } catch { /* ignore */ }
}
ws.close()
process.exit(0)
