import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

// 日志和授权、配置文件放在同一个数据目录（main.ts 里钉死为 %APPDATA%\douyin-live-info），
// 这样以后改软件的显示名字，日志位置不会跟着变。
function logDir(): string {
  return path.join(app.getPath('userData'), 'logs')
}

/** 只保留最近多少天的日志（7×24 常年跑，不清理会越堆越多） */
const KEEP_DAYS = 14

let logStream: fs.WriteStream | null = null
let currentDate = ''
let cleaned = false

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 本机时间戳。以前用 UTC（日志里 08:18 对应本地 16:18），排查问题时对不上号。 */
function timestamp(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

function localDay(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 删掉太老的日志文件（只在当天第一次写日志时做一次） */
function cleanOldLogs(): void {
  if (cleaned) return
  cleaned = true
  try {
    const dir = logDir()
    const files = fs.readdirSync(dir).filter((f) => /^app_\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort()
    const keep = new Set(files.slice(-KEEP_DAYS))
    for (const f of files) {
      if (!keep.has(f)) {
        try { fs.unlinkSync(path.join(dir, f)) } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

function getLogStream(): fs.WriteStream {
  const today = localDay()
  if (logStream && today === currentDate) return logStream

  if (logStream) logStream.end()
  fs.mkdirSync(logDir(), { recursive: true })
  cleanOldLogs()
  currentDate = today
  logStream = fs.createWriteStream(path.join(logDir(), `app_${today}.log`), { flags: 'a' })
  // 磁盘写满、文件被占用时不能让整个程序崩掉
  logStream.on('error', () => { /* 日志写不进去也不能影响主功能 */ })
  return logStream
}

export function info(module: string, msg: string): void {
  try {
    const line = `[${timestamp()}] [INFO] [${module}] ${msg}\n`
    getLogStream().write(line)
  } catch { /* logging should never crash */ }
}

export function warn(module: string, msg: string, ex?: unknown): void {
  try {
    const detail = ex instanceof Error ? `${ex.message}\n${ex.stack || ''}` : ex ? String(ex) : ''
    const line = `[${timestamp()}] [WARN] [${module}] ${msg}${detail ? ' — ' + detail : ''}\n`
    getLogStream().write(line)
  } catch { /* logging should never crash */ }
}

export function error(module: string, msg: string, ex?: unknown): void {
  try {
    const detail = ex instanceof Error ? `${ex.message}\n${ex.stack || ''}` : ex ? String(ex) : ''
    const line = `[${timestamp()}] [ERROR] [${module}] ${msg}${detail ? ' — ' + detail : ''}\n`
    getLogStream().write(line)
  } catch { /* logging should never crash */ }
}
