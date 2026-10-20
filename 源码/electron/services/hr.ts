/**
 * 人事（极简）：只管三件事 —— 新入职主播建档、把主播分配给运营、自动算离职率等指标。
 *
 * 刻意不另建档案库：全部复用「孵化」的主播学籍表（同一份主播主键，一个主播只有一份档案）。
 * 人事改的字段（带教运营 / 赛道 / 入司日期 / 首播日期 / 离司日期）就是孵化和考核一直在用的那几个，
 * 所以「人事录一次 → 运营那边自动出现 → 全周期跟踪」是天然打通的，不需要第二套数据。
 */
import * as fs from 'fs'
import * as path from 'path'
import * as logger from './logger'
import { readZipEntry } from './doc-text'
import { listRows, addRow, updateRow, TABLES, TRACKS, DEFAULT_TRACK } from './incubate'

const LOG_MODULE = 'hr'
const ROSTER = '主播学籍'
const NEW_JOINER_DAYS = 60

// ------------------------------------------------------------------ 表格解析（零依赖）

/** .xlsx/.xlsm 是 zip；sharedStrings 存字符串，sheet1 存单元格 */
function xmlDecode(s: string): string {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  const siRe = /<si[^>]*>([\s\S]*?)<\/si>/g
  let m: RegExpExecArray | null
  while ((m = siRe.exec(xml))) {
    // 富文本会被拆成多个 <t>，拼起来才是一条完整字符串
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g
    let t: RegExpExecArray | null
    let s = ''
    while ((t = tRe.exec(m[1]))) s += t[1]
    out.push(xmlDecode(s))
  }
  return out
}

/** A→0、B→1、AA→26 */
function colIndex(ref: string): number {
  const letters = (String(ref).match(/^[A-Z]+/i) || [''])[0].toUpperCase()
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = []
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g
  let rm: RegExpExecArray | null
  while ((rm = rowRe.exec(xml))) {
    const cells: string[] = []
    const cRe = /<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g
    let cm: RegExpExecArray | null
    while ((cm = cRe.exec(rm[1]))) {
      const attrs = cm[1] || cm[3] || ''
      const inner = cm[2] || ''
      const ref = (attrs.match(/r="([A-Z]+\d+)"/i) || [])[1] || ''
      const type = (attrs.match(/t="([^"]+)"/) || [])[1] || ''
      const idx = ref ? colIndex(ref) : cells.length
      let val = ''
      if (type === 's') {
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || ''
        val = shared[Number(v)] ?? ''
      } else if (type === 'inlineStr') {
        const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g
        let t: RegExpExecArray | null
        while ((t = tRe.exec(inner))) val += t[1]
        val = xmlDecode(val)
      } else {
        val = xmlDecode((inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '')
      }
      while (cells.length < idx) cells.push('')
      cells[idx] = String(val).trim()
    }
    // 整行空白就不留（Excel 常带几十行空行）
    if (cells.some((c) => c !== '')) rows.push(cells)
  }
  return rows
}

function decodeText(buf: Buffer): string {
  const utf8 = buf.toString('utf8')
  if (!utf8.includes('\uFFFD')) return utf8
  try { return new TextDecoder('gbk').decode(buf) } catch { return utf8 }
}

function splitLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else inQuote = false
      } else cur += ch
    } else if (ch === '"') inQuote = true
    else if (ch === delim) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

function parseDelimited(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (!lines.length) return []
  // 分隔符按前几行里谁切出来的列多来定（中文表格逗号/制表符都常见，飞书导出可能带标题行）
  let delim = ','
  let best = 0
  for (const c of [',', '\t', ';', '|', '，']) {
    const n = Math.max(...lines.slice(0, 5).map((l) => l.split(c).length))
    if (n > best) { best = n; delim = c }
  }
  return lines.map((l) => splitLine(l, delim).map((s) => s.trim()))
}

/**
 * 飞书多维表格/在线表格导出常带「表格标题」「导出说明」等前置行。
 * 在前 5 行里找最像表头的那一行（命中常见字段名优先），上面的行当说明跳过。
 */
