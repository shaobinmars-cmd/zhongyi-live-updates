// 主播改名/换运营/换赛道与误建删除专项，使用临时数据库，不接触正式孵化库。
const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const temp = path.join(os.tmpdir(), `zy-streamer-identity-${Date.now()}`)
app.setPath('userData', temp)
app.on('window-all-closed', () => { /* 测试脚本自行退出 */ })

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

    const oldName = '填错主播'
    const fixedName = '正确主播'
    await inc.importStreamers(`${oldName},运营A,唱歌点歌`, '运营A', '唱歌点歌')
    await plan.generateTrainingPlan({ streamer: oldName, track: '唱歌点歌', startDate: today, source: '专项测试' })
    await inc.addRow('场次记录', {
      日期: today, 运营: '运营A', 主播: oldName, 赛道: '唱歌点歌',
      指标: '话术熟练度', 数值: '3', 提交时间: today
    })
    await inc.addRow('孵化反馈', {
      日期: today, 主播: oldName, 运营: '运营A', 今日任务: '原任务',
      完成情况: '完成', 数据结果: '', 问题: '', 明日计划: '', 提交时间: today
    })

    const changed = await inc.updateStreamerIdentity(oldName, {
      name: fixedName,
      operator: '运营B',
      track: '聊天陪聊'
    })
    assert(changed.ok && changed.name === fixedName, '主播资料修改接口返回正确', changed)

    const roster = await inc.listRows('主播学籍')
    const fixed = roster.find((row) => row['主播'] === fixedName)
    assert(!!fixed && !roster.some((row) => row['主播'] === oldName), '旧名字已改成新名字，没有重复档案', roster)
    assert(fixed?.['带教运营'] === '运营B' && fixed?.['赛道'] === '聊天陪聊', '带教运营和赛道同步更新', fixed)

    for (const table of ['场次记录', '课表', '培训计划', '孵化反馈']) {
      const rows = await inc.listRows(table)
      assert(!rows.some((row) => row['主播'] === oldName) && rows.some((row) => row['主播'] === fixedName), `${table}已同步到新主播名`, rows.filter((row) => row['主播'] === fixedName || row['主播'] === oldName))
    }

    const planRows = await inc.listRows('培训计划')
    assert(planRows.find((row) => row['主播'] === fixedName)?.['赛道'] === '聊天陪聊', '培训计划赛道已同步')

    const removed = await inc.deleteStreamer(fixedName)
    assert(removed.ok && removed.deleted['主播学籍'] === 1, '误建主播可以删除', removed)
    for (const table of ['主播学籍', '场次记录', '课表', '培训计划', '孵化反馈']) {
      const rows = await inc.listRows(table)
      assert(!rows.some((row) => row['主播'] === fixedName), `${table}中的关联数据已清理`)
    }

    console.log('STREAMER IDENTITY OK')
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* ignore */ }
    app.exit(0)
  } catch (error) {
    console.error(error && error.stack ? error.stack : error)
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* ignore */ }
    app.exit(1)
  }
})
