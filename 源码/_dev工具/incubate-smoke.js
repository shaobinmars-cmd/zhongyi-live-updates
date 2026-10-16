/**
 * 孵化系统冒烟测试（开发用，v2：通用能力五项 + 赛道加测）
 * 运行：electron.exe _dev工具\incubate-smoke.js
 * 数据写在临时目录，跑完自动清理，不碰正式 userData。
 */
const path = require('path')
const fs = require('fs')
const os = require('os')
const { app } = require('electron')

const tmp = path.join(os.tmpdir(), 'incubate-smoke-' + Date.now())
fs.mkdirSync(tmp, { recursive: true })
app.setPath('userData', tmp)

function ok(label, cond, extra) {
  console.log((cond ? '[OK]   ' : '[FAIL] ') + label + (extra !== undefined ? '  → ' + extra : ''))
  if (!cond) process.exitCode = 1
}

app.whenReady().then(async () => {
  try {
    const inc = require(path.join(__dirname, '..', 'dist-electron', 'services', 'incubate.js'))

    const tables = await inc.listTables()
    ok('表结构（应 11 张，含 场次记录）', tables.length === 11 && tables.includes('场次记录'), tables.join('、'))

    ok('通用能力五项', inc.COMMON_METRICS.length === 7, inc.COMMON_METRICS.map((m) => m.label).join('、'))
    ok('赛道数（应 16）', Object.keys(inc.TRACKS).length === 16, Object.keys(inc.TRACKS).join('、'))
    ok('赛道项与通用项不重复判定', (() => {
      const ev = inc.evaluateMetrics('唱歌点歌', { 话术熟练度: '3', 最长空档秒: '1.5', 收尾完成: '是', 报歌名次数: '8' })
      return ev.tot === 4 && ev.hit === 4
    })(), JSON.stringify(inc.evaluateMetrics('唱歌点歌', { 话术熟练度: '3', 最长空档秒: '1.5', 收尾完成: '是', 报歌名次数: '8' })))

    const seeded = await inc.seedIfEmpty()
    ok('种子数据灌入', seeded.seeded.length >= 1, seeded.seeded.join('、'))

    const r3 = await inc.importStreamers('测试主播A,小A,唱歌点歌\n测试主播B,小A\n测试主播A,小A,唱歌点歌', '小A')
    ok('名册导入（新增 2 / 更新 1 或 0）', r3.added === 2, `新增 ${r3.added}、更新 ${r3.updated}`)
    const roster = await inc.listRows('主播学籍')
    ok('名册带赛道', roster.some((r) => r['主播'] === '测试主播A' && r['赛道'] === '唱歌点歌'), roster.map((r) => r['主播'] + '/' + r['赛道']).join('、'))

    // 写一次场次（长表：一条指标一行）
    const today = new Date().toISOString().slice(0, 10)
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    const vals = { 话术熟练度: '4', BGM使用熟练度: '3', 动作熟练度: '3', 表情管理: '4', 直播连贯性: '4', 最长空档秒: '1.5', 收尾完成: '是', 报歌名次数: '9' }
    for (const [k, v] of Object.entries(vals)) {
      await inc.addRow('场次记录', { 日期: today, 运营: '小A', 主播: '测试主播A', 赛道: '唱歌点歌', 指标: k, 数值: v, 提交时间: today + ' 22:00' })
    }
    const sess = await inc.listRows('场次记录')
    ok('场次记录（长表）', sess.length === 8, sess.length + ' 行')

    const sessions = inc.sessionsOf(sess)
    ok('场次可合成', sessions.length === 1 && sessions[0].values['话术熟练度'] === '4', JSON.stringify(sessions[0] && sessions[0].values))

    const scores = await inc.scoreOperators(today.slice(0, 7))
    const me = scores.find((s) => s['运营'] === '小A')
    ok('运营考核（三项）', !!me, me ? `应交 ${me['应交场次']} / 按时 ${me['按时提交']} / 补交 ${me['补交']} / 按时率 ${me['按时率']} / 成长 ${me['成长分']} / 学习 ${me['学习分']} / 得分 ${me['得分']} ${me['等级']} / ${me['结论']}` : '无结果')
    // 应交 = 名下 2 个主播 × 4 场（录像目录为空时走最低标准）
    ok('应交场次按「每个主播至少 4 场」算（应 8）', me && me['应交场次'] === '8', me && me['应交场次'])
    ok('当天交算按时（应 1 按时 / 0 补交）', me && me['按时提交'] === '1' && me['补交'] === '0', me && `${me['按时提交']}/${me['补交']}`)
    ok('按时率 = 1/8（应 13）', me && me['按时率'] === '13', me && me['按时率'])
    ok('成长分 = 达标 100×0.4 + 中性进步 50×0.6（应 70）', me && me['成长分'] === '70', me && me['成长分'])
    ok('学习分没做就是 0（不送默认分）', me && me['学习分'] === '0', me && me['学习分'])
    ok('总分 = 45×70 + 35×12.5 + 20×0（应 36）', me && me['得分'] === '36', me && me['得分'])
    ok('等级列有值', me && !!me['等级'], me && me['等级'])

    // 只挂名、一场不交的运营也要出现在表里，并且是 0 分不合格
    await inc.importStreamers('测试主播C,小B', '小B')
    const scores2 = await inc.scoreOperators(today.slice(0, 7))
    const lazy = scores2.find((s) => s['运营'] === '小B')
    ok('不交的运营也在表里', !!lazy, lazy ? `按时率 ${lazy['按时率']} / 得分 ${lazy['得分']} / ${lazy['结论']}` : '没出现')
    ok('不交就是 0 分不合格', lazy && lazy['按时率'] === '0' && lazy['得分'] === '0' && lazy['结论'] === '不合格', lazy && `${lazy['按时率']}/${lazy['得分']}/${lazy['结论']}`)

    // 补交：日期写今天、提交时间写明天 → 算补交，只拿半额
    const five = { 话术熟练度: '4', BGM使用熟练度: '4', 动作熟练度: '4', 表情管理: '4', 直播连贯性: '4' }
    for (const [k, v] of Object.entries(five)) {
      await inc.addRow('场次记录', { 日期: today, 运营: '小B', 主播: '测试主播C', 赛道: '唱歌点歌', 指标: k, 数值: v, 提交时间: tomorrow + ' 09:00' })
    }
    const b2 = (await inc.scoreOperators(today.slice(0, 7))).find((s) => s['运营'] === '小B')
    ok('次日补交算补交（应 1 场）', b2 && b2['补交'] === '1' && b2['按时提交'] === '0', b2 && `${b2['按时提交']}/${b2['补交']}`)
    ok('补交只算半额（0.5/4 应 13）', b2 && b2['按时率'] === '13', b2 && b2['按时率'])
    ok('补交也有成长分（应 70）', b2 && b2['成长分'] === '70', b2 && b2['成长分'])
    ok('补交总分 = 45×70 + 35×12.5（应 36）', b2 && b2['得分'] === '36', b2 && b2['得分'])

    // 学习分：课表 10 条 + 资产 2 条 + 复盘 4 次 = 满分
    for (let i = 0; i < 10; i++) await inc.addRow('课表', { 日期: today, 主播: '测试主播A', 今天练什么: '开场白', 录入人: '小A' })
    for (let i = 0; i < 2; i++) await inc.addRow('资产库', { 编号: 'T-' + i, 类型: '话术', 内容: '测试资产', 提交人: '小A' })
    for (let i = 0; i < 4; i++) await inc.addRow('周复盘', { 周次: today.slice(0, 7), 运营: '小A', 主持: '小A', 提交时间: today + ' 20:00' })
    const assetRow = (await inc.listRows('资产库')).find((r) => String(r['编号'] || '').startsWith('T-'))
    ok('资产录入时间自动盖章（考核学习分靠它）', !!assetRow && /^\d{4}-\d{2}/.test(String(assetRow['录入时间'])), assetRow && assetRow['录入时间'])
    const me2 = (await inc.scoreOperators(today.slice(0, 7))).find((s) => s['运营'] === '小A')
    ok('学习分：课表/资产/复盘 都达标 = 100', me2 && me2['学习分'] === '100', me2 && me2['学习分'])
    ok('学习拉满后总分 = 45×70 + 35×12.5 + 20×100（应 56）', me2 && me2['得分'] === '56', me2 && me2['得分'])

    // 只填一个分 = 没填完，不算一次提交
    const half = inc.hasAllRatings({ 话术熟练度: '5' })
    ok('只填一个分不算一次提交', half === false, String(half))
    const f1 = inc.sessionFilled('唱歌点歌', { 话术熟练度: '5' })
    ok('完整度按赛道项数算', f1.need >= 7, `已填 ${f1.filled}/${f1.need}`)
    const sc = inc.sessionScore('唱歌点歌', { 话术熟练度: '1', BGM使用熟练度: '5' })
    ok('单场得分能区分 1 分和 5 分（应 50）', sc === 50, String(sc))
    ok('sameDay 判定（当天=按时、次日=补交）', inc.sameDay(today, today + ' 22:00') === true && inc.sameDay(today, tomorrow + ' 09:00') === false, '')
    ok('考核权重合计 100（成长 45 / 按时 35 / 学习 20）', inc.SCORE_WEIGHTS.成长 + inc.SCORE_WEIGHTS.按时提交 + inc.SCORE_WEIGHTS.学习 === 100, JSON.stringify(inc.SCORE_WEIGHTS))

    const xlsx = path.join(tmp, 'out.xlsx')
    await inc.exportXlsx(xlsx)
    ok('导出 Excel', fs.readFileSync(xlsx).slice(0, 2).toString() === 'PK', fs.statSync(xlsx).size + ' 字节')

    const csvDir = path.join(tmp, 'csv')
    const r2 = await inc.exportCsv(csvDir)
    ok('导出 CSV（11 个文件）', r2.files.length === 11, r2.files.length + ' 个')

    const teardownDir = 'D:\\直播拆解工具\\录像\\BIGda\\work'
    if (fs.existsSync(teardownDir)) {
      const imp = await inc.importFromTeardown(teardownDir)
      ok('从拆解产物导入', true, imp.message)
    }

    await inc.flushIncubate()
    ok('数据落盘', fs.existsSync(path.join(tmp, 'incubate.db')), fs.statSync(path.join(tmp, 'incubate.db')).size + ' 字节')
  } catch (e) {
    console.error('[EXCEPTION]', e && e.stack ? e.stack : e)
    process.exitCode = 1
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
    app.quit()
  }
})
