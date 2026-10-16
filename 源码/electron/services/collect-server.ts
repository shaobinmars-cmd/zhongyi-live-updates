/**
 * 局域网「数据汇总 + 升级分发」——老板机这一端。
 *
 * 为什么走局域网：不碰公网、不用开路由器端口，运营就在同一栋楼里，
 * 速度和稳定性都比走百度网盘强。
 *
 * 这个服务干三件事：
 *   1) 收数据：运营那台每天把「弹幕库 + 孵化库 + 场次清单 + AI 报告」打包 POST 上来，
 *      落盘到  %APPDATA%\douyin-live-info\汇总\<运营名>\<时间>\  。录像不上传。
 *   2) 发版本：把升级包放进一个目录，运营那台联网问一句「最新版是多少」，
 *      有新版就下载（局域网内 280MB 几秒钟）。
 *   3) 报活：/health 用来确认这台机器的服务是不是开着。
 *
 * 密钥复用「AI 共享」里发出去的那把（一人一个 zy-xxx）：
 * 运营那边只要已经在用老板的 AI 共享，汇总和升级就自动能用，不用再配一次。
 */

import * as http from 'http'
import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'
import * as zlib from 'zlib'
import * as crypto from 'crypto'
import { app } from 'electron'
import { loadShare } from './ai-server'
import * as logger from './logger'

const LOG_MODULE = 'CollectServer'

export interface CollectConfig {
  enabled: boolean
  port: number
  /** 升级包放哪个目录（里面放 "…Setup 2.6.0.exe" 这种文件） */
  updateDir: string
}

export const DEFAULT_COLLECT: CollectConfig = { enabled: false, port: 57889, updateDir: '' }

function configPath(): string {
  return path.join(app.getPath('userData'), 'collect.json')
}

export function loadCollect(): CollectConfig {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), 'utf-8'))
    return {
      enabled: !!saved.enabled,
      port: Number(saved.port) || DEFAULT_COLLECT.port,
      updateDir: typeof saved.updateDir === 'string' ? saved.updateDir : ''
    }
  } catch {
    return { ...DEFAULT_COLLECT }
  }
}

export function saveCollect(patch: Partial<CollectConfig>): CollectConfig {
  const next = { ...loadCollect(), ...patch }
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true })
    fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf-8')
  } catch (ex: any) {
    logger.warn(LOG_MODULE, `保存汇总配置失败：${ex.message}`)
  }
  return next
}

/** 收到的数据放这里：汇总\<运营名>\<时间>\ */
export function inboxRoot(): string {
  return path.join(app.getPath('userData'), '汇总')
}

export function lanAddresses(): string[] {
  const out: string[] = []
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family === 'IPv4' && !info.internal) out.push(info.address)
    }
  }
  return out
}

// ---------------------------------------------------------------- 升级包

interface UpdateInfo { name: string; version: string; size: number; sha256: string; file: string }

let cached: { key: string; info: UpdateInfo } | null = null

/** 升级包目录里最新的那个安装包（文件名里带 x.y.z） */
function findNewestSetup(): UpdateInfo | null {
  const dir = loadCollect().updateDir
  if (!dir || !fs.existsSync(dir)) return null
  let best: { file: string; version: string; mtime: number; size: number } | null = null
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!/\.exe$/i.test(name)) continue
      const m = /(\d+\.\d+\.\d+)/.exec(name)
      if (!m) continue
      const full = path.join(dir, name)
      let st: fs.Stats
      try { st = fs.statSync(full) } catch { continue }
      if (!st.isFile() || st.size < 1024 * 1024) continue
      if (!best || st.mtimeMs > best.mtime) best = { file: full, version: m[1], mtime: st.mtimeMs, size: st.size }
    }
  } catch { /* 目录读不到就算了 */ }
  if (!best) return null

  // 280MB 的包每次请求都算一遍 sha256 太慢：按 路径+大小+改动时间 缓存
  const key = `${best.file}|${best.size}|${best.mtime}`
  if (cached && cached.key === key) return cached.info

  let sha = ''
  try {
    sha = crypto.createHash('sha256').update(fs.readFileSync(best.file)).digest('hex')
  } catch { /* 算不了就不带校验和，客户端会跳过校验 */ }

  const info: UpdateInfo = { name: path.basename(best.file), version: best.version, size: best.size, sha256: sha, file: best.file }
  cached = { key, info }
  return info
}

// ---------------------------------------------------------------- 服务

let server: http.Server | null = null
let activePort = 0
let received = 0

export function shareStatus(): { running: boolean; port: number; addresses: string[]; received: number; baseUrl: string } {
  const cfg = loadCollect()
  const ips = lanAddresses()
  return {
    running: !!server,
    port: activePort || cfg.port,
    addresses: ips,
    received,
    baseUrl: `http://${ips[0] || '本机IP'}:${activePort || cfg.port}`
  }
}

export function stopShare(): void {
  if (server) {
    try { server.close() } catch { /* ignore */ }
    server = null
    activePort = 0
    logger.info(LOG_MODULE, '数据汇总服务已停止')
  }
}

function send(res: http.ServerResponse, code: number, obj: any): void {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(text)
}

