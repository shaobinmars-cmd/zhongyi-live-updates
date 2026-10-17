/**
 * 孵化系统（独立模块，接入直播运营中控台）
 *
 * 设计原则（与原有功能完全隔离，不改乱现有逻辑）：
 * 1. 数据存在独立的 incubate.db（与弹幕库 danmu.db 分开，互不影响）；
 * 2. 只新增 IPC 通道 incubate:*，不动任何现有通道；
 * 3. 不修改拆解引擎与素材包生成流程；只在「孵化」页里提供“从拆解产物导入”。
 */
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import * as fs from 'fs'
import * as path from 'path'
import * as zlib from 'zlib'
import { app, shell } from 'electron'
import * as logger from './logger'
import { extractReportText } from './doc-text'

const LOG_MODULE = 'Incubate'

export type Row = Record<string, string>

/** 表结构：表名 → 字段（顺序即界面顺序） */
export const TABLES: Record<string, string[]> = {
  // 注意：「时间戳」是视频里的时间点（如 50:41.9），不是日期；考核要用的录入时间单独一列
  资产库: ['编号', '类型', '内容', '来源场次', '时间戳', '证据等级', '复用次数', '适用主播', '状态', '提交人', '维护人', '录入时间'],
  主播学籍: ['主播', '带教运营', '赛道', '入司日期', '首播日期', '离司日期', '固定休息日', '请假开始日期', '请假结束日期', '请假原因', '是否正常开播', '配合意愿', '路径', '起点_连说3分钟', '起点_有开场收尾', '起点_独立开播', '当前等级', '更新时间'],
  每周数字: ['周次', '主播', '最长空档秒', '每10分钟事件数', '点名次数', '口令道具次数', '收尾完成', '录入人', '录入时间'],
  课表: ['日期', '主播', '资产编号', '今天练什么', '怎么练', '验收', '打卡', '录入人'],
  案例库: ['案例名', '日期', '赛道', '证明了什么', '不能证明什么', '证据等级', '提交人', '来源目录'],
  变更日志: ['日期', '谁', '改了什么', '为什么', '影响谁'],
  场次记录: ['日期', '运营', '主播', '赛道', '指标', '数值', '提交时间'],
  运营日报: ['日期', '运营', '主播', '开播前检查', '最长空档秒', '每10分钟事件数', '点名次数', '口令道具次数', '收尾完成', '提交时间'],
  运营抽查: ['日期', '运营', '主播', '指标', '运营值', '复核值', '误差百分比', '是否合格', '复核人'],
  周复盘: ['周次', '运营', '主持', '回放片段数', '资产更新数', '课表产出', '提交时间'],
  // 运营考核：多存了「主播数 / 应交 / 有效提交 / 等级」，运营自己也能看懂这个分是怎么来的
  运营考核: ['月份', '运营', '主播数', '应交场次', '按时提交', '补交', '按时率', '成长分', '学习分', '得分', '等级', '结论', '说明', '计算时间']
  ,
  // 60 天培训计划：一个主播一行（什么赛道、从哪天开始）
  培训计划: ['主播', '赛道', '开始日期', '固定休息日', '进度', '阶段', '报告来源', '更新时间'],
  // 每天孵化结果的运营反馈
  孵化反馈: ['日期', '主播', '运营', '今日任务', '完成情况', '数据结果', '问题', '明日计划', '提交时间']
}

/** 运营考核权重（合计 100） */
export const WEIGHTS: Record<string, number> = {
  日报按时率: 20, 数字准确率: 20, 主播进步率: 20, 课表完成率: 15,
  资产贡献: 10, 复盘按时率: 10, 出师率: 5
}

/**
 * 通用能力项：所有赛道都用这一套（运营每天只需要打这 5 个分 + 1 个空档 + 收尾）。
 * 打分锚点写在 hint 里，四台电脑的运营打分才可比。
 */
export const COMMON_METRICS: MetricDef[] = [
  { key: '话术熟练度', label: '话术熟练度', kind: 'rate', op: '>=', target: 3,
    hint: '1 照读卡顿/离题｜2 能念完但生硬｜3 顺、偶尔卡｜4 顺且能换说法｜5 能带节奏（问-答-追问）' },
  { key: 'BGM使用熟练度', label: 'BGM 使用熟练度', kind: 'rate', op: '>=', target: 3,
    hint: '1 不会开/中途断｜2 会开但音量忽大忽小｜3 全程不断、音量稳定（人声压过 BGM）｜4 会按段落切换｜5 会配合节目卡点' },
  { key: '动作熟练度', label: '动作熟练度', kind: 'rate', op: '>=', target: 3,
    hint: '1 手无处放/遮镜头｜2 有固定动作但不熟｜3 动作到位、不遮脸｜4 有节奏、会带观众｜5 有专属动作梗' },
  { key: '表情管理', label: '表情管理', kind: 'rate', op: '>=', target: 3,
    hint: '1 面无表情/低头｜2 偶尔有表情｜3 收到礼物/爆点有反应｜4 全程有起伏、会盯镜头｜5 表情能带动情绪' },
  { key: '直播连贯性', label: '直播连贯性', kind: 'rate', op: '>=', target: 3,
    hint: '1 经常空场/断档｜2 偶有 5 秒以上空档｜3 最长空档 ≤3 秒｜4 最长空档 ≤2 秒且环节衔接顺｜5 全程无空档、环节自动流转' },
  { key: '最长空档秒', label: '最长空档（秒）', kind: 'num', op: '<=', target: 2,
    hint: '客观项：回放里量，只算 ≥0.5 秒的连续没人声' },
  { key: '收尾完成', label: '收尾四步走完', kind: 'bool', op: '==', target: 1,
    hint: '预告 → 点名 → 明日钩子 → 固定结束语，缺一步算没走完' }
]

/** 赛道专属项（可选加测）：默认不用填，需要细看某个赛道时再补 */
/**
 * 按赛道定义「每场要填的数据项」与合格线。
 * 设计：不同赛道要盯的东西不一样；每项都给了操作提示，运营照着填。
 * kind：num 数字 / bool 是-否 / sec 秒 / pct 百分比 / cnt 次数
 */
export interface MetricDef {
  key: string
  label: string
  kind: 'num' | 'bool' | 'rate'
  op: '<=' | '>=' | '=='
  target: number
  hint: string
}

