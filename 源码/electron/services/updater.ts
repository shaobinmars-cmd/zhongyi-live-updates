/**
 * 公网更新：读 latest.json（支持单文件 url 或分卷 parts），下载/合并/校验/静默安装。
 * Gitee 单文件限 100MB，所以安装包按 90MB 分卷上传，App 自动拼回去。
 */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import axios from 'axios'
import { app } from 'electron'
import { spawn } from 'child_process'
import * as logger from './logger'

const LOG = 'Updater'

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

export async function checkUrl(url: string): Promise<any> {
  if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false, message: '更新源必须是 http(s) 地址' }
  try {
    const res = await axios.get(url, { timeout: 30000, headers: { 'Cache-Control': 'no-cache' } })
    const m = res.data as Manifest
    if (!m || !m.version || (!m.url && !(Array.isArray(m.parts) && m.parts.length))) {
      return { ok: false, message: '更新清单格式不对（需要 version 和 url 或 parts）' }
    }
    const newer = cmp(m.version, app.getVersion()) > 0
    logger.info(LOG, `检查更新：当前 ${app.getVersion()}，最新 ${m.version}`)
    return {
      ok: true, current: app.getVersion(), latest: m.version, newer,
      url: m.url || '', parts: m.parts || [], sha256: m.sha256 || '',
      notes: m.notes || '', size: m.size || 0,
      message: newer ? `发现新版本 ${m.version}` : `已是最新版本 ${app.getVersion()}`
    }
  } catch (ex: any) {
    return { ok: false, message: '连不上更新源：' + (ex?.message || ex) }
  }
}

async function downloadTo(url: string, file: string, offset: number, total: number, onPct?: (p: number) => void): Promise<number> {
  const res = await axios.get(url, { responseType: 'stream', timeout: 0, maxContentLength: 500 * 1024 * 1024, maxBodyLength: Infinity })
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
}

export async function downloadManifest(m: Manifest, onPct?: (p: number) => void): Promise<any> {
  const out = path.join(os.tmpdir(), `zhongyi-setup-${m.version}-${Date.now()}.exe`)
  try {
    try { fs.unlinkSync(out) } catch { /* ignore */ }
    let offset = 0
    if (Array.isArray(m.parts) && m.parts.length) {
      for (const u of m.parts) offset += await downloadTo(u, out, offset, Number(m.size) || 0, onPct)
    } else if (m.url) {
      await downloadTo(m.url, out, 0, Number(m.size) || 0, onPct)
    } else {
      return { ok: false, message: '清单里没有下载地址' }
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
    logger.info(LOG, `更新包下载完成：${out}`)
    return { ok: true, path: out, message: '下载完成' }
  } catch (ex: any) {
    return { ok: false, message: '下载失败：' + (ex?.message || ex) }
  }
}

export function install(file: string): any {
  try {
    spawn(file, ['/S'], { detached: true, stdio: 'ignore' }).unref()
    setTimeout(() => app.quit(), 1200)
    return { ok: true }
  } catch (ex: any) {
    return { ok: false, message: String(ex?.message || ex) }
  }
}
