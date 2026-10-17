/**
 * 运营这一端：把本机数据汇总给老板机 + 从老板机升版本。
 *
 * 走局域网（老板机上开的是 collect-server）。
 *
 * 地址不用运营填：直接拿「AI 共享」里那个地址的主机名，端口默认 57889；
 * 密钥也复用那把 zy-xxx。也就是说 —— 只要运营已经在用老板的 AI 共享，
 * 汇总和升级就自动能用，不用再配一次。
 *
 * 只传数据 + 报告，不传录像（一场好几个 G，传不动也没必要）。
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as zlib from 'zlib'
import * as crypto from 'crypto'
import * as http from 'http'
import * as dgram from 'dgram'
import * as https from 'https'
import { spawn } from 'child_process'
import { app } from 'electron'
import { loadAiConfig } from './ai-analyze'
import { loadLicense } from './license'
import { loadConfig as loadRecordConfig, getEffectiveOutputPath } from './record-config'
import { load as loadTdConfig } from './teardown-config'
import { listRecordings, packetPathFor } from './teardown'
import * as logger from './logger'

const LOG_MODULE = 'CollectClient'

/** 默认汇总端口（和老板机上 collect-server 的默认值保持一致） */
const DEFAULT_COLLECT_PORT = 57889

/** 单个 AI 报告最多带多少字，全部报告加起来最多多少字（防止一次传几十 MB） */
const MAX_REPORT_CHARS = 200 * 1024
const MAX_REPORTS_TOTAL = 5 * 1024 * 1024

export interface ClientConfig {
  /** 留空 = 自动从 AI 共享的地址推导 */
  serverUrl: string
  /** 留空 = 自动用 AI 共享的密钥 */
  token: string
  /** 每天自动上报 */
  autoDaily: boolean
  lastSentAt: number
  lastResult: string
}

export const DEFAULT_CLIENT: ClientConfig = {
  serverUrl: '', token: '', autoDaily: true, lastSentAt: 0, lastResult: ''
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'collect-client.json')
}

/** 是不是局域网地址（192.168 / 10 / 172.16-31 / 本机） */
function isLanHost(host: string): boolean {
  const h = String(host || '').toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' ||
    /^192\.168\./.test(h) || /^10\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
}

export function loadClientConfig(): ClientConfig {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), 'utf-8'))
    return {
      serverUrl: typeof saved.serverUrl === 'string' ? saved.serverUrl : '',
      token: typeof saved.token === 'string' ? saved.token : '',
      autoDaily: saved.autoDaily !== false,
      lastSentAt: Number(saved.lastSentAt) || 0,
      lastResult: typeof saved.lastResult === 'string' ? saved.lastResult : ''
    }
  } catch {
    return { ...DEFAULT_CLIENT }
  }
}

export function saveClientConfig(patch: Partial<ClientConfig>): ClientConfig {
  const next = { ...loadClientConfig(), ...patch }
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true })
    fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf-8')
  } catch (ex: any) {
    logger.warn(LOG_MODULE, `保存汇总设置失败：${ex.message}`)
  }
  return next
}

/** 算出要连哪台机器：优先用自己填的，没填就从 AI 共享地址里取主机名 */
export function resolveServer(): { url: string; token: string; fromAi: boolean } {
  const c = loadClientConfig()
  const ai = loadAiConfig()
  let url = (c.serverUrl || '').trim().replace(/\/+$/, '')
  const token = (c.token || '').trim() || (ai.apiKey || '').trim()
  let fromAi = false
  if (!url && ai.baseUrl) {
    try {
      const u = new URL(ai.baseUrl)
      // 只能「推导」局域网地址：AI 里填的是 api.deepseek.com 这种公网地址时
      // （运营用自己密钥的情况），推出来就是 http://api.deepseek.com:57889，根本发不通。
      // 这种就当“没配”，让界面明说要去填。
      if (isLanHost(u.hostname)) {
        url = `http://${u.hostname}:${DEFAULT_COLLECT_PORT}`
        fromAi = true
      }
    } catch { /* 地址不合法就当没填 */ }
  }
  return { url, token, fromAi }
}

