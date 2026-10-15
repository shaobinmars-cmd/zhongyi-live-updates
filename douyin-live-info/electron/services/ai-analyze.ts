/**
 * AI 分析：把素材包直接发给 AI，出拆解报告。
 *
 * 以前是「运营把素材包发给老板 → 老板贴给 Codex」，现在 App 里点一下就能出报告。
 * 接口按 OpenAI 兼容格式（/chat/completions）走，所以 DeepSeek、通义、智谱、Kimi、
 * 本地 LM Studio/Ollama 都能用，只要在设置页填地址 + 密钥 + 模型名。
 *
 * 关键点：素材包可能很长（两小时直播的素材包约 3-5 万字），
 * 这里复用 packet-split 按「上下文预算」自动分片，一片一片发给 AI 再拼起来，
 * 所以再长的直播也不会超上下文。
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import axios from 'axios'
import { splitPacket } from './packet-split'
import { readPacket } from './teardown'
import { load as loadTdConfig } from './teardown-config'
import * as logger from './logger'

const LOG_MODULE = 'AiAnalyze'

/** 单个分片最长等多久（AI 生成整份报告可能要几分钟） */
const REQUEST_TIMEOUT_MS = 15 * 60 * 1000

// ---- 可中途停止：分析多片可能要跑很久（一片最多等 15 分钟），运营不能干等 ----
let cancelRequested = false
let currentAbort: AbortController | null = null

/** 停止 AI 分析（正在等回复的那一次也会被中断） */
export function cancelAnalyze(): boolean {
  cancelRequested = true
  try { currentAbort?.abort() } catch { /* ignore */ }
  return true
}

export interface AiConfig {
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string
  maxOutputTokens: number
  temperature: number
}

const DEFAULT_CONFIG: AiConfig = {
  enabled: false,
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  // 推理型模型（如 deepseek-reasoner / 各类 flash 版）会先想一大段再写正文，
  // 上限给小了正文会被截断，默认给宽松一点。
  maxOutputTokens: 8000,
  temperature: 0.3
}

/**
 * 从接口返回里取正文。
 * 推理型模型的正文可能在 message.content，也可能只剩 message.reasoning_content，
 * 两个都取，避免「明明回了东西却当没回」。
 */
function pickText(data: any): { text: string; truncated: boolean } {
  const choice = data?.choices?.[0] || {}
  const msg = choice.message || {}
  const content = typeof msg.content === 'string' ? msg.content.trim() : ''
  if (content) return { text: content, truncated: choice.finish_reason === 'length' }
  const reasoning = typeof msg.reasoning_content === 'string' ? msg.reasoning_content.trim() : ''
  return { text: reasoning, truncated: choice.finish_reason === 'length' }
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'ai.json')
}

export function loadAiConfig(): AiConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8')
    const saved = JSON.parse(raw)
    return { ...DEFAULT_CONFIG, ...saved }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveAiConfig(patch: Partial<AiConfig>): AiConfig {
  const next = { ...loadAiConfig(), ...patch }
  try {
    fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf-8')
  } catch (ex: any) {
    logger.warn(LOG_MODULE, `保存 AI 配置失败：${ex.message}`)
  }
  return next
}

function endpoint(cfg: AiConfig): string {
  const base = (cfg.baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) return ''
  return base.endsWith('/chat/completions') ? base : base + '/chat/completions'
}

/** 设置页的「测试连接」：发一句最短的话，确认地址/密钥/模型都能用 */
export async function testAiConnection(patch?: Partial<AiConfig>): Promise<{ ok: boolean; message: string }> {
  const cfg = { ...loadAiConfig(), ...(patch || {}) }
  const url = endpoint(cfg)
  if (!url) return { ok: false, message: '请先填接口地址，例如 https://api.deepseek.com/v1' }
  if (!cfg.apiKey) return { ok: false, message: '请先填 API 密钥' }
  if (!cfg.model) return { ok: false, message: '请先填模型名，例如 deepseek-chat' }

  try {
    const res = await axios.post(
      url,
      {
        model: cfg.model,
        messages: [{ role: 'user', content: '只回复两个字：正常' }],
        max_tokens: 16,
        temperature: 0,
        stream: false
      },
      {
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        timeout: 60000
      }
    )
    const { text } = pickText(res.data)
    const model2 = res.data?.model ? `（模型自报：${res.data.model}）` : ''
    logger.info(LOG_MODULE, `连接测试成功：${cfg.baseUrl} / ${cfg.model}`)
    return { ok: true, message: `连接成功${model2}${text ? '，它回了一句：' + text.slice(0, 30) : ''}` }
  } catch (ex: any) {
    logger.warn(LOG_MODULE, `连接测试失败：${describeError(ex)}`)
    return { ok: false, message: describeError(ex) }
  }
}

