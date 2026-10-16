import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import * as logger from './logger'

const LOG_MODULE = 'Database'

let dbInstance: SqlJsDatabase | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let dbPromise: Promise<SqlJsDatabase> | null = null

/** 弹幕库里最多写多长的原始数据（完整 protobuf JSON 很大，不封顶库会飞一样涨） */
const MAX_RAW_CHARS = 2000

/** 弹幕保留天数：超过就自动清掉 */
export const RETENTION_DAYS = 30

function getDbPath(): string {
  return path.join(app.getPath('userData'), 'danmu.db')
}

/** SQLite 文件头校验：头部不是 "SQLite format 3" 的一律当坏库处理 */
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

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath)
    if (isSqliteFile(fileBuffer)) {
      dbInstance = new SQL.Database(fileBuffer)
    } else {
      // 库坏了（断电/磁盘异常会造成整文件空字节）：备份后新建，否则每次启动都刷“file is not a database”
      const bad = dbPath + '.bad-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
      try { fs.renameSync(dbPath, bad) } catch { /* 备份失败也不能卡住启动 */ }
      logger.warn(LOG_MODULE, `弹幕库不是有效的 SQLite，已备份为 ${path.basename(bad)} 并新建空库`)
      dbInstance = new SQL.Database()
    }
  } else {
    dbInstance = new SQL.Database()
  }

  return dbInstance
  })().catch((ex) => {
    dbPromise = null   // 加载失败可重试，不要卡死
    throw ex
  })
  return dbPromise
}

function saveDb(db: SqlJsDatabase): void {
  const data = db.export()
  const dbPath = getDbPath()
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  // 先写临时文件再改名：断电/崩溃时不会把原库写坏
  const tmp = dbPath + '.tmp'
  fs.writeFileSync(tmp, Buffer.from(data))
  fs.renameSync(tmp, dbPath)
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (dbInstance) saveDb(dbInstance)
    saveTimer = null
  }, 2000)
}

export async function flushDb(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (dbInstance) saveDb(dbInstance)
}

