/** 直播平台识别与通用平台拉流。抖音仍走专用接口，其余公开页面用内置 yt-dlp。 */
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'
import * as logger from './logger'

const LOG = 'PlatformLive'

export type PlatformId = 'douyin' | 'bilibili' | 'tiktok' | 'kuaishou' | 'xiaohongshu' | 'other'

export interface GenericRoomInfo {
  platform: PlatformId
  platformLabel: string
  url: string
  enterRoomId: string
  nickname: string
  title: string
  roomStatus: number
  likeCount: number
  viewCount: number
  error: string
}

export function detectPlatform(url: string): PlatformId {
  const s = String(url || '').toLowerCase()
  if (/live\.douyin\.com|douyin\.com/.test(s)) return 'douyin'
  if (/bilibili\.com|b23\.tv/.test(s)) return 'bilibili'
  if (/tiktok\.com/.test(s)) return 'tiktok'
  if (/kuaishou\.com/.test(s)) return 'kuaishou'
  if (/xiaohongshu\.com|xhslink\.com/.test(s)) return 'xiaohongshu'
  return 'other'
}

export function platformLabel(platform: string): string {
  return ({
    douyin: '抖音',
    bilibili: 'B站',
    tiktok: 'TikTok',
    kuaishou: '快手',
    xiaohongshu: '小红书',
    other: '其他平台'
  } as Record<string, string>)[platform] || '其他平台'
}

function stableId(url: string): string {
  return 'p_' + crypto.createHash('sha1').update(String(url || '')).digest('hex').slice(0, 18)
}

function roomHint(url: string, platform: PlatformId): string {
  try {
    const u = new URL(url)
    const seg = u.pathname.split('/').filter(Boolean).pop() || u.hostname
    return `${platformLabel(platform)} ${seg.slice(0, 28)}`
  } catch {
    return platformLabel(platform)
  }
}

/** 非抖音平台先立即入列；真正录制时再由 yt-dlp 解析拉流地址。 */
export function genericRoomInfo(url: string, platform: PlatformId): GenericRoomInfo {
  return {
    platform,
    platformLabel: platformLabel(platform),
    url,
    enterRoomId: stableId(url),
    nickname: roomHint(url, platform),
    title: `${platformLabel(platform)} · 待录制时解析`,
    roomStatus: 1,
    likeCount: 0,
    viewCount: 0,
    error: ''
  }
}

function findPython(): string {
  const candidates: string[] = []
  try {
    const res = (process as any).resourcesPath
    if (res) candidates.push(path.join(res, 'engine', 'python-embed', 'python.exe'))
  } catch { /* ignore */ }
  candidates.push(path.join(process.cwd(), '..', '直播拆解引擎', 'python-embed', 'python.exe'))
  candidates.push('H:\\众艺传媒运营工具\\直播拆解引擎\\python-embed\\python.exe')
  candidates.push(path.join(process.cwd(), 'python-embed', 'python.exe'))
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p } catch { /* ignore */ }
  }
  return 'python'
}

function isDirectMedia(url: string): boolean {
  return /\.(m3u8|flv|mp4|ts|mov|mkv)(\?|#|$)/i.test(url)
}

function ytDlpDirect(url: string, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve) => {
    const py = findPython()
    const child = spawn(py, [
      '-m', 'yt_dlp', '--no-playlist', '--no-warnings', '--skip-download',
      '-f', 'b', '-g', url
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* ignore */ }
      resolve('')
    }, timeoutMs)
    child.stdout?.on('data', (b: Buffer) => { out += b.toString('utf-8') })
    child.stderr?.on('data', (b: Buffer) => { err = (err + b.toString('utf-8')).slice(-2000) })
    child.on('error', () => { clearTimeout(timer); resolve('') })
    child.on('exit', (code) => {
      clearTimeout(timer)
      const line = out.split(/\r?\n/).map((x) => x.trim()).find((x) => /^https?:\/\//i.test(x)) || ''
      if (!line) logger.warn(LOG, `通用拉流解析失败 code=${code} ${err.slice(-300)}`)
      resolve(line)
    })
  })
}

/** 解析非抖音直播页面的拉流地址。公开直播优先；平台要求登录时会返回空并在界面提示。 */
export async function resolveGenericPullUrl(url: string): Promise<{ success: boolean; pullUrl: string; nickname: string }> {
  if (!/^https?:\/\//i.test(String(url || ''))) return { success: false, pullUrl: '', nickname: '' }
  const pullUrl = isDirectMedia(url) ? url : await ytDlpDirect(url)
  return {
    success: !!pullUrl,
    pullUrl,
    nickname: ''
  }
}
