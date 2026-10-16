// 离线签名授权 + 可选在线吊销名单。
//
// 你（管理员）保留 tools\授权密钥\私钥.pem，用它给每个运营签发一份「授权.json」；
// 程序里只内置公钥，验证签名、机器码和到期日。
// 想立刻停掉某个运营：把他的机器码写进「吊销名单」（共享盘文件或一个网址），
// 程序启动时会去读一次，读到就拒绝使用。

import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execSync } from 'child_process'
import { app } from 'electron'
import * as logger from './logger'

const LOG_MODULE = 'License'

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAyhmO5Y4fQQ48nxZdNldxtWhFn3cVlxl7k8RhDfIdzJ0=
-----END PUBLIC KEY-----`

export interface LicensePayload {
  v: number
  机器码: string
  运营: string
  单位: string
  签发: string
  到期: string
  备注: string
}

export interface LicenseStatus {
  licensed: boolean
  reason: string
  machineCode: string
  payload: LicensePayload | null
  daysLeft: number | null
  source: string
  revoked?: boolean
}

const PAYLOAD_KEYS = ['v', '机器码', '运营', '单位', '签发', '到期', '备注']

let cachedMachineCode: string | null = null

/** 机器码：取自 Windows 的 MachineGuid，重装系统才会变 */
export function machineCode(): string {
  if (cachedMachineCode) return cachedMachineCode
  let raw = ''
  try {
    const out = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
      encoding: 'utf-8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    })
    const m = /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/i.exec(out)
    if (m) raw = m[1]
  } catch { /* 读不到就退化成硬件指纹 */ }
  if (!raw) raw = `${os.hostname()}|${os.cpus()?.[0]?.model || ''}|${os.totalmem()}`
  const h = crypto.createHash('sha256').update(raw.trim().toUpperCase()).digest('hex').toUpperCase()
  cachedMachineCode = (h.slice(0, 20).match(/.{4}/g) || []).join('-')
  return cachedMachineCode
}

function canonical(obj: any): string {
  const out: Record<string, any> = {}
  for (const k of PAYLOAD_KEYS) out[k] = obj?.[k] ?? ''
  return JSON.stringify(out)
}

function parseDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return isNaN(d.getTime()) ? null : d
}

/** 授权文件可能放在这些位置，按顺序找 */
function licensePaths(): string[] {
  const list: string[] = []
  const push = (p?: string) => { if (p) list.push(p) }
  try { push(path.join(path.dirname(app.getPath('exe')), '授权.json')) } catch { /* ignore */ }
  try { push(path.join(process.resourcesPath, '授权.json')) } catch { /* ignore */ }
  try { push(path.join(app.getAppPath(), '授权.json')) } catch { /* ignore */ }
  try { push(path.join(app.getPath('userData'), '授权.json')) } catch { /* ignore */ }
  push(path.join(process.cwd(), '授权.json'))
  return list
}

export function verifyLicense(text: string, source = ''): LicenseStatus {
  const mc = machineCode()
  const base: LicenseStatus = {
    licensed: false, reason: '', machineCode: mc, payload: null, daysLeft: null, source
  }

  let obj: any
  try {
    obj = JSON.parse(String(text).replace(/^\uFEFF/, ''))
  } catch {
    return { ...base, reason: '授权文件不是合法的 JSON' }
  }

  const sig = obj?.签名
  if (!sig) return { ...base, reason: '授权文件缺少签名' }

  let ok = false
  try {
    ok = crypto.verify(null, Buffer.from(canonical(obj), 'utf-8'), PUBLIC_KEY, Buffer.from(String(sig), 'base64'))
  } catch {
    ok = false
  }
  if (!ok) return { ...base, payload: obj, reason: '签名校验失败（文件被改过，或不是本程序签发的）' }

  const p = obj as LicensePayload
  if (p.机器码 !== '*' && String(p.机器码).trim().toUpperCase() !== mc) {
    return { ...base, payload: p, reason: `这份授权是签给另一台机器的（${p.机器码}）` }
  }

  const due = parseDay(p.到期)
  if (!due) return { ...base, payload: p, reason: '到期日格式不对，应为 2027-12-31' }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const daysLeft = Math.floor((due.getTime() - today.getTime()) / 86400000)
  if (daysLeft < 0) {
    return { ...base, payload: p, daysLeft, reason: `授权已于 ${p.到期} 到期，请联系管理员续期` }
  }

  return { licensed: true, reason: '', machineCode: mc, payload: p, daysLeft, source }
}

export function loadLicense(): LicenseStatus {
  for (const p of licensePaths()) {
    try {
      if (!fs.existsSync(p)) continue
      const text = fs.readFileSync(p, 'utf-8')
      const st = verifyLicense(text, p)
      if (st.licensed || st.payload) return st
    } catch { /* ignore */ }
  }
  return {
    licensed: false,
    reason: '本机还没有授权文件',
    machineCode: machineCode(),
    payload: null,
    daysLeft: null,
    source: ''
  }
}

/** 把授权内容存到 userData（免安装目录可能是只读的） */
export function saveLicense(text: string): LicenseStatus {
  const st = verifyLicense(text, '')
  if (!st.licensed) return st
  const dest = path.join(app.getPath('userData'), '授权.json')
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, String(text), 'utf-8')
  } catch (ex) {
    logger.warn(LOG_MODULE, '保存授权失败', ex)
  }
  logger.info(LOG_MODULE, `激活成功 运营=${st.payload?.运营} 到期=${st.payload?.到期} 机器码=${st.machineCode}`)
  return { ...st, source: dest }
}

export function readLicenseFile(p: string): LicenseStatus {
  try {
    return verifyLicense(fs.readFileSync(p, 'utf-8'), p)
  } catch (ex: any) {
    return {
      licensed: false, reason: `读不了这个文件：${ex.message}`, machineCode: machineCode(),
      payload: null, daysLeft: null, source: p
    }
  }
}

// ------------------------------------------------------------ 吊销名单（可选）

async function readRevokeSource(src: string): Promise<string | null> {
  const s = String(src || '').trim()
  if (!s) return null
  try {
    if (/^https?:\/\//i.test(s)) {
      const res = await fetch(s, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return null
      return await res.text()
    }
    if (fs.existsSync(s)) return fs.readFileSync(s, 'utf-8')
  } catch { /* 读不到就当作没吊销 */ }
  return null
}

/**
 * 启动时查一次吊销名单。名单可以是共享盘上的 txt，也可以是一个网址。
 * 每行一个机器码（# 开头为注释）。读不到就放行，保证断网能用。
 */
export async function checkRevoked(revokeSource: string): Promise<boolean> {
  if (!revokeSource) return false
  const text = await readRevokeSource(revokeSource)
  if (!text) return false
  const mc = machineCode().toUpperCase()
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    if (t.toUpperCase() === mc) {
      logger.warn(LOG_MODULE, `机器码 ${mc} 在吊销名单中，已停用`)
      return true
    }
  }
  return false
}
