import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

// 日志和授权、配置文件放在同一个数据目录（main.ts 里钉死为 %APPDATA%\douyin-live-info），
// 这样以后改软件的显示名字，日志位置不会跟着变。
function logDir(): string {
  return path.join(app.getPath('userData'), 'logs')
}

let logStream: fs.WriteStream | null = null
let currentDate = ''

function getLogStream(): fs.WriteStream {
  const today = new Date().toISOString().substring(0, 10)
  if (logStream && today === currentDate) return logStream

  if (logStream) logStream.end()
  fs.mkdirSync(logDir(), { recursive: true })
  currentDate = today
  logStream = fs.createWriteStream(path.join(logDir(), `app_${today}.log`), { flags: 'a' })
  return logStream
}

function timestamp(): string {
  return new Date().toISOString()
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
