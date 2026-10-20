/** GitHub 私有数据仓库同步：运营下班后自动上传，老板端生成各类报表。 */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as https from 'https'
import { spawn } from 'child_process'
import { app } from 'electron'
import { engineStatus } from './teardown'
import { flushIncubate } from './incubate'
import { loadLicense } from './license'
import * as logger from './logger'

const LOG_MODULE = 'GithubSync'
let timer: ReturnType<typeof setInterval> | null = null
let firstTimer: ReturnType<typeof setTimeout> | null = null
let running = false

export interface SyncConfig {
  owner: string
  repo: string
  token: string
  operator: string
  autoDaily: boolean
  bossMode: boolean
  lastUploadAt: number
  lastReportDate: string
  lastResult: string
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'sync.json')
}

function readConfigPath(): string {
  const primary = configPath()
  if (fs.existsSync(primary)) return primary
  const deployed = path.join(app.getPath('appData'), 'douyin-live-info', 'sync.json')
  return fs.existsSync(deployed) ? deployed : primary
}

function defaultOperator(): string {
  try { return String(loadLicense().payload?.运营 || os.hostname()) } catch { return os.hostname() }
}

export function loadSyncConfig(): SyncConfig {
  try {
    const s = JSON.parse(fs.readFileSync(readConfigPath(), 'utf-8').replace(/^\uFEFF/, ''))
    return {
      owner: String(s.owner || 'shaobinmars-cmd'),
      repo: String(s.repo || 'zhongyi-data'),
      token: String(s.token || ''),
      operator: String(s.operator || defaultOperator()),
      autoDaily: s.autoDaily !== false,
      bossMode: s.bossMode === true,
      lastUploadAt: Number(s.lastUploadAt) || 0,
      lastReportDate: String(s.lastReportDate || ''),
      lastResult: String(s.lastResult || '')
    }
  } catch {
    return {
      owner: 'shaobinmars-cmd', repo: 'zhongyi-data', token: '',
      operator: defaultOperator(), autoDaily: true, bossMode: false,
      lastUploadAt: 0, lastReportDate: '', lastResult: ''
    }
  }
}

export function saveSyncConfig(patch: Partial<SyncConfig>): SyncConfig {
  const next = { ...loadSyncConfig(), ...patch }
  next.owner = String(next.owner || '').trim()
  next.repo = String(next.repo || '').trim()
  next.token = String(next.token || '').trim()
  next.operator = String(next.operator || '').trim() || defaultOperator()
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true })
    fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf-8')
  } catch (ex: any) {
    logger.warn(LOG_MODULE, `保存同步配置失败：${ex.message}`)
  }
  return next
}

function toolsDir(): string {
  const packed = path.join(process.resourcesPath, 'tools')
  if (fs.existsSync(packed)) return packed
  const dev = path.resolve(app.getAppPath(), '..', 'tools')
  if (fs.existsSync(dev)) return dev
  return path.join(app.getAppPath(), 'tools')
}

export interface SyncRunResult {
  ok: boolean
  message: string
  output: string[]
}

function runPython(file: string, args: string[] = []): Promise<SyncRunResult> {
  return new Promise(async (resolve) => {
    const status = engineStatus()
    const script = path.join(toolsDir(), file)
    if (!status.python || !fs.existsSync(status.python)) {
      return resolve({ ok: false, message: '找不到内置 Python，无法同步数据。', output: [] })
    }
    if (!fs.existsSync(script)) {
      return resolve({ ok: false, message: `安装包缺少同步脚本：${file}，请重新安装最新版。`, output: [] })
    }
    const lines: string[] = []
    let child
    try {
      child = spawn(status.python, [script, ...args], {
        cwd: toolsDir(),
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
          APPDATA: process.env.APPDATA || app.getPath('appData')
        },
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (ex: any) {
      return resolve({ ok: false, message: String(ex?.message || ex), output: [] })
    }
    let all = ''
    const consume = (b: Buffer): void => {
      const text = b.toString('utf-8')
      all += text
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) lines.push(line.trim())
      }
    }
    child.stdout?.on('data', consume)
    child.stderr?.on('data', consume)
    child.on('error', (err) => {
      resolve({ ok: false, message: err.message, output: lines })
    })
    child.on('exit', (code) => {
      const ok = code === 0
      resolve({
        ok,
        message: ok ? (lines[lines.length - 1] || '同步完成') : `同步失败（退出码 ${code}）：${all.slice(-500)}`,
        output: lines.slice(-80)
      })
    })
  })
}