export const TRACKS: Record<string, MetricDef[]> = {
  下单游戏: [
    { key: '最长空档秒', label: '最长空档（秒）', kind: 'num', op: '<=', target: 2, hint: '≤2' },
    { key: '每10分钟事件数', label: '每 10 分钟事件', kind: 'num', op: '>=', target: 1, hint: '≥1' },
    { key: '点名次数', label: '点名次数', kind: 'num', op: '>=', target: 15, hint: '≥15' },
    { key: '口令道具次数', label: '口令＋道具次数', kind: 'num', op: '>=', target: 10, hint: '≥10' },
    { key: '收尾完成', label: '收尾四步走完', kind: 'bool', op: '==', target: 1, hint: '预告→点名→钩子→结束语' }
  ],
  唱歌点歌: [
    { key: '最长空档秒', label: '最长空档（秒）', kind: 'num', op: '<=', target: 2, hint: '≤2' },
    { key: '报歌名次数', label: '报歌名＋点给谁', kind: 'num', op: '>=', target: 8, hint: '每首都要报，≥8' },
    { key: '唱完互动次数', label: '唱完问一句', kind: 'num', op: '>=', target: 8, hint: '打1/下首打2，≥8' },
    { key: '点歌响应秒', label: '点歌响应（秒）', kind: 'num', op: '<=', target: 60, hint: '≤60' },
    { key: '收尾完成', label: '收尾四步走完', kind: 'bool', op: '==', target: 1, hint: '同上' }
  ],
  聊天陪聊: [
    { key: '最长空档秒', label: '最长空档（秒）', kind: 'num', op: '<=', target: 3, hint: '≤3' },
    { key: '封闭提问次数', label: '封闭式提问', kind: 'num', op: '>=', target: 10, hint: '能答"打1"的那种，≥10' },
    { key: '复述次数', label: '复述观众的话', kind: 'num', op: '>=', target: 5, hint: '"你刚说X，那我Y"，≥5' },
    { key: '话题轮换分钟', label: '话题轮换（分钟）', kind: 'num', op: '<=', target: 10, hint: '一个话题别超 10 分钟' },
    { key: '收尾完成', label: '收尾四步走完', kind: 'bool', op: '==', target: 1, hint: '同上' }
  ],
  乐器: [
    { key: '曲目间隔分钟', label: '曲目间隔（分钟）', kind: 'num', op: '<=', target: 2, hint: '≤2' },
    { key: '报曲名次数', label: '报曲名＋点给谁', kind: 'num', op: '>=', target: 6, hint: '≥6' },
    { key: '间隙互动次数', label: '演奏间隙互动', kind: 'num', op: '>=', target: 6, hint: '≥6' },
    { key: '点曲响应秒', label: '点曲响应（秒）', kind: 'num', op: '<=', target: 60, hint: '≤60' },
    { key: '收尾完成', label: '收尾四步走完', kind: 'bool', op: '==', target: 1, hint: '同上' }
  ],
  舞蹈: [
    { key: '曲目间隔分钟', label: '曲目间隔（分钟）', kind: 'num', op: '<=', target: 3, hint: '≤3' },
    { key: '定点动作数', label: '每曲定点动作', kind: 'num', op: '>=', target: 3, hint: '≥3' },
    { key: '镜头走位次数', label: '镜头走位', kind: 'num', op: '>=', target: 5, hint: '≥5' },
    { key: '补水次数', label: '补水/休息节点', kind: 'num', op: '>=', target: 3, hint: '每 20 分钟一次，≥3' },
    { key: '收尾完成', label: '收尾四步走完', kind: 'bool', op: '==', target: 1, hint: '同上' }
  ],
  才艺: [
    { key: '讲解占比', label: '边做边讲占比（%）', kind: 'num', op: '>=', target: 50, hint: '≥50' },
    { key: '成品展示次数', label: '成品展示', kind: 'num', op: '>=', target: 2, hint: '≥2' },
    { key: '互动提问次数', label: '互动提问', kind: 'num', op: '>=', target: 8, hint: '≥8' },
    { key: '最长空档秒', label: '最长空档（秒）', kind: 'num', op: '<=', target: 5, hint: '手上活可以放宽到 5' },
    { key: '收尾完成', label: '收尾四步走完', kind: 'bool', op: '==', target: 1, hint: '同上' }
  ],
  脱口秀: [
    { key: '段子数', label: '段子/梗数量', kind: 'num', op: '>=', target: 10, hint: '≥10' },
    { key: '弹幕接梗次数', label: '接弹幕次数', kind: 'num', op: '>=', target: 10, hint: '≥10' },
    { key: '最长空档秒', label: '最长空档（秒）', kind: 'num', op: '<=', target: 3, hint: '≤3' },
    { key: '笑点后接话次数', label: '笑点后立刻接话', kind: 'num', op: '>=', target: 8, hint: '≥8' },
    { key: '收尾完成', label: '收尾四步走完', kind: 'bool', op: '==', target: 1, hint: '同上' }
  ],
  游戏电竞: [
    { key: '解说密度', label: '解说密度（句/分钟）', kind: 'num', op: '>=', target: 8, hint: '≥8' },
    { key: '局内互动次数', label: '局内互动', kind: 'num', op: '>=', target: 10, hint: '≥10' },
    { key: '最长空档秒', label: '最长空档（秒）', kind: 'num', op: '<=', target: 3, hint: '≤3' },
    { key: '收尾完成', label: '收尾四步走完', kind: 'bool', op: '==', target: 1, hint: '同上' }
  ],
  连麦交友: [
    { key: '破冰问题数', label: '破冰问题', kind: 'num', op: '>=', target: 10, hint: '≥10' },
    { key: '单轮时长分钟', label: '单轮时长（分钟）', kind: 'num', op: '<=', target: 10, hint: '一人别超 10 分钟' },
    { key: '最长空档秒', label: '最长空档（秒）', kind: 'num', op: '<=', target: 3, hint: '≤3' },
    { key: '收尾完成', label: '收尾四步走完', kind: 'bool', op: '==', target: 1, hint: '同上' }
  ],
  PK: [
    { key: '规则说清', label: '开场把规则说清', kind: 'bool', op: '==', target: 1, hint: '时长/惩罚/票数' },
    { key: '倒计时播报次数', label: '倒计时播报', kind: 'num', op: '>=', target: 3, hint: '≥3' },
    { key: '拉票次数', label: '拉票次数', kind: 'num', op: '>=', target: 5, hint: '≥5' },
    { key: '赛后回馈', label: '赛后给观众回馈', kind: 'bool', op: '==', target: 1, hint: '立刻做一段节目' },
    { key: '最长空档秒', label: '最长空档（秒）', kind: 'num', op: '<=', target: 2, hint: '≤2' }
  ],
  团播: [
    { key: '交接次数', label: '交接次数', kind: 'num', op: '>=', target: 6, hint: '≥6' },
    { key: '配合口令次数', label: '配合口令', kind: 'num', op: '>=', target: 6, hint: '≥6' },
    { key: '最长空档秒', label: '最长空档（秒）', kind: 'num', op: '<=', target: 2, hint: '≤2' },
    { key: '收尾完成', label: '收尾四步走完', kind: 'bool', op: '==', target: 1, hint: '同上' }
  ],
  带货: [
    { key: '卖点轮次', label: '卖点讲解轮次', kind: 'num', op: '>=', target: 8, hint: '≥8' },
    { key: '演示次数', label: '实物演示', kind: 'num', op: '>=', target: 3, hint: '≥3' },
    { key: '催单次数', label: '催单次数', kind: 'num', op: '>=', target: 10, hint: '≥10' },
    { key: '最长空档秒', label: '最长空档（秒）', kind: 'num', op: '<=', target: 2, hint: '≤2' },
    { key: '收尾完成', label: '收尾四步走完', kind: 'bool', op: '==', target: 1, hint: '同上' }
  ],
  户外: [
    { key: '场景介绍次数', label: '场景介绍', kind: 'num', op: '>=', target: 8, hint: '≥8' },
    { key: '互动次数', label: '互动次数', kind: 'num', op: '>=', target: 10, hint: '≥10' },
    { key: '最长空档秒', label: '最长空档（秒）', kind: 'num', op: '<=', target: 5, hint: '走路可放宽到 5' },
    { key: '收尾完成', label: '收尾四步走完', kind: 'bool', op: '==', target: 1, hint: '同上' }
  ],
  知识教学: [
    { key: '知识块数', label: '知识块数量', kind: 'num', op: '>=', target: 5, hint: '≥5' },
    { key: '答疑次数', label: '答疑次数', kind: 'num', op: '>=', target: 8, hint: '≥8' },
    { key: '最长空档秒', label: '最长空档（秒）', kind: 'num', op: '<=', target: 5, hint: '≤5' },
    { key: '收尾完成', label: '收尾四步走完', kind: 'bool', op: '==', target: 1, hint: '同上' }
  ],
  助眠ASMR: [
    { key: '最长空档秒', label: '最长空档（秒）', kind: 'num', op: '<=', target: 3, hint: '≤3' },
    { key: '道具音次数', label: '道具音/音效次数', kind: 'num', op: '>=', target: 8, hint: '≥8' },
    { key: '突然大声次数', label: '突然大声次数', kind: 'num', op: '==', target: 0, hint: '0 次' },
    { key: '收尾完成', label: '收尾四步走完', kind: 'bool', op: '==', target: 1, hint: '同上' }
  ],
  美食吃播: [
    { key: '一道一段', label: '一道菜一段', kind: 'bool', op: '==', target: 1, hint: '是/否' },
    { key: '展示次数', label: '展示/特写次数', kind: 'num', op: '>=', target: 5, hint: '≥5' },
    { key: '边吃边聊占比', label: '边吃边聊占比（%）', kind: 'num', op: '>=', target: 70, hint: '≥70' },
    { key: '最长空档秒', label: '最长空档（秒）', kind: 'num', op: '<=', target: 5, hint: '咀嚼时放宽到 5' },
    { key: '收尾完成', label: '收尾四步走完', kind: 'bool', op: '==', target: 1, hint: '同上' }
  ]
}

