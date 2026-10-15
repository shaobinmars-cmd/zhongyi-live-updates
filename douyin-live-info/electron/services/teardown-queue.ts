// 批量拆解：下播后把当天所有录制排队跑一遍，一个跑完再跑下一个。
// 转写吃 CPU，必须串行；跑完自动按上下文预算分片（复用 teardown 里的逻辑）。

import * as teardown from './teardown'
import * as logger from './logger'

const LOG_MODULE = 'TeardownQueue'

export type QueueStatus = '等待中' | '拆解中' | '完成' | '已拆解过' | '失败' | '已跳过'

export interface QueueItem {
  path: string
  name: string
  status: QueueStatus
  message: string
  tokens: number
  parts: number
}

const MAX_ITEMS = 200

class TeardownQueue {
  private items: QueueItem[] = []
  private running = false
  private cancelled = false
  private model = 'small'

  public onUpdate: (() => void) | null = null

  private emit(): void {
    this.onUpdate?.()
  }

  getState(): { items: QueueItem[]; running: boolean; done: number; total: number; currentName: string } {
    const done = this.items.filter((i) => i.status === '完成' || i.status === '已拆解过' || i.status === '失败' || i.status === '已跳过').length
    const cur = this.items.find((i) => i.status === '拆解中')
    return {
      items: this.items,
      running: this.running,
      done,
      total: this.items.length,
      currentName: cur ? cur.name : ''
    }
  }

  /** 入队。skipAnalyzed = 已经拆解过的直接跳过 */
  add(entries: { path: string; name: string; analyzed?: boolean }[], model: string, skipAnalyzed = true): number {
    this.model = model || 'small'
    this.cancelled = false

    const known = new Set(this.items.filter((i) => i.status === '等待中' || i.status === '拆解中').map((i) => i.path))
    let added = 0
    for (const e of entries) {
      if (this.items.length >= MAX_ITEMS) break
      if (!e.path || known.has(e.path)) continue
      known.add(e.path)
      const skip = skipAnalyzed && e.analyzed
      this.items.push({
        path: e.path,
        name: e.name || e.path,
        status: skip ? '已拆解过' : '等待中',
        message: skip ? '之前拆解过，已跳过' : '',
        tokens: 0,
        parts: 0
      })
      added++
    }
    logger.info(LOG_MODULE, `入队 ${added} 个，队列共 ${this.items.length} 个`)
    this.emit()
    this.loop()
    return added
  }

  clear(): void {
    if (this.running) return
    this.items = []
    this.emit()
  }

  /** 停止：当前这个也停掉，剩下的标为已跳过 */
  stop(): void {
    this.cancelled = true
    teardown.stop()
    for (const it of this.items) {
      if (it.status === '等待中') {
        it.status = '已跳过'
        it.message = '已手动停止'
      }
    }
    this.emit()
  }

  private async loop(): Promise<void> {
    if (this.running) return
    this.running = true
    this.emit()
    try {
      for (const it of this.items) {
        if (this.cancelled) break
        if (it.status !== '等待中') continue

        it.status = '拆解中'
        this.emit()

        // 一场直播可能有多个分段（每 30 分钟一段 / 断流重连再一段）。
        // 批量通道以前漏了「先合并」这一步，结果只拆到第一段——必须先合并再拆。
        try {
          await teardown.prepareInput(it.path)
        } catch (ex: any) {
          logger.warn(LOG_MODULE, `合并分段失败，按原文件继续：${it.path} ${ex?.message || ''}`)
        }

        teardown.start(it.path, this.model)
        await this.waitFinish()

        const st = teardown.getState()
        if (st.exitCode === 0 && st.packetPath) {
          const info = teardown.readPacket(it.path)
          const split = info?.split
          it.status = '完成'
          it.tokens = split?.totalTokens || 0
          it.parts = split?.split ? split.parts.length : 1
          it.message = split?.split ? `超预算，已切成 ${it.parts} 份` : `约 ${it.tokens} token，整份即可`
        } else {
          it.status = '失败'
          it.message = st.error || `退出码 ${st.exitCode}`
        }
        this.emit()
      }
    } catch (ex: any) {
      logger.error(LOG_MODULE, '批量拆解异常', ex)
    } finally {
      this.running = false
      this.emit()
      logger.info(LOG_MODULE, '批量拆解结束')
    }
  }

  private waitFinish(): Promise<void> {
    return new Promise((resolve) => {
      // 等 teardown 那个单任务跑完
      const t = setInterval(() => {
        if (!teardown.isRunning()) {
          clearInterval(t)
          resolve()
        }
      }, 1000)
      // 兜底：万一状态没同步过来，最多等 6 小时
      setTimeout(() => { clearInterval(t); resolve() }, 6 * 60 * 60 * 1000)
    })
  }
}

export const teardownQueue = new TeardownQueue()