const HEADER_WORDS = ['主播', '姓名', '名字', '昵称', '艺名', '人员', '运营', '带教', '赛道', '日期', '电话', '联系', '微信', '手机', '状态', '备注']
function detectHeaderRow(table: string[][]): number {
  let best = 0
  let bestScore = -1
  const limit = Math.min(table.length, 5)
  for (let i = 0; i < limit; i++) {
    const cells = table[i] || []
    const nonEmpty = cells.filter((c) => String(c || '').trim() !== '').length
    if (!nonEmpty) continue
    const hits = cells.filter((c) => HEADER_WORDS.some((w) => String(c).includes(w))).length
    const score = hits * 100 + nonEmpty
    if (score > bestScore) { bestScore = score; best = i }
    if (hits >= 2) break // 已经很像表头了，不再往下找
  }
  return best
}

/** 原始行 → 从真正的表头行开始（兼容飞书导出带标题/说明行） */
function fromHeaderRow(table: string[][]): string[][] {
  if (!table.length) return table
  return table.slice(detectHeaderRow(table))
}

export interface SheetPreview {
  /** 文件里的原始表头 */
  headers: string[]
  /** 预览数据行（不含表头） */
  rows: string[][]
  /** 数据总行数 */
  total: number
  source: string
}

/**
 * 把任意表格读成「表头 + 数据行」。支持 .xlsx / .xlsm / .csv / .tsv / .txt（含 GBK）。
 * 老版 .xls（二进制）不解析，直接给出可照做的提示，不假装成功。
 */
export function readSheetFile(filePath: string): SheetPreview {
  const ext = path.extname(filePath).toLowerCase()
  const source = path.basename(filePath)
  let table: string[][] = []

  if (ext === '.xlsx' || ext === '.xlsm') {
    const buf = fs.readFileSync(filePath)
    const sharedXml = readZipEntry(buf, 'xl/sharedStrings.xml')
    const sheetXml = readZipEntry(buf, 'xl/worksheets/sheet1.xml')
    if (!sheetXml) throw new Error('这个 Excel 解不开：请确认不是加密文件，或在 Excel 里「另存为 .xlsx」再试')
    table = parseSheet(sheetXml.toString('utf8'), sharedXml ? parseSharedStrings(sharedXml.toString('utf8')) : [])
  } else if (ext === '.csv' || ext === '.tsv' || ext === '.txt') {
    table = parseDelimited(decodeText(fs.readFileSync(filePath)))
  } else if (ext === '.xls') {
    throw new Error('不支持老版 .xls（二进制格式）：请在 WPS/Excel 里「另存为 → Excel 工作簿(.xlsx)」再导入')
  } else {
    throw new Error('不支持这个文件类型（' + (ext || '无扩展名') + '）：请用 .xlsx / .csv / .tsv / .txt')
  }

  if (!table.length) throw new Error('这个文件里没有读到内容：确认表格里确实有数据行')
  table = fromHeaderRow(table)
  const rawHead = (table[0] || []).map((h) => String(h || '').trim())
  const width = Math.max(rawHead.length, ...table.slice(1).map((r) => r.length), 1)
  const headers: string[] = []
  for (let i = 0; i < width; i++) headers.push(rawHead[i] || `第${i + 1}列`)
  const data = table.slice(1).map((r) => {
    const copy = r.slice()
    while (copy.length < width) copy.push('')
    return copy
  })
  return { headers, rows: data.slice(0, 30), total: data.length, source }
}

// ------------------------------------------------------------------ 日期归一

function pad2(n: number): string { return String(n).padStart(2, '0') }

/** 把各种写法统一成 YYYY-MM-DD；认不出就返回空串（不瞎猜） */
function normDate(v: string): string {
  const s = String(v || '').trim()
  if (!s) return ''
  // Excel 里的日期其实是序列号（1900 起算），表格解析只能拿到数字
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Math.round((Number(s) - 25569) * 86400 * 1000))
    return Number.isNaN(d.getTime()) ? '' : `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
  }
  const m = s.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/)
  if (m) return `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function str(v: any): string { return String(v ?? '').trim() }

// ------------------------------------------------------------------ 批量导入