export const TRACK_NAMES = Object.keys(TRACKS)
/** 默认赛道（主播档案没填时用） */
export const DEFAULT_TRACK = '下单游戏'

let dbInstance: SqlJsDatabase | null = null
let dbPromise: Promise<SqlJsDatabase> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

function getDbPath(): string {
  return path.join(app.getPath('userData'), 'incubate.db')
}

function existingColumns(db: SqlJsDatabase, table: string): string[] {
  try {
    const res = db.exec(`PRAGMA table_info([${table}])`)
    if (!res.length) return []
    return res[0].values.map((v: any[]) => String(v[1]))
  } catch {
    return []
  }
}

function initSchema(db: SqlJsDatabase): void {
  for (const [name, cols] of Object.entries(TABLES)) {
    const defs = cols.map((c) => `[${c}] TEXT DEFAULT ''`).join(', ')
    db.run(`CREATE TABLE IF NOT EXISTS [${name}] (id INTEGER PRIMARY KEY AUTOINCREMENT, ${defs})`)
    // 兼容旧库：缺哪列补哪列（版本升级时不会因为少一列就写不进去）
    const have = existingColumns(db, name)
    for (const c of cols) {
      if (!have.includes(c)) db.run(`ALTER TABLE [${name}] ADD COLUMN [${c}] TEXT DEFAULT ''`)
    }
  }
}

function isSqliteFile(buf: Buffer): boolean {
  return buf.length >= 16 && buf.slice(0, 15).toString('latin1') === 'SQLite format 3'
}

async function getDb(): Promise<SqlJsDatabase> {
  if (dbInstance) return dbInstance
  if (dbPromise) return dbPromise
  dbPromise = (async () => {
    const SQL = await initSqlJs()
    const dbPath = getDbPath()
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    if (fs.existsSync(dbPath) && isSqliteFile(fs.readFileSync(dbPath))) {
      dbInstance = new SQL.Database(fs.readFileSync(dbPath))
    } else {
      if (fs.existsSync(dbPath)) {
        const bad = dbPath + '.bad-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
        try { fs.renameSync(dbPath, bad) } catch { /* 忽略 */ }
        logger.warn(LOG_MODULE, '孵化库不是有效的 SQLite，已备份并新建空库')
      }
      dbInstance = new SQL.Database()
    }
    initSchema(dbInstance)
    saveDb(dbInstance)
    return dbInstance
  })().catch((ex) => {
    dbPromise = null
    throw ex
  })
  return dbPromise
}

function saveDb(db: SqlJsDatabase): void {
  const data = db.export()
  const dbPath = getDbPath()
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const tmp = dbPath + '.tmp'
  fs.writeFileSync(tmp, Buffer.from(data))
  fs.renameSync(tmp, dbPath)
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (dbInstance) saveDb(dbInstance)
    saveTimer = null
  }, 1500)
}

/** 在资源管理器里定位数据文件（孵化页的「打开数据目录」） */
export function openDataFolder(): boolean {
  const dbPath = getDbPath()
  if (fs.existsSync(dbPath)) shell.showItemInFolder(dbPath)
  else shell.openPath(path.dirname(dbPath))
  return true
}

export async function flushIncubate(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (dbInstance) saveDb(dbInstance)
}

function assertTable(table: string): string[] {
  const cols = TABLES[table]
  if (!cols) throw new Error('未知的表：' + table)
  return cols
}

// ---------------------------------------------------------------- 基础读写
export async function listTables(): Promise<string[]> {
  return Object.keys(TABLES)
}

export async function listRows(table: string): Promise<any[]> {
  const cols = assertTable(table)
  const db = await getDb()
  const res = db.exec(`SELECT id, ${cols.map((c) => `[${c}]`).join(', ')} FROM [${table}] ORDER BY id DESC`)
  if (!res.length) return []
  return res[0].values.map((v: any[]) => {
    const row: any = { id: Number(v[0]) }
    cols.forEach((c, i) => { row[c] = v[i + 1] === null || v[i + 1] === undefined ? '' : String(v[i + 1]) })
    return row
  })
}

