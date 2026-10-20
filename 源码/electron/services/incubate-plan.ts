/**
 * 60 天孵化培训计划：从 AI 拆解报告 → 建议赛道 → 60 天每日课表 → 每日运营反馈
 *
 * 单独成文件，不改 incubate.ts 里已有的任何逻辑，只复用它的数据表读写。
 */
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import * as logger from './logger'
import {
  TRACKS, DEFAULT_TRACK, Row,
  listRows, addRow, updateRow, deleteRow, importRows,
  importFromTeardown, ImportResult
} from './incubate'

const LOG_MODULE = 'IncubatePlan'

/** 五个阶段 + 60 天后跟踪（界面直接展示；音浪是判断标准不是阶段任务：20万基础/30万成熟/60万进阶/100万+优秀，第 40 天达 20 万即孵化成功）
 *  复盘节奏（运营标准工作）：1-30 天每天下播后当日复盘；31-60 天每三天复盘一次；60 天以后每周复盘 + 学习 */
export const PLAN_PHASES = [
  { key: 'p1', label: '1-3 天 · 互相了解', from: 1, to: 3, goal: '找 3 个对标直播间并拆解；运营摸清主播特点，定赛道与人设' },
  { key: 'p2', label: '4-7 天 · 基础学习', from: 4, to: 7, goal: '搭建直播间、开场收尾、互动四件套成型，能完整播 30 分钟' },
  { key: 'p3', label: '8-15 天 · 上播学习', from: 8, to: 15, goal: '每天上播实操，互动与谢礼形成肌肉记忆，五项指标稳定' },
  { key: 'p4', label: '16-30 天 · 提升', from: 16, to: 30, goal: '节奏与留人稳定，数据不再大起大落' },
  { key: 'p5', label: '31-60 天 · 巩固提升', from: 31, to: 60, goal: '活动、转化、控场跑通；预期线：第 40 天音浪达 20 万即孵化成功' },
  { key: 'p6', label: '60 天以后 · 持续跟踪', from: 61, to: 999, goal: '每周复盘 + 学习；每月运营考核；判断标准：30 万成熟 / 60 万进阶 / 100 万以上优秀' }
]