/** mapping：目标字段 → 表格列号；-1 表示这列不要 */
export interface HrImportMapping {
  主播: number
  带教运营?: number
  联系方式?: number
  赛道?: number
  入司日期?: number
  首播日期?: number
}

export interface HrImportResult {
  added: number
  updated: number
  skipped: number
  errors: string[]
}

/**
 * 按列映射把人写进主播学籍：同名视为同一个人，只补空着的字段，不覆盖已有值。
 * 这样人事可以拿一份「新人表」反复导，不会把运营已经改过的东西冲掉。
 */
async function upsertRows(
  full: string[][],
  mapping: HrImportMapping,
  defaults: { operator?: string; track?: string },
  source: string
): Promise<HrImportResult> {
  const rows = await listRows(ROSTER)
  const byName = new Map<string, any>()
  for (const r of rows) byName.set(str(r['主播']), r)

  const fallbackTrack = TRACKS[str(defaults.track)] ? str(defaults.track) : DEFAULT_TRACK
  const result: HrImportResult = { added: 0, updated: 0, skipped: 0, errors: [] }

  for (let i = 1; i < full.length; i++) {
    const line = full[i]
    const pick = (idx?: number) => (idx == null || idx < 0 ? '' : str(line[idx]))
    const name = pick(mapping.主播)
    if (!name) { result.skipped++; continue }

    const operator = pick(mapping.带教运营) || str(defaults.operator)
    const contact = pick(mapping.联系方式)
    const rawTrack = pick(mapping.赛道)
    const track = TRACKS[rawTrack] ? rawTrack : ''
    const joinDate = normDate(pick(mapping.入司日期))
    const firstLive = normDate(pick(mapping.首播日期))

    const exist = byName.get(name)
    if (exist) {
      const patch: any = { ...exist }
      let changed = false
      if (operator && str(exist['带教运营']) !== operator) { patch['带教运营'] = operator; changed = true }
      if (contact && str(exist['联系方式']) !== contact) { patch['联系方式'] = contact; changed = true }
      if (track && str(exist['赛道']) !== track) { patch['赛道'] = track; changed = true }
      if (joinDate && str(exist['入司日期']) !== joinDate) { patch['入司日期'] = joinDate; changed = true }
      if (firstLive && str(exist['首播日期']) !== firstLive) { patch['首播日期'] = firstLive; changed = true }
      if (changed) {
        patch['更新时间'] = today()
        await updateRow(ROSTER, Number(exist.id), patch)
        result.updated++
      } else {
        result.skipped++
      }
      continue
    }

    const row: any = { 主播: name, 带教运营: operator, 联系方式: contact, 赛道: track || fallbackTrack, 更新时间: today() }
    if (joinDate) row['入司日期'] = joinDate
    if (firstLive) row['首播日期'] = firstLive
    for (const c of TABLES[ROSTER]) if (!(c in row)) row[c] = ''
    const added = await addRow(ROSTER, row)
    byName.set(name, { ...row, id: added.id })
    result.added++
  }

  logger.info(LOG_MODULE, `人事导入（${source}）：新增 ${result.added} / 更新 ${result.updated} / 跳过 ${result.skipped}`)
  return result
}

/** 批量导入：整份新人表 → 主播学籍 */
export async function applyImport(
  filePath: string,
  mapping: HrImportMapping,
  defaults: { operator?: string; track?: string } = {}
): Promise<HrImportResult> {
  return upsertRows(readSheetAll(filePath), mapping, defaults, path.basename(filePath))
}

/** 手工录入一个新人：和批量导入走同一条写入逻辑，不给人事留第二套规则 */
export async function addOne(input: {
  name: string
  operator?: string
  contact?: string
  track?: string
  joinDate?: string
  firstLive?: string
}): Promise<HrImportResult> {
  const head = ['主播', '带教运营', '联系方式', '赛道', '入司日期', '首播日期']
  const line = [str(input.name), str(input.operator), str(input.contact), str(input.track), normDate(str(input.joinDate)), normDate(str(input.firstLive))]
  return upsertRows([head, line], { 主播: 0, 带教运营: 1, 联系方式: 2, 赛道: 3, 入司日期: 4, 首播日期: 5 }, {}, '手工录入')
}