export async function addRow(table: string, row: Row): Promise<{ ok: boolean; id: number }> {
  const cols = assertTable(table)
  // 有「录入时间」的表（资产库等）自动盖上时间，考核的学习分才有据可依
  if (cols.includes('录入时间') && !String(row['录入时间'] || '').trim()) row = { ...row, 录入时间: localStamp() }
  const db = await getDb()
  db.run(
    `INSERT INTO [${table}] (${cols.map((c) => `[${c}]`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map((c) => row[c] ?? '')
  )
  const id = Number(db.exec('SELECT last_insert_rowid()')[0].values[0][0])
  scheduleSave()
  return { ok: true, id }
}

export async function updateRow(table: string, id: number, row: Row): Promise<{ ok: boolean }> {
  const cols = assertTable(table)
  const db = await getDb()
  db.run(
    `UPDATE [${table}] SET ${cols.map((c) => `[${c}] = ?`).join(', ')} WHERE id = ?`,
    [...cols.map((c) => row[c] ?? ''), String(id)]
  )
  scheduleSave()
  return { ok: true }
}

export async function deleteRow(table: string, id: number): Promise<{ ok: boolean }> {
  assertTable(table)
  const db = await getDb()
  db.run(`DELETE FROM [${table}] WHERE id = ?`, [String(id)])
  scheduleSave()
  return { ok: true }
}

export async function importRows(table: string, rows: Row[]): Promise<{ added: number }> {
  let added = 0
  for (const r of rows) {
    await addRow(table, r)
    added++
  }
  return { added }
}

/** 首次使用时灌入种子数据（仅当表为空） */
export async function seedIfEmpty(): Promise<{ seeded: string[] }> {
  const seeded: string[] = []
  const assets = await listRows('资产库')
  if (assets.length === 0) {
    await importRows('资产库', SEED_ASSETS)
    seeded.push('资产库')
  }
  const cases = await listRows('案例库')
  if (cases.length === 0) {
    await importRows('案例库', SEED_CASES)
    seeded.push('案例库')
  }
  if (seeded.length) logger.info(LOG_MODULE, '已灌入种子数据：' + seeded.join('、'))
  return { seeded }
}

// ---------------------------------------------------------------- 主播名册（运营带 30 个主播，靠这个下拉选人）
export async function importStreamers(text: string, operator: string): Promise<{ added: number; updated: number }> {
  const rows = await listRows('主播学籍')
  const byName = new Map<string, any>()
  for (const r of rows) byName.set(String(r['主播'] || '').trim(), r)

  let added = 0
  let updated = 0
  const lines = String(text || '').split(/[\r\n;；]+/).map((s) => s.trim()).filter(Boolean)
  for (const line of lines) {
    const parts = line.split(/[,，\t|]+/).map((s) => s.trim()).filter(Boolean)
    const name = parts[0]
    if (!name || name === '主播') continue
    const op = parts[1] || operator || ''
    const track = parts[2] && TRACKS[parts[2]] ? parts[2] : ''
    const exist = byName.get(name)
    if (exist) {
      if ((op && String(exist['带教运营'] || '') !== op) || (track && String(exist['赛道'] || '') !== track)) {
        await updateRow('主播学籍', Number(exist.id), { ...exist, '带教运营': op || exist['带教运营'], '赛道': track || exist['赛道'] })
        updated++
      }
      continue
    }
    const row: any = { 主播: name, 带教运营: op, 赛道: track || DEFAULT_TRACK, 更新时间: new Date().toISOString().slice(0, 10) }
    for (const c of TABLES['主播学籍']) if (!(c in row)) row[c] = ''
    const res = await addRow('主播学籍', row)
    byName.set(name, { ...row, id: res.id })   // 同名再出现时走更新，不再重复插入
    added++
  }
  logger.info(LOG_MODULE, `主播名册导入：新增 ${added}、更新 ${updated}`)
  return { added, updated }
}

// ---------------------------------------------------------------- 运营考核（全自动）
function num(v: string | undefined): number | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function grade(total: number): string {
  if (total >= 90) return 'S'
  if (total >= 80) return 'A'
  if (total >= 70) return 'B'
  if (total >= 60) return 'C'
  return 'D'
}

/** 五个评分项（1–5 分）：缺任何一项就算「没填完」，不算一次有效提交 */
const RATING_KEYS = COMMON_METRICS.filter((d) => d.kind === 'rate').map((d) => d.key)

/** 每个主播一个月按 4 场算（一周一场的最低线）——「应交场次 = 主播数 × 4」 */
const MIN_SESSIONS_PER_STREAMER = 4

/** 考核权重（合计 100）：重在主播成长，其次是每日按时提交，最后是学习 */
// 老板拍板：主播成长 40% / 学习 40% / 按时提交 20%（历史月份不重算）
export const SCORE_WEIGHTS: Record<string, number> = { 成长: 40, 按时提交: 20, 学习: 40 }

/** 学习分的目标值：一个月做到这些就算满分（运营自己也能看懂） */
export const LEARN_TARGETS: Record<string, number> = { 课表: 10, 资产: 2, 复盘: 4 }

/** 抽查门禁：本月抽查合格率低于 70% → 总分打 8 折（防乱填）；没抽查不罚也不奖 */
const SPOT_GATE = 0.7
const SPOT_PENALTY = 0.8

function isBoolTrue(v: string): boolean {
  return ['是', '1', 'Y', 'y', 'yes', 'true', '√', '✓'].includes(String(v).trim())
}

/** 本地时间戳：YYYY-MM-DD HH:MM */
function localStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 提交时间是不是就是当天（「每日按时提交」的判定）：日期 2026-10-16 + 提交时间 2026-10-16 22:00 */
export function sameDay(date: string, submittedAt: string): boolean {
  const d = String(date || '').trim()
  const s = String(submittedAt || '').trim()
  if (!d || !s) return false
  return s.startsWith(d)
}

/** 五个评分项都填了吗（只填一个分不算交了） */
export function hasAllRatings(values: Record<string, string>): boolean {
  return RATING_KEYS.every((k) => String(values[k] ?? '').trim() !== '')
}

/** 这一场填了几项 / 应有几项（完整度，展示给运营看） */
export function sessionFilled(track: string, values: Record<string, string>): { filled: number; need: number } {
  const extras = (TRACKS[track] || TRACKS[DEFAULT_TRACK] || []).filter((d) => !COMMON_METRICS.some((c) => c.key === d.key))
  const defs = [...COMMON_METRICS, ...extras]
  const filled = defs.filter((d) => String(values[d.key] ?? '').trim() !== '').length
  return { filled, need: defs.length }
}

/**
 * 单场百分制得分（只算填了的项）：
 * 评分项 (v-1)/4×100（1 分=0，5 分=100）｜是/否 100/0｜数字项按合格线折算，越差越低。
 * 用它才能看出「从 2 分提到 3 分」和「一直 3 分」的区别。
 */
export function sessionScore(track: string, values: Record<string, string>): number | null {
  const extras = (TRACKS[track] || TRACKS[DEFAULT_TRACK] || []).filter((d) => !COMMON_METRICS.some((c) => c.key === d.key))
  let sum = 0
  let n = 0
  for (const d of [...COMMON_METRICS, ...extras]) {
    const raw = String(values[d.key] ?? '').trim()
    if (raw === '') continue
    let pct: number | null = null
    if (d.kind === 'rate') {
      const v = Number(raw)
      if (Number.isFinite(v)) pct = ((Math.min(5, Math.max(1, v)) - 1) / 4) * 100
    } else if (d.kind === 'bool') {
      pct = isBoolTrue(raw) ? 100 : 0
    } else {
      const v = Number(raw)
      if (Number.isFinite(v)) {
        pct = d.op === '<='
          ? (v <= d.target ? 100 : Math.max(0, 100 - (v - d.target) * 20))
          : (v >= d.target ? 100 : Math.max(0, (v / (d.target || 1)) * 100))
      }
    }
    if (pct === null) continue
    sum += pct
    n++
  }
  return n ? sum / n : null
}


/** 按赛道判定一次场次：达标项 / 总项 / 未达标项 */
export function evaluateMetrics(track: string, values: Record<string, string>): { hit: number; tot: number; fails: string[] } {
  const extras = (TRACKS[track] || TRACKS[DEFAULT_TRACK] || []).filter((d) => !COMMON_METRICS.some((c) => c.key === d.key))
  const defs = [...COMMON_METRICS, ...extras]
  let hit = 0
  let tot = 0
  const fails: string[] = []
  for (const d of defs) {
    const raw = String(values[d.key] ?? '').trim()
    if (raw === '') continue
    const n = d.kind === 'bool' ? (['是', '1', 'Y', 'true', '√', '✓'].includes(raw) ? 1 : 0) : Number(raw)
    if (!Number.isFinite(n)) continue
    tot++
    const pass = d.op === '<=' ? n <= d.target : d.op === '>=' ? n >= d.target : n === d.target
    if (pass) hit++
    else fails.push(d.label)
  }
  return { hit, tot, fails }
}

/** 场次记录（长表）→ 按「日期+主播」合成一次场次 */
export function sessionsOf(rows: any[], name?: string): any[] {
  const map = new Map<string, any>()
  for (const r of rows) {
    const who = String(r['主播'] || '').trim()
    if (!who) continue
    if (name && who !== name) continue
    const key = String(r['日期'] || '') + '|' + who
    const s = map.get(key) || { 日期: r['日期'], 主播: who, 赛道: r['赛道'], 运营: r['运营'], values: {} as Record<string, string>, ids: [] as number[] }
    if (r['赛道']) s['赛道'] = r['赛道']
    // 提交时间：同一天可能分几次填，取「最早的那次」作为这一场的提交时间
    // （考核要看「是不是当天交的」，取最后一次会把人误判成补交）
    const stamp = String(r['提交时间'] || '').trim()
    if (stamp && (!s['提交时间'] || stamp < String(s['提交时间']))) s['提交时间'] = stamp
    s.values[String(r['指标'] || '')] = String(r['数值'] ?? '')
    s.ids.push(Number(r.id))
    map.set(key, s)
  }
  return Array.from(map.values()).sort((a, b) => String(a['日期']).localeCompare(String(b['日期'])))
}

/** 主播的赛道：档案里优先，其次最近一次场次 */
export function trackOf(name: string, students: any[], sessions: any[]): string {
  const s = students.find((x) => String(x['主播'] || '').trim() === name)
  const fromRoster = s ? String(s['赛道'] || '').trim() : ''
  if (fromRoster && TRACKS[fromRoster]) return fromRoster
  const mine = sessions.filter((x) => String(x['主播'] || '').trim() === name)
  const fromSession = mine.length ? String(mine[mine.length - 1]['赛道'] || '').trim() : ''
  if (fromSession && TRACKS[fromSession]) return fromSession
  return DEFAULT_TRACK
}

export async function scoreOperators(month?: string): Promise<any[]> {
  const m = month && month.trim() ? month.trim() : new Date().toISOString().slice(0, 7)
  const inM = (s: string | undefined): boolean => String(s || '').startsWith(m)

  const sessionsRaw = await listRows('场次记录')
  const spot = await listRows('运营抽查')
  const students = await listRows('主播学籍')
  const sessions = sessionsOf(sessionsRaw)
  const sched = await listRows('课表')
  const assets = await listRows('资产库')
  const reviews = await listRows('周复盘')

  // 参与考核的人：学籍里的带教运营 ∪ 本月提交过的运营 ∪ 本月被抽查的运营。
  // 以前只列「有提交的人」，等于谁不交谁就不用考 —— 最该被看到的反而看不见。
  const opsNames = new Set<string>()
  const addOp = (v: unknown) => { const s = String(v || '').trim(); if (s) opsNames.add(s) }
  for (const s of students) addOp(s['带教运营'])
  for (const s of sessions) if (inM(s['日期'])) addOp(s['运营'])
  for (const r of spot) if (inM(r['日期'])) addOp(r['运营'])
  const ops = Array.from(opsNames).sort()

  const out: any[] = []
  for (const op of ops) {
    const mine = sessions.filter((s) => String(s['运营'] || '').trim() === op && inM(s['日期']))

    // 这个运营名下的主播：学籍里的带教关系优先，其次本月提交里出现过的
    const roster = new Set<string>()
    for (const s of students) {
      const who = String(s['主播'] || '').trim()
      if (who && String(s['带教运营'] || '').trim() === op) roster.add(who)
    }
    for (const s of mine) { const who = String(s['主播'] || '').trim(); if (who) roster.add(who) }
    const names = Array.from(roster)
    const trackCache = new Map<string, string>()
    const trackOfName = (nm: string) => {
      if (!trackCache.has(nm)) trackCache.set(nm, trackOf(nm, students, sessionsRaw as any[]))
      return trackCache.get(nm) as string
    }

    // 有效提交：五个评分项全填的那一场（主播×天）；只填一两个分的不算交上来
    const valid = mine.filter((s) => hasAllRatings(s.values))
    let fillSum = 0
    for (const s of mine) {
      const f = sessionFilled(trackOfName(String(s['主播'] || '').trim()), s.values)
      fillSum += f.need ? f.filled / f.need : 0
    }
    const fillPct = mine.length ? Math.round((fillSum / mine.length) * 100) : 0

    // ① 每日按时提交：应交 = 主播数 × 4 场/月（不看录像，运营电脑上新装也能直接算）；
    //    当天交满额、事后补交半额、没交 0 分 —— 直接对着「每日按时」这个要求。
    const needDays = names.length * MIN_SESSIONS_PER_STREAMER
    const onTime = valid.filter((s) => sameDay(String(s['日期'] || ''), String(s['提交时间'] || '')))
    const lateCount = valid.length - onTime.length
    const rateOnTime = needDays === 0 ? 0 : Math.min(100, ((onTime.length + lateCount * 0.5) / needDays) * 100)

    // ② 主播成长 = 40% 现状（达标率）+ 60% 变化（本月首场 → 末场单场得分）
    const byStreamer = new Map<string, any[]>()
    for (const s of valid) {
      const nm = String(s['主播'] || '').trim()
      if (!nm) continue
      const arr = byStreamer.get(nm) || []
      arr.push(s)
      byStreamer.set(nm, arr)
    }
    let hit = 0
    let tot = 0
    let progSum = 0
    let progN = 0
    let soloCount = 0
    for (const [nm, arr] of byStreamer) {
      const track = trackOfName(nm)
      const sorted = arr.slice().sort((a, b) => String(a['日期']).localeCompare(String(b['日期'])))
      for (const s of sorted) {
        const ev = evaluateMetrics(track, s.values)
        hit += ev.hit
        tot += ev.tot
      }
      const first = sessionScore(track, sorted[0].values)
      const last = sessionScore(track, sorted[sorted.length - 1].values)
      if (sorted.length < 2 || first === null || last === null) {
        progSum += 50          // 只有一场：进步按中性 50 分，不奖也不罚
        soloCount++
      } else {
        // 提升 20 分算满分，退 20 分算 0 分
        progSum += Math.max(0, Math.min(100, 50 + (last - first) * 2.5))
      }
      progN++
    }
    const rateKeep = tot === 0 ? null : (hit / tot) * 100
    const progress = progN === 0 ? null : progSum / progN
    const rateGrow = rateKeep === null || progress === null ? 0 : rateKeep * 0.4 + progress * 0.6

    // ③ 学习：课表（每天练什么）/ 资产贡献 / 周复盘，三项平均，做到月目标就满分
    const schedMine = sched.filter((r) => String(r['录入人'] || '').trim() === op && inM(r['日期'])).length
    const assetMine = assets.filter((r) => String(r['提交人'] || '').trim() === op && inM(r['录入时间'])).length
    const reviewMine = reviews.filter((r) => String(r['运营'] || '').trim() === op && (inM(r['提交时间']) || inM(r['周次']))).length
    const pctOf = (n: number, target: number) => Math.min(100, (n / Math.max(1, target)) * 100)
    const learn = (pctOf(schedMine, LEARN_TARGETS.课表) + pctOf(assetMine, LEARN_TARGETS.资产) + pctOf(reviewMine, LEARN_TARGETS.复盘)) / 3

    // 抽查门禁：本月有抽查且合格率 <70% → 总分打 8 折（防乱填）；没抽查不罚也不奖
    const mineSpot = spot.filter((r) => String(r['运营'] || '').trim() === op && inM(r['日期']))
    const spotOK = (v: unknown) => { const s = String(v || '').trim(); return isBoolTrue(s) || s === '合格' }
    const okSpot = mineSpot.filter((r) => spotOK(r['是否合格'])).length
    const spotRate = mineSpot.length === 0 ? null : okSpot / mineSpot.length
    const gate = spotRate !== null && spotRate < SPOT_GATE ? SPOT_PENALTY : 1

    const rawScore = (SCORE_WEIGHTS.成长 * rateGrow + SCORE_WEIGHTS.按时提交 * rateOnTime + SCORE_WEIGHTS.学习 * learn) / 100
    const score = rawScore * gate
    const nothing = names.length === 0 && valid.length === 0 && learn === 0
    const verdict = nothing ? '无数据' : score >= 80 ? '达标' : score >= 60 ? '待改进' : '不合格'

    const notes: string[] = []
    notes.push(`应交 ${needDays}（主播 ${names.length}×4）`)
    notes.push(`按时 ${onTime.length}／补交 ${lateCount}，完整度 ${fillPct}%`)
    notes.push(`成长 达标 ${hit}/${tot || 0}`)
    notes.push(`学习 课表 ${schedMine}/${LEARN_TARGETS.课表}·资产 ${assetMine}/${LEARN_TARGETS.资产}·复盘 ${reviewMine}/${LEARN_TARGETS.复盘}`)
    if (spotRate !== null) notes.push(`抽查合格 ${Math.round(spotRate * 100)}%${gate < 1 ? '（<70% 总分×0.8）' : ''}`)
    if (soloCount) notes.push(`${soloCount} 个主播仅 1 场，进步按 50 计`)
    if (needDays === 0) notes.push('没有可考核的主播：先到主播页填名单和带教运营')

    out.push({
      月份: m, 运营: op,
      主播数: String(names.length),
      应交场次: String(needDays),
      按时提交: String(onTime.length),
      补交: String(lateCount),
      按时率: String(Math.round(rateOnTime)),
      成长分: String(Math.round(rateGrow)),
      学习分: String(Math.round(learn)),
      得分: String(Math.round(score)),
      等级: grade(score),
      结论: verdict,
      说明: notes.join('；'),
      计算时间: new Date().toISOString().replace('T', ' ').slice(0, 16)
    })
  }

  const db = await getDb()
  db.run('DELETE FROM [运营考核] WHERE [月份] = ?', [m])
  for (const r of out) {
    const cols = ['月份', '运营', '主播数', '应交场次', '按时提交', '补交', '按时率', '成长分', '学习分', '得分', '等级', '结论', '说明', '计算时间']
    await addRow('运营考核', Object.fromEntries(cols.map((c) => [c, String(r[c] ?? '')])))
  }
  scheduleSave()
  return out
}

// ---------------------------------------------------------------- 导出（CSV / XLSX，零依赖）
function csvCell(v: string): string {
  const s = v ?? ''
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export async function exportCsv(dir: string): Promise<{ files: string[] }> {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const files: string[] = []
  for (const [table, cols] of Object.entries(TABLES)) {
    const rows = await listRows(table)
    const lines = [cols.join(',')]
    for (const r of rows) lines.push(cols.map((c) => csvCell(r[c] ?? '')).join(','))
    const f = path.join(dir, table + '.csv')
    fs.writeFileSync(f, '\ufeff' + lines.join('\r\n'), 'utf-8')
    files.push(f)
  }
  return { files }
}

let CRC_TABLE: number[] | null = null
function crc32(buf: Buffer): number {
  if (!CRC_TABLE) {
    CRC_TABLE = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = (CRC_TABLE[(crc ^ buf[i]) & 0xff] as number) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function zipFiles(files: Array<{ name: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8')
    const crc = crc32(f.data)
    const comp = zlib.deflateRawSync(f.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(f.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    parts.push(local, nameBuf, comp)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0, 8)
    cd.writeUInt16LE(8, 10)
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(0x21, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(comp.length, 20)
    cd.writeUInt32LE(f.data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(offset, 42)
    central.push(cd, nameBuf)
    offset += local.length + nameBuf.length + comp.length
  }
  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([Buffer.concat(parts), cdBuf, eocd])
}

function xmlEsc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function colName(i: number): string {
  let s = ''
  i += 1
  while (i > 0) {
    const r = (i - 1) % 26
    s = String.fromCharCode(65 + r) + s
    i = Math.floor((i - 1) / 26)
  }
  return s
}

function sheetXml(rows: string[][]): string {
  const body = rows.map((row, ri) => {
    const cells = row.map((v, ci) => {
      const ref = colName(ci) + String(ri + 1)
      if (v !== '' && Number.isFinite(Number(v))) return `<c r="${ref}"><v>${Number(v)}</v></c>`
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`
    })
    return `<row r="${ri + 1}">${cells.join('')}</row>`
  })
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    body.join('') + '</sheetData></worksheet>'
}

