import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 孵化系统 store（独立模块）
 * - 数据走主进程新增的 incubate:* 通道，不触碰任何现有功能
 * - 场次是「长表」：一次场次 = (日期, 主播) 下多条「指标/数值」
 * - 指标 = 通用能力五项（1–5 分）＋ 客观项（最长空档、收尾）＋ 赛道可选加测项
 */
const api = () => (window as any).electronAPI

export interface MetricDef {
  key: string
  label: string
  kind: 'num' | 'bool' | 'rate'
  op: '<=' | '>=' | '=='
  target: number
  hint: string
}

export const useIncubateStore = defineStore('incubate', () => {
  const schema = ref<Record<string, string[]>>({})
  const table = ref('资产库')
  const rows = ref<any[]>([])
  const loading = ref(false)
  const logs = ref<string[]>([])
  const scoreRows = ref<any[]>([])

  const tracks = ref<Record<string, MetricDef[]>>({})
  const common = ref<MetricDef[]>([])
  const defaultTrack = ref('下单游戏')
  const sessions = ref<any[]>([])
  const streamers = ref<any[]>([])
  const schedule = ref<any[]>([])
  // 60 天培训计划 + 每日反馈
  const plan = ref<any>(null)
  const planDays = ref<any[]>([])
  const planFeedback = ref<any[]>([])

  function log(msg: string) {
    const t = new Date().toTimeString().slice(0, 8)
    logs.value.unshift(`[${t}] ${msg}`)
    if (logs.value.length > 200) logs.value.pop()
  }

  // ---------------- 基础表 ----------------
  async function loadSchema() {
    schema.value = await api().incubateSchema()
    if (!schema.value[table.value]) table.value = Object.keys(schema.value)[0] || '资产库'
  }

  async function loadRows(t?: string) {
    loading.value = true
    try {
      rows.value = await api().incubateList(t || table.value)
    } finally {
      loading.value = false
    }
  }

  async function switchTable(t: string) {
    table.value = t
    await loadRows(t)
  }

  async function seed() {
    const r = await api().incubateSeed()
    await loadSchema()
    await loadRows()
    log(r?.seeded?.length ? '灌入种子数据：' + r.seeded.join('、') : '种子数据已存在')
  }

  async function score(month: string) {
    scoreRows.value = await api().incubateScore(month)
    log(month ? `${month} 运营考核已计算（${scoreRows.value.length} 人）` : '运营考核已计算')
    return scoreRows.value
  }

  async function importDir(dir: string) {
    const r = await api().incubateImport(dir)
    await loadRows()
    log(r?.message || '导入完成')
    return r
  }

  async function browseDir(): Promise<string | null> {
    return await api().incubateBrowseDir()
  }

  /** 只选一个报告文件（Windows 上跟“选文件夹”必须是两个对话框） */
  async function pickReport(): Promise<string | null> {
    return await api().incubatePickReport()
  }

  async function importReportText(text: string, name: string) {
    const r = await api().incubateImportText(text, name)
    await loadRows()
    log(r?.message || '导入完成')
    return r
  }

  async function generatePlan(opts: any) {
    const r = await api().incubateGeneratePlan(opts)
    await loadSchedule()
    await loadStreamers()
    log(r?.message || '已生成 60 天计划')
    return r
  }

  async function loadPlan(streamer: string) {
    const r = await api().incubatePlan(streamer)
    plan.value = r?.plan || null
    planDays.value = r?.days || []
    planFeedback.value = r?.feedback || []
    return r
  }

  async function saveFeedback(row: any) {
    const r = await api().incubateFeedbackSave(row)
    if (row?.主播) await loadPlan(row.主播)
    log(r?.updated ? '反馈已更新' : '反馈已保存')
    return r
  }

  async function exportCsv() {
    const r = await api().incubateExportCsv()
    log(r?.files?.length ? `已导出 ${r.files.length} 个 CSV` : '导出 CSV 已取消')
    return r
  }

  async function exportXlsx() {
    const r = await api().incubateExportXlsx()
    log(r?.path ? '已导出 Excel：' + r.path : '导出 Excel 已取消')
    return r
  }

  async function openDataDir() {
    await api().incubateOpenDataDir()
  }

  // ---------------- 赛道 / 指标 ----------------
  async function loadTracks() {
    const r = await api().incubateTracks()
    tracks.value = r?.tracks || {}
    common.value = r?.common || []
    defaultTrack.value = r?.defaultTrack || '下单游戏'
    return r
  }

  function trackNames(): string[] {
    return Object.keys(tracks.value)
  }

  /** 赛道专属「可选加测项」（去掉与通用项重名的） */
  function extraDefsOf(track: string): MetricDef[] {
    const list = tracks.value[track] || []
    return list.filter((d) => !common.value.some((c) => c.key === d.key))
  }

  /** 判定用的完整定义：通用 + 赛道加测 */
  function allDefsOf(track: string): MetricDef[] {
    return [...common.value, ...extraDefsOf(track)]
  }

  // ---------------- 主播 / 场次 ----------------
  async function loadStreamers() {
    streamers.value = await api().incubateList('主播学籍')
    return streamers.value
  }

  async function importStreamers(text: string, operator: string) {
    const r = await api().incubateImportStreamers(text, operator)
    await loadStreamers()
    log(`名册导入：新增 ${r?.added ?? 0}、更新 ${r?.updated ?? 0}`)
    return r
  }

  async function loadSessions() {
    sessions.value = await api().incubateList('场次记录')
    return sessions.value
  }

  async function loadSchedule() {
    schedule.value = await api().incubateList('课表')
    return schedule.value
  }

  /** 主播的赛道：档案优先 → 最近场次 → 默认 */
  function trackOf(name: string): string {
    const s = streamers.value.find((x: any) => String(x['主播'] || '').trim() === name)
    const fromRoster = s ? String(s['赛道'] || '').trim() : ''
    if (fromRoster && tracks.value[fromRoster]) return fromRoster
    const mine = sessionsOf(name)
    const last = mine.length ? String(mine[mine.length - 1]['赛道'] || '').trim() : ''
    if (last && tracks.value[last]) return last
    return defaultTrack.value
  }

  /** 某主播的场次（按日期合成），升序 */
  function sessionsOf(name: string): any[] {
    const map = new Map<string, any>()
    for (const r of sessions.value) {
      if (String(r['主播'] || '').trim() !== name) continue
      const key = String(r['日期'] || '')
      const s = map.get(key) || { 日期: r['日期'], 主播: name, 赛道: r['赛道'], 运营: r['运营'], values: {} as Record<string, string> }
      if (r['赛道']) s['赛道'] = r['赛道']
      s.values[String(r['指标'] || '')] = String(r['数值'] ?? '')
      map.set(key, s)
    }
    return Array.from(map.values()).sort((a, b) => String(a['日期']).localeCompare(String(b['日期'])))
  }

  /** 按赛道判定一次场次 */
  function evaluate(track: string, values: Record<string, string>): { hit: number; tot: number; level: 'ok' | 'warn' | 'bad' | 'none'; text: string; fails: string[] } {
    let hit = 0
    let tot = 0
    const fails: string[] = []
    for (const d of allDefsOf(track)) {
      const raw = String(values[d.key] ?? '').trim()
      if (raw === '') continue
      const n = d.kind === 'bool' ? (['是', '1', 'Y', 'true', '√', '✓'].includes(raw) ? 1 : 0) : Number(raw)
      if (!Number.isFinite(n)) continue
      tot++
      const pass = d.op === '<=' ? n <= d.target : d.op === '>=' ? n >= d.target : n === d.target
      if (pass) hit++
      else fails.push(d.label)
    }
    const level: 'ok' | 'warn' | 'bad' | 'none' = tot === 0 ? 'none' : hit === tot ? 'ok' : hit === 0 ? 'bad' : 'warn'
    const text = level === 'ok' ? '达标' : level === 'bad' ? '不合格' : level === 'warn' ? `待改进 ${hit}/${tot}` : '暂无记录'
    return { hit, tot, level, text, fails }
  }

  /** 保存一次场次：同一天同一主播先清旧行，再按指标写新行 */
  async function saveSession(payload: { 日期: string; 运营: string; 主播: string; 赛道: string; values: Record<string, string> }) {
    const { 日期, 运营, 主播, 赛道, values } = payload
    const old = sessions.value.filter((r: any) => String(r['日期'] || '') === 日期 && String(r['主播'] || '').trim() === 主播)
    for (const r of old) await api().incubateDelete('场次记录', Number(r.id))
    const 提交时间 = new Date().toISOString().slice(0, 16)
    let n = 0
    for (const [k, v] of Object.entries(values)) {
      if (String(v ?? '').trim() === '') continue
      await api().incubateAdd('场次记录', { 日期, 运营, 主播, 赛道, 指标: k, 数值: String(v).trim(), 提交时间 })
      n++
    }
    await loadSessions()
    log(`已记录一场：${主播}（${日期}，${赛道}，${n} 项）`)
    return n
  }

  /** 名单里没有这个主播时自动建档（省得运营再手动加人） */
  async function ensureStreamer(name: string, track: string, operator: string) {
    const hit = streamers.value.find((x: any) => String(x['主播'] || '').trim() === name)
    if (hit) return
    await api().incubateAdd('主播学籍', { 主播: name, 带教运营: operator || '', 赛道: track || defaultTrack.value, 更新时间: new Date().toISOString().slice(0, 10) })
    await loadStreamers()
  }

  /** 在主播页改赛道时，同步到档案 */
  async function updateStreamerTrack(name: string, track: string) {
    const hit = streamers.value.find((x: any) => String(x['主播'] || '').trim() === name)
    if (!hit) return
    await api().incubateUpdate('主播学籍', Number(hit.id), { ...hit, 赛道: track })
    await loadStreamers()
  }

  async function removeSession(name: string, date: string) {
    const old = sessions.value.filter((r: any) => String(r['日期'] || '') === date && String(r['主播'] || '').trim() === name)
    for (const r of old) await api().incubateDelete('场次记录', Number(r.id))
    await loadSessions()
    log(`已删除场次：${name}（${date}）`)
  }

  return {
    schema, table, rows, loading, logs, scoreRows, log,
    tracks, common, defaultTrack, sessions, streamers, schedule,
    plan, planDays, planFeedback,
    loadSchema, loadRows, switchTable, seed, score, importDir, browseDir, pickReport, importReportText,
    generatePlan, loadPlan, saveFeedback,
    exportCsv, exportXlsx, openDataDir,
    loadTracks, trackNames, extraDefsOf, allDefsOf,
    loadStreamers, importStreamers, loadSessions, loadSchedule,
    trackOf, sessionsOf, evaluate, saveSession, removeSession, ensureStreamer, updateStreamerTrack
  }
})
