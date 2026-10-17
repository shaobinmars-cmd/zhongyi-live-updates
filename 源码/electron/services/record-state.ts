import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import * as logger from './logger'

const LOG_MODULE = 'RecordState'

export interface SavedRecording {
  roomId: string
  nickname: string
  platform?: string
  sourceUrl?: string
}

interface StateFile {
  savedAt: number
  rooms: SavedRecording[]
}

function statePath(): string {
  return path.join(app.getPath('userData'), 'record-state.json')
}

/** 把「现在正在录哪几场」写到磁盘，程序被杀掉/电脑重启后好恢复 */
export function save(rooms: SavedRecording[]): void {
  try {
    const data: StateFile = { savedAt: Date.now(), rooms }
    fs.writeFileSync(statePath(), JSON.stringify(data, null, 2), 'utf-8')
  } catch (ex: any) {
    logger.warn(LOG_MODULE, `保存录制状态失败：${ex.message}`)
  }
}

export function load(): StateFile {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf-8'))
    const rooms = Array.isArray(raw?.rooms)
      ? raw.rooms.filter((r: any) => r && typeof r.roomId === 'string' && r.roomId).map((r: any) => ({ ...r, platform: typeof r.platform === 'string' ? r.platform : 'douyin', sourceUrl: typeof r.sourceUrl === 'string' ? r.sourceUrl : '' }))
      : []
    return { savedAt: Number(raw?.savedAt) || 0, rooms }
  } catch {
    return { savedAt: 0, rooms: [] }
  }
}

export function clear(): void {
  save([])
}