export async function exportXlsx(outPath: string): Promise<{ path: string }> {
  const names = Object.keys(TABLES)
  const used: string[] = []
  const sheets: string[][][] = []
  for (const table of names) {
    let nm = table.replace(/[\[\]:*?/\\]/g, '_').slice(0, 31) || 'Sheet'
    let k = 2
    while (used.includes(nm)) { nm = (table.slice(0, 28) + '_' + k).slice(0, 31); k++ }
    used.push(nm)
    const cols = TABLES[table]
    const data = await listRows(table)
    sheets.push([cols, ...data.map((r) => cols.map((c) => r[c] ?? ''))])
  }
  const ct: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
  ]
  names.forEach((_n, i) => ct.push(`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`))
  ct.push('</Types>')

  const wb: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
  ]
  used.forEach((nm, i) => wb.push(`<sheet name="${xmlEsc(nm)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`))
  wb.push('</sheets></workbook>')

  const rels: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  ]
  names.forEach((_n, i) => rels.push(`<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`))
  rels.push('</Relationships>')

  const root = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>'

  const files: Array<{ name: string; data: Buffer }> = [
    { name: '[Content_Types].xml', data: Buffer.from(ct.join(''), 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(root, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(wb.join(''), 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(rels.join(''), 'utf8') }
  ]
  sheets.forEach((rows, i) => {
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(sheetXml(rows), 'utf8') })
  })
  fs.writeFileSync(outPath, zipFiles(files))
  return { path: outPath }
}

