/**
 * AI 共享：把老板这台机器的 AI 接口开放给运营用。
 *
 * 背景：老板的 Codex 走的是本机代理（127.0.0.1:57321），只有本机能连。
 * 运营在自己电脑上装同一套 App，但填的是老板电脑的地址（局域网 IP + 端口），
 * 由这个小服务器转发给老板机器上的 AI 接口 —— 密钥只留在老板机器上，不用发给运营。
 *
 * 用法：设置页打开「分享给运营」，把显示的地址和口令发给运营即可。
 * 运营在自己 App 的设置页填：接口地址 = http://192.168.x.x:57888/v1，密钥 = 口令。
 */

import * as http from 'http'
import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { app } from 'electron'
import axios from 'axios'
import { loadAiConfig, AiConfig } from './ai-analyze'
import * as logger from './logger'

const LOG_MODULE = 'AiShare'

export interface ShareClient {
  name: string
  token: string
  createdAt: string
  requests: number
  charsIn: number
  tokensIn: number
  tokensOut: number
  lastUsedAt: string
  lastError: string
  enabled: boolean
}

export interface ShareConfig {
  enabled: boolean
  port: number
  clients: ShareClient[]
}

export const DEFAULT_SHARE: ShareConfig = { enabled: false, port: 57888, clients: [] }

function configPath(): string {
  return path.join(app.getPath('userData'), 'share.json')
}

export function loadShare(): ShareConfig {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), 'utf-8'))
    return {
      enabled: !!saved.enabled,
      port: Number(saved.port) || DEFAULT_SHARE.port,
      clients: Array.isArray(saved.clients) ? saved.clients : []
    }
  } catch {
    return { ...DEFAULT_SHARE, clients: [] }
  }
}

export function saveShare(cfg: ShareConfig): ShareConfig {
  try {
    fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf-8')
  } catch (ex: any) {
    logger.warn(LOG_MODULE, `保存共享配置失败：${ex.message}`)
  }
  return cfg
}

/** 给一个运营发密钥（一人一个，用量分开记） */
export function addClient(name: string): ShareClient {
  const cfg = loadShare()
  const client: ShareClient = {
    name: name || `运营${cfg.clients.length + 1}`,
    token: 'zy-' + crypto.randomBytes(12).toString('hex'),
    createdAt: new Date().toLocaleString('zh-CN'),
    requests: 0, charsIn: 0, tokensIn: 0, tokensOut: 0,
    lastUsedAt: '', lastError: '', enabled: true
  }
  cfg.clients.push(client)
  saveShare(cfg)
  logger.info(LOG_MODULE, `新增一个运营密钥：${client.name}`)
  return client
}

/** 批量发密钥：一次输入一批名字（一行一个） */
export function addClients(names: string[]): ShareClient[] {
  const out: ShareClient[] = []
  for (const n of names) {
    const name = String(n || '').trim()
    if (name) out.push(addClient(name))
  }
  return out
}

export function removeClient(token: string): ShareConfig {
  const cfg = loadShare()
  cfg.clients = cfg.clients.filter((c) => c.token !== token)
  return saveShare(cfg)
}

export function resetAllClients(): ShareConfig {
  const cfg = loadShare()
  for (const c of cfg.clients) {
    c.requests = 0; c.charsIn = 0; c.tokensIn = 0; c.tokensOut = 0
    c.lastUsedAt = ''; c.lastError = ''
  }
  return saveShare(cfg)
}

/** 按密钥记账 */
function touchClient(token: string, patch: Partial<ShareClient>): void {
  const cfg = loadShare()
  const c = cfg.clients.find((x) => x.token === token)
  if (!c) return
  if (patch.requests) c.requests += patch.requests
  if (patch.charsIn) c.charsIn += patch.charsIn
  if (patch.tokensIn) c.tokensIn += patch.tokensIn
  if (patch.tokensOut) c.tokensOut += patch.tokensOut
  if (patch.lastUsedAt) c.lastUsedAt = patch.lastUsedAt
  if (patch.lastError !== undefined) c.lastError = patch.lastError
  saveShare(cfg)
}

let server: http.Server | null = null
let activePort = 0
let requestCount = 0

/** 本机在局域网里的 IPv4（给运营填地址用） */
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

export function shareStatus(): { running: boolean; port: number; addresses: string[]; requests: number; baseUrl: string } {
  const cfg = loadShare()
  const ips = lanAddresses()
  return {
    running: !!server,
    port: activePort || cfg.port,
    addresses: ips,
    requests: requestCount,
    baseUrl: `http://${ips[0] || '本机IP'}:${activePort || cfg.port}/v1`
  }
}