/** 表头 + 全部数据行（导入要用全量，不是界面预览那 30 行） */
function readSheetAll(filePath: string): string[][] {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.xlsx' || ext === '.xlsm') {
    const buf = fs.readFileSync(filePath)
    const sharedXml = readZipEntry(buf, 'xl/sharedStrings.xml')
    const sheetXml = readZipEntry(buf, 'xl/worksheets/sheet1.xml')
    if (!sheetXml) throw new Error('这个 Excel 解不开：请确认不是加密文件，或在 Excel 里「另存为 .xlsx」再试')
    return fromHeaderRow(parseSheet(sheetXml.toString('utf8'), sharedXml ? parseSharedStrings(sharedXml.toString('utf8')) : []))
  }
  if (ext === '.csv' || ext === '.tsv' || ext === '.txt') {
    return fromHeaderRow(parseDelimited(decodeText(fs.readFileSync(filePath))))
  }
  if (ext === '.xls') {
    throw new Error('不支持老版 .xls（二进制格式）：请在 WPS/Excel 里「另存为 → Excel 工作簿(.xlsx)」再导入')
  }
  throw new Error('不支持这个文件类型：请用 .xlsx / .csv / .tsv / .txt')
}

// ------------------------------------------------------------------ 自动指标

export interface HrMonthStat {
  month: string
  /** 月初在职 */
  onHandStart: number
  joined: number
  left: number
  /** 月末在职 */
  onHandEnd: number
  /** 离职率 = 本月离职 / (月初在职 + 本月入职) */
  leaveRate: number
  /** 本月入职的人里，已经开过首播的比例 */
  firstLiveRate: number
}

export interface HrOperatorStat {
  operator: string
  onHand: number
  joined: number
  left: number
  leaveRate: number
}

/** 每个运营逐月趋势（近三个月，旧 → 新） */
export interface HrOperatorMonthly {
  operator: string
  stats: HrMonthStat[]
}

export interface HrNewJoiner {
  主播: string
  带教运营: string
  赛道: string
  入司日期: string
  首播日期: string
  离司日期: string
  /** 入职第几天 */
  days: number
  状态: '待开播' | '孵化中' | '已离司'
}

export interface HrOverview {
  month: string
  today: string
  onHand: number
  /** 在职但没填入司日期的人数：这些人进不了离职率，要提醒人事补 */
  missingJoinDate: number
  joinedThisMonth: number
  leftThisMonth: number
  leaveRate: number
  /** 新人 60 天留存：入职 60–120 天这批里有完整观察窗的仍在职比例 */
  retain60Rate: number
  retain60Base: number
  /** 近 6 个月（含本月）趋势，旧 → 新 */
  trend: HrMonthStat[]
  byOperator: HrOperatorStat[]
  /** 每个运营近三个月逐月趋势（与 trend 同一口径现算） */
  byOperatorMonthly: HrOperatorMonthly[]
  newJoiners: HrNewJoiner[]
  operators: string[]
}

function monthStart(month: string): string { return `${month}-01` }
function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return `${month}-${pad2(last)}`
}
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}
function daysBetween(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00')
  const b = new Date(to + 'T00:00:00')
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}
function rate(part: number, base: number): number {
  return base > 0 ? Math.round((part / base) * 1000) / 10 : 0
}

function statFor(rows: any[], month: string): HrMonthStat {
  const s = monthStart(month)
  const e = monthEnd(month)
  let onHandStart = 0
  let joined = 0
  let left = 0
  let onHandEnd = 0
  let joinedWithFirstLive = 0
  for (const r of rows) {
    const j = normDate(str(r['入司日期']))
    const d = normDate(str(r['离司日期']))
    if (!j) continue
    if (j <= s && (!d || d >= s)) onHandStart++
    if (j >= s && j <= e) { joined++; if (normDate(str(r['首播日期']))) joinedWithFirstLive++ }
    if (j <= e && (!d || d > e)) onHandEnd++
    if (d && d >= s && d <= e) left++
  }
  return {
    month, onHandStart, joined, left, onHandEnd,
    leaveRate: rate(left, onHandStart + joined),
    firstLiveRate: rate(joinedWithFirstLive, joined)
  }
}

