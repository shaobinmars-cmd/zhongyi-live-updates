import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

export interface TeardownConfig {
  /** 喂给 AI 的上下文预算（token）。素材包超过它就自动分片。 */
  contextLimit: number
  /** 吊销名单：共享盘 txt 路径或网址；留空则不检查。 */
  /** 转写用哪个设备：cpu（默认）/ cuda / auto。包内没带 CUDA 库，选 GPU 会在引擎里自动回退 CPU。 */
  whisperDevice: string
  revokeSource: string
  /** AI 报告是否用 v5（孵化版）结构：框架 → 可复制资产 → 30 天清单。默认关（关闭时维持原有行为）。 */
  useV5: boolean
}

const DEFAULT_CONFIG: TeardownConfig = {
  contextLimit: 24000,
  whisperDevice: 'cpu',
  revokeSource: '',
  useV5: false
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'teardown.json')
}

export function load(): TeardownConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    const limit = Number(parsed?.contextLimit)
    return {
      contextLimit: Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_CONFIG.contextLimit,
      revokeSource: typeof parsed?.revokeSource === 'string' ? parsed.revokeSource : DEFAULT_CONFIG.revokeSource,
      whisperDevice: typeof parsed?.whisperDevice === 'string' ? parsed.whisperDevice : DEFAULT_CONFIG.whisperDevice,
      useV5: parsed?.useV5 === true
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function save(patch: Partial<TeardownConfig>): TeardownConfig {
  const next = { ...load(), ...patch }
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true })
    fs.writeFileSync(configPath(), JSON.stringify(next, null, 2))
  } catch { /* ignore */ }
  return next
}
