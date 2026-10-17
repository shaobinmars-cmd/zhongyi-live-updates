import { StreamRecorder } from './stream-recorder'
import { formatFileSize } from './format'
import * as logger from './logger'
import * as recordState from './record-state'

const LOG_MODULE = 'RecordingManager'

interface RecordItem {
  platform: string
  sourceUrl: string
  roomId: string
  nickname: string
  durationText: string
  sizeText: string
  isActive: boolean
  statusText: string
}

export class RecordingManager {
  private recorders = new Map<string, StreamRecorder>()
  private items = new Map<string, RecordItem>()
  /** 录制状态心跳定时器（见 persist） */
  private heartbeat: ReturnType<typeof setInterval> | null = null

  public onUpdate: (() => void) | null = null

  has(roomId: string): boolean {
    return this.recorders.has(roomId)
  }

  startRecording(roomId: string, pullUrl: string, nickname: string, format: string, platform = 'douyin', sourceUrl = ''): boolean {
    // 同一个房间已经在录，就不重复开
    if (this.recorders.has(roomId)) return true

    const recorder = new StreamRecorder(roomId, nickname, format, {
      onStatus: (text: string) => {
        const item = this.items.get(roomId)
        if (item) item.statusText = text
        this.onUpdate?.()
      },
      onFinished: (reason: string) => {
        // 断流重连由 recorder 自己扛，只有真的结束了（停止 / 判定下播 / 放弃重连）才收尾
        const item = this.items.get(roomId)
        if (item) {
          item.statusText = reason
          item.isActive = false
        }
        this.recorders.delete(roomId)
        this.onUpdate?.()
        this.persist()
      }
    }, platform, sourceUrl)

    if (!recorder.start(pullUrl)) {
      logger.warn(LOG_MODULE, `录制启动失败 roomId=${roomId}`)
      return false
    }

    this.recorders.set(roomId, recorder)
    this.items.set(roomId, {
      roomId,
      nickname,
      platform,
      sourceUrl,
      durationText: '00:00:00',
      sizeText: '0 B',
      isActive: true,
      statusText: '正在录制...'
    })

    logger.info(LOG_MODULE, `开始录制 roomId=${roomId} nickname=${nickname} format=${format}`)
    this.persist()
    return true
  }

  stopOne(roomId: string): void {
    const recorder = this.recorders.get(roomId)
    if (recorder) {
      recorder.stop()
      this.recorders.delete(roomId)
    }
    const item = this.items.get(roomId)
    if (item) {
      item.isActive = false
      item.statusText = '已停止'
    }
    this.persist()
    this.onUpdate?.()
  }

  stopAll(): void {
    const count = this.recorders.size
    for (const [roomId, recorder] of this.recorders) {
      recorder.stop()
      const item = this.items.get(roomId)
      if (item) {
        item.isActive = false
        item.statusText = '已停止'
      }
    }
    this.recorders.clear()
    if (count) logger.info(LOG_MODULE, `停止全部录制 count=${count}`)
    this.persist()
    this.onUpdate?.()
  }

  /** 清空已结束的记录（UI 上的「清空」用） */
  clearFinished(): void {
    for (const [roomId, item] of this.items) {
      if (!item.isActive) this.items.delete(roomId)
    }
    this.onUpdate?.()
  }

  getState(): { items: RecordItem[]; count: number } {
    for (const [roomId, recorder] of this.recorders) {
      const item = this.items.get(roomId)
      if (!item) continue
      item.durationText = recorder.getDurationText()
      item.sizeText = formatFileSize(recorder.currentFileSize)
    }
    return {
      items: Array.from(this.items.values()),
      count: this.recorders.size
    }
  }

  /** 正在录的房间号，用于退出前记录/恢复 */
  activeRoomIds(): string[] {
    return Array.from(this.recorders.keys())
  }


  /** 把当前在录的场次写到磁盘（崩溃/重启后靠它恢复） */
  private persist(): void {
    recordState.save(Array.from(this.recorders.keys()).map((roomId) => ({
      roomId,
      nickname: this.items.get(roomId)?.nickname || '',
      platform: this.items.get(roomId)?.platform || 'douyin',
      sourceUrl: this.items.get(roomId)?.sourceUrl || ''
    })))
    // 只要还有在录的，就每 3 分钟刷新一次时间戳。
    // 以前只在开录/停录时写一次，通宵场（>6 小时）崩了会被判成“状态太旧”而不恢复 ——
    // 那恰恰是这个功能要救的场景。
    if (this.recorders.size > 0) this.startHeartbeat()
    else this.stopHeartbeat()
  }

  /** 录制状态心跳：让 record-state.json 的保存时间始终是“刚才”。 */
  private startHeartbeat(): void {
    if (this.heartbeat) return
    this.heartbeat = setInterval(() => {
      if (this.recorders.size === 0) { this.stopHeartbeat(); return }
      this.persist()
    }, 3 * 60 * 1000)
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null }
  }

  /** 正在录的场次文件名前缀（磁盘清理要避开这些文件） */
  activePrefixes(): string[] {
    return Array.from(this.recorders.values()).map((r) => r.filePrefix).filter(Boolean)
  }
}
