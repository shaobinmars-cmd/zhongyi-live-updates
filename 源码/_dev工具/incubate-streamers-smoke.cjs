// 主播赛道、离司留存、自定义课程、离职率专项自测（临时数据库）
const { app } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const temp = path.join(os.tmpdir(), `incubate-streamers-smoke-${Date.now()}`)
app.setPath('userData', temp)
app.on('window-all-closed', () => { /* 测试脚本自己退出 */ })

function assert(ok, message) {
  if (!ok) throw new Error(message)
  console.log('[OK] ' + message)
}

app.whenReady().then(async () => {
  try {
    const inc = require('../dist-electron/services/incubate.js')
    const plan = require('../dist-electron/services/incubate-plan.js')
    const today = new Date().toISOString().slice(0, 10)
    const month = today.slice(0, 7)

    await inc.importStreamers('测试甲,运营A\n测试乙,运营A,唱歌点歌', '', '舞蹈')
    let roster = await inc.listRows('主播学籍')
    const a = roster.find((r) => r['主播'] === '测试甲')
    const b = roster.find((r) => r['主播'] === '测试乙')
    assert(a?.['赛道'] === '舞蹈', '未写第三段时，新主播使用弹窗选择的默认赛道')
    assert(b?.['赛道'] === '唱歌点歌', '名单里明确写第三段时，赛道可正常保存')

    await inc.importStreamers('测试甲,运营A,脱口秀', '', '下单游戏')
    roster = await inc.listRows('主播学籍')
    assert(roster.find((r) => r['主播'] === '测试甲')?.['赛道'] === '脱口秀', '已有主播可以切换到其他赛道')

    await plan.generateTrainingPlan({ streamer: '测试甲', track: '脱口秀', startDate: today, source: '测试' })
    const custom = await plan.addCustomCourse({
      streamer: '测试甲', date: today, title: '话术加练 20 分钟', how: '开场三句练 10 遍',
      accept: '脱稿完成并在直播中用 8 次', operator: '运营A'
    })
    assert(custom.day === 'D1', '运营自定义课程会映射到计划第几天')

    let p = await plan.getPlan('测试甲')
    assert(p.days.length === 61, 'AI 60 天计划与 1 条运营课程同时存在')
    const customRow = p.days.find((r) => r['课程来源'] === '运营自定义')
    assert(customRow?.['今天练什么'] === '话术加练 20 分钟', '自定义课程进入主播课表')

    await plan.generateTrainingPlan({ streamer: '测试甲', track: '脱口秀', startDate: today, source: '重新生成' })
    p = await plan.getPlan('测试甲')
    assert(p.days.filter((r) => r['课程来源'] === '运营自定义').length === 1, '重新生成 AI 计划不会覆盖运营自定义课程')

    await inc.addRow('场次记录', { 日期: today, 运营: '运营A', 主播: '测试甲', 赛道: '脱口秀', 指标: '话术熟练度', 数值: '4' })
    let score = await inc.scoreOperators(month)
    let op = score.find((r) => r['运营'] === '运营A')
    assert(op?.['主播数'] === '2' && op?.['已离司'] === '0' && op?.['离职率'] === '0', '在职时离职率为 0%')

    await inc.departStreamer('测试甲', today)
    roster = await inc.listRows('主播学籍')
    assert(roster.some((r) => r['主播'] === '测试甲'), '标记离司后主播姓名仍保留')
    assert(roster.find((r) => r['主播'] === '测试甲')?.['离司日期'] === today, '离司日期已保存')
    p = await plan.getPlan('测试甲')
    assert(p.days.length >= 61, '标记离司后历史课程仍保留')

    score = await inc.scoreOperators(month)
    op = score.find((r) => r['运营'] === '运营A')
    assert(op?.['主播数'] === '1' && op?.['已离司'] === '1' && op?.['离职率'] === '50', '离职率按在职+离司人数自动计算为 50%')

    await inc.restoreStreamer('测试甲')
    roster = await inc.listRows('主播学籍')
    assert(!roster.find((r) => r['主播'] === '测试甲')?.['离司日期'], '可以恢复在职并清空离司日期')
    assert((await inc.listRows('场次记录')).some((r) => r['主播'] === '测试甲'), '恢复在职不会丢历史场次')

    await inc.flushIncubate()
    console.log('STREAMER LIFECYCLE OK')
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* ignore */ }
    app.exit(0)
  } catch (e) {
    console.error(e && e.stack ? e.stack : e)
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* ignore */ }
    app.exit(1)
  }
})
