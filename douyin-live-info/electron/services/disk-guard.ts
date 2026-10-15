// 7×24 录制用的磁盘守卫：算剩余空间、算目录占用、超配额就删最老的录像。
//
// 两条安全线（2026-10-15 补）：
//   1. 只删「我们自己录的文件」——名字必须长成 <主播>_<14位时间戳>_<分段号>.扩展名。
//      录制目录常常是 H:\迅雷下载 这种混合目录，以前只按扩展名删，会误伤别人的视频。
//   2. 正在录 / 正在拆的场次（前缀命中）一个都不动。

import * as fs from 'fs'
import * as path from 'path'
import * as logger from './logger'

const LOG_MODULE = 'DiskGuard'

const REC_EXTS = new Set(['.mp3', '.mp4', '.wav', '.flv', '.ts', '.mkv', '.m4a', '.aac'])

/** 我们的录像命名：<主播>_20261015080405_000.mp4（断流重连分段号会 +1000，所以 3~4 位） */
const OUR_RECORDING_RE = /_\d{14}_\d{3,4}\.[A-Za-z0-9]+$/

export function isOurRecording(fileName: string): boolean {
  return OUR_RECORDING_RE.test(fileName)
}

export interface QuotaOptions {
  /** 受保护的场次前缀（正在录 / 正在拆）：这些文件一个都不动 */
  protectPrefixes?: string[]
}

function protectedFile(name: string, protect: string[]): boolean {
  for (const p of protect) {
    if (p && name.startsWith(p + '_')) return true
  }
  return false
}

/** 目录所在盘还剩多少 GB；读不到就返回 Infinity（不拦） */
export function freeSpaceGB(dir: string): number {
  try {
    const probe = fs.existsSync(dir) ? dir : nearestExisting(path.resolve(dir))
    const st: any = fs.statfsSync(probe)
    const free = Number(st.bsize) * Number(st.bavail)
    return free / 1024 ** 3
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function nearestExisting(p: string): string {
  let cur = p
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(cur)) return cur
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return path.parse(p).root || '.'
}

interface Rec {
  path: string
  size: number
  mtime: number
}

function collect(dir: string, out: Rec[], protect: string[], depth = 0): void {
  if (depth > 2) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      collect(full, out, protect, depth + 1)
      continue
    }
    if (!e.isFile()) continue
    if (!REC_EXTS.has(path.extname(e.name).toLowerCase())) continue
    if (!isOurRecording(e.name)) continue                     // 不是我们录的，永远不碰
    if (protectedFile(e.name, protect)) continue              // 正在录/正在拆的，不碰
    try {
      const st = fs.statSync(full)
      out.push({ path: full, size: st.size, mtime: st.mtimeMs })
    } catch { /* ignore */ }
  }
}

/** 录制目录当前占用（GB），只统计「我们自己录的」文件 */
export function dirSizeGB(dir: string): number {
  const recs: Rec[] = []
  collect(dir, recs, [])
  return recs.reduce((s, r) => s + r.size, 0) / 1024 ** 3
}

/**
 * 超配额就删最老的「我们的录像」。
 * 最近 2 分钟还在写的不动；受保护前缀不动。返回删了多少个、释放了多少 GB。
 */
export function enforceQuota(dir: string, maxGB: number, opts?: QuotaOptions): { deleted: number; freedGB: number } {
  if (!maxGB || maxGB <= 0) return { deleted: 0, freedGB: 0 }
  const protect = opts?.protectPrefixes || []
  const recs: Rec[] = []
  collect(dir, recs, protect)

  let total = recs.reduce((s, r) => s + r.size, 0)
  const limit = maxGB * 1024 ** 3
  if (total <= limit) return { deleted: 0, freedGB: 0 }

  // 老的先删；最近 2 分钟动过的当成「正在录」，跳过
  const now = Date.now()
  recs.sort((a, b) => a.mtime - b.mtime)

  let deleted = 0
  let freed = 0
  for (const r of recs) {
    if (total <= limit) break
    if (now - r.mtime < 2 * 60 * 1000) continue
    try {
      fs.unlinkSync(r.path)
      total -= r.size
      freed += r.size
      deleted++
      logger.info(LOG_MODULE, `超出配额，删除旧录像：${r.path}`)
    } catch (ex) {
      logger.warn(LOG_MODULE, `删除失败：${r.path}`, ex)
    }
  }
  return { deleted, freedGB: freed / 1024 ** 3 }
}
