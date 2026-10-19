import * as fs from 'fs'
import * as path from 'path'

export type AutoWatchState = 'waiting' | 'checking' | 'starting' | 'started' | 'failed'

export interface AutoWatchRoom {
  enterRoomId: string
  url: string
  nickname: string
  title: string
  platform: string
  platformLabel: string
  roomStatus: number
  likeCount: number
  viewCount: number
  error: string
}

export interface AutoWatchItem extends AutoWatchRoom {
  state: AutoWatchState
  message: string
  addedAt: string
  lastCheckAt: string
  startedAt: string
  attempts: number
}

export interface AutoWatchHooks {
  refreshRoom(room: AutoWatchRoom): Promise<Partial<AutoWatchRoom>>
  startDanmu(room: AutoWatchRoom): Promise<boolean>
  startRecording(room: AutoWatchRoom): Promise<boolean>
  isDanmuConnected(roomId: string): boolean
  isRecording(roomId: string): boolean
  onUpdate?: (items: AutoWatchItem[]) => void
}

function now(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function cleanRoom(input: Partial<AutoWatchRoom>): AutoWatchRoom {
  return {
    enterRoomId: String(input.enterRoomId || '').trim(),
    url: String(input.url || '').trim(),
    nickname: String(input.nickname || '').trim(),
    title: String(input.title || '').trim(),
    platform: String(input.platform || 'douyin').trim() || 'douyin',
    platformLabel: String(input.platformLabel || '').trim(),
    roomStatus: Number(input.roomStatus) || 0,
    likeCount: Number(input.likeCount) || 0,
    viewCount: Number(input.viewCount) || 0,
    error: String(input.error || '').trim()
  }
}

function cleanItem(input: any): AutoWatchItem | null {
  const room = cleanRoom(input || {})
  if (!room.enterRoomId || !room.url) return null
  const states: AutoWatchState[] = ['waiting', 'checking', 'starting', 'started', 'failed']
  const state = states.includes(input?.state) ? input.state : 'waiting'
  return {
    ...room,
    state,
    message: String(input?.message || ''),
    addedAt: String(input?.addedAt || now()),
    lastCheckAt: String(input?.lastCheckAt || ''),
    startedAt: String(input?.startedAt || ''),
    attempts: Math.max(0, Number(input?.attempts) || 0)
  }
}

/**
 * 未开播等待器：后台轮询房间状态，开播后自动连接弹幕并启动录制。
 * 等待列表落盘，软件重启后会继续检查。
 */
export class AutoWatchManager {
  private items = new Map<string, AutoWatchItem>()
  private timer: ReturnType<typeof setInterval> | null = null
  private polling = false
  private firstPoll: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly filePath: string,
    private readonly hooks: AutoWatchHooks,
    private readonly intervalMs = 30_000
  ) {
    this.load()
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
      const rows = Array.isArray(raw) ? raw : raw?.items
      if (Array.isArray(rows)) {
        for (const row of rows) {
          const item = cleanItem(row)
          if (item) this.items.set(item.enterRoomId, item)
          if (item && (item.state === 'checking' || item.state === 'starting')) {
            item.state = 'waiting'
            item.message = '上次检查被中断，已恢复为继续等待'
          }
        }
      }
    } catch { /* 首次使用或文件损坏 */ }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
      const temp = this.filePath + '.tmp'
      fs.writeFileSync(temp, JSON.stringify({ version: 1, items: this.snapshot() }, null, 2), 'utf-8')
      try {
        fs.renameSync(temp, this.filePath)
      } catch {
        try { fs.unlinkSync(this.filePath) } catch { /* ignore */ }
        fs.renameSync(temp, this.filePath)
      }
    } catch { /* 单次落盘失败不能中断后台监控 */ }
  }

  private notify(): void {
    try { this.hooks.onUpdate?.(this.snapshot()) } catch { /* ignore */ }
  }

  snapshot(): AutoWatchItem[] {
    return Array.from(this.items.values())
      .map((item) => ({ ...item }))
      .sort((a, b) => (b.attempts - a.attempts) || a.nickname.localeCompare(b.nickname, 'zh-CN'))
  }

  get(roomId: string): AutoWatchItem | null {
    const item = this.items.get(String(roomId || ''))
    return item ? { ...item } : null
  }

  add(input: Partial<AutoWatchRoom>): AutoWatchItem {
    const room = cleanRoom(input)
    if (!room.enterRoomId) throw new Error('这个直播间还没解析出房间号，暂时不能等待开播')
    if (!/^https?:\/\//i.test(room.url)) throw new Error('直播间链接格式不正确')
    const old = this.items.get(room.enterRoomId)
    const item: AutoWatchItem = {
      ...room,
      state: 'waiting',
      message: old?.message || '已加入等待，开播后自动连接弹幕并录制',
      addedAt: old?.addedAt || now(),
      lastCheckAt: old?.lastCheckAt || '',
      startedAt: '',
      attempts: old?.attempts || 0
    }
    this.items.set(item.enterRoomId, item)
    this.save()
    this.notify()
    this.start()
    if (this.firstPoll) clearTimeout(this.firstPoll)
    this.firstPoll = setTimeout(() => { this.checkNow().catch(() => { /* ignore */ }) }, 500)
    return { ...item }
  }

  remove(roomId: string): boolean {
    const removed = this.items.delete(String(roomId || ''))
    if (removed) {
      this.save()
      this.notify()
      if (this.items.size === 0) this.stop()
    }
    return removed
  }

  clearFinished(): number {
    let count = 0
    for (const [id, item] of this.items) {
      if (item.state === 'started') {
        this.items.delete(id)
        count++
      }
    }
    if (count) {
      this.save()
      this.notify()
    }
    return count
  }

  start(): void {
    if (!this.timer) {
      this.timer = setInterval(() => { this.checkNow().catch(() => { /* ignore */ }) }, Math.max(10_000, this.intervalMs))
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.firstPoll) {
      clearTimeout(this.firstPoll)
      this.firstPoll = null
    }
  }

  async checkNow(): Promise<AutoWatchItem[]> {
    if (this.polling) return this.snapshot()
    this.polling = true
    try {
      const pending = Array.from(this.items.values())
        .filter((item) => item.state === 'waiting' || item.state === 'failed')
      for (const item of pending) await this.checkOne(item)
      return this.snapshot()
    } finally {
      this.polling = false
    }
  }

  private async checkOne(item: AutoWatchItem): Promise<void> {
    item.state = 'checking'
    item.message = '正在检查是否开播…'
    item.attempts++
    item.lastCheckAt = now()
    this.save()
    this.notify()

    try {
      const updated = await this.hooks.refreshRoom({ ...item })
      Object.assign(item, cleanRoom({ ...item, ...updated }))
      if (Number(item.roomStatus) === 2) {
        item.state = 'waiting'
        item.message = '还没开播，后台会继续检查'
        this.save()
        this.notify()
        return
      }

      item.state = 'starting'
      item.message = '检测到开播，正在自动连接弹幕和录制…'
      this.save()
      this.notify()

      let danmuOk = true
      if (item.platform === 'douyin') {
        if (this.hooks.isDanmuConnected(item.enterRoomId)) {
          danmuOk = true
        } else {
          try {
            danmuOk = await this.hooks.startDanmu({ ...item })
          } catch {
            danmuOk = false
          }
        }
      }

      let recordOk = this.hooks.isRecording(item.enterRoomId)
      let recordError = ''
      if (!recordOk) {
        try {
          recordOk = await this.hooks.startRecording({ ...item })
        } catch (ex: any) {
          recordError = String(ex?.message || ex || '录制启动失败')
        }
      }

      if (recordOk) {
        item.state = 'started'
        item.startedAt = now()
        item.message = danmuOk
          ? '已自动开始录制并连接弹幕'
          : '已自动开始录制；弹幕连接失败，请到直播监播检查登录状态'
        this.save()
        this.notify()
        return
      }

      item.state = 'failed'
      item.message = recordError || '检测到开播，但录制启动失败，30 秒后自动重试'
      this.save()
      this.notify()
    } catch (ex: any) {
      item.state = 'failed'
      item.message = `检查失败：${String(ex?.message || ex || '网络异常')}；稍后自动重试`
      this.save()
      this.notify()
    }
  }
}