/** 库里存的是 UTC；界面和导出统一换算成本机时间（以前直接显示，比实际早 8 小时） */
function utcToLocalStamp(ts: string): string {
  if (!ts) return ts
  const d = new Date(ts.replace(' ', 'T') + 'Z')
  if (isNaN(d.getTime())) return ts
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * 清理 N 天前的弹幕（默认 30 天），顺手紧缩文件。
 * 7×24 盯几个直播间，消息会一直涨，不清理早晚吃满盘。
 */
export async function pruneOld(days = RETENTION_DAYS): Promise<{ removed: number }> {
  const db = await getDb()
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').substring(0, 19)
  let removed = 0
  try {
    const rows = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'room_%'")
    if (rows.length > 0) {
      for (const row of rows[0].values) {
        const t = String(row[0])
        try {
          db.run(`DELETE FROM [${t}] WHERE Time < ?`, [cutoff])
          removed += db.getRowsModified()
        } catch { /* 不是我们的表结构就跳过 */ }
      }
    }
    if (removed > 0) {
      try { db.run('VACUUM') } catch { /* ignore */ }
      saveDb(db)
      logger.info(LOG_MODULE, `清理 ${days} 天前的弹幕：删除 ${removed} 条`)
    }
  } catch (ex: any) {
    logger.warn(LOG_MODULE, `清理旧弹幕失败：${ex.message}`)
  }
  return { removed }
}

function safeTableName(roomId: string): string {
  return 'room_' + roomId.replace(/[^a-zA-Z0-9]/g, '')
}

export function initializeTable(roomId: string, nickname: string): void {
  getDb().then(db => {
    const tableName = safeTableName(roomId)
    db.run(`CREATE TABLE IF NOT EXISTS [${tableName}] (
      Id INTEGER PRIMARY KEY AUTOINCREMENT,
      Time TEXT NOT NULL,
      Type TEXT NOT NULL,
      UserName TEXT NOT NULL,
      Content TEXT DEFAULT '',
      GiftName TEXT DEFAULT '',
      GiftCount INTEGER DEFAULT 0,
      GiftPrice INTEGER DEFAULT 0,
      LikeCount INTEGER DEFAULT 0,
      Avatar TEXT DEFAULT '',
      ProfileUrl TEXT DEFAULT '',
      RawData TEXT DEFAULT ''
    )`)

    // Migrate existing tables that lack the new columns
    try { db.run(`ALTER TABLE [${tableName}] ADD COLUMN Avatar TEXT DEFAULT ''`) } catch { /* already exists */ }
    try { db.run(`ALTER TABLE [${tableName}] ADD COLUMN ProfileUrl TEXT DEFAULT ''`) } catch { /* already exists */ }
    try { db.run(`ALTER TABLE [${tableName}] ADD COLUMN RawData TEXT DEFAULT ''`) } catch { /* already exists */ }

    ensureRoomInfoTable(db)
    db.run(`INSERT OR REPLACE INTO room_info (RoomId, Nickname, LastActive) VALUES (?, ?, ?)`,
      [roomId, nickname, new Date().toISOString().replace('T', ' ').substring(0, 19)])
    saveDb(db)
  }).catch((ex) => logger.error(LOG_MODULE, 'initializeTable失败', ex))
}

export interface DanmuInsert {
  type: string
  userName: string
  content: string
  giftName: string
  giftCount: number
  giftPrice: number
  likeCount: number
  avatar: string
  profileUrl: string
  rawData: string
}

export function insertMessage(roomId: string, msg: DanmuInsert): void {
  getDb().then(db => {
    const tableName = safeTableName(roomId)
    // 原始 protobuf JSON 很大，封个顶：不封的话一晚上就能把库撞到几百 MB
    const raw = msg.rawData && msg.rawData.length > MAX_RAW_CHARS
      ? msg.rawData.slice(0, MAX_RAW_CHARS) + '…(截断)'
      : msg.rawData
    db.run(`INSERT INTO [${tableName}] (Time, Type, UserName, Content, GiftName, GiftCount, GiftPrice, LikeCount, Avatar, ProfileUrl, RawData) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [new Date().toISOString().replace('T', ' ').substring(0, 19), msg.type, msg.userName, msg.content, msg.giftName, msg.giftCount, msg.giftPrice, msg.likeCount, msg.avatar, msg.profileUrl, raw])
    scheduleSave()
  }).catch((ex) => logger.error(LOG_MODULE, 'insertMessage失败', ex))
}

export interface DanmuRow {
  time: string
  type: string
  userName: string
  content: string
  giftName: string
  giftCount: number
  giftPrice: number
  likeCount: number
}

/**
 * 取某个房间在指定时间段内的弹幕记录（时间格式跟入库一致：UTC 的 YYYY-MM-DD HH:MM:SS）。
 * 用于把「观众反应」并进拆解素材包。
 */
export async function getDanmuWindow(roomId: string, fromTs: string, toTs: string): Promise<DanmuRow[]> {
  try {
    const db = await getDb()
    const tableName = safeTableName(roomId)
    const rows = db.exec(
      `SELECT Time, Type, UserName, Content, GiftName, GiftCount, LikeCount, GiftPrice FROM [${tableName}] WHERE Time >= ? AND Time <= ? ORDER BY Time ASC`,
      [fromTs, toTs]
    )
    if (!rows.length) return []
    return rows[0].values.map((r: any[]) => ({
      time: String(r[0] || ''),
      type: String(r[1] || ''),
      userName: String(r[2] || ''),
      content: String(r[3] || ''),
      giftName: String(r[4] || ''),
      giftCount: Number(r[5]) || 0,
      giftPrice: Number(r[7]) || 0,
      likeCount: Number(r[6]) || 0
    }))
  } catch (ex: any) {
    logger.warn(LOG_MODULE, `取弹幕时间段失败 roomId=${roomId}：${ex.message}`)
    return []
  }
}

export interface RoomInfo {
  roomId: string
  nickname: string
  lastActive: string
  messageCount: number
  /** 按类型分开的数量：Chat / Gift / Like / Member / Social / Stats
   */
  typeCounts: Record<string, number>
}

export async function getRooms(): Promise<RoomInfo[]> {
  const db = await getDb()
  ensureRoomInfoTable(db)

  const rows = db.exec('SELECT RoomId, Nickname, LastActive FROM room_info ORDER BY LastActive DESC')
  const rooms: RoomInfo[] = []

  if (rows.length > 0) {
    for (const row of rows[0].values) {
      const roomId = row[0] as string
      let messageCount = 0
      const typeCounts: Record<string, number> = {}
      try {
        const tableName = safeTableName(roomId)
        // 一次分组统计：总数 + 各类型数量（历史页要按房间分开列出来）
        const cntRows = db.exec(`SELECT Type, COUNT(*) FROM [${tableName}] GROUP BY Type`)
        if (cntRows.length > 0) {
          for (const r of cntRows[0].values) {
            const t = String(r[0] || 'Other')
            const n = Number(r[1]) || 0
            typeCounts[t] = n
            messageCount += n
          }
        }
      } catch { /* table may not exist */ }

      rooms.push({
        roomId,
        nickname: row[1] as string,
        lastActive: utcToLocalStamp(String(row[2] || '')),
        messageCount,
        typeCounts
      })
    }
  }

  return rooms
}

export interface DanmuRecord {
  id: number
  time: string
  type: string
  userName: string
  content: string
  giftName: string
  giftCount: number
  giftPrice: number
  likeCount: number
  avatar: string
  profileUrl: string
  rawData: string
  displayLine: string
}

export async function getMessages(roomId: string, typeFilter?: string, keyword?: string, username?: string, limit = 2000): Promise<DanmuRecord[]> {
  const db = await getDb()
  const tableName = safeTableName(roomId)
  const whereParts: string[] = []
  const params: any[] = []

  if (typeFilter) { whereParts.push('Type = ?'); params.push(typeFilter) }
  if (keyword) { whereParts.push('(Content LIKE ? OR UserName LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`) }
  if (username) { whereParts.push('UserName LIKE ?'); params.push(`%${username}%`) }

  const whereClause = whereParts.length > 0 ? 'WHERE ' + whereParts.join(' AND ') : ''

  const rows = db.exec(`SELECT Id, Time, Type, UserName, Content, GiftName, GiftCount, GiftPrice, LikeCount, Avatar, ProfileUrl, RawData FROM [${tableName}] ${whereClause} ORDER BY Id DESC LIMIT ${limit}`, params)

  const messages: DanmuRecord[] = []
  if (rows.length > 0) {
    for (const row of rows[0].values) {
      const type = row[2] as string
      const userName = (row[3] as string) || ''
      const content = (row[4] as string) || ''
      const giftName = (row[5] as string) || ''
      const giftCount = (row[6] as number) || 0
      const likeCount = (row[8] as number) || 0

      messages.push({
        id: row[0] as number,
        time: utcToLocalStamp(String(row[1] || '')),
        type,
        userName,
        content,
        giftName,
        giftCount,
        giftPrice: (row[7] as number) || 0,
        likeCount,
        avatar: (row[9] as string) || '',
        profileUrl: (row[10] as string) || '',
        rawData: (row[11] as string) || '',
        displayLine: getDisplayLine(type, userName, content, giftName, giftCount, likeCount)
      })
    }
  }

  messages.reverse()
  return messages
}

function getDisplayLine(type: string, userName: string, content: string, giftName: string, giftCount: number, likeCount: number): string {
  switch (type) {
    case 'Chat': return `${userName}: ${content}`
    case 'Gift': return `${userName} 赠送 ${giftName} x${giftCount}`
    case 'Member': return `${userName} 进入直播间`
    case 'Like': return `${userName} 点赞了 ${likeCount} 次`
    case 'Social': return `${userName} 关注了主播`
    case 'Stats': return content
    default: return content
  }
}

export async function getAllMessagesForExport(roomId: string, nickname: string, typeFilter?: string, keyword?: string, username?: string): Promise<DanmuRecord[]> {
  return getMessages(roomId, typeFilter, keyword, username, 999999)
}

export async function clearAll(): Promise<void> {
  const db = await getDb()
  const rows = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'room_%'")
  if (rows.length > 0) {
    for (const row of rows[0].values) {
      db.run(`DROP TABLE IF EXISTS [${row[0]}]`)
    }
  }
  try { db.run('DELETE FROM room_info WHERE 1=1') } catch { /* ignore */ }
  saveDb(db)
}

function ensureRoomInfoTable(db: SqlJsDatabase): void {
  db.run(`CREATE TABLE IF NOT EXISTS room_info (
    RoomId TEXT PRIMARY KEY,
    Nickname TEXT DEFAULT '',
    LastActive TEXT DEFAULT ''
  )`)
}
