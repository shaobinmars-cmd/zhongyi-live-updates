/**
 * 公网更新：读 latest.json（支持单文件 url 或分卷 parts），下载/合并/校验/静默安装。
 * Gitee 单文件限 100MB，所以安装包按 90MB 分卷上传，App 自动拼回去。
 */
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import axios from 'axios'
import { app } from 'electron'
import { spawn } from 'child_process'
import * as logger from './logger'

const LOG = 'Updater'

function updatesDir(): string {
  const base = String(process.env.LOCALAPPDATA || app.getPath('userData'))
  const dir = path.join(base, 'douyin-live-info', 'updates')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function freeBytes(dir: string): number {
  try {
    const st = (fs as any).statfsSync(dir)
    return Number(st.bavail) * Number(st.bsize)
  } catch {
    return 0
  }
}

function pruneOldSetups(keep: string): void {
  try {
    const files = fs.readdirSync(updatesDir())
      .filter((f) => /^zhongyi-setup-.+\.exe$/i.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(updatesDir(), f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    for (const old of files.slice(2)) {
      if (old.f === keep) continue
      try { fs.unlinkSync(path.join(updatesDir(), old.f)) } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

export interface Manifest {
  version: string
  url?: string
  parts?: string[]
  sha256?: string
  notes?: string
  size?: number
}

function cmp(a: string, b: string): number {
  const x = String(a || '').split('.').map((n) => parseInt(n, 10) || 0)
  const y = String(b || '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0)
    if (d) return d
  }
  return 0
}

function manifestCandidates(source: string): string[] {
  const url = String(source || '').trim()
  if (!/zhongyi-live-updates.*latest\.json/i.test(url)) return [url]
  const raw = 'https://raw.githubusercontent.com/shaobinmars-cmd/zhongyi-live-updates/main/latest.json'
  return Array.from(new Set([
    'https://ghfast.top/' + raw,
    'https://ghproxy.net/' + raw,
    'https://gh-proxy.com/' + raw,
    raw,
    url
  ]))
}
export async function checkUrl(url: string): Promise<any> {

  if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false, message: '更新源必须是 http(s) 地址' }
  let lastError = ''
  for (const candidate of manifestCandidates(url)) {
    try {
      const res = await axios.get(candidate, { timeout: 20000, headers: { 'Cache-Control': 'no-cache' } })
      const m = res.data as Manifest
      if (!m || !m.version || (!m.url && !(Array.isArray(m.parts) && m.parts.length))) {
        lastError = '更新清单格式不对（需要 version 和 url 或 parts）'
        continue
      }
      const newer = cmp(m.version, app.getVersion()) > 0
      logger.info(LOG, `检查更新：当前 ${app.getVersion()}，最新 ${m.version}，来源 ${candidate}`)
      return {
        ok: true, current: app.getVersion(), latest: m.version, newer,
        url: m.url || '', parts: m.parts || [], sha256: m.sha256 || '',
        notes: m.notes || '', size: m.size || 0,
        message: newer ? `发现新版本 ${m.version}` : `已是最新版本 ${app.getVersion()}`
      }
    } catch (ex: any) {
      lastError = String(ex?.message || ex || '连接失败')
    }
  }
  return { ok: false, message: '连不上更新源：' + (lastError || '所有入口均失败') }
}

/** 国内访问 GitHub 经常超时：内置三个加速前缀，直连失败就自动换 */
const GITHUB_PROXIES = ['https://ghfast.top/', 'https://ghproxy.net/', 'https://gh-proxy.com/']
function proxied(url: string, i: number): string {
  if (!/github\.com|githubusercontent\.com/i.test(url)) return url
  return GITHUB_PROXIES[i] + url
}

async function downloadTo(url: string, file: string, offset: number, total: number, onPct?: (p: number) => void): Promise<number> {
  let lastErr: any = null
  const isGithub = /github\.com|githubusercontent\.com/i.test(url)
  const targets = isGithub
    ? [proxied(url, 0), proxied(url, 1), proxied(url, 2), url]
    : [url]
  for (const target of targets) {
    try {
      logger.info(LOG, `下载更新包：${target}`)
      const res = await axios.get(target, {
        responseType: 'stream',
        timeout: 45_000,
        maxContentLength: 500 * 1024 * 1024,
        maxBodyLength: Infinity,
        headers: { 'User-Agent': 'Zhongyi-Updater', 'Cache-Control': 'no-cache' }
      })
      const len = Number(res.headers['content-length'] || 0) || 0
      const all = total || len || 0
      let got = 0
      await new Promise<void>((resolve, reject) => {
        const ws = fs.createWriteStream(file, { flags: 'a' })
        res.data.on('data', (c: Buffer) => {
          got += c.length
          if (all) onPct?.(Math.min(99, Math.round((offset + got) / all * 100)))
        })
        res.data.on('error', reject)
        ws.on('error', reject)
        ws.on('finish', () => resolve())
        res.data.pipe(ws)
      })
      return got
    } catch (ex) {
      lastErr = ex
      try { fs.unlinkSync(file) } catch { /* ignore */ }
    }
  }
  throw lastErr || new Error('下载失败')
}

export async function downloadManifest(m: Manifest, onPct?: (p: number) => void): Promise<any> {
  const out = path.join(updatesDir(), `zhongyi-setup-${String(m.version || 'new').replace(/[^\w.-]/g, '_')}.exe`)
  try {
    try { fs.unlinkSync(out) } catch { /* ignore */ }
    const expected = Number(m.size) || 0
    const need = Math.max(2 * 1024 ** 3, expected * 2 + 512 * 1024 ** 2)
    const free = freeBytes(updatesDir())
    if (free > 0 && free < need) {
      return { ok: false, message: `磁盘空间不足：更新至少需要 ${(need / 1024 ** 3).toFixed(1)} GB，当前只剩 ${(free / 1024 ** 3).toFixed(1)} GB。先清理磁盘再更新。` }
    }
    onPct?.(0)
    let offset = 0
    if (Array.isArray(m.parts) && m.parts.length) {
      for (const u of m.parts) offset += await downloadTo(u, out, offset, Number(m.size) || 0, onPct)
    } else if (m.url) {
      await downloadTo(m.url, out, 0, Number(m.size) || 0, onPct)
    } else {
      return { ok: false, message: '清单里没有下载地址' }
    }
    if (expected > 0 && fs.statSync(out).size !== expected) {
      try { fs.unlinkSync(out) } catch { /* ignore */ }
      return { ok: false, message: '下载文件大小不对，已删除，请重试。' }
    }
    if (m.sha256) {
      const h = crypto.createHash('sha256')
      h.update(fs.readFileSync(out))
      if (h.digest('hex').toLowerCase() !== String(m.sha256).toLowerCase()) {
        try { fs.unlinkSync(out) } catch { /* ignore */ }
        return { ok: false, message: '文件校验失败（下载不完整），请重试' }
      }
    }
    onPct?.(100)
    pruneOldSetups(path.basename(out))
    logger.info(LOG, `更新包下载完成：${out}`)
    return { ok: true, path: out, message: '下载完成' }
  } catch (ex: any) {
    try { fs.unlinkSync(out) } catch { /* ignore */ }
    return { ok: false, message: '下载失败：' + (ex?.message || ex) }
  }
}

export function install(file: string): any {
  try {
    if (!file || !fs.existsSync(file)) return { ok: false, message: '更新包不存在，请重新下载。' }
    if (fs.statSync(file).size < 100 * 1024 * 1024) return { ok: false, message: '更新包不完整，请重新下载。' }
    spawn(file, ['/S'], { detached: true, stdio: 'ignore' }).unref()
    setTimeout(() => app.quit(), 1200)
    return { ok: true }
  } catch (ex: any) {
    return { ok: false, message: String(ex?.message || ex) }
  }
}