function describeError(ex: any): string {
  const status = ex?.response?.status
  const data = ex?.response?.data
  const detail = typeof data === 'string' ? data : data ? JSON.stringify(data) : ''
  if (status === 401 || status === 403) return `密钥被拒绝（HTTP ${status}）：${detail.slice(0, 200)}`
  if (status === 402) return `账户余额不足（HTTP 402）：去 DeepSeek 官网充值后再试。${detail.slice(0, 160)}`
  if (status === 404) return `接口地址不对（HTTP 404）：${detail.slice(0, 200)}`
  if (status === 429) return `调用太频繁或余额不足（HTTP 429）：${detail.slice(0, 200)}`
  if (status === 503) return `模型服务太忙（HTTP 503）：这是上游自己的波动，过几分钟再点一次就行。${detail.slice(0, 160)}`
  if (status === 413) return `请求体太大（HTTP 413）：${detail.slice(0, 200)}`
  if (status) return `接口返回 HTTP ${status}：${detail.slice(0, 200)}`
  if (/timeout|ETIMEDOUT/i.test(String(ex?.code || ex?.message))) return '请求超时（AI 太久没回，可稍后重试）'
  return String(ex?.message || ex)
}

const SYSTEM_PROMPT =
  '你是资深抖音娱乐直播运营分析师。下面给你一份「直播拆解素材包」（含技术索引、逐句话术稿、画面网格图路径清单）。\n' +
  '请严格按素材包最后一节「给分析 AI 的指令」里列的结构输出 Markdown 报告：\n' +
  '每条结论必须带时间戳；话术必须是素材包里的原句，不要自己编；不要给无法执行的空话建议。\n' +
  '如果这是分片，请只分析本片内容，并在开头注明「本片覆盖时间段」。'

export interface AiProgress {
  stage: string
  part?: number
  total?: number
  text?: string
}
export type AiProgressFn = (p: AiProgress) => void

export interface AiAnalyzeResult {
  ok: boolean
  note: string
  reportPath?: string
  parts?: number
}

async function chatOnce(cfg: AiConfig, userContent: string): Promise<string> {
  const url = endpoint(cfg)
  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent }
    ],
    max_tokens: cfg.maxOutputTokens || 8000,
    temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.3,
    stream: false
  }

  // 上游经常 503「太忙」：自动重试两次，别让运营看到莫名其妙的失败
  const delays = [0, 6000, 20000]
  let lastErr: any = null
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (cancelRequested) throw new Error('已取消')
    if (delays[attempt] > 0) await new Promise((r) => setTimeout(r, delays[attempt]))
    try {
      currentAbort = new AbortController()
      const res = await axios.post(url, body, {
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        timeout: REQUEST_TIMEOUT_MS,
        signal: currentAbort.signal
      })
      const { text, truncated } = pickText(res.data)
      if (!text) {
        const raw = JSON.stringify(res.data || {})
        throw new Error(
          /length/.test(raw)
            ? 'AI 输出被截断了（单次输出上限太小）：去「设置」页把「单次最多输出」调到 8000 以上再试。'
            : '接口没有返回内容：' + raw.slice(0, 200)
        )
      }
      if (truncated) logger.warn(LOG_MODULE, 'AI 输出被截断（finish_reason=length），建议调大「单次最多输出」')
      return text
    } catch (ex: any) {
      lastErr = ex
      if (cancelRequested) throw new Error('已取消')
      const status = ex?.response?.status
      logger.warn(LOG_MODULE, `AI 调用失败（第 ${attempt + 1} 次，HTTP ${status || '无'}）：${String(ex?.message || ex).slice(0, 120)}`)
      const retryable = !status || status === 429 || status === 502 || status === 503 || status === 504
      if (!retryable || attempt === delays.length - 1) break
    } finally {
      currentAbort = null
    }
  }
  throw lastErr || new Error('调用失败')
}

