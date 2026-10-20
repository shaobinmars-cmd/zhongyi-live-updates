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
import { SEED_SCRIPTS, SEED_PK } from './seed-content'
import { SEED_SCRIPTS_XH } from './seed-scripts-xiaohan'

const LOG_MODULE = 'Incubate'

export type Row = Record<string, string>

/** 表结构：表名 → 字段（顺序即界面顺序） */
export const TABLES: Record<string, string[]> = {
  // 注意：「时间戳」是视频里的时间点（如 50:41.9），不是日期；考核要用的录入时间单独一列
  资产库: ['编号', '类型', '内容', '来源场次', '时间戳', '证据等级', '复用次数', '适用主播', '状态', '提交人', '维护人', '录入时间'],
  主播学籍: ['主播', '带教运营', '赛道', '联系方式', '入司日期', '首播日期', '离司日期', '固定休息日', '请假开始日期', '请假结束日期', '请假原因', '是否正常开播', '配合意愿', '路径', '起点_连说3分钟', '起点_有开场收尾', '起点_独立开播', '当前等级', '更新时间'],
  每周数字: ['周次', '主播', '最长空档秒', '每10分钟事件数', '点名次数', '口令道具次数', '收尾完成', '录入人', '录入时间'],
  课表: ['日期', '主播', '资产编号', '今天练什么', '怎么练', '验收', '打卡', '录入人', '执行日期', '课程来源'],
  案例库: ['案例名', '日期', '赛道', '证明了什么', '不能证明什么', '证据等级', '提交人', '来源目录'],
  变更日志: ['日期', '谁', '改了什么', '为什么', '影响谁'],
  场次记录: ['日期', '运营', '主播', '赛道', '指标', '数值', '提交时间'],
  运营日报: ['日期', '运营', '主播', '开播前检查', '最长空档秒', '每10分钟事件数', '点名次数', '口令道具次数', '收尾完成', '提交时间'],
  运营抽查: ['日期', '运营', '主播', '指标', '运营值', '复核值', '误差百分比', '是否合格', '复核人'],
  周复盘: ['周次', '运营', '主持', '回放片段数', '资产更新数', '课表产出', '提交时间'],
  // 运营考核：多存了「主播数 / 应交 / 有效提交 / 等级」，运营自己也能看懂这个分是怎么来的
  运营考核: ['月份', '运营', '主播数', '已离司', '离职率', '应交场次', '按时提交', '补交', '按时率', '成长分', '学习分', '得分', '等级', '结论', '说明', '计算时间']
  ,
  // 60 天培训计划：一个主播一行（什么赛道、从哪天开始）
  培训计划: ['主播', '赛道', '开始日期', '固定休息日', '进度', '阶段', '报告来源', '更新时间'],
  // 每天孵化结果的运营反馈
  孵化反馈: ['日期', '主播', '运营', '今日任务', '完成情况', '数据结果', '问题', '明日计划', '提交时间'],
  // 心态调整：多方心态方案 —— 对象=主播（运营照着说）/ 运营（管理端照着说）/ 管理者（自己想通照着做）
  心态调整: ['对象', '分类', '问题', '疏导回复', '应对动作', '更新时间'],
  // 话术库：主播在直播间照着念的回话方案，按对话场景区分（接话破冰/对答如流/满腹经纶…）
  // 心态调整管「主播心里怎么想通」，话术库管「主播嘴上怎么接话」，两回事
  话术库: ['场景', '游客说', '回复方案', '出处', '更新时间'],
  // 主播作业：图片/视频/Word 等文件复制到 userData/homework 存档（路径列），飞书等只登记链接
  作业库: ['主播', '日期', '标题', '类型', '文件名', '路径', '链接', '备注', '录入时间'],
  // PK玩法库：PK 输了做的惩罚玩法；每条带安全提示（不饮酒/不低俗/不危险/不涉钱）
  PK玩法库: ['分类', '惩罚内容', '安全提示', '出处', '更新时间']
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

// ---------------------------------------------------------------- 主播作业（文件存档 + 链接登记）
function homeworkRoot(): string {
  const dir = path.join(app.getPath('userData'), 'homework')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function safeFileName(name: string): string {
  return String(name || 'file').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'file'
}

/** 作业归属日期：优先用传入的 YYYY-MM-DD，缺省今天 */
function homeworkDate(date: string): string {
  const d = String(date || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date().toISOString().slice(0, 10)
}

/** 上传作业文件：复制进用户目录（图片/视频/Word 等不限格式），再登记到作业库 */
export async function addHomeworkFile(srcPath: string, streamer: string, title: string, note: string, date?: string): Promise<{ ok: boolean; id: number }> {
  const s = String(streamer || '').trim()
  if (!s) throw new Error('先选主播再传作业')
  const src = String(srcPath || '').trim()
  if (!src || !fs.existsSync(src)) throw new Error('文件不存在：' + src)
  const dir = path.join(homeworkRoot(), safeFileName(s))
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const base = safeFileName(path.basename(src))
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  let dest = path.join(dir, `${stamp}_${base}`)
  let n = 1
  while (fs.existsSync(dest)) dest = path.join(dir, `${stamp}_${n++}_${base}`)
  fs.copyFileSync(src, dest)
  return addRow('作业库', {
    主播: s,
    日期: homeworkDate(String(date || '')),
    标题: String(title || '').trim() || base,
    类型: '文件',
    文件名: base,
    路径: dest,
    备注: String(note || '').trim()
  })
}

/** 登记作业链接（飞书文档/多维表格等） */
export async function addHomeworkLink(streamer: string, title: string, url: string, note: string, date?: string): Promise<{ ok: boolean; id: number }> {
  const s = String(streamer || '').trim()
  if (!s) throw new Error('先选主播再传作业')
  const u = String(url || '').trim()
  if (!/^https?:\/\//i.test(u)) throw new Error('链接要以 http:// 或 https:// 开头')
  return addRow('作业库', {
    主播: s,
    日期: homeworkDate(String(date || '')),
    标题: String(title || '').trim() || u,
    类型: '链接',
    链接: u,
    备注: String(note || '').trim()
  })
}

/** 打开作业：文件用系统默认程序，链接走浏览器 */
export async function openHomework(id: number): Promise<boolean> {
  const rows = await listRows('作业库')
  const row = rows.find((r) => Number(r.id) === Number(id))
  if (!row) return false
  if (String(row['类型']) === '链接') {
    const u = String(row['链接'] || '').trim()
    if (!/^https?:\/\//i.test(u)) return false
    await shell.openExternal(u)
    return true
  }
  const p = String(row['路径'] || '').trim()
  if (!p || !fs.existsSync(p)) return false
  const err = await shell.openPath(p)
  return !err
}

/** 删除作业：记录删掉；复制存档的本地文件一并清掉（链接没有本地文件） */
export async function deleteHomework(id: number): Promise<{ ok: boolean }> {
  const rows = await listRows('作业库')
  const row = rows.find((r) => Number(r.id) === Number(id))
  const res = await deleteRow('作业库', id)
  if (row && String(row['类型']) !== '链接') {
    const p = String(row['路径'] || '').trim()
    if (p && p.startsWith(homeworkRoot()) && fs.existsSync(p)) {
      try { fs.unlinkSync(p) } catch { /* 忽略 */ }
    }
  }
  return res
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
  // 心态调整：空表灌全部种子；老表补「对象」列（默认主播）并按角色补齐新种子，幂等
  const mindset = await listRows('心态调整')
  if (mindset.length === 0) {
    await importRows('心态调整', SEED_MINDSET)
    seeded.push('心态调整')
  } else {
    let backfilled = false
    for (const r of mindset) {
      if (!String(r['对象'] || '').trim()) {
        await updateRow('心态调整', Number(r.id), { ...r, 对象: '主播' })
        backfilled = true
      }
    }
    const roles = new Set((backfilled ? await listRows('心态调整') : mindset).map((r) => String(r['对象'] || '').trim()))
    if (!roles.has('运营')) {
      await importRows('心态调整', SEED_MINDSET_OPERATOR)
      seeded.push('心态调整·运营')
    }
    if (!roles.has('管理者')) {
      await importRows('心态调整', SEED_MINDSET_MANAGER)
      seeded.push('心态调整·管理者')
    }
  }
  // 话术库：按「回复方案」补缺失（幂等；老用户已有数据只补不删，自定义条目不丢）
  {
    const scripts = await listRows('话术库')
    const exist = new Set(scripts.map((r) => String(r['回复方案'] || '').trim()))
    const miss = [...SEED_SCRIPTS, ...SEED_SCRIPTS_XH].filter((r) => !exist.has(String(r['回复方案'] || '').trim()))
    if (miss.length) {
      await importRows('话术库', miss)
      seeded.push(`话术库+${miss.length}`)
    }
  }
  // PK玩法库：按「惩罚内容」补缺失（同上幂等）
  {
    const pks = await listRows('PK玩法库')
    const exist = new Set(pks.map((r) => String(r['惩罚内容'] || '').trim()))
    const miss = SEED_PK.filter((r) => !exist.has(String(r['惩罚内容'] || '').trim()))
    if (miss.length) {
      await importRows('PK玩法库', miss)
      seeded.push(`PK玩法库+${miss.length}`)
    }
  }
  if (seeded.length) logger.info(LOG_MODULE, '已灌入种子数据：' + seeded.join('、'))
  return { seeded }
}

// ---------------------------------------------------------------- 主播名册（运营带 30 个主播，靠这个下拉选人）
export async function importStreamers(text: string, operator: string, defaultTrack = DEFAULT_TRACK): Promise<{ added: number; updated: number }> {
  const rows = await listRows('主播学籍')
  const byName = new Map<string, any>()
  for (const r of rows) byName.set(String(r['主播'] || '').trim(), r)

  let added = 0
  let updated = 0
  const fallbackTrack = TRACKS[defaultTrack] ? defaultTrack : DEFAULT_TRACK
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
    const row: any = { 主播: name, 带教运营: op, 赛道: track || fallbackTrack, 更新时间: new Date().toISOString().slice(0, 10) }
    for (const c of TABLES['主播学籍']) if (!(c in row)) row[c] = ''
    const res = await addRow('主播学籍', row)
    byName.set(name, { ...row, id: res.id })   // 同名再出现时走更新，不再重复插入
    added++
  }
  logger.info(LOG_MODULE, `主播名册导入：新增 ${added}、更新 ${updated}`)
  return { added, updated }
}

/** 标记主播离司：保留姓名和全部历史，用于离职率与历史追溯。 */
export async function departStreamer(name: string, date = ''): Promise<{ ok: boolean; date: string }> {
  const who = String(name || '').trim()
  if (!who) throw new Error('主播名字不能为空')
  const day = String(date || '').trim() || new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('离司日期格式不对')
  const hit = (await listRows('主播学籍')).find((r) => String(r['主播'] || '').trim() === who)
  if (!hit) throw new Error('找不到这个主播的学籍')
  await updateRow('主播学籍', Number(hit.id), { ...hit, 离司日期: day, 更新时间: day })
  logger.info(LOG_MODULE, `主播标记离司：${who} / ${day}`)
  return { ok: true, date: day }
}

/** 恢复在职：保留历史，只清空离司日期。 */
export async function restoreStreamer(name: string): Promise<{ ok: boolean }> {
  const who = String(name || '').trim()
  if (!who) throw new Error('主播名字不能为空')
  const hit = (await listRows('主播学籍')).find((r) => String(r['主播'] || '').trim() === who)
  if (!hit) throw new Error('找不到这个主播的学籍')
  await updateRow('主播学籍', Number(hit.id), { ...hit, 离司日期: '', 更新时间: new Date().toISOString().slice(0, 10) })
  logger.info(LOG_MODULE, `主播恢复在职：${who}`)
  return { ok: true }
}

// ---------------------------------------------------------------- 运营考核（全自动）
/** 修改主播姓名、带教运营或赛道；改名会同步所有以主播名关联的孵化数据。 */
export async function updateStreamerIdentity(
  oldName: string,
  patch: { name?: string; operator?: string; track?: string }
): Promise<{ ok: boolean; oldName: string; name: string; operator: string; track: string; updatedRows: number }> {
  const who = String(oldName || '').trim()
  if (!who) throw new Error('请先选择主播')
  const roster = await listRows('主播学籍')
  const hit = roster.find((r) => String(r['主播'] || '').trim() === who)
  if (!hit) throw new Error('找不到这个主播的学籍')
  const nextName = String(patch.name ?? who).trim()
  if (!nextName) throw new Error('主播姓名不能为空')
  const duplicate = roster.find((r) => Number(r.id) !== Number(hit.id) && String(r['主播'] || '').trim() === nextName)
  if (nextName !== who && duplicate) throw new Error(`主播“${nextName}”已经存在，请换一个名字或先处理重复档案`)
  const nextOperator = String(patch.operator ?? hit['带教运营'] ?? '').trim()
  const requestedTrack = String(patch.track ?? hit['赛道'] ?? '').trim()
  const nextTrack = TRACKS[requestedTrack] ? requestedTrack : String(hit['赛道'] || DEFAULT_TRACK)
  const day = new Date().toISOString().slice(0, 10)
  let updatedRows = 0
  await updateRow('主播学籍', Number(hit.id), { ...hit, 主播: nextName, 带教运营: nextOperator, 赛道: nextTrack, 更新时间: day })
  updatedRows++
  if (nextName !== who) {
    for (const [table, columns] of Object.entries(TABLES)) {
      if (table === '主播学籍' || !columns.includes('主播')) continue
      const rows = await listRows(table)
      for (const row of rows) {
        if (String(row['主播'] || '').trim() !== who) continue
        await updateRow(table, Number(row.id), { ...row, 主播: nextName })
        updatedRows++
      }
    }
  }
  const plans = await listRows('培训计划')
  for (const row of plans) {
    if (String(row['主播'] || '').trim() !== nextName) continue
    if (String(row['赛道'] || '').trim() !== nextTrack) {
      await updateRow('培训计划', Number(row.id), { ...row, 赛道: nextTrack, 更新时间: day })
      updatedRows++
    }
  }
  logger.info(LOG_MODULE, `主播资料修改：${who} → ${nextName}（${nextOperator} / ${nextTrack}）`)
  return { ok: true, oldName: who, name: nextName, operator: nextOperator, track: nextTrack, updatedRows }
}

/** 仅用于误建或重复主播；正常离职应使用 departStreamer 保留历史。 */
export async function deleteStreamer(name: string): Promise<{ ok: boolean; name: string; deleted: Record<string, number> }> {
  const who = String(name || '').trim()
  if (!who) throw new Error('请先选择主播')
  const roster = await listRows('主播学籍')
  const hit = roster.find((r) => String(r['主播'] || '').trim() === who)
  if (!hit) throw new Error('找不到这个主播的学籍')
  const deleted: Record<string, number> = {}
  for (const [table, columns] of Object.entries(TABLES)) {
    if (table === '主播学籍' || !columns.includes('主播')) continue
    const rows = await listRows(table)
    const targets = rows.filter((row) => String(row['主播'] || '').trim() === who)
    for (const row of targets) await deleteRow(table, Number(row.id))
    if (targets.length) deleted[table] = targets.length
  }
  await deleteRow('主播学籍', Number(hit.id))
  deleted['主播学籍'] = 1
  logger.warn(LOG_MODULE, `删除错误主播：${who} / ${JSON.stringify(deleted)}`)
  return { ok: true, name: who, deleted }
}

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
    const activeRoster = new Set<string>()
    for (const s of students) {
      const who = String(s['主播'] || '').trim()
      if (who && String(s['带教运营'] || '').trim() === op) roster.add(who)
      if (who && String(s['带教运营'] || '').trim() === op && !String(s['离司日期'] || '').trim()) activeRoster.add(who)
    }
    for (const s of mine) { const who = String(s['主播'] || '').trim(); if (who) roster.add(who) }
    for (const s of mine) {
      const who = String(s['主播'] || '').trim()
      if (!who) continue
      roster.add(who)
      const person = students.find((r) => String(r['主播'] || '').trim() === who)
      if (!String(person?.['离司日期'] || '').trim()) activeRoster.add(who)
    }
    const names = Array.from(roster)
    const activeNames = Array.from(activeRoster)
    const departed = Math.max(0, names.length - activeNames.length)
    const turnoverRate = names.length ? Math.round((departed / names.length) * 100) : 0
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
    const needDays = activeNames.length * MIN_SESSIONS_PER_STREAMER
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
    notes.push(`应交 ${needDays}（在职主播 ${activeNames.length}×4）`)
    notes.push(`主播离职 ${departed}/${names.length}，离职率 ${turnoverRate}%`)
    notes.push(`按时 ${onTime.length}／补交 ${lateCount}，完整度 ${fillPct}%`)
    notes.push(`成长 达标 ${hit}/${tot || 0}`)
    notes.push(`学习 课表 ${schedMine}/${LEARN_TARGETS.课表}·资产 ${assetMine}/${LEARN_TARGETS.资产}·复盘 ${reviewMine}/${LEARN_TARGETS.复盘}`)
    if (spotRate !== null) notes.push(`抽查合格 ${Math.round(spotRate * 100)}%${gate < 1 ? '（<70% 总分×0.8）' : ''}`)
    if (soloCount) notes.push(`${soloCount} 个主播仅 1 场，进步按 50 计`)
    if (needDays === 0) notes.push('没有可考核的主播：先到主播页填名单和带教运营')

    out.push({
      月份: m, 运营: op,
      主播数: String(activeNames.length),
      已离司: String(departed),
      离职率: String(turnoverRate),
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
    const cols = ['月份', '运营', '主播数', '已离司', '离职率', '应交场次', '按时提交', '补交', '按时率', '成长分', '学习分', '得分', '等级', '结论', '说明', '计算时间']
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

/**
 * 心态调整种子库（多方版）：
 *  - 主播：运营下播后谈心照着用（疏导回复=运营对主播说的话，应对动作=说完立刻带着做的事）；
 *  - 运营：管理端给运营做疏导（疏导回复=管理端对运营说的话，应对动作=落地的管理动作）；
 *  - 管理者：老板/管理端自我调整（疏导回复=自己要想通的理，应对动作=回去就做的管理动作）。
 * 光说不练没用，每条都配了动作。
 */
const SEED_MINDSET_STREAMER: Row[] = [
  // —— 开播紧张（第 1 周最高发）——
  {
    分类: '开播紧张', 问题: '第一天开播，紧张到说不出话、大脑空白',
    疏导回复: '紧张说明你在乎，这正常，每个大主播第一天都这样。今天不要求你播得好，只要求你把开场三句说完就算赢。镜头那头没人认识你，说错了也没代价。',
    应对动作: '开播前把开场三句贴在镜头旁，照着念 10 遍；今天目标降为「完整播 30 分钟」，下播后只复盘 1 个进步点。'
  },
  {
    分类: '开播紧张', 问题: '怕被熟人刷到，觉得丢人',
    疏导回复: '靠手艺吃饭不丢人。熟人刷到只有两个结果：划走，或者给你点个关注，两个都不亏。真做起来了，当初笑你的人会第一个来问你还招不招人。',
    应对动作: '把「可能看到的熟人」列出来，逐个想一遍「他看到我直播会怎样」，写完就发现没什么大不了；开播照常。'
  },
  {
    分类: '开播紧张', 问题: '开播前拖延，到点了不想开',
    疏导回复: '拖延不是懒，是怕。把开播拆小：你现在只需要做一件事——按下开播键，后面的话术我都在你边上。先播 10 分钟，10 分钟后还难受咱们再说。',
    应对动作: '定死开播闹钟，提前 15 分钟坐到位子上；运营陪着开前 10 分钟，进状态后再撤。连续 3 天按时开播就奖励一次。'
  },

  // —— 冷场尴尬 ——
  {
    分类: '冷场尴尬', 问题: '直播间没人说话，自言自语特别尴尬',
    疏导回复: '新直播间前两周都是这样，不是针对你。你看的那些热闹直播间，头一个月也是对着空气练出来的。你就当现在是排练，观众是后来才进场的。',
    应对动作: '准备 5 个自问自答的话术循环用（报菜名式栏目单）；运营进直播间当「气氛组」带头发弹幕；每场只考核「空档不超过 3 秒」，不考核在线人数。'
  },
  {
    分类: '冷场尴尬', 问题: '有人进来了又马上划走，怀疑自己不适合',
    疏导回复: '划走的是路人，不是你的观众。100 个划走的人里留下 3 个，这 3 个才是你的。你现在要盯的不是走了多少，是留下了谁。',
    应对动作: '下播只看一个数：停留超过 1 分钟的有几个人；把他们的昵称记下来，明天开播点名欢迎。'
  },

  // —— 数据焦虑 ——
  {
    分类: '数据焦虑', 问题: '播了一周还是个位数在线，觉得没希望',
    疏导回复: '个位数在线是每个人的起点，算法还没认识你。我们的计划是按 60 天排的，第 7 天该练的是「能完整播下来」，不是在线人数。你的验收标准在课表上，不在右上角那个数字上。',
    应对动作: '把在线人数挡住不看（贴纸贴上）；只对照今日课表验收；一周后回看录屏，对比第一天的自己。'
  },
  {
    分类: '数据焦虑', 问题: '没人刷礼物，觉得自己白播了',
    疏导回复: '礼物是结果，不是目标。新主播前 30 天的收入指标就是低，公司按阶段给你算成长，不拿你和成熟主播比。话术、互动、留人练到位了，礼物是跟着来的。',
    应对动作: '今日考核只看互动次数和空档秒数；把「谢礼三连」话术再练 10 遍，为来礼物那天做准备。'
  },
  {
    分类: '数据焦虑', 问题: '看到别人（同期或老主播）数据好，心里不平衡',
    疏导回复: '你看到的是他现在的第 100 场，不是他的第 1 场。你俩起点不同、赛道不同，比数据没意义，要比就比自己上周。你今天的课表完成了没有？这才是你能控制的。',
    应对动作: '把「对比对象」换成自己：找出自己第 1 场和最近 1 场的录屏各看 5 分钟，写下 3 个进步点。'
  },

  // —— 黑粉恶评 ——
  {
    分类: '黑粉恶评', 问题: '被喷「长得丑」「播得烂」，下播后一直想着这句话',
    疏导回复: '喷子对每个直播间都说一样的话，他不是评价你，他只是路过倒垃圾。你一个都别往心里去，往心里去他就赢了。平台给你拉黑键就是干这个用的。',
    应对动作: '当场拉黑不回复（不和喷子对话，越回他越来劲）；运营下播后主动找主播聊 5 分钟，把这条恶评说开、笑掉；写 3 条今天观众给过的好评对冲。'
  },
  {
    分类: '黑粉恶评', 问题: '被人身攻击后当场情绪失控，想哭/想下播',
    疏导回复: '想哭就哭，不丢人，但别在镜头前。你现在可以切 BGM、喝口水，给自己 30 秒。记住：直播间是你的主场，你有权让任何人出去。',
    应对动作: '教会「应急三步」：切 BGM → 喝水深呼吸 → 念备用话术（「新来的哥看一下节目单」）；运营收到信号立刻进场刷正面弹幕盖过去。'
  },

  // —— 自我怀疑 / 想放弃 ——
  {
    分类: '自我怀疑', 问题: '「我是不是不适合干这个」',
    疏导回复: '适不适合，60 天见分晓，现在下结论太早。你入司才 X 天，课表上你该会的都在涨——话术从磕巴到顺、空档从 10 秒到 3 秒，这些数据都在说你适合。',
    应对动作: '拿出评分记录，给主播看他自己的成长曲线（五项评分对比）；确认今天的小目标并完成它，用完成感对冲怀疑。'
  },
  {
    分类: '自我怀疑', 问题: '提出「我不想干了」/ 有离职苗头',
    疏导回复: '先不急着决定。咱们把「不想干」拆开：是累、是没数据、还是家里有事？每一项都有解法，唯独现在放弃，前面 X 天真的白练了。给我 3 天，咱们一起把这个坎过了再谈。',
    应对动作: '运营当天必须上报管理端，24 小时内安排一次面对面深聊，找到真实原因（累→调休；没数据→降指标看进步；家里事→请假顺延计划）；3 天内每天跟一次状态。'
  },
  {
    分类: '自我怀疑', 问题: '遇到瓶颈期，练了也没进步',
    疏导回复: '瓶颈说明你在往上走，平路不会有瓶颈。这个阶段拼的不是练得更多，是练得更准——我们找到卡住你的那一个点，专打它。',
    应对动作: '运营回看最近 3 场录屏，定位唯一瓶颈点（话术/留人/节奏三选一）；未来 3 天课表只练这一项，其余降强度。'
  },

  // —— 身体状态 ——
  {
    分类: '身体状态', 问题: '连续播了一周，嗓子哑、特别累',
    疏导回复: '主播是体力活，状态垮了什么都白搭。嗓子是饭碗，今天硬扛明天更播不了。该休息休息，计划可以顺延，人垮了没顺延。',
    应对动作: '安排 1 天「休息与轻复盘」（不排高强度训练）；准备温水/护嗓；如需请假走请假流程，课表顺延，不补课不追数据。'
  },
  {
    分类: '身体状态', 问题: '作息颠倒，白天没精神，恶性循环',
    疏导回复: '固定作息就是主播的职业装。开播时间飘忽，算法和观众都找不到你。咱们先把开播时间钉死，睡觉时间跟着倒推。',
    应对动作: '定死每天固定开播时段；下播后 1 小时内不碰手机；连续 5 天同一时段开播，形成生物钟。'
  },

  // —— 外界压力 ——
  {
    分类: '外界压力', 问题: '家人/朋友不理解，说「这不正经」「赚不到钱」',
    疏导回复: '他们不了解这个行业，担心你才这么说。你不需要说服他们，你需要用 60 天后的自己回答他们。公司按阶段带你，你不是一个人在扛。',
    应对动作: '帮主播算清现阶段的成长账（学会了什么、下一步是什么）；约定一个「给家里人看成果」的时间点（如第 40 天音浪目标）。'
  },
  {
    分类: '外界压力', 问题: '经济压力大，急着赚钱，嫌弃前期收入低',
    疏导回复: '急钱赚不长。这个行当是手艺活，前 30 天练手艺，后 30 天手艺换钱。你现在每练一天，是在给后面每天加钱。真扛不住跟我说，咱们一起想办法，别自己闷着。',
    应对动作: '把 60 天音浪预期（40 天 20 万）拆给主播看，让他知道自己走在哪一步；如确有困难，上报管理端协商帮扶方案。'
  }
]

// —— 运营对象：管理端对运营说的话 + 落地动作 ——
export const SEED_MINDSET_OPERATOR: Row[] = [
  {
    对象: '运营', 分类: '带教挫败', 问题: '带的主播离职了，觉得是自己没带好',
    疏导回复: '主播离职是行业常态，不是某个运营的问题。你带 10 个走 2 个是概率，不是能力。复盘只看一条：该做的带教动作做了没有——动作都做了，人要走拦不住。',
    应对动作: '调出这个主播的 60 天记录，逐项核对带教动作完成度；动作做到位的，在周复盘标注「非带教原因」，管理端不把这条算进你的考核；动作有缺口的，写明下周补法。'
  },
  {
    对象: '运营', 分类: '带教挫败', 问题: '主播播了两周数据没起色，怀疑自己不会带',
    疏导回复: '两周没起色在正常区间里。60 天计划的前 15 天本来就不冲数据，你的验收标准是课表完成度和五项评分，不是在线人数。',
    应对动作: '把五项评分第一周和本周拉出来对比，有进步就按计划走；真没进步的那一项单独约管理端过一遍方法，别全盘否定自己。'
  },
  {
    对象: '运营', 分类: '精力分配', 问题: '手上主播太多，顾不过来，天天救火',
    疏导回复: '救火式带人谁都累，而且带不好。主播分三层：重点孵化的每天跟，稳定的隔天跟，成熟的每周跟——你的时间先给最需要的前 5 个。',
    应对动作: '今天就把手上主播按「重点/稳定/成熟」分三层写下来，排好各自跟进频率；排完还是超负荷，直接找管理端调人，别硬扛。'
  },
  {
    对象: '运营', 分类: '考核压力', 问题: '月底考核压力大，怕垫底',
    疏导回复: '考核每一项都是平时动作的汇总：日报按时交、课表按天排、复盘按时写，分数自然不会低。临时抱佛脚抱不出来，也不用焦虑。',
    应对动作: '把考核七项权重打印贴桌上；每周五对着自评一次，弱项下周补；连续垫底管理端会安排一对一过方法，是帮不是罚。'
  },
  {
    对象: '运营', 分类: '沟通冲突', 问题: '主播不配合、顶嘴，管不动',
    疏导回复: '主播顶嘴多半是心里有结，先解结再谈管理。你是带他赚钱的人，不是他的对立面，硬压只会把人压走。',
    应对动作: '约一次非正式沟通（下播后 10 分钟，不谈数据只听他说）；找到心结对症处理；实在带不动就上报管理端换带教，不硬耗。'
  },
  {
    对象: '运营', 分类: '新人心态', 问题: '刚当运营，不敢管、不敢说',
    疏导回复: '你背后是整个孵化体系：课表、评分、话术库、心态库都是你的底气。按流程带就不会错，说错了管理端给你兜着。',
    '应对动作': '前 30 天每次跟主播沟通前把要点写在纸上；每周找老运营过一次带教记录；拿不准的直接问，不装懂。'
  },
  {
    对象: '运营', 分类: '工作节奏', 问题: '主播晚上播，运营作息乱，长期疲惫',
    疏导回复: '运营不是 24 小时保姆。跟播时段提前排，非跟播时段消息集中回。你垮了，你的主播才真没人管。',
    应对动作: '排定每周跟播表并同步给主播；晚上 12 点后非急事次日回；每周至少留一天完全不排跟播。'
  },
  {
    对象: '运营', 分类: '夹在中间', 问题: '管理端催数据，主播又没进展，两头受气',
    疏导回复: '上传下达是你的工作，但焦虑不用夹在中间。管理端要的是真实进度和原因，你把完成度、卡点、明日计划报清楚，就是合格运营。',
    应对动作: '日报固定写清「完成/问题/明日」三项；主播停滞超过 3 天，主动约管理端对齐策略，不等着被问。'
  }
]

// —— 管理者对象：自己要想通的理 + 回去就做的管理动作 ——
export const SEED_MINDSET_MANAGER: Row[] = [
  {
    对象: '管理者', 分类: '招人留人', 问题: '招 10 个走 8 个，觉得招人白招',
    疏导回复: '直播行业新人 60 天留存本来就低，这是漏斗不是失败。算总账：留下 2 个能稳定开播的，就覆盖前面走掉的成本。',
    应对动作: '按 60 天留存率算每月真实用人成本；每周看漏斗（入职→首播→30 天→60 天），哪层漏得多补哪层；初筛口径太宽就收严，不从留人端硬扛。'
  },
  {
    对象: '管理者', 分类: '数据波动', 问题: '整体音浪忽高忽低，睡不着',
    疏导回复: '单个主播波动是常态，你要看的基本盘是「在营主播数 × 人均开播场次」。基本盘在涨，单日波动就是噪声。',
    应对动作: '每周只看三个数：在营人数、总开播场次、60 天留存率；不因单日数据开紧急会；趋势连续 2 周下行才动策略。'
  },
  {
    对象: '管理者', 分类: '批量流失', 问题: '同期进来的一批主播集体打退堂鼓',
    疏导回复: '批量动摇多半是同一个根因：训练太狠、收入预期没管好、或某个负面事件传染。先找根因，逐个硬劝没用。',
    应对动作: '当天分别约谈 2-3 个代表找真实原因；预期问题就开集体通气会讲清 60 天收入节奏；强度问题就调课表；处理完 3 天内逐个回访。'
  },
  {
    对象: '管理者', 分类: '投入焦虑', 问题: '投了不少钱（设备/场地/培训），怕收不回来',
    疏导回复: '孵化是 60 天的生意，前 30 天纯投入是模型的一部分。盯回收周期，不盯单日盈亏。',
    应对动作: '算清单个成熟主播的月均贡献和回收周期；按「在营 N 个成熟主播 = 盈亏平衡」定月度目标；每月复盘一次模型，不天天看账户。'
  },
  {
    对象: '管理者', 分类: '放权与盯人', 问题: '不放心运营，什么都想自己盯，越来越累',
    疏导回复: '你盯得过来 3 个运营，盯不过来 30 个主播。管理端的价值在定规则、看数据、处理例外，不是替运营带主播。',
    应对动作: '列一张决策清单：哪些运营自己定、哪些必须上报，写死；每天只看管理端汇总页；例外事项（离职苗头/停滞 3 天）才介入。'
  },
  {
    对象: '管理者', 分类: '团队冲突', 问题: '运营之间抢主播、互相不服',
    疏导回复: '抢主播说明归属规则没说清。主播归属按录入时的带教运营算，调整必须过管理端，私下抢的一律无效。',
    应对动作: '当场重申归属规则；有争议的查历史带教记录定归属；以后分新人公开透明，按各运营当前负载分，从源头上杜绝抢人。'
  }
]

/** 全部心态种子：主播 18 条 + 运营 8 条 + 管理者 6 条 */
export const SEED_MINDSET: Row[] = [
  ...SEED_MINDSET_STREAMER.map((r) => ({ 对象: '主播', ...r })),
  ...SEED_MINDSET_OPERATOR,
  ...SEED_MINDSET_MANAGER
]