/** 听老板机的广播，找出它现在在哪台机器上（IP 变了也能找到） */
function discoverServer(timeoutMs = 5000): Promise<string> {
  return new Promise((resolve) => {
    let done = false
    let sock: dgram.Socket | null = null
    const finish = (v: string) => {
      if (done) return
      done = true
      try { sock?.close() } catch { /* ignore */ }
      resolve(v)
    }
    try {
      sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
      sock.on('message', (msg, rinfo) => {
        try {
          const j = JSON.parse(msg.toString('utf-8'))
          if (j && j.zy === 'collect' && j.port) finish(`http://${rinfo.address}:${j.port}`)
        } catch { /* 不是我们的广播，忽略 */ }
      })
      sock.on('error', () => finish(''))
      sock.bind(57890, () => { setTimeout(() => finish(''), timeoutMs) })
    } catch {
      finish('')
    }
  })
}

/** 这个地址活着吗 */
function pingHealth(base: string): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const fin = (v: boolean) => { if (!done) { done = true; resolve(v) } }
    try {
      const t = new URL('/health', base)
      const lib = t.protocol === 'https:' ? https : http
      const req = lib.get({ hostname: t.hostname, port: t.port || 80, path: t.pathname, timeout: 5000 }, (r) => {
        r.resume()
        fin((r.statusCode || 0) === 200)
      })
      req.on('timeout', () => { req.destroy(); fin(false) })
      req.on('error', () => fin(false))
    } catch {
      fin(false)
    }
  })
}

/**
 * 先试已配的地址；不通就在局域网里找老板机（IP 变了也能找到），
 * 找到就把新地址存下来 —— 运营以后不用再管地址。
 */
async function resolveReachable(): Promise<{ url: string; token: string }> {
  const r = resolveServer()
  if (r.url && await pingHealth(r.url)) return r
  const found = await discoverServer()
  if (found) {
    saveClientConfig({ serverUrl: found })
    logger.info(LOG_MODULE, `自动找到老板机：${found}`)
    return { url: found, token: r.token }
  }
  return r
}

// ---------------------------------------------------------------- 打包本机数据

function readB64(p: string): string {
  try {
    if (!fs.existsSync(p)) return ''
    const st = fs.statSync(p)
    if (!st.isFile() || st.size === 0 || st.size > 300 * 1024 * 1024) return ''
    return fs.readFileSync(p).toString('base64')
  } catch {
    return ''
  }
}

function readJson(p: string): any {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return null }
}

/** 本机的场次清单：录了什么、拆没拆、有没有 AI 报告 */
function buildSessions(): { 场次: any[]; 报告: { 场次: string; 内容: string }[] } {
  const 场次: any[] = []
  const 报告: { 场次: string; 内容: string }[] = []
  let budget = MAX_REPORTS_TOTAL

  let list: any[] = []
  try { list = listRecordings() } catch { /* 列不出来就只报数据 */ }

  for (const rec of list) {
    const row: any = {
      名字: rec.name,
      主播: rec.nickname,
      大小MB: Math.round((Number(rec.sizeBytes) || 0) / 1024 / 1024),
      录制时间: new Date(Number(rec.mtime) || 0).toLocaleString('zh-CN'),
      已拆解: !!rec.analyzed
    }

    // 拆解产物：直接挑 AI 分析报告（素材包太大，不传）
    try {
      const workDir = rec.packetPath ? path.dirname(rec.packetPath) : ''
      if (workDir) {
        const rep = path.join(workDir, 'AI分析报告.md')
        if (fs.existsSync(rep)) {
          let text = fs.readFileSync(rep, 'utf-8')
          if (text.length > MAX_REPORT_CHARS) text = text.slice(0, MAX_REPORT_CHARS) + '\n\n…（过长已截断）'
          if (budget - text.length > 0) {
            报告.push({ 场次: rec.name, 内容: text })
            budget -= text.length
            row.有AI报告 = true
          } else {
            row.有AI报告 = true
            row.备注 = '报告太多，这次没能全部带上，下次上报会补'
          }
        }
        const seg = path.join(workDir, '分段统计.md')
        if (fs.existsSync(seg)) row.有分段统计 = true
      }
    } catch { /* 单个场次读不动不影响别的 */ }

    场次.push(row)
  }
  return { 场次, 报告 }
}

export interface CollectResult { ok: boolean; message: string; bytes?: number; saved?: string }

