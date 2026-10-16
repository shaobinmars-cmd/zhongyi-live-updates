import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { app } from 'electron'

export interface RecordConfig {
  outputFormat: string
  outputPath: string
  /** 每段多少分钟切一个文件；0 = 不切（一场一个文件） */
  segmentMinutes: number
  /** 录制目录总容量上限（GB）；0 = 不限制。超了就删最老的 */
  maxGB: number
  /** 磁盘剩余空间低于这个值（GB）就停止录制 */
  minFreeGB: number
  /** 断流后自动重连 */
  autoReconnect: boolean
}

const DEFAULTS: RecordConfig = {
  // 默认录 MP4：拆解引擎要靠画面出网格图，MP3 只有声音，拆解页根本列不出来。旧配置里已经选了格式的不受影响。
  outputFormat: 'mp4',
  outputPath: '',
  segmentMinutes: 30,
  maxGB: 80,
  minFreeGB: 10,
  autoReconnect: true
}

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'record.json')
}

function num(v: any, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export function loadConfig(): RecordConfig {
  let parsed: any = {}
  try {
    const p = getConfigPath()
    if (fs.existsSync(p)) parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) || {}
  } catch { /* 读不到就用默认值 */ }

  return {
    outputFormat: typeof parsed.outputFormat === 'string' && parsed.outputFormat ? parsed.outputFormat : DEFAULTS.outputFormat,
    outputPath: typeof parsed.outputPath === 'string' ? parsed.outputPath : DEFAULTS.outputPath,
    segmentMinutes: num(parsed.segmentMinutes, DEFAULTS.segmentMinutes),
    maxGB: num(parsed.maxGB, DEFAULTS.maxGB),
    minFreeGB: num(parsed.minFreeGB, DEFAULTS.minFreeGB),
    autoReconnect: parsed.autoReconnect === undefined ? DEFAULTS.autoReconnect : !!parsed.autoReconnect
  }
}

export function saveConfig(config: Partial<RecordConfig>): RecordConfig {
  const next = { ...loadConfig(), ...config }
  const configPath = getConfigPath()
  const dir = path.dirname(configPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2))
  return next
}

export function getEffectiveOutputPath(config: RecordConfig): string {
  if (config.outputPath && fs.existsSync(config.outputPath)) return config.outputPath
  return path.join(os.homedir(), 'Desktop', '直播录制')
}