/** 人事看板的全部数字都是从这里现算出来的，没有人工填的指标 */
export async function overview(month?: string): Promise<HrOverview> {
  const rows = (await listRows(ROSTER)).filter((r) => str(r['主播']))
  const day = today()
  const m0 = str(month) && /^\d{4}-\d{2}$/.test(str(month)) ? str(month) : day.slice(0, 7)

  const trend: HrMonthStat[] = []
  for (let i = 5; i >= 0; i--) trend.push(statFor(rows, shiftMonth(m0, -i)))
  const current = trend[trend.length - 1]

  // 在职 = 没填离司日期（老档案可能没入司日期，不能因此就不算在职）
  const onHandRows = rows.filter((r) => !normDate(str(r['离司日期'])))
  // 离职率、留存这些必须靠入司日期，缺的人要明确告诉人事去补，而不是静悄悄漏掉
  const missingJoinDate = onHandRows.filter((r) => !normDate(str(r['入司日期']))).length

  const operatorSet = new Set<string>()
  for (const r of rows) { const op = str(r['带教运营']); if (op) operatorSet.add(op) }
  const byOperator: HrOperatorStat[] = [...operatorSet].sort().map((op) => {
    const mine = rows.filter((r) => str(r['带教运营']) === op)
    let joined = 0
    let left = 0
    let onHand = 0
    for (const r of mine) {
      const j = normDate(str(r['入司日期']))
      const d = normDate(str(r['离司日期']))
      if (j >= monthStart(current.month) && j <= monthEnd(current.month)) joined++
      if (d && d >= monthStart(current.month) && d <= monthEnd(current.month)) left++
      if (j && (!d || d > monthEnd(current.month))) onHand++
    }
    const s = statFor(mine, current.month)
    return { operator: op, onHand, joined, left, leaveRate: s.leaveRate }
  })

  // 每个运营近三个月逐月趋势：和总体同一套 statFor 口径，现算不建表
  const last3Months = [shiftMonth(m0, -2), shiftMonth(m0, -1), m0]
  const byOperatorMonthly: HrOperatorMonthly[] = [...operatorSet].sort().map((op) => {
    const mine = rows.filter((r) => str(r['带教运营']) === op)
    return { operator: op, stats: last3Months.map((mm) => statFor(mine, mm)) }
  })

  // 新人跟踪：入职 60 天内的，按入司日期倒序；先看有没有漏掉的档案
  const newJoiners: HrNewJoiner[] = rows
    .filter((r) => {
      const j = normDate(str(r['入司日期']))
      return j && daysBetween(j, day) <= NEW_JOINER_DAYS && daysBetween(j, day) >= 0
    })
    .map((r) => {
      const j = normDate(str(r['入司日期']))
      const d = normDate(str(r['离司日期']))
      const first = normDate(str(r['首播日期']))
      const days = daysBetween(j, day) + 1
      const status: HrNewJoiner['状态'] = d ? '已离司' : first ? '孵化中' : '待开播'
      return {
        主播: str(r['主播']), 带教运营: str(r['带教运营']), 赛道: str(r['赛道']),
        入司日期: j, 首播日期: first, 离司日期: d, days, 状态: status
      }
    })
    .sort((a, b) => (a.入司日期 < b.入司日期 ? 1 : -1))

  // 60 天留存：只看有完整观察窗的（入职 60–120 天），避免把刚进来的人算成流失
  let retain60Base = 0
  let retain60Keep = 0
  for (const r of rows) {
    const j = normDate(str(r['入司日期']))
    if (!j) continue
    const age = daysBetween(j, day)
    if (age < 60 || age > 120) continue
    retain60Base++
    const d = normDate(str(r['离司日期']))
    if (!d || daysBetween(j, d) >= 60) retain60Keep++
  }

  return {
    month: current.month,
    today: day,
    onHand: onHandRows.length,
    missingJoinDate,
    joinedThisMonth: current.joined,
    leftThisMonth: current.left,
    leaveRate: current.leaveRate,
    retain60Rate: rate(retain60Keep, retain60Base),
    retain60Base,
    trend,
    byOperator,
    byOperatorMonthly,
    newJoiners,
    operators: [...operatorSet].sort()
  }
}
