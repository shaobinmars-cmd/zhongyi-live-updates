import { StreamRecorder } from './stream-recorder'
import { formatFileSize } from './format'
import * as logger from './logger'

const LOG_MODULE = 'RecordingManager'

interface RecordItem {
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

  public onUpdate: (() => void) | null = null

  has(roomId: string): boolean {
    return this.recorders.has(roomId)
  }

  startRecording(roomId: string, pullUrl: string, nickname: string, format: string): boolean {
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
      }
    })

    if (!recorder.start(pullUrl)) {
      logger.warn(LOG_MODULE, `录制启动失败 roomId=${roomId}`)
      return false
    }

    this.recorders.set(roomId, recorder)
    this.items.set(roomId, {
      roomId,
      nickname,
      durationText: '00:00:00',
      sizeText: '0 B',
      isActive: true,
      statusText: '正在录制...'
    })

    logger.info(LOG_MODULE, `开始录制 roomId=${roomId} nickname=${nickname} format=${format}`)
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

  /** 正在录的场次文件名前缀（磁盘清理要避开这些文件） */
  activePrefixes(): string[] {
    return Array.from(this.recorders.values()).map((r) => r.filePrefix).filter(Boolean)
  }
}