/** 运营名做目录名：去掉不能当文件名的字符 */
function safeName(v: string): string {
  return (v || '未命名').replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+$/, '_').slice(0, 40)
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function startShare(cfg: CollectConfig): Promise<{ ok: boolean; message: string }> {
  stopShare()
  if (!cfg.enabled) return Promise.resolve({ ok: true, message: '已关闭' })

  try { fs.mkdirSync(inboxRoot(), { recursive: true }) } catch { /* ignore */ }

  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = req.url || ''

      if (req.method === 'GET' && /\/health$/.test(url)) {
        return send(res, 200, { ok: true, service: '众艺传媒 数据汇总', received })
      }

      // 升级：运营那台先问「最新版是多少」，再下载
      if (req.method === 'GET' && /\/update\/info$/.test(url)) {
        const info = findNewestSetup()
        if (!info) return send(res, 404, { error: { message: '管理员还没放升级包' } })
        return send(res, 200, { version: info.version, name: info.name, size: info.size, sha256: info.sha256 })
      }
      if (req.method === 'GET' && /\/update\/download$/.test(url)) {
        const info = findNewestSetup()
        if (!info) return send(res, 404, { error: { message: '管理员还没放升级包' } })
        logger.info(LOG_MODULE, `有运营在下载升级包：${info.name}`)
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(info.size),
          'Content-Disposition': `attachment; filename="${encodeURIComponent(info.name)}"`
        })
        fs.createReadStream(info.file).pipe(res)
        return
      }

      // 收数据
      if (req.method !== 'POST' || !/\/collect$/.test(url)) {
        return send(res, 404, { error: { message: '只支持 GET /health、/update/info、/update/download 和 POST /collect' } })
      }

      const auth = String(req.headers.authorization || '')
      const token = auth.replace(/^Bearer\s+/i, '').trim()
      const client = loadShare().clients.find((c) => c.token === token && c.enabled)
      if (!client) {
        logger.warn(LOG_MODULE, `拒绝一个无效密钥：${auth.slice(0, 14)}…`)
        return send(res, 401, { error: { message: '密钥无效（找管理员要一个新的）' } })
      }

      const chunks: Buffer[] = []
      let size = 0
      let tooBig = false
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size > 512 * 1024 * 1024) {   // 512MB 上限，防呆
          tooBig = true
          req.destroy()
          return
        }
        chunks.push(c)
      })
      req.on('end', () => {
        if (tooBig) return
        let raw: Buffer = Buffer.concat(chunks)
        try {
          if ((req.headers['content-encoding'] || '') === 'gzip') raw = zlib.gunzipSync(raw)
        } catch (ex: any) {
          logger.warn(LOG_MODULE, `解压失败：${ex.message}`)
          return send(res, 400, { error: { message: '数据解压失败' } })
        }

        let payload: any
        try { payload = JSON.parse(raw.toString('utf-8')) } catch {
          return send(res, 400, { error: { message: '数据不是合法 JSON' } })
        }

        // 落盘：汇总\<运营名>\<时间>\ ...
        const who = safeName(payload?.运营 || client.name)
        const dir = path.join(inboxRoot(), who, stamp())
        try {
          fs.mkdirSync(dir, { recursive: true })
          const data = payload?.数据 || {}
          const written: string[] = []

          if (typeof data.danmuDb === 'string' && data.danmuDb) {
            fs.writeFileSync(path.join(dir, '弹幕库.db'), Buffer.from(data.danmuDb, 'base64'))
            written.push('弹幕库.db')
          }
          if (typeof data.incubateDb === 'string' && data.incubateDb) {
            fs.writeFileSync(path.join(dir, '孵化库.db'), Buffer.from(data.incubateDb, 'base64'))
            written.push('孵化库.db')
          }
          if (data.配置) {
            fs.writeFileSync(path.join(dir, '本机配置.json'), JSON.stringify(data.配置, null, 2), 'utf-8')
            written.push('本机配置.json')
          }
          if (Array.isArray(data.场次) && data.场次.length) {
            fs.writeFileSync(path.join(dir, '场次清单.json'), JSON.stringify(data.场次, null, 2), 'utf-8')
            written.push('场次清单.json')
          }
          if (Array.isArray(data.报告) && data.报告.length) {
            const rdir = path.join(dir, 'AI报告')
            fs.mkdirSync(rdir, { recursive: true })
            for (const r of data.报告) {
              const n = safeName(String(r?.场次 || '未命名'))
              fs.writeFileSync(path.join(rdir, `${n}.md`), String(r?.内容 || ''), 'utf-8')
            }
            written.push(`AI报告(${data.报告.length})`)
          }
          fs.writeFileSync(path.join(dir, '说明.txt'),
            `运营：${payload?.运营 || client.name}\r\n` +
            `密钥名：${client.name}\r\n` +
            `机器码：${payload?.机器码 || ''}\r\n` +
            `软件版本：${payload?.版本 || ''}\r\n` +
            `上报时间：${new Date().toLocaleString('zh-CN')}\r\n` +
            `收到：${written.join('、')}\r\n`, 'utf-8')
        } catch (ex: any) {
          logger.warn(LOG_MODULE, `保存上报数据失败：${ex.message}`)
          return send(res, 500, { error: { message: '服务端保存失败：' + ex.message } })
        }

        received++
        logger.info(LOG_MODULE, `${who} 上报成功：${size} 字节 → ${dir}`)
        send(res, 200, { ok: true, saved: dir })
      })
    })

    srv.on('error', (ex: any) => {
      logger.warn(LOG_MODULE, `汇总服务启动失败：${ex.message}`)
      resolve({ ok: false, message: `启动失败：${ex.message}（端口可能被占用）` })
    })

    srv.listen(cfg.port, '0.0.0.0', () => {
      server = srv
      activePort = cfg.port
      const ips = lanAddresses()
      logger.info(LOG_MODULE, `数据汇总服务已启动，端口 ${cfg.port}，地址 ${ips.map((i) => `http://${i}:${cfg.port}`).join(' / ')}`)
      resolve({ ok: true, message: '已开启，运营那台填：' + (ips[0] ? `http://${ips[0]}:${cfg.port}` : `http://本机IP:${cfg.port}`) })
    })
  })
}