// ---------------------------------------------------------------- 从拆解产物导入
export interface ImportResult {
  caseName: string
  assetsAdded: number
  scheduleAdded: number
  message: string
  /** 从报告里猜出来的赛道（给「生成 60 天计划」自动带过去） */
  track?: string
}

/** 在目录（含子目录，最多 3 层）里挑最像报告的那个 md：拆解报告/AI分析报告 > 报告 > 素材包 > 其它 > index，草稿最后 */
function pickReportFile(dir: string): { file: string; fromDir: string } | null {
  const found: Array<{ file: string; fromDir: string; depth: number; size: number }> = []
  const walk = (d: string, depth: number) => {
    if (depth > 3) return
    let items: fs.Dirent[] = []
    try { items = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const it of items) {
      const full = path.join(d, it.name)
      if (it.isDirectory()) { walk(full, depth + 1); continue }
      if (!it.isFile() || !/\.(md|markdown|txt|docx|doc|wps|rtf)$/i.test(it.name)) continue
      let size = 0
      try { size = fs.statSync(full).size } catch { /* ignore */ }
      found.push({ file: it.name, fromDir: d, depth, size })
    }
  }
  walk(dir, 0)
  if (!found.length) return null
  const rank = (n: string): number => {
    const s = n.toLowerCase()
    if (s.includes('草稿')) return 90
    if (s.includes('拆解报告') || s.includes('分析报告')) return 0
    if (s.includes('报告')) return 1
    if (s.includes('素材包')) return 2
    if (s.includes('index')) return 4
    return 3
  }
  found.sort((a, b) => rank(a.file) - rank(b.file) || a.depth - b.depth || b.size - a.size)
  return { file: found[0].file, fromDir: found[0].fromDir }
}

/** 资产编号：按类型给前缀，从 101 往后找没被占用的 */
function nextAssetCode(type: string, seen: Set<string>): string {
  const prefix = /动作/.test(type) ? 'XD-DZ' : /表情/.test(type) ? 'XD-BQ' : /口令|票|码/.test(type) ? 'XD-KL' : 'XD-HS'
  for (let i = 101; i < 999; i++) {
    const code = `${prefix}-${String(i).padStart(3, '0')}`
    if (!seen.has(code)) return code
  }
  return `${prefix}-999`
}