function upstreamChatUrl(cfg: AiConfig): string {
  const base = (cfg.baseUrl || '').trim().replace(/\/+$/, '')
  return base.endsWith('/chat/completions') ? base : base + '/chat/completions'
}

async function forward(body: any): Promise<{ status: number; data: any }> {
  const cfg = loadAiConfig()
  const url = upstreamChatUrl(cfg)
  if (!url) return { status: 500, data: { error: { message: '本机还没配置 AI 接口（设置页里填）' } } }

  // 模型名统一用本机配置的，运营那边填什么都不影响
  const payload = { ...body, model: cfg.model, stream: false }

  const res = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    timeout: 15 * 60 * 1000,
    validateStatus: () => true
  })
  return { status: res.status, data: res.data }
}

export function stopShare(): void {
  if (server) {
    try { server.close() } catch { /* ignore */ }
    server = null
    activePort = 0
    logger.info(LOG_MODULE, 'AI 共享已停止')
  }
}

export function startShare(cfg: ShareConfig): Promise<{ ok: boolean; message: string }> {
  stopShare()
  if (!cfg.enabled) return Promise.resolve({ ok: true, message: '已关闭' })

  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const send = (code: number, obj: any) => {
        const text = typeof obj === 'string' ? obj : JSON.stringify(obj)
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(text)
      }

      if (req.method === 'GET' && /\/health$/.test(req.url || '')) {
        return send(200, { ok: true, service: '众艺传媒 AI 共享', clients: loadShare().clients.length })
      }
      if (req.method !== 'POST' || !/\/chat\/completions/.test(req.url || '')) {
        return send(404, { error: { message: '只支持 POST /v1/chat/completions' } })
      }

      const auth = String(req.headers.authorization || '')
      const token = auth.replace(/^Bearer\s+/i, '').trim()
      const client = loadShare().clients.find((c) => c.token === token && c.enabled)
      if (!client) {
        logger.warn(LOG_MODULE, `拒绝一个无效密钥：${auth.slice(0, 14)}…`)
        return send(401, { error: { message: '密钥无效（找管理员要一个新的）' } })
      }

      let raw = ''
      let tooBig = false
      req.on('data', (chunk) => {
        raw += chunk
        if (raw.length > 64 * 1024 * 1024) {   // 64MB 上限，防呆
          tooBig = true
          req.destroy()
        }
      })
      req.on('end', async () => {
        if (tooBig) return
        let body: any = {}
        try { body = JSON.parse(raw) } catch { return send(400, { error: { message: '请求体不是 JSON' } }) }
        const chars = (body.messages || []).reduce((n: number, m: any) => n + String(m.content || '').length, 0)
        const now = new Date().toLocaleString('zh-CN')
        requestCount++
        logger.info(LOG_MODULE, `${client.name} 发起分析（${chars} 字），转发给本机 AI…`)
        try {
          const r = await forward(body)
          const usage = r.data?.usage || {}
          touchClient(token, {
            requests: 1,
            charsIn: chars,
            tokensIn: Number(usage.prompt_tokens) || 0,
            tokensOut: Number(usage.completion_tokens) || 0,
            lastUsedAt: now,
            lastError: r.status >= 400 ? `HTTP ${r.status}` : ''
          })
          logger.info(LOG_MODULE, `${client.name} 完成，上游 HTTP ${r.status}，用量 in/out=${usage.prompt_tokens || 0}/${usage.completion_tokens || 0}`)
          send(r.status, r.data)
        } catch (ex: any) {
          touchClient(token, { requests: 1, charsIn: chars, lastUsedAt: now, lastError: String(ex?.message || ex).slice(0, 80) })
          logger.warn(LOG_MODULE, `${client.name} 转发失败：${ex.message}`)
          send(502, { error: { message: '转发到 AI 失败：' + String(ex?.message || ex) } })
        }
      })
    })

    srv.on('error', (ex: any) => {
      logger.warn(LOG_MODULE, `AI 共享启动失败：${ex.message}`)
      resolve({ ok: false, message: `启动失败：${ex.message}（端口可能被占用）` })
    })

    srv.listen(cfg.port, '0.0.0.0', () => {
      server = srv
      activePort = cfg.port
      const ips = lanAddresses()
      logger.info(LOG_MODULE, `AI 共享已启动，端口 ${cfg.port}，${cfg.clients.length} 个密钥，地址 ${ips.map((i) => `http://${i}:${cfg.port}/v1`).join(' / ')}`)
      resolve({ ok: true, message: '已开启，运营填：' + (ips[0] ? `http://${ips[0]}:${cfg.port}/v1` : `http://本机IP:${cfg.port}/v1`) })
    })
  })
}