export async function collectNow(): Promise<CollectResult> {
  const { url, token } = await resolveReachable()
  if (!url) return { ok: false, message: '还没填汇总地址（设置页里填，或先配好 AI 共享地址）' }
  if (!token) return { ok: false, message: '还没有密钥（找管理员要一个）' }

  const userData = app.getPath('userData')
  const license = loadLicense()
  const rec = loadRecordConfig()

  const { 场次, 报告 } = buildSessions()
  const payload = {
    运营: license.payload?.运营 || os.hostname(),
    机器码: license.machineCode,
    版本: app.getVersion(),
    时间: new Date().toLocaleString('zh-CN'),
    数据: {
      danmuDb: readB64(path.join(userData, 'danmu.db')),
      incubateDb: readB64(path.join(userData, 'incubate.db')),
      // 注意：不带 ai.json（里面有密钥）
      配置: {
        录制: { ...rec, outputPath: getEffectiveOutputPath(rec) },
        拆解: loadTdConfig()
      },
      场次,
      报告
    }
  }

  let body: Buffer
  try {
    body = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf-8'), { level: 6 })
  } catch (ex: any) {
    return { ok: false, message: '打包数据失败：' + ex.message }
  }

  const target = new URL('/collect', url)
  const res = await new Promise<{ code: number; text: string }>((resolve, reject) => {
    const lib = target.protocol === 'https:' ? https : http
    const req = lib.request({
      hostname: target.hostname,
      port: target.port || 80,
      path: target.pathname,
      method: 'POST',
      timeout: 120000,
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'Content-Length': String(body.length),
        Authorization: `Bearer ${token}`
      }
    }, (r) => {
      let text = ''
      r.setEncoding('utf-8')
      r.on('data', (c) => { text += c })
      r.on('end', () => resolve({ code: r.statusCode || 0, text }))
    })
    req.on('timeout', () => req.destroy(new Error('上报超时（老板那台可能没开汇总服务）')))
    req.on('error', reject)
    req.write(body)
    req.end()
  }).catch((ex: any) => ({ code: 0, text: String(ex?.message || ex) }))

  const saved = (() => {
    try { return JSON.parse(res.text)?.saved || '' } catch { return '' }
  })()

  const ok = res.code === 200
  const message = ok
    ? `上报成功（${(body.length / 1024 / 1024).toFixed(1)} MB）`
    : `上报失败（HTTP ${res.code || '无'}）：${res.text.slice(0, 160)}`

  saveClientConfig({ lastSentAt: Date.now(), lastResult: message })
  logger.info(LOG_MODULE, `${message}${saved ? ' → ' + saved : ''}`)
  return { ok, message, bytes: body.length, saved }
}

// ---------------------------------------------------------------- 检查 / 一键升级

export interface UpdateCheck { ok: boolean; message: string; hasNew?: boolean; version?: string; size?: number; name?: string }

/** 问老板那台：最新版是多少 */
export async function checkUpdate(): Promise<UpdateCheck> {
  const { url } = await resolveReachable()
  if (!url) return { ok: false, message: '还没填汇总地址' }
  const target = new URL('/update/info', url)
  const res = await new Promise<{ code: number; text: string }>((resolve, reject) => {
    const lib = target.protocol === 'https:' ? https : http
    const req = lib.get({
      hostname: target.hostname, port: target.port || 80, path: target.pathname, timeout: 15000
    }, (r) => {
      let text = ''
      r.setEncoding('utf-8')
      r.on('data', (c) => { text += c })
      r.on('end', () => resolve({ code: r.statusCode || 0, text }))
    })
    req.on('timeout', () => req.destroy(new Error('连不上老板那台（检查是不是同一个局域网、服务有没有开）')))
    req.on('error', reject)
  }).catch((ex: any) => ({ code: 0, text: String(ex?.message || ex) }))

  if (res.code !== 200) return { ok: false, message: `没查到版本：${res.text.slice(0, 120)}` }

  let info: any = null
  try { info = JSON.parse(res.text) } catch { return { ok: false, message: '版本信息看不懂' } }

  const cur = app.getVersion()
  const cmp = (a: string, b: string) => {
    const pa = a.split('.').map(Number)
    const pb = b.split('.').map(Number)
    for (let i = 0; i < 3; i++) {
      const d = (pa[i] || 0) - (pb[i] || 0)
      if (d) return d
    }
    return 0
  }
  const hasNew = cmp(String(info.version || '0'), cur) > 0
  return {
    ok: true,
    hasNew,
    version: String(info.version || ''),
    size: Number(info.size) || 0,
    name: String(info.name || ''),
    message: hasNew
      ? `有新版本 ${info.version}（当前 ${cur}），${Math.round((Number(info.size) || 0) / 1024 / 1024)} MB`
      : `已经是最新版（${cur}）`
  }
}