/** 每日训练用的赛道动作库（报告里没有资产时用它兜底） */
const TRACK_DRILLS: Record<string, string[]> = {
  下单游戏: ['口令节奏', '道具讲解', '下单话术', '整点活动', '连麦互动', '谢礼与逼单'],
  唱歌点歌: ['点歌应答', '报歌名+点给谁', '唱完问一句', '曲间过渡', '谢礼与点歌引导', '气息稳定'],
  聊天陪聊: ['开场三问', '话题轮换', '复述观众的话', '封闭提问', '讲故事段', '收尾钩子'],
  乐器: ['报曲名', '曲间互动', '点曲应答', 'solo 展示', '设备切换', '谢礼'],
  舞蹈: ['定点动作', '镜头走位', '曲目衔接', '补水节奏', '互动喊话', '收尾'],
  才艺: ['边做边讲', '成品展示', '互动提问', '材料介绍', '节奏控制', '收尾'],
  脱口秀: ['包袱铺垫', '互动接梗', '节奏停顿', '话题储备', '临场反应', '收尾'],
  游戏电竞: ['解说节奏', '局势讲解', '互动竞猜', '高光回放', '组队连麦', '收尾'],
  连麦交友: ['开场破冰', '话题引导', '控场节奏', 'PK 规则', '谢榜', '收尾']
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * AI 报告里「60 天逐日执行表」的一天。
 * 列顺序与 v5 指令写死的一致：天数｜资产编号｜话术｜视觉整改｜动作与表情｜BGM 节点｜对标模仿点｜问题编号｜验收数字
 */
export interface DailyRow {
  day: number
  code: string
  script: string
  visual: string
  action: string
  bgm: string
  benchmark: string
  problem: string
  accept: string
}

/**
 * 从 AI 报告全文里解析「60 天逐日执行表」。只认 D1–D60 开头的表格行；
 * 表头、分隔线、「本周复盘」行天然不匹配 D\d，自动跳过。
 * 兼容全角 ｜ 表格（整行都是全角时先归一成半角再切）。
 */
export function parseDailyRows(reportText: string): Map<number, DailyRow> {
  const map = new Map<number, DailyRow>()
  const text = String(reportText || '')
  const start = text.search(/60\s*天[^。\n]{0,8}执行表/)
  const scope = start >= 0 ? text.slice(start) : text
  for (let line of scope.split('\n')) {
    line = line.trim()
    if (!line) continue
    if (line.startsWith('｜')) line = line.replace(/｜/g, '|')
    if (!line.startsWith('|')) continue
    let parts = line.split('|').map((s) => s.trim())
    if (parts[0] === '') parts = parts.slice(1)
    if (parts.length && parts[parts.length - 1] === '') parts = parts.slice(0, -1)
    if (parts.length < 3) continue
    const dm = parts[0].match(/^D(\d{1,2})$/i)
    if (!dm) continue
    const day = Number(dm[1])
    if (day < 1 || day > 60) continue
    const c = (i: number) => String(parts[i] || '').trim()
    map.set(day, { day, code: c(1), script: c(2), visual: c(3), action: c(4), bgm: c(5), benchmark: c(6), problem: c(7), accept: c(8) })
  }
  return map
}

/** 指令里「某天没有对应内容就写 —」的占位，统一视为空 */
function isBlankCell(s: string): boolean {
  const v = String(s || '').trim()
  return !v || v === '—' || v === '-' || v === '–' || v === '无'
}

function localStamp(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 从 AI 报告里猜赛道：先找「建议赛道：X」，再按关键词，最后按赛道名出现次数 */
export function suggestTrackFromText(text: string): string {
  const src = String(text || '')
  const names = Object.keys(TRACKS)
  const m = src.match(/(?:建议)?赛道\s*[：:]\s*([^\n，。；,;|]{2,12})/) || src.match(/定位\s*[：:]\s*([^\n，。；,;|]{2,12})/)
  if (m && m[1]) {
    const cand = m[1].trim()
    const hit = names.find((n) => cand.includes(n) || n.includes(cand))
    if (hit) return hit
  }
  const kw: Array<[RegExp, string]> = [
    [/唱歌|点歌|麦霸|歌曲|演唱/, '唱歌点歌'],
    [/吉他|钢琴|古筝|乐器|弹唱/, '乐器'],
    [/舞蹈|跳舞|爵士|韩舞|手势舞/, '舞蹈'],
    [/脱口秀|段子|相声/, '脱口秀'],
    [/游戏|电竞|开黑|王者|吃鸡|英雄联盟/, '游戏电竞'],
    [/连麦|交友|PK|相亲/, '连麦交友'],
    [/手工|画画|书法|才艺|变装/, '才艺'],
    [/聊天|陪聊|唠嗑|情感/, '聊天陪聊'],
    [/下单|带货|销售|逼单|礼物|打赏|电商/, '下单游戏']
  ]
  for (const [re, t] of kw) if (re.test(src)) return t
  let best = ''
  let bestN = 0
  for (const n of names) {
    const c = (src.match(new RegExp(n, 'g')) || []).length
    if (c > bestN) { best = n; bestN = c }
  }
  return best
}

export function phaseTextOf(dayIndex: number): string {
  if (dayIndex <= 0) return '未开始'
  if (dayIndex <= 3) return PLAN_PHASES[0].label
  if (dayIndex <= 7) return PLAN_PHASES[1].label
  if (dayIndex <= 15) return PLAN_PHASES[2].label
  if (dayIndex <= 30) return PLAN_PHASES[3].label
  if (dayIndex <= 60) return PLAN_PHASES[4].label
  return PLAN_PHASES[5].label
}

/** 第 d 天练什么（d = 1..60） */
function dayPlan(d: number, drills: string[], assets: any[], isRest = false, isLeave = false): { code: string; title: string; how: string; accept: string } {
  if (isLeave) {
    return {
      code: '',
      title: '请假/停播（不排训练）',
      how: '运营仅确认主播状态；不催作业、不补课、不追数据，复工后沿用当天原课表继续。',
      accept: '确认请假状态并记录原因，今天不计完成率。'
    }
  }
  if (isRest) {
    return {
      code: '',
      title: '休息与轻复盘（不排高强度训练）',
      how: '睡够、护嗓、回看本周 1 个片段；今天不学新课，不追数据。',
      accept: '完成休息打卡；写 1 条本周观察，不用补作业。'
    }
  }
  const asset = assets.length ? assets[(d - 1) % assets.length] : null
  const assetCode = asset ? String(asset['编号'] || '') : ''
  const assetText = asset ? String(asset['内容'] || '').slice(0, 50) : ''

  if (d <= 3) {
    // 阶段一·互相了解：找对标直播间、拆解，运营摸清主播
    const fixed: Array<[string, string, string]> = [
      ['互相了解 + 找对标', '运营和主播深聊（经历/特长/可播时间/目标），定赛道与人设方向；主播找 3 个对标直播间，各看 30 分钟', '记 5 句能直接用的原话；3 个对标清单交给运营'],
      ['拆解对标（一）', '用「拆解直播间」拆 1 场对标：开场/互动/留人/收尾四段各记 2 个能照做的动作', '交 1 份拆解记录（拆解素材包或笔记都行）'],
      ['拆解对标（二）+ 定位卡', '再拆 1 场对标，汇总两场能直接用的原话和动作', '交一页定位卡：赛道、人设、3 个对标、5 句话术']
    ]
    const [title, how, accept] = fixed[d - 1]
    return { code: '', title, how, accept }
  }

  if (d <= 7) {
    // 阶段二·基础学习：搭建、开场收尾、互动四件套，第 7 天首播测试
    const fixed: Array<[string, string, string]> = [
      ['直播间搭建', '按清单检查画面/灯光/声音/背景/BGM/网络；录 1 分钟测试回放', '回放里人脸清楚、无回声、BGM 不盖人声'],
      ['开场三句 + 留人四步', '背熟开场三句（欢迎/价值/指令）与留人四步（点名/提问/福利/预告），开播前练 10 遍', '开播前 3 分钟连着用下来不卡'],
      ['自我介绍与互动四件套', '准备 30 秒版和 2 分钟版自我介绍；练点名、封闭提问、复述观众、口令四件套', '两版自我介绍脱稿；四件套各连说 5 次不卡'],
      ['谢礼三连 + 首播测试 + 复盘', '练「称呼 + 感谢 + 引导」三连；完整播 30 分钟：开场→栏目→互动→收尾；下播立刻复盘', '找出 3 个问题，写进明天计划']
    ]
    const [title, how, accept] = fixed[d - 4]
    return { code: '', title, how, accept }
  }

  if (d <= 15) {
    // 阶段三·上播学习：每天上播实操，下播当天复盘
    const drill = drills[(d - 8) % drills.length]
    return {
      code: assetCode,
      title: `上播学习：${drill}${assetText ? ' + 资产：' + assetText : ''}`,
      how: '每天上播实操；开播前练 10 分钟；直播中至少用 6 次；下播当天复盘：回看 3 处并写 3 条改进',
      accept: `${drill}做到位；当日复盘 3 条改进交运营，明天验证 1 条`
    }
  }

  if (d <= 30) {
    // 阶段四·提升：核心动作打磨 + 每天复盘
    const drill = drills[(d - 8) % drills.length]
    return {
      code: assetCode,
      title: `提升训练：${drill}${assetText ? ' + 资产：' + assetText : ''}`,
      how: '开播前练 10 分钟；直播中至少用 8 次；下播当天复盘：回看 3 处并写 3 条改进',
      accept: `${drill}做到位；最长空档 ≤3 秒；当日复盘 3 条改进，至少 1 条新话术交进资产库`
    }
  }

  // 阶段五·巩固提升：实战循环；复盘每三天一次（D33/36/…/60），不再每天复盘
  const week = Math.floor((d - 31) / 7) % 5
  const modes: Array<[string, string, string]> = [
    ['拉时长与节奏', '连续播 3 小时，按 20 分钟一个环节排节目单', '空档 ≤2 秒；没有 10 分钟以上的冷场'],
    ['连麦 / PK', '每天至少 2 次连麦或 PK，练开场破冰和谢榜', '连麦不尬聊；PK 前后都有引导'],
    ['活动与转化', '设计 1 个整点活动（口令/抽奖/点歌），完整跑 2 轮', '活动参与 ≥10 人；口令执行不乱'],
    ['数据复盘', '回看昨天数据：停留/互动/礼物，各找 1 个爆点和 1 个掉点', '写 3 条改进，今天验证 1 条'],
    ['对标冲刺', '拆 1 场优秀主播，找 3 个可复用动作，融入今天直播', '新增 3 条资产；本周至少 1 个指标提升']
  ]
  const [title, how, accept] = modes[week]
  const reviewDay = (d - 30) % 3 === 0
  return {
    code: assetCode,
    title: `巩固：${title}${reviewDay ? ' + 三日复盘' : ''}${assetText ? '（用资产：' + assetText + '）' : ''}`,
    how: reviewDay ? how + '；今天做三日复盘：回看近 3 天数据，写 3 条改进' : how,
    accept: reviewDay ? accept + '；三日复盘 3 条改进交运营' : accept
  }
}

/** 生成 60 天计划：会先清掉该主播旧的 D1..D60 行，再按报告重排 */
export async function generateTrainingPlan(opts: {
  streamer: string
  track?: string
  startDate?: string
  source?: string
  reportText?: string
  restDay?: string
  leaveStart?: string
  leaveEnd?: string
  leaveReason?: string
}): Promise<{ days: number; track: string; assets: number; message: string }> {
  const streamer = String(opts.streamer || '').trim()
  if (!streamer) throw new Error('先在左上角选一个主播')

  const finalTrack = opts.track && TRACKS[opts.track]
    ? opts.track
    : (suggestTrackFromText(opts.reportText || '') || DEFAULT_TRACK || '下单游戏')
  const start = String(opts.startDate || '').trim() || new Date().toISOString().slice(0, 10)
  const assets = (await listRows('资产库')).slice(-60)
  const drills = TRACK_DRILLS[finalTrack] || TRACK_DRILLS[DEFAULT_TRACK] || TRACK_DRILLS['下单游戏']
  const restMap: Record<string, number> = { '周日': 0, '周一': 1, '周二': 2, '周三': 3, '周四': 4, '周五': 5, '周六': 6 }
  const restDayNum = restMap[String(opts.restDay || '').trim()] ?? -1
  const leaveStart = String(opts.leaveStart || '')
  const leaveEnd = String(opts.leaveEnd || opts.leaveStart || '')
  // 报告里的「60 天逐日执行表」：有就优先用 AI 排的每天内容，没有再退回内置排课
  const dailyRows = parseDailyRows(opts.reportText || '')
  let aiDays = 0

  // 清掉该主播旧的 D 计划（保留其它非 D 开头的课表行）
  const old = (await listRows('课表')).filter(
    (r) => String(r['主播'] || '').trim() === streamer && /^D\d+$/.test(String(r['日期'] || '')) && String(r['课程来源'] || '') !== '运营自定义'
  )
  for (const r of old) await deleteRow('课表', Number(r.id))

  const rows: Row[] = []
  for (let d = 1; d <= 60; d++) {
    const date = new Date(start + 'T00:00:00')
    date.setDate(date.getDate() + d - 1)
    const isRest = restDayNum >= 0 && date.getDay() === restDayNum
    const dateText = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const isLeave = !!leaveStart && !!leaveEnd && dateText >= leaveStart && dateText <= leaveEnd
    const t = dayPlan(d, drills, assets, isRest, isLeave)
    const ai = !isRest && !isLeave ? dailyRows.get(d) : undefined
    if (ai) {
      // AI 逐日表：话术是当天主菜，视觉/动作/BGM/对标全进「怎么练」，验收带问题整改号
      aiDays++
      const segs: string[] = []
      if (!isBlankCell(ai.script)) segs.push('话术：' + ai.script)
      if (!isBlankCell(ai.visual)) segs.push('视觉：' + ai.visual)
      if (!isBlankCell(ai.action)) segs.push('动作：' + ai.action)
      if (!isBlankCell(ai.bgm)) segs.push('BGM：' + ai.bgm)
      if (!isBlankCell(ai.benchmark)) segs.push('对标：' + ai.benchmark)
      const titleCore = !isBlankCell(ai.script) ? ai.script
        : !isBlankCell(ai.visual) ? ai.visual
        : !isBlankCell(ai.action) ? ai.action
        : t.title
      const accept = (isBlankCell(ai.accept) ? t.accept : ai.accept) + (isBlankCell(ai.problem) ? '' : `（整改${ai.problem}）`)
      rows.push({
        日期: `D${d}`, 主播: streamer, 资产编号: isBlankCell(ai.code) ? t.code : ai.code,
        今天练什么: titleCore.slice(0, 80), 怎么练: (segs.join('；') || t.how).slice(0, 240),
        验收: accept.slice(0, 120), 打卡: '', 录入人: 'AI计划', 执行日期: dateText, 课程来源: 'AI计划'
      })
    } else {
      rows.push({
        日期: `D${d}`, 主播: streamer, 资产编号: t.code,
        今天练什么: t.title, 怎么练: t.how, 验收: t.accept, 打卡: '', 录入人: 'AI计划', 执行日期: dateText, 课程来源: 'AI计划'
      })
    }
  }
  await importRows('课表', rows)

  const plans = await listRows('培训计划')
  const exist = plans.find((r) => String(r['主播'] || '').trim() === streamer)
  const payload: Row = {
    主播: streamer, 赛道: finalTrack, 开始日期: start, 进度: 'D1/60',
    固定休息日: String(opts.restDay || ''),
    阶段: PLAN_PHASES[0].label, 报告来源: String(opts.source || 'AI 拆解报告').slice(0, 60),
    更新时间: localStamp()
  }
  if (exist) await updateRow('培训计划', Number(exist.id), { ...exist, ...payload })
  else await addRow('培训计划', payload)

  // 主播档案里也把赛道写上（没有这个人就顺手建档）
  const roster = (await listRows('主播学籍')).find((r) => String(r['主播'] || '').trim() === streamer)
  if (roster) await updateRow('主播学籍', Number(roster.id), { ...roster, 赛道: finalTrack, 更新时间: start })
  else await addRow('主播学籍', { 主播: streamer, 带教运营: '', 赛道: finalTrack, 更新时间: start })

  logger.info(LOG_MODULE, `已生成 60 天计划：${streamer} / ${finalTrack} / 资产 ${assets.length} 条 / 报告逐日表命中 ${aiDays} 天`)
  const tail = aiDays > 0 ? `（其中 ${aiDays} 天按报告逐日表排）` : ''
  return { days: 60, track: finalTrack, assets: assets.length, message: `已生成 60 天计划：${streamer} · ${finalTrack}${tail}` }
}

/** 运营给主播追加一节自定义课程；不覆盖 AI 的 60 天计划。 */
export async function addCustomCourse(opts: {
  streamer: string
  date: string
  title: string
  how?: string
  accept?: string
  operator?: string
}): Promise<{ ok: boolean; id: number; day: string; date: string }> {
  const streamer = String(opts.streamer || '').trim()
  const date = String(opts.date || '').trim() || new Date().toISOString().slice(0, 10)
  const title = String(opts.title || '').trim()
  if (!streamer) throw new Error('先选择主播')
  if (!title) throw new Error('请填写今天要练什么')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('课程日期格式不对')
  const plan = (await listRows('培训计划')).find((r) => String(r['主播'] || '').trim() === streamer)
  let day = '自定义'
  const start = String(plan?.['开始日期'] || '').trim()
  if (start) {
    const s = new Date(start + 'T00:00:00')
    const d = new Date(date + 'T00:00:00')
    const idx = Math.floor((d.getTime() - s.getTime()) / 86400000) + 1
    if (idx >= 1 && idx <= 60) day = `D${idx}`
  }
  const row: Row = {
    日期: day,
    主播: streamer,
    资产编号: ''
    ,今天练什么: title
    ,怎么练: String(opts.how || '').trim()
    ,验收: String(opts.accept || '').trim()
    ,打卡: ''
    ,录入人: String(opts.operator || '').trim() || '运营'
    ,执行日期: date
    ,课程来源: '运营自定义'
  }
  const res = await addRow('课表', row)
  logger.info(LOG_MODULE, `新增运营课程：${streamer} / ${date} / ${title}`)
  return { ok: true, id: res.id, day, date }
}

export async function updateCustomCourse(id: number, opts: {
  streamer: string
  date: string
  title: string
  how?: string
  accept?: string
  operator?: string
}): Promise<{ ok: boolean; id: number; day: string; date: string }> {
  const rows = await listRows('课表')
  const old = rows.find((r) => Number(r.id) === Number(id))
  if (!old || String(old['课程来源'] || '') !== '运营自定义') throw new Error('找不到这条运营自定义计划')
  const streamer = String(opts.streamer || '').trim()
  const date = String(opts.date || '').trim() || new Date().toISOString().slice(0, 10)
  const title = String(opts.title || '').trim()
  if (!streamer) throw new Error('先选择主播')
  if (!title) throw new Error('请填写今天要练什么')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('课程日期格式不对')
  const plan = (await listRows('培训计划')).find((r) => String(r['主播'] || '').trim() === streamer)
  let day = '自定义'
  const start = String(plan?.['开始日期'] || '').trim()
  if (start) {
    const s = new Date(start + 'T00:00:00')
    const d = new Date(date + 'T00:00:00')
    const idx = Math.floor((d.getTime() - s.getTime()) / 86400000) + 1
    if (idx >= 1 && idx <= 60) day = `D${idx}`
  }
  await updateRow('课表', Number(id), {
    ...old,
    日期: day,
    主播: streamer,
    今天练什么: title,
    怎么练: String(opts.how || '').trim(),
    验收: String(opts.accept || '').trim(),
    录入人: String(opts.operator || '').trim() || String(old['录入人'] || '运营'),
    执行日期: date,
    课程来源: '运营自定义'
  })
  logger.info(LOG_MODULE, `修改运营课程：${streamer} / ${date} / ${title}`)
  return { ok: true, id: Number(id), day, date }
}

export async function listFeedback(streamer: string, limit = 60): Promise<Row[]> {
  const name = String(streamer || '').trim()
  const rows = (await listRows('孵化反馈')).filter((r) => String(r['主播'] || '').trim() === name)
  return rows
    .sort((a, b) => String(b['日期'] || '').localeCompare(String(a['日期'] || '')))
    .slice(0, limit)
}

/** 保存今天的反馈：同一天同一主播覆盖 */
export async function saveFeedback(row: Row): Promise<{ id: number; updated: boolean }> {
  const date = String(row['日期'] || '').trim() || new Date().toISOString().slice(0, 10)
  const streamer = String(row['主播'] || '').trim()
  if (!streamer) throw new Error('先选主播')
  const all = await listRows('孵化反馈')
  const exist = all.find((r) => String(r['日期'] || '') === date && String(r['主播'] || '').trim() === streamer)
  const payload: Row = {
    日期: date, 主播: streamer, 运营: String(row['运营'] || ''),
    今日任务: String(row['今日任务'] || ''), 完成情况: String(row['完成情况'] || ''),
    数据结果: String(row['数据结果'] || ''), 问题: String(row['问题'] || ''),
    明日计划: String(row['明日计划'] || ''), 提交时间: localStamp()
  }
  if (exist) {
    await updateRow('孵化反馈', Number(exist.id), { ...exist, ...payload })
    logger.info(LOG_MODULE, `更新孵化反馈：${streamer} ${date}`)
    return { id: Number(exist.id), updated: true }
  }
  const res = await addRow('孵化反馈', payload)
  logger.info(LOG_MODULE, `新增孵化反馈：${streamer} ${date}`)
  return { id: res.id, updated: false }
}

/** 一个主播的完整计划视图：计划 + 60 天课表 + 反馈 + 今天第几天 */
export async function getPlan(streamer: string): Promise<any> {
  const name = String(streamer || '').trim()
  const plan = (await listRows('培训计划')).find((r) => String(r['主播'] || '').trim() === name) || null
  const roster = (await listRows('主播学籍')).find((r) => String(r['主播'] || '').trim() === name) || null
  const days = (await listRows('课表'))
    .filter((r) => String(r['主播'] || '').trim() === name && (/^D\d+$/.test(String(r['日期'] || '')) || String(r['课程来源'] || '') === '运营自定义'))
    .sort((a, b) => {
      const na = /^D\d+$/.test(String(a['日期'])) ? Number(String(a['日期']).slice(1)) : 9999
      const nb = /^D\d+$/.test(String(b['日期'])) ? Number(String(b['日期']).slice(1)) : 9999
      return na - nb || String(a['执行日期'] || '').localeCompare(String(b['执行日期'] || ''))
    })
  const feedback = await listFeedback(name, 60)

  let dayIndex = 0
  if (plan && plan['开始日期']) {
    const start = new Date(String(plan['开始日期']) + 'T00:00:00')
    if (!isNaN(start.getTime())) {
      const t = new Date()
      t.setHours(0, 0, 0, 0)
      dayIndex = Math.floor((t.getTime() - start.getTime()) / 86400000) + 1
    }
  }
  return {
    plan, days, feedback, dayIndex, phase: phaseTextOf(dayIndex), phases: PLAN_PHASES,
    leaveStart: String(roster?.['请假开始日期'] || ''),
    leaveEnd: String(roster?.['请假结束日期'] || ''),
    leaveReason: String(roster?.['请假原因'] || '')
  }
}

/** 粘贴的报告文本也走同一套导入（写临时文件，导完删掉） */
export async function importReportText(text: string, name = '粘贴的报告'): Promise<ImportResult> {
  const p = path.join(app.getPath('userData'), '_pasted_report.md')
  fs.writeFileSync(p, String(text || ''), 'utf-8')
  try {
    return await importFromTeardown(p, name)
  } finally {
    try { fs.unlinkSync(p) } catch { /* ignore */ }
  }
}