export async function syncNow(): Promise<SyncRunResult> {
  if (running) return { ok: false, message: '正在同步，请稍候。', output: [] }
  const cfg = loadSyncConfig()
  if (!cfg.token) return { ok: false, message: '还没有填 GitHub 数据仓库令牌。', output: [] }
  if (!cfg.owner || !cfg.repo) return { ok: false, message: 'GitHub 仓库配置不完整。', output: [] }
  running = true
  try {
    await flushIncubate()
    const r = await runPython('自动上传数据.py', ['--operator', cfg.operator])
    saveSyncConfig({
      lastUploadAt: r.ok ? Date.now() : (cfg.lastUploadAt || 0),
      lastResult: r.message
    })
    logger.info(LOG_MODULE, r.message)
    return r
  } finally {
    running = false
  }
}

export async function generateReports(): Promise<SyncRunResult> {
  if (running) return { ok: false, message: '正在处理，请稍候。', output: [] }
  const cfg = loadSyncConfig()
  if (!cfg.token) return { ok: false, message: '还没有填 GitHub 数据仓库令牌。', output: [] }
  running = true
  try {
    const r = await runPython('生成报表.py')
    saveSyncConfig(r.ok ? { lastReportDate: new Date().toISOString().slice(0, 10), lastResult: r.message } : { lastResult: r.message })
    logger.info(LOG_MODULE, r.message)
    return r
  } finally {
    running = false
  }
}

function githubGet(pathname: string, token: string): Promise<{ code: number; text: string }> {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.github.com',
      path: pathname,
      method: 'GET',
      timeout: 20_000,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Zhongyi-Sync-Test'
      }
    }, (res) => {
      let text = ''
      res.setEncoding('utf-8')
      res.on('data', (chunk) => { text += chunk })
      res.on('end', () => resolve({ code: res.statusCode || 0, text }))
    })
    req.on('timeout', () => req.destroy(new Error('GitHub 连接超时')))
    req.on('error', (ex) => resolve({ code: 0, text: ex.message }))
    req.end()
  })
}

export async function testConnection(): Promise<SyncRunResult> {
  const cfg = loadSyncConfig()
  if (!cfg.owner || !cfg.repo) return { ok: false, message: '仓库所有者或仓库名未填写', output: [] }
  if (!cfg.token) return { ok: false, message: '还没有填写 GitHub 数据仓库令牌', output: [] }
  const repoPath = '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo)
  const repoRes = await githubGet(repoPath, cfg.token)
  if (repoRes.code !== 200) return { ok: false, message: `仓库连接失败（HTTP ${repoRes.code}）：${repoRes.text.slice(0, 200)}`, output: [repoRes.text] }
  let repo: any = {}
  try { repo = JSON.parse(repoRes.text) } catch { /* ignore */ }
  const canPush = repo?.permissions?.push === true
  const dataRes = await githubGet(repoPath + '/contents/data?ref=main', cfg.token)
  const dataOk = dataRes.code === 200 || dataRes.code === 404
  if (!dataOk) return { ok: false, message: `仓库能进，但 data 目录读取失败（HTTP ${dataRes.code}）`, output: [dataRes.text] }
  const message = canPush
    ? `上传通道正常：${cfg.owner}/${cfg.repo} 可读写，data 目录可访问，当前运营：${cfg.operator}`
    : `仓库可以连接，但令牌没有写入权限；请换有 Contents: Read and write 的令牌`
  saveSyncConfig({ lastResult: message })
  return { ok: canPush, message, output: [message] }
}

export function startAutoSync(): void {
  if (timer) return
  const tick = () => {
    const c = loadSyncConfig()
    const today = new Date().toISOString().slice(0, 10)
    if (c.bossMode && c.token && c.lastReportDate !== today) {
      generateReports().catch(() => { /* 下小时重试 */ })
    }
    if (!c.autoDaily || !c.token) return
    if (Date.now() - (c.lastUploadAt || 0) < 20 * 60 * 60 * 1000) return
    syncNow().catch(() => { /* 下小时再试 */ })
  }
  firstTimer = setTimeout(tick, 60 * 1000)
  timer = setInterval(tick, 60 * 60 * 1000)
}

export function stopAutoSync(): void {
  if (firstTimer) clearTimeout(firstTimer)
  if (timer) clearInterval(timer)
  firstTimer = null
  timer = null
}