export interface UpdateApply { ok: boolean; message: string; path?: string }

/**
 * 下载新版本，然后：等本程序退出 → 静默安装 → 再把程序拉起来。
 * 直接在本进程里跑安装包不行：文件是锁着的，装不进去。
 */
export async function applyUpdate(): Promise<UpdateApply> {
  const { url } = resolveServer()
  if (!url) return { ok: false, message: '还没填汇总地址' }

  const info = await checkUpdate()
  if (!info.ok) return { ok: false, message: info.message }
  if (!info.hasNew) return { ok: false, message: info.message }

  const target = new URL('/update/download', url)
  const dest = path.join(os.tmpdir(), `zy-update-${info.version}.exe`)

  const downloaded = await new Promise<{ ok: boolean; message: string }>((resolve) => {
    const lib = target.protocol === 'https:' ? https : http
    const req = lib.get({
      hostname: target.hostname, port: target.port || 80, path: target.pathname, timeout: 300000
    }, (r) => {
      if (r.statusCode !== 200) { resolve({ ok: false, message: `下载失败 HTTP ${r.statusCode}` }); return }
      const out = fs.createWriteStream(dest)
      r.pipe(out)
      out.on('finish', () => resolve({ ok: true, message: '下载完成' }))
      out.on('error', (e) => resolve({ ok: false, message: '写文件失败：' + e.message }))
    })
    req.on('timeout', () => req.destroy(new Error('下载超时')))
    req.on('error', (e) => resolve({ ok: false, message: '下载失败：' + e.message }))
  })
  if (!downloaded.ok) return { ok: false, message: downloaded.message }

  // 校验（服务端给了校验和才校验）
  try {
    const st = fs.statSync(dest)
    if (st.size < 1024 * 1024) return { ok: false, message: '下载到的文件不完整，请重试' }
  } catch {
    return { ok: false, message: '下载到的文件找不到了，请重试' }
  }

  const exePath = process.execPath
  const cmd = `timeout /t 4 /nobreak >nul & "${dest}" /S & timeout /t 40 /nobreak >nul & start "" "${exePath}"`
  logger.info(LOG_MODULE, `准备升级到 ${info.version}：${cmd}`)
  try {
    spawn('cmd', ['/c', cmd], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } catch (ex: any) {
    return { ok: false, message: '启动安装程序失败：' + ex.message }
  }
  return { ok: true, message: `已开始升级到 ${info.version}，程序会自动关掉再打开（大约 1 分钟）`, path: dest }
}

/** 从当前 AI 共享的地址里把汇总地址/密钥补上（一键） */
export function adoptFromAi(): ClientConfig {
  const ai = loadAiConfig()
  const cur = loadClientConfig()
  const patch: Partial<ClientConfig> = {}
  // 只有 AI 地址本身就是局域网时才推得出汇总地址。
  // 以前没判断：AI 填的是 api.deepseek.com 时，这里存成了
  // http://api.deepseek.com:57889，谁也连不上（运营机上就撞过这个）。
  let lanUrl = ''
  try {
    const u = new URL(ai.baseUrl || '')
    if (isLanHost(u.hostname)) lanUrl = `http://${u.hostname}:${DEFAULT_COLLECT_PORT}`
  } catch { /* 地址不合法就当没填 */ }
  // 存的不是局域网地址就纠正过来（包括以前存错的老值）
  const curHost = (cur.serverUrl || '').replace(/^https?:\/\//, '').split(':')[0]
  if (lanUrl && !isLanHost(curHost)) patch.serverUrl = lanUrl
  if (!cur.token && ai.apiKey) patch.token = ai.apiKey
  return saveClientConfig(patch)
}

/** 需要时用一下，避免 tree-shaking 把 packetPathFor 去掉（它被用于推导 work 目录） */
export const _packetPathFor = packetPathFor

/** 本机机器码（界面上显示用） */
export function machineCode(): string {
  try { return loadLicense().machineCode } catch { return '' }
}

/** 兜底：确保 crypto 被引用（下载校验留作后续扩展） */
export const _sha256 = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex')