/**
 * 分析一份素材包（input 可以是视频文件、素材包 md、或它的 work 目录）
 * 报告写到素材包同目录的「AI分析报告.md」
 */
export async function analyzePacket(input: string, onProgress?: AiProgressFn): Promise<AiAnalyzeResult> {
  const cfg = loadAiConfig()
  if (!cfg.apiKey || !cfg.model || !endpoint(cfg)) {
    return { ok: false, note: '还没配置 AI 接口。去「设置」页填接口地址、密钥、模型名，再点「测试连接」。' }
  }

  const info = readPacket(input)
  if (!info || !info.content) {
    return { ok: false, note: '没找到拆解素材包，先把这一场拆解跑完。' }
  }

  const limit = loadTdConfig().contextLimit || 24000
  const split = splitPacket(info.content, limit)
  const parts = split.split ? split.parts : [split.parts[0]]
  const total = parts.length

  logger.info(LOG_MODULE, `开始 AI 分析 workDir=${info.workDir} 分片=${total} 模型=${cfg.model}`)
  onProgress?.({ stage: '开始分析', part: 0, total })

  const outputs: string[] = []
  cancelRequested = false

  const reportPath = path.join(info.workDir, 'AI分析报告.md')
  const header = [
    '# AI 分析报告',
    '',
    `- 素材包：${info.packetPath}`,
    `- 模型：${cfg.model}`,
    `- 分析时间：${new Date().toLocaleString('zh-CN')}`,
    `- 分片：${total} 片${total > 1 ? `（每片 ≤ ${limit} token）` : ''}`,
    '',
    '---',
    ''
  ].join('\n')
  // 每跑完一片就落盘：中途停了/失败了，前面跑完的部分不白费
  const writeReport = (partial: boolean): void => {
    try {
      fs.writeFileSync(reportPath,
        header + outputs.join('\n\n---\n\n') +
        (partial ? '\n\n---\n\n> ⚠ 这次分析没有跑完，以上是已经完成的部分。\n' : '\n'), 'utf-8')
    } catch { /* ignore */ }
  }

  let cancelled = false
  for (let i = 0; i < total; i++) {
    if (cancelRequested) { cancelled = true; break }
    const part = parts[i]
    onProgress?.({ stage: total > 1 ? `正在分析第 ${i + 1}/${total} 片` : '正在分析', part: i + 1, total })
    const body = total > 1
      ? `【这是第 ${i + 1}/${total} 片】\n${part.timeRange ? `本片覆盖：${part.timeRange}\n` : ''}\n${part.content}`
      : part.content
    let answer = ''
    try {
      answer = await chatOnce(cfg, body)
    } catch (ex) {
      if (cancelRequested) { cancelled = true; break }
      writeReport(true)
      throw ex
    }
    outputs.push(total > 1
      ? `## 第 ${i + 1}/${total} 片${part.timeRange ? `（${part.timeRange}）` : ''}\n\n${answer.trim()}`
      : answer.trim())
    writeReport(i < total - 1)
    onProgress?.({ stage: `第 ${i + 1}/${total} 片完成`, part: i + 1, total })
  }

  if (cancelled) {
    writeReport(true)
    logger.info(LOG_MODULE, `AI 分析被停止，已完成 ${outputs.length}/${total} 片`)
    onProgress?.({ stage: '已停止', total, text: reportPath })
    return { ok: false, note: `已停止（完成 ${outputs.length}/${total} 片，跑完的部分已存到 AI分析报告.md）` }
  }

  logger.info(LOG_MODULE, `AI 分析完成：${reportPath}`)
  onProgress?.({ stage: '完成', total, text: reportPath })

  return { ok: true, note: `分析完成（${total} 片）`, reportPath, parts: total }
}

/** 读一份已经生成的分析报告 */
export function readReport(input: string): string {
  const info = readPacket(input)
  if (!info) return ''
  const p = path.join(info.workDir, 'AI分析报告.md')
  try {
    return fs.readFileSync(p, 'utf-8')
  } catch {
    return ''
  }
}
