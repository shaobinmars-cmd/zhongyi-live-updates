// 运营自定义计划修改/删除专项，临时数据，不接触正式孵化库。
const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const temp = path.join(os.tmpdir(), `zy-custom-plan-${Date.now()}`)
app.setPath('userData', temp)
app.on('window-all-closed', () => { /* 自行退出 */ })

function assert(ok, message, detail) {
  if (!ok) throw new Error(message + (detail ? '：' + JSON.stringify(detail) : ''))
  console.log('[OK] ' + message)
}

app.whenReady().then(async () => {
  try {
    const inc = require('../dist-electron/services/incubate.js')
    const plan = require('../dist-electron/services/incubate-plan.js')
    const now = new Date()
    const p2 = (n) => String(n).padStart(2, '0')
    const today = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`
    await inc.importStreamers('修改测试主播,修改测试运营,聊天陪聊', '修改测试运营', '聊天陪聊')
    await plan.generateTrainingPlan({ streamer: '修改测试主播', track: '聊天陪聊', startDate: today, source: '专项测试' })
    const created = await plan.addCustomCourse({
      streamer: '修改测试主播', date: today, title: '原计划', how: '原练法', accept: '原验收', operator: '修改测试运营'
    })
    const changed = await plan.updateCustomCourse(created.id, {
      streamer: '修改测试主播', date: today, title: '修改后的计划', how: '练习 15 遍', accept: '直播中用 8 次', operator: '修改测试运营'
    })
    let p = await plan.getPlan('修改测试主播')
    let rows = p.days.filter((r) => String(r['课程来源'] || '') === '运营自定义')
    assert(rows.length === 1, '修改不会产生重复计划', rows)
    assert(rows[0]?.['今天练什么'] === '修改后的计划' && rows[0]?.['怎么练'] === '练习 15 遍', '计划内容已更新', rows)
    await plan.generateTrainingPlan({ streamer: '修改测试主播', track: '聊天陪聊', startDate: today, source: '重新生成' })
    p = await plan.getPlan('修改测试主播')
    rows = p.days.filter((r) => String(r['课程来源'] || '') === '运营自定义')
    assert(rows.length === 1, '重新生成 AI 计划后自定义计划仍只有一条', rows)
    await inc.deleteRow('课表', Number(changed.id))
    p = await plan.getPlan('修改测试主播')
    assert(!p.days.some((r) => Number(r.id) === Number(changed.id)), '自定义计划可以删除')
    console.log('CUSTOM PLAN EDIT DELETE OK')
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* ignore */ }
    app.exit(0)
  } catch (error) {
    console.error(error?.stack || error)
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* ignore */ }
    app.exit(1)
  }
})
