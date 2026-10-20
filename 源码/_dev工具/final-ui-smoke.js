/**
 * 最终打包版隔离验收：版本、主导航、孵化结构、曲库、拆解引擎和设置更新源。
 * 用法：node _dev工具\final-ui-smoke.js <CDP端口>
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const PORT = Number(process.argv[2] || 9666)
const OUT = process.env.E2E_OUT_DIR || path.join(__dirname, 'e2e-out')
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let text = ''
      res.on('data', (chunk) => { text += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(text)) } catch (error) { reject(error) }
      })
    }).on('error', reject)
  })
}

let passed = 0
function check(condition, label, detail = '') {
  if (!condition) throw new Error(`[FAIL] ${label}${detail ? '：' + detail : ''}`)
  passed++
  console.log(`[OK] ${label}${detail ? '：' + detail : ''}`)
}

async function main() {
  let pages = []
  for (let i = 0; i < 40; i++) {
    try {
      pages = await getJson(`http://127.0.0.1:${PORT}/json/list`)
      if (pages.some((page) => page.type === 'page')) break
    } catch { /* 等待应用启动 */ }
    await sleep(500)
  }
  const page = pages.find((item) => item.type === 'page' && /index\.html/i.test(item.url)) || pages.find((item) => item.type === 'page')
  if (!page) throw new Error('没有找到打包版应用页面')

  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
  let sequence = 0
  const pending = new Map()
  const errors = []
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
      return
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      errors.push(String(message.params.args?.map((item) => item.value ?? item.description).join(' ')).slice(0, 240))
    }
    if (message.method === 'Runtime.exceptionThrown') {
      errors.push('EXCEPTION: ' + String(message.params?.exceptionDetails?.text || '').slice(0, 240))
    }
  })
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++sequence
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  await send('Runtime.enable')
  await send('Page.enable')
  await sleep(2500)
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text || '页面脚本执行失败')
    return response.result?.result?.value
  }

  const body = String(await evaluate('document.body.innerText') || '')
  if (!body.includes('2.9.12')) console.log('BODY_DEBUG', JSON.stringify(body.slice(0, 1000)))
  check(body.includes('2.9.12'), '安装包版本显示 2.9.12')
  check(!/激活|机器码/.test(body.slice(0, 300)), '隔离授权可正常进入主界面')

  const nav = String(await evaluate(`Array.from(document.querySelectorAll('.nav-label')).map((e) => e.textContent.trim()).join('|')`) || '')
  for (const label of ['仪表盘', '直播监播', '拆解', '孵化', '曲库', '设置']) {
    check(nav.includes(label), `主导航包含${label}`, nav)
  }

  const schemaCount = Number(await evaluate(`(async () => Object.keys(await window.electronAPI.incubateSchema()).length)()`))
  check(schemaCount === 13, '孵化数据结构完整', String(schemaCount))
  const trackInfo = String(await evaluate(`(async () => { const t = await window.electronAPI.incubateTracks(); return Object.keys(t.tracks).length + '/' + t.common.length })()`) || '')
  check(trackInfo === '16/7', '孵化赛道与通用指标完整', trackInfo)

  const engine = await evaluate(`(async () => await window.electronAPI.teardownEngineStatus())()`)
  check(engine?.ok === true && engine?.pythonExists === true && engine?.scriptExists === true && engine?.ffmpegExists === true, '内置拆解引擎完整', JSON.stringify(engine))

  const folders = await evaluate(`(async () => await window.electronAPI.musicFolders())()`) || []
  const blockedFolder = folders.find((folder) => folder.id === '__blocked__')
  check(!!blockedFolder && blockedFolder.count === 1253, '曲库内置禁播清单 1253 首', String(blockedFolder?.count || 0))
  const apiTypes = String(await evaluate(`[typeof window.electronAPI.musicPickFile, typeof window.electronAPI.musicPickAudio, typeof window.electronAPI.musicUpload, typeof window.electronAPI.musicOpenFolder].join('/')`) || '')
  check(apiTypes === 'function/function/function/function', '曲库导入、上传、打开入口均已注册', apiTypes)

  const autoWatchTypes = String(await evaluate(`[typeof window.electronAPI.autoWatchList, typeof window.electronAPI.autoWatchAdd, typeof window.electronAPI.autoWatchRemove, typeof window.electronAPI.onAutoWatchUpdate].join('/')`) || '')
  check(autoWatchTypes === 'function/function/function/function', '未开播自动等待接口已注册', autoWatchTypes)
  const autoRoundTrip = String(await evaluate(`(async () => {
    const room = { enterRoomId: 'test-auto-443854703170', url: 'https://live.douyin.com/443854703170', nickname: '自动等待测试', title: '未开播测试', platform: 'douyin', platformLabel: '抖音', roomStatus: 2, likeCount: 0, viewCount: 0, error: '' }
    await window.electronAPI.autoWatchAdd(room)
    const before = await window.electronAPI.autoWatchList()
    await window.electronAPI.autoWatchRemove(room.enterRoomId)
    const after = await window.electronAPI.autoWatchList()
    return before.some((item) => item.enterRoomId === room.enterRoomId && item.state === 'waiting') + '/' + after.some((item) => item.enterRoomId === room.enterRoomId)
  })()`) || '')
  check(autoRoundTrip === 'true/false', '未开播自动等待可加入并可取消', autoRoundTrip)

  await evaluate(`location.hash = '#/live'`)
  await sleep(1100)
  const liveText = String(await evaluate('document.body.innerText') || '')
  for (const text of ['直播监播', '等待开播', '开始未录 / 等待开播', '全部连接 / 等待开播']) {
    check(liveText.includes(text), `直播监播页面显示${text}`)
  }

  const liveScreenshot = await send('Page.captureScreenshot', { format: 'png' })
  if (liveScreenshot.result?.data) {
    const output = path.join(OUT, `live-auto-2.9.12-${Date.now()}.png`)
    fs.writeFileSync(output, Buffer.from(liveScreenshot.result.data, 'base64'))
    check(fs.statSync(output).size > 10000, '直播监播自动等待界面截图生成', output)
  }

  await evaluate(`location.hash = '#/music'`)
  await sleep(1200)
  const musicText = String(await evaluate('document.body.innerText') || '')
  for (const text of ['曲库', '1253', '导入歌单到当前文件夹', '批量检测能否播放', '更新禁播歌曲', '上传歌曲文件']) {
    check(musicText.includes(text), `曲库页面显示${text}`)
  }

  await evaluate(`location.hash = '#/incubate'`)
  await sleep(1000)
  const incubateText = String(await evaluate('document.body.innerText') || '')
  check(incubateText.includes('孵化') && incubateText.includes('主播'), '孵化页面正常渲染')

  await evaluate(`location.hash = '#/settings'`)
  await sleep(900)
  const updateUrl = String(await evaluate(`document.querySelector('input[placeholder*="latest.json"]')?.value || ''`) || '')
  check(updateUrl.includes('ghfast.top/https://raw.githubusercontent.com/shaobinmars-cmd/zhongyi-live-updates/main/latest.json'), '设置页使用最新自动更新源', updateUrl)
  const updateLinkCount = Number(await evaluate(`document.querySelectorAll('.update-links button').length`))
  check(updateLinkCount === 4, '设置页列出首选、两个备用和 GitHub 原更新入口', String(updateLinkCount))
  const updateCheck = await evaluate(`(async () => await window.electronAPI.updateCheckUrl(${JSON.stringify(updateUrl)}))()`)
  check(updateCheck?.ok === true && !!String(updateCheck?.latest || ''), '联网更新清单可读取', JSON.stringify(updateCheck))

  const screenshot = await send('Page.captureScreenshot', { format: 'png' })
  if (screenshot.result?.data) {
    const output = path.join(OUT, `final-2.9.12-${Date.now()}.png`)
    fs.writeFileSync(output, Buffer.from(screenshot.result.data, 'base64'))
    check(fs.statSync(output).size > 10000, '最终界面截图生成', output)
  }

  check(errors.length === 0, '页面无控制台异常', errors.slice(0, 2).join(' || '))
  console.log(`FINAL_UI_SMOKE_OK ${passed}`)
  ws.close()
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exit(1)
})