/**
 * 普通「分析报告」的兜底抽取：话术库章节里的表格 → 资产。
 * 因为很多报告（包括用 ChatGPT 跑的）只是「场景 | 原句 | 变体 | 时机」这种表，没有 XD-XX-001 编号。
 */
function extractTalkFromReport(text: string): Array<{ 类型: string; 内容: string; 时间戳: string }> {
  const out: Array<{ 类型: string; 内容: string; 时间戳: string }> = []
  let inTalk = false
  let sub = ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (/^#{2,4}\s/.test(line)) {
      const isTalk = /话术|口令|金句|台词/.test(line)
      if (/^##\s/.test(line) && !isTalk) { inTalk = false; sub = ''; continue }
      if (isTalk) { inTalk = true; sub = line.replace(/^#+\s*/, ''); continue }
      if (inTalk && /^#{3,4}\s/.test(line)) sub = line.replace(/^#+\s*/, '')
      continue
    }
    if (!inTalk || !line.startsWith('|')) continue
    if (/^\|[\s:|-]+\|$/.test(line)) continue
    const cells = line.split('|').map((c) => c.trim())
    if (cells.length < 4) continue
    const scene = cells[1]
    const rawLine = cells[2]
    if (!rawLine || /^原句$/.test(rawLine) || /^-+$/.test(rawLine)) continue
    const type = /动作/.test(sub) ? '动作' : /表情/.test(sub) ? '表情' : /口令|票|码/.test(sub) ? '口令' : /bgm|音乐/i.test(sub) ? 'BGM' : '话术'
    const stamp = (rawLine.match(/`[^`]*?(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d)?)/) || [])[1] || ''
    const quoted = Array.from(rawLine.matchAll(/[「“"]([^」”"]+)[」”"]/g)).map((x) => x[1].trim()).filter(Boolean)
    const body = quoted.length ? quoted.map((q) => `「${q}」`).join('；') : rawLine.replace(/`/g, '').trim()
    if (!body) continue
    out.push({ 类型: type, 内容: scene ? `【${scene}】${body}` : body, 时间戳: stamp })
  }
  return out
}

/** 普通「分析报告」的兜底抽取：SOP 章节里的编号清单 → 课表（D1、D2…） */
function extractSopFromReport(text: string): string[] {
  const out: string[] = []
  let inSop = false
  let stage = ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (/^#{2,4}\s/.test(line)) {
      const isSop = /sop|执行清单|照做|流程/i.test(line)
      if (/^##\s/.test(line) && !isSop) { inSop = false; continue }
      if (isSop) inSop = true
      continue
    }
    if (!inSop) continue
    const bold = line.match(/^\*\*(.+?)\*\*$/)
    if (bold) { stage = bold[1].trim(); continue }
    const item = line.match(/^\d+[.、]\s*(.+)$/)
    if (!item) continue
    // 只去掉反引号字符、保留里面的时间码（“（对标 00:03.4）”才读得懂）
    const body = item[1].replace(/`/g, '').replace(/[（(]\s*[)）]/g, '').replace(/\s+/g, ' ').trim()
    if (!body) continue
    out.push((stage ? `【${stage}】` : '') + body.slice(0, 140))
  }
  return out.slice(0, 40)
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

export async function importFromTeardown(input: string, displayName?: string): Promise<ImportResult> {
  const result: ImportResult = { caseName: '', assetsAdded: 0, scheduleAdded: 0, message: '' }
  if (!input || !fs.existsSync(input)) {
    result.message = '路径不存在：' + input
    return result
  }

  // ① 选文件：选了 md 就直接用；选了目录就往下找（最多 3 层），优先「拆解报告/AI 分析报告」
  let filePath = ''
  try {
    filePath = fs.statSync(input).isFile() ? input : ''
  } catch { /* ignore */ }
  if (!filePath) {
    const picked = pickReportFile(input)
    if (!picked) {
      result.message = '这个目录（含子目录）里没找到 .md 报告文件'
      return result
    }
    filePath = path.join(picked.fromDir, picked.file)
  }
  const srcName = path.basename(filePath)
  let text = ''
  try {
    text = extractReportText(filePath).text
  } catch (ex: any) {
    result.message = '读不了这个文件：' + (ex?.message || ex)
    return result
  }
  if (!text || text.trim().length < 20) {
    result.message = '这个文件里没读到文字（可能是扫描版/图片）。请用 WPS 另存为 .docx，或直接粘贴报告全文。'
    return result
  }
  let sourceDir = path.dirname(filePath)
  while (/^work(?:_|$)/i.test(path.basename(sourceDir))) sourceDir = path.dirname(sourceDir)
  const stem = srcName.replace(/\.(md|markdown|txt|docx|doc|wps|rtf)$/i, '')
  const genericReport = /^(ai\s*分析报告|ai报告|拆解报告|分析报告|报告|素材包|index)$/i.test(stem.trim())
  result.caseName = displayName || (genericReport ? path.basename(sourceDir) : stem)

  // ② v5 指令那种带编号的资产表：| XD-XX-001 | 类型 | 内容 |
  const assetRe = /^\|\s*([A-Z]{2,4}-[A-Z]{2,4}-\d{2,4})\s*\|([^|]*)\|([^|]*)\|/gm
  const existingAssets = await listRows('资产库')
  const seen = new Set(existingAssets.map((r) => String(r['编号'] || '')))
  // 按「类型+内容」也去重：同一份报告重复导入时不会又堆一堆同样的词
  const seenContent = new Set(existingAssets.map((r) => `${String(r['类型'] || '')}|${String(r['内容'] || '').trim()}`))
  const seenSched = new Set((await listRows('课表')).map((r) => String(r['今天练什么'] || '').trim()))
  let m: RegExpExecArray | null
  const newAssets: Row[] = []
  while ((m = assetRe.exec(text)) !== null) {
    const code = m[1].trim()
    if (seen.has(code)) continue
    seen.add(code)
    newAssets.push({
      编号: code, 类型: m[2].trim(), 内容: m[3].trim(), 来源场次: result.caseName,
      时间戳: '', 证据等级: '候选', 复用次数: '1', 适用主播: '', 状态: '在库', 提交人: '导入', 维护人: '教研'
    })
  }

  // ③ v5 那种课表：| D1 | 资产编号 | 今天练什么 |
  const schedRe = /^\|\s*(D\d{1,2})\s*\|\s*([A-Z]{2,4}-[A-Z]{2,4}-\d{2,4}[^|]*)\|([^|]*)\|/gm
  const rows: Row[] = []
  while ((m = schedRe.exec(text)) !== null) {
    rows.push({
      日期: m[1].trim(), 主播: '', 资产编号: m[2].trim(), 今天练什么: m[3].trim(),
      怎么练: '', 验收: '', 打卡: '', 录入人: '导入'
    })
  }

  // ④ 兜底：普通「分析报告」（话术库表格 → 资产；SOP 编号清单 → 课表）
  let looseAssets = 0
  let looseSched = 0
  let looseSkipped = 0
  if (newAssets.length === 0) {
    for (const a of extractTalkFromReport(text)) {
      const key = `${a.类型}|${a.内容.trim()}`
      if (seenContent.has(key)) { looseSkipped++; continue }
      seenContent.add(key)
      const code = nextAssetCode(a.类型, seen)
      seen.add(code)
      newAssets.push({
        编号: code, 类型: a.类型, 内容: a.内容, 来源场次: result.caseName, 时间戳: a.时间戳,
        证据等级: '候选', 复用次数: '1', 适用主播: '', 状态: '在库', 提交人: '导入', 维护人: '教研'
      })
      looseAssets++
    }
  }
  if (rows.length === 0) {
    for (const s of extractSopFromReport(text)) {
      rows.push({ 日期: `D${rows.length + 1}`, 主播: '', 资产编号: '', 今天练什么: s, 怎么练: '', 验收: '', 打卡: '', 录入人: '导入' })
      looseSched++
    }
  }

  if (newAssets.length) await importRows('资产库', newAssets)
  result.assetsAdded = newAssets.length
  // 课表再按「今天练什么」去重一次（v5 表和 SOP 兜底两条路都覆盖）
  const rowsToAdd = rows.filter((r) => {
    const key = String(r['今天练什么'] || '').trim()
    if (!key || seenSched.has(key)) return false
    seenSched.add(key)
    return true
  })
  if (rowsToAdd.length) await importRows('课表', rowsToAdd)
  result.scheduleAdded = rowsToAdd.length

  // ⑤ 案例登记：只在真抽到东西时记，同名不重复（否则重复导入会堆一堆空案例）
  let caseAdded = false
  if (result.assetsAdded > 0 || result.scheduleAdded > 0) {
    const cases = await listRows('案例库')
    const existingCase = cases.find((c) => String(c['案例名'] || '').trim() === result.caseName)
    if (!existingCase) {
      await addRow('案例库', {
        案例名: result.caseName, 日期: new Date().toISOString().slice(0, 10), 赛道: '',
        证明了什么: '（由拆解产物导入，待补）', 不能证明什么: '（待补）', 证据等级: '候选', 提交人: '导入',
        来源目录: sourceDir
      })
      caseAdded = true
    } else if (!String(existingCase['来源目录'] || '').trim() && sourceDir) {
      await updateRow('案例库', Number(existingCase.id), { ...existingCase, 来源目录: sourceDir })
    }
  }

  const parts: string[] = [
    `来源：${result.caseName}`,
    `资产 ${result.assetsAdded} 条${looseAssets ? `（从话术库抽的 ${looseAssets}）` : ''}${looseSkipped ? `，跳过重复 ${looseSkipped}` : ''}`,
    `课表 ${result.scheduleAdded} 条${looseSched ? `（从 SOP 抽的 ${looseSched}）` : ''}`,
    caseAdded ? '案例 1 条' : '案例没记（已存在或没抽到东西）'
  ]
  if (newAssets.length === 0 && rows.length === 0) {
    parts.push('这个报告里没抽到东西：v5 格式要有「| XD-XX-001 |」资产表，普通报告要有「话术库」表格或「SOP」清单')
  } else if (result.assetsAdded === 0 && result.scheduleAdded === 0) {
    parts.push('都是已经导入过的，没有重复添加')
  }
  result.message = '已导入：' + parts.join('；')
  // 顺便从报告里猜一下赛道，给下一步「生成 60 天计划」用
  result.track = suggestTrackFromText(text) || undefined
  logger.info(LOG_MODULE, result.message)
  return result
}

// ---------------------------------------------------------------- 种子数据
export const SEED_ASSETS: Row[] = [
  { 编号: 'XD-HS-001', 类型: '话术', 内容: '欢迎问句：哥你来了，今天想点一个还是先看我玩', 来源场次: '我方改写', 时间戳: '-', 证据等级: '候选', 复用次数: '0', 适用主播: '全部', 状态: '在库', 提交人: '教研', 维护人: '教研' },
  { 编号: 'XD-HS-002', 类型: '话术', 内容: '收到订单：XX 哥一份，马上安排', 来源场次: '我方改写', 时间戳: '-', 证据等级: '候选', 复用次数: '0', 适用主播: '全部', 状态: '在库', 提交人: '教研', 维护人: '教研' },
  { 编号: 'XD-HS-003', 类型: '话术', 内容: '执行完确认：这份做完了，满意不满意', 来源场次: '我方改写', 时间戳: '-', 证据等级: '候选', 复用次数: '0', 适用主播: '全部', 状态: '在库', 提交人: '教研', 维护人: '教研' },
  { 编号: 'XD-HS-004', 类型: '话术', 内容: '催单：还有没有哥要点的，点一个我给你演到底', 来源场次: '我方改写', 时间戳: '-', 证据等级: '候选', 复用次数: '0', 适用主播: '全部', 状态: '在库', 提交人: '教研', 维护人: '教研' },
  { 编号: 'XD-HS-005', 类型: '话术', 内容: '感谢（梯度）：小单／大单两种说法', 来源场次: '我方改写', 时间戳: '-', 证据等级: '候选', 复用次数: '0', 适用主播: '全部', 状态: '在库', 提交人: '教研', 维护人: '教研' },
  { 编号: 'XD-KL-001', 类型: '口令', 内容: '执行口令：XX 哥你请坐，一般人我都不让坐（字面待回听）', 来源场次: 'BIGda 2026-10-15', 时间戳: '50:41.9', 证据等级: '候选', 复用次数: '1', 适用主播: '外向型', 状态: '在库', 提交人: '教研', 维护人: '教研' },
  { 编号: 'XD-DZ-001', 类型: '动作', 内容: '下单就举起道具，动作要大', 来源场次: 'BIGda 2026-10-15', 时间戳: '44:00', 证据等级: '候选', 复用次数: '1', 适用主播: '全部', 状态: '在库', 提交人: '教研', 维护人: '教研' },
  { 编号: 'XD-DZ-002', 类型: '动作', 内容: '每单之间不停嘴，不留空档', 来源场次: 'BIGda 2026-10-15', 时间戳: '全片', 证据等级: '候选', 复用次数: '1', 适用主播: '全部', 状态: '在库', 提交人: '教研', 维护人: '教研' },
  { 编号: 'XD-BQ-001', 类型: '表情', 内容: '表情三档：惊讶／委屈／盯镜头', 来源场次: '我方设定', 时间戳: '-', 证据等级: '候选', 复用次数: '0', 适用主播: '全部', 状态: '在库', 提交人: '教研', 维护人: '教研' },
  { 编号: 'XD-DJ-001', 类型: '道具', 内容: '一件专属道具放手边（案例为金红小椅子）', 来源场次: 'BIGda 2026-10-15', 时间戳: '44:00', 证据等级: '候选', 复用次数: '1', 适用主播: '全部', 状态: '在库', 提交人: '教研', 维护人: '教研' },
  { 编号: 'XD-BGM-001', 类型: 'BGM', 内容: 'BGM 全程不断；人声比 BGM 高 12–14 dB', 来源场次: 'BIGda 2026-10-15', 时间戳: '全片（实测）', 证据等级: '已测', 复用次数: '1', 适用主播: '全部', 状态: '在库', 提交人: '教研', 维护人: '教研' },
  { 编号: 'XD-BGM-002', 类型: 'BGM', 内容: '换 BGM 只在单与单之间那 2 秒', 来源场次: '我方建议', 时间戳: '-', 证据等级: '候选', 复用次数: '0', 适用主播: '全部', 状态: '在库', 提交人: '教研', 维护人: '教研' }
]

export const SEED_CASES: Row[] = [
  {
    案例名: 'BIGda 直播间1', 日期: '2026-10-15', 赛道: '下单游戏',
    证明了什么: '口令流水线撑停留（静音 12.5 秒/0.4%）；道具梗；BGM 全程不断、人声高出 12–14 dB；掉人段在 20:00–40:00',
    不能证明什么: '菜单长什么样；出单量/客单价/转化率；换歌节点；口令准确字面',
    证据等级: '候选', 提交人: '教研'
  }
]
