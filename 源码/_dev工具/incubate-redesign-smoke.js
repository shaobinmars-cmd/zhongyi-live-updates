/**
 * 孵化页重排验收：顶部主播、今日该盯、五项自动保存、课表颜色与点选详情。
 * 用法：node _dev工具\incubate-redesign-smoke.js <CDP端口>
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const PORT = Number(process.argv[2] || 9667)
const OUT = process.env.E2E_OUT_DIR || path.join(__dirname, 'e2e-out')
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let passed = 0

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let text = ''
      res.on('data', (chunk) => { text += chunk })
      res.on('end', () => { try { resolve(JSON.parse(text)) } catch (error) { reject(error) } })
    }).on('error', reject)
  })
}

function check(ok, label, detail = '') {
  if (!ok) throw new Error(`[FAIL] ${label}${detail ? '：' + detail : ''}`)
  passed++
  console.log(`[OK] ${label}${detail ? '：' + detail : ''}`)
}

async function main() {
  let pages = []
  for (let i = 0; i < 40; i++) {
    try {
      pages = await getJson(`http://127.0.0.1:${PORT}/json/list`)
      if (pages.some((page) => page.type === 'page')) break
    } catch { /* 等应用启动 */ }
    await sleep(500)
  }
  const page = pages.find((item) => item.type === 'page' && /index\.html/i.test(item.url)) || pages.find((item) => item.type === 'page')
  if (!page) throw new Error('没有找到应用页面')

  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
  let id = 0
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
      errors.push(String(message.params.args?.map((x) => x.value ?? x.description).join(' ')).slice(0, 240))
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(String(message.params?.exceptionDetails?.text || '').slice(0, 240))
  })
  const send = (method, params = {}) => new Promise((resolve) => {
    const messageId = ++id
    pending.set(messageId, resolve)
    ws.send(JSON.stringify({ id: messageId, method, params }))
  })
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  await send('Runtime.enable')
  await send('Page.enable')
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text || '页面脚本执行失败')
    return response.result?.result?.value
  }

  const seeded = String(await evaluate(`(async () => {
    const d = new Date();
    localStorage.removeItem('inc_operator');
    localStorage.removeItem('inc_only_mine');
    const p = (n) => String(n).padStart(2, '0');
    const suffix = String(Date.now()).slice(-5);
    const streamerA = '界面验收A' + suffix;
    const streamerB = '界面验收B' + suffix;
    const today = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    await window.electronAPI.incubateImportStreamers(streamerA + ',界面验收运营,唱歌点歌\\n' + streamerB + ',界面验收运营,聊天陪聊', '界面验收运营', '唱歌点歌');
    await window.electronAPI.incubateGeneratePlan({ streamer: streamerA, track: '唱歌点歌', startDate: today, source: '界面验收' });
    await window.electronAPI.incubateGeneratePlan({ streamer: streamerB, track: '聊天陪聊', startDate: today, source: '界面验收' });
    return today;
  })()`) || '')
  check(!!seeded, '测试主播与 60 天课表已生成', seeded)

  await evaluate(`location.hash = '#/dashboard'`)
  await sleep(500)
  await evaluate(`location.hash = '#/incubate'`)
  await sleep(2200)

  const body = String(await evaluate('document.body.innerText') || '')
  for (const text of ['添加主播', '修改主播资料', '今日该盯', '当前主播', '基础档案', '运营加课', '今日五项评分', '输入后自动保存', '本周课表']) {
    check(body.includes(text), `孵化页显示${text}`, body.includes(text) ? '' : body.slice(0, 1600))
  }
  const scoreCount = Number(await evaluate(`document.querySelectorAll('.top-score-grid label').length`))
  check(scoreCount === 5, '顶部显示五项评分', String(scoreCount))
  const sectionCount = Number(await evaluate(`document.querySelectorAll('.inc-command-block, .inc-today-block, .inc-all-block').length`))
  check(sectionCount === 3, '页面按一、二、三三个工作板块组织', String(sectionCount))
  const profileFields = Number(await evaluate(`document.querySelectorAll('.basic-profile-grid label').length`))
  check(profileFields >= 6, '基础档案已移到顶部工作台', String(profileFields))

  const hero0 = String(await evaluate(`document.querySelector('.hero-name-wrap b')?.textContent?.trim() || ''`) || '')
  check(!!hero0 && hero0 !== '未选择主播', '当前主播以大号标题显示', hero0)

  const watchNames = String(await evaluate(`Array.from(document.querySelectorAll('.watch-dock .watch-name')).map((x) => x.textContent.trim()).join('|')`) || '')
  check(watchNames.length > 0, '今日该盯主播已显示在顶部', watchNames)
  const watchClick = String(await evaluate(`(async () => {
    const items = Array.from(document.querySelectorAll('.watch-dock .watch-item'));
    const other = items.find((x) => !x.textContent.includes(document.querySelector('.hero-name-wrap b')?.textContent || '___'));
    if (!other) return '';
    const name = other.querySelector('.watch-name')?.textContent?.trim() || '';
    other.click();
    await new Promise((r) => setTimeout(r, 1200));
    return name + '/' + (document.querySelector('.hero-name-wrap b')?.textContent?.trim() || '');
  })()`) || '')
  const [clickedName, clickedHero] = watchClick.split('/')
  check(!!clickedName && clickedName === clickedHero, '点今日该盯主播会自动切换并带出资料', watchClick)

  const weekRows = Number(await evaluate(`document.querySelectorAll('.week-card .n-data-table-tr').length`))
  check(weekRows >= 1, '本周课表已按日期生成', String(weekRows))
  const coloredDates = Number(await evaluate(`document.querySelectorAll('.week-date-chip').length`))
  check(coloredDates >= 1, '本周课表日期已用彩色标签区分', String(coloredDates))
  const weekClick = String(await evaluate(`(async () => {
    const row = document.querySelector('.week-card .n-data-table-tbody .n-data-table-tr');
    if (!row) return '';
    row.click();
    await new Promise((r) => setTimeout(r, 300));
    return document.querySelector('.week-detail')?.innerText || '';
  })()`) || '')
  check(weekClick.includes('今天练什么') && weekClick.includes('验收标准'), '点课表行会直接显示课程详情', weekClick.slice(0, 180))

  const autoSave = String(await evaluate(`(async () => {
    const first = document.querySelector('.top-score-grid label');
    const key = first?.querySelector('span')?.textContent?.trim() || '';
    const trigger = first?.querySelector('.n-base-selection');
    if (!trigger) return 'NO_SELECT';
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    const option = Array.from(document.querySelectorAll('.n-base-select-option')).find((x) => x.textContent.trim().startsWith('4'));
    if (!option) return 'NO_OPTION';
    option.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 2000));
    const streamer = document.querySelector('.hero-name-wrap b')?.textContent?.trim() || '';
    const d = new Date(); const p = (n) => String(n).padStart(2, '0');
    const today = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    const rows = await window.electronAPI.incubateList('场次记录');
    const hit = rows.find((row) => String(row['主播'] || '').trim() === streamer && String(row['日期'] || '') === today && String(row['指标'] || '') === key);
    return JSON.stringify({ streamer, key, value: hit?.['数值'] || '', status: document.querySelector('.top-score-head i')?.textContent || '' });
  })()`) || '')
  check(autoSave.includes('"value":"4"') && autoSave.includes('已自动保存'), '今日评分输入后自动保存', autoSave)

  const sync = await evaluate(`(async () => await window.electronAPI.syncTest())()`)
  check(sync?.ok === true, '每日数据上传到 GitHub 通道正常', String(sync?.message || ''))

  const dropResult = await evaluate(`(async () => {
    const drop = document.querySelector('.plan-drop');
    if (!drop) return 'NO_DROP';
    const transfer = new DataTransfer();
    transfer.items.add(new File(['# 拖拽测试报告 建议赛道：聊天陪聊'], '拖拽测试报告.md', { type: 'text/markdown' }));
    drop.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    await new Promise((r) => setTimeout(r, 2600));
    return document.body.innerText.includes('报告已读取并导入') || document.body.innerText.includes('已导入并生成计划') ? 'IMPORTED' : 'NO_MESSAGE';
  })()`) || ''
  check(dropResult === 'IMPORTED', 'AI 报告拖入区域可读取并导入', dropResult)

  const addModalText = String(await evaluate(`(async () => {
    const btn = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === '+ 添加主播');
    if (!btn) return 'NO_BUTTON';
    btn.click();
    await new Promise((r) => setTimeout(r, 400));
    return document.body.innerText;
  })()`) || '')
  check(addModalText.includes('添加主播（可一次加多人）') && addModalText.includes('添加这些主播'), '添加主播弹窗已简化', addModalText.includes('添加这些主播') ? 'OK' : 'MISSING')
  await evaluate(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === '取消'); if (b) b.click(); })()`)
  await sleep(500)

  const editModalText = String(await evaluate(`(async () => {
    const btn = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === '修改主播资料');
    if (!btn) return 'NO_BUTTON';
    btn.click();
    await new Promise((r) => setTimeout(r, 400));
    return document.body.innerText;
  })()`) || '')
  check(editModalText.includes('只处理填错或重复建档') && editModalText.includes('删除这个错误主播'), '主播修改与误建删除入口可用', editModalText.includes('删除这个错误主播') ? 'OK' : 'MISSING')
  const editShot = await send('Page.captureScreenshot', { format: 'png' })
  if (editShot.result?.data) {
    const output = path.join(OUT, `incubate-edit-streamer-${Date.now()}.png`)
    fs.writeFileSync(output, Buffer.from(editShot.result.data, 'base64'))
    check(fs.statSync(output).size > 10000, '主播修改与删除弹窗截图已生成', output)
  }
  await evaluate(`(() => { const buttons = Array.from(document.querySelectorAll('.n-modal button')); const b = buttons.includes(buttons.find((x) => x.textContent.trim() === '取消')) ? buttons.find((x) => x.textContent.trim() === '取消') : null; if (b) b.click(); })()`)
  await sleep(500)

  await evaluate(`(() => { const page = document.querySelector('.inc-page'); if (page) page.scrollTop = 0; window.scrollTo(0, 0); return true })()`)
  await sleep(350)
  const metrics = await send('Page.getLayoutMetrics')
  const contentSize = metrics.result?.cssContentSize || metrics.result?.contentSize || { width: 1100, height: 800 }
  const screenshot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: contentSize.width, height: Math.min(contentSize.height, 5000), scale: 1 }
  })
  if (screenshot.result?.data) {
    const output = path.join(OUT, `incubate-redesign-${Date.now()}.png`)
    fs.writeFileSync(output, Buffer.from(screenshot.result.data, 'base64'))
    check(fs.statSync(output).size > 10000, '孵化页重排截图已生成', output)
  }
  for (const [label, selector] of [['today', '.inc-today-block'], ['all', '.inc-all-block']]) {
    await evaluate(`(() => { document.querySelector('${selector}')?.scrollIntoView({ block: 'start', behavior: 'auto' }); return true })()`)
    await sleep(300)
    const sectionShot = await send('Page.captureScreenshot', { format: 'png' })
    if (sectionShot.result?.data) {
      const output = path.join(OUT, `incubate-${label}-${Date.now()}.png`)
      fs.writeFileSync(output, Buffer.from(sectionShot.result.data, 'base64'))
      check(fs.statSync(output).size > 10000, `孵化页${label}分区截图已生成`, output)
    }
  }
  check(errors.length === 0, '页面无控制台异常', errors.slice(0, 2).join(' || '))
  console.log(`INCUBATE_REDESIGN_OK ${passed}`)
  ws.close()
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exit(1)
})
