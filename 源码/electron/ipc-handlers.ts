import { ipcMain, BrowserWindow, dialog, app } from 'electron'
import { shell } from 'electron'
import { DouyinLiveService } from './services/douyin-live'
import { DanmuService, DanmuMsg } from './services/danmu'
import { douyinLoginState, openDouyinLogin, refreshAllRoomTaps, tapCount, closeAllRoomTaps, closeLoginWindow } from './services/danmu-capture'
import * as ai from './services/ai-analyze'
import * as aiShare from './services/ai-server'
import * as collectServer from './services/collect-server'
import * as collectClient from './services/collect-client'
import * as githubSync from './services/github-sync'
import * as upnp from './services/upnp'
import { RecordingManager } from './services/recording-manager'
import * as teardown from './services/teardown'
import * as tdConfig from './services/teardown-config'
import { buildComparison, writeCompareParts } from './services/comparison'
import { teardownQueue } from './services/teardown-queue'
import { runEnvCheck } from './services/env-check'
import * as license from './services/license'
import { freeSpaceGB, enforceQuota } from './services/disk-guard'
import { getPullUrl } from './services/live-stream'
import { detectPlatform, platformLabel, genericRoomInfo, resolveGenericPullUrl } from './services/platform'
import * as db from './services/database'
import * as incubate from './services/incubate'
import * as importKnowledge from './services/import-knowledge'
import * as updater from './services/updater'
import * as incubatePlan from './services/incubate-plan'
import * as hr from './services/hr'
import * as musicLibrary from './services/music-library'
import { V5_FULL_INSTRUCTION } from './services/teardown-instruction'
import * as config from './services/record-config'
import * as logger from './services/logger'
import * as fs from 'fs'
import * as path from 'path'
import { execFile, spawn } from 'child_process'
import * as recordState from './services/record-state'
import { AutoWatchManager } from './services/auto-watch'

const LOG_MODULE = 'IPC'

// 授权状态：未授权（或已被吊销）时，录制/拆解/对比一律拒绝
let licenseRevoked = false
export function setLicenseRevoked(v: boolean): void { licenseRevoked = v }
function licenseOk(): { ok: boolean; reason: string } {
  if (licenseRevoked) return { ok: false, reason: '本机已被管理员停用' }
  const st = license.loadLicense()
  return st.licensed ? { ok: true, reason: '' } : { ok: false, reason: st.reason || '未授权' }
}

function roomPlatform(room: any): string {
  return String(room?.platform || detectPlatform(room?.url || ''))
}

async function resolveRoomPull(room: any): Promise<{ success: boolean; pullUrl: string; nickname: string }> {
  return roomPlatform(room) === 'douyin'
    ? getPullUrl(String(room?.enterRoomId || ''))
    : resolveGenericPullUrl(String(room?.url || ''))
}

async function connectDanmuRoom(room: any): Promise<boolean> {
  const roomId = String(room?.enterRoomId || '')
  if (!roomId) throw new Error('直播间还没有解析出房间号')
  if (danmuConnections.has(roomId)) return true
  if (roomPlatform(room) !== 'douyin') return false
  const service = new DanmuService()
  danmuConnections.set(roomId, service)
  service.onMessage = (msg: DanmuMsg) => {
    mainWindow?.webContents.send('danmu:on-message', { roomId, msg })
  }
  service.onStatusChanged = (status: string) => {
    mainWindow?.webContents.send('danmu:on-status', { roomId, status })
  }
  service.onDisconnected = (reason: string) => {
    danmuConnections.delete(roomId)
    mainWindow?.webContents.send('danmu:on-disconnect', { roomId, reason })
  }
  try {
    await service.connect(roomId, douyinLive.webRidOf(roomId), String(room?.nickname || ''))
    return true
  } catch (ex) {
    try { service.disconnect() } catch { /* ignore */ }
    danmuConnections.delete(roomId)
    throw ex
  }
}

async function startRecordingRoom(room: any): Promise<boolean> {
  const l = licenseOk()
  if (!l.ok) throw new Error(l.reason)
  const roomId = String(room?.enterRoomId || '')
  if (!roomId) throw new Error('这个房间还没解析出房间号，先刷新一下')
  if (recordingManager.has(roomId)) return true
  const cfg = config.loadConfig()
  const outDir = config.getEffectiveOutputPath(cfg)
  const free = freeSpaceGB(outDir)
  if (free < cfg.minFreeGB) throw new Error(`磁盘剩余 ${free.toFixed(1)}GB，低于设置的 ${cfg.minFreeGB}GB，先清理录像再录`)
  enforceQuota(outDir, cfg.maxGB, {
    protectPrefixes: [...recordingManager.activePrefixes(), ...teardown.protectedPrefixes()]
  })
  const { success, pullUrl, nickname } = await resolveRoomPull(room)
  if (!success || !pullUrl) throw new Error(`${nickname || room?.nickname || roomId} 取不到直播流（可能还没开播）`)
  const ok = recordingManager.startRecording(roomId, pullUrl, nickname || room?.nickname || '', cfg.outputFormat, roomPlatform(room), room?.url || '')
  if (!ok) throw new Error('录制启动失败，请检查录制目录和 ffmpeg')
  return true
}

/** 联网复查授权（吐销名单）的状态：什么时候查的、查通没、有没有被停用 */
let revokeState = { at: 0, ok: false, revoked: false, source: '' }
let revokeTimer: ReturnType<typeof setInterval> | null = null
let collectTimer: ReturnType<typeof setInterval> | null = null

/**
 * 联网复查吐销名单。
 * 设计：查得到就按名单执行；查不到（断网/共享盘进不去）就放行 —— 不能让运营当场干不了活。
 * 被停用会立刻把正在录的、正在拆的都停掉。
 */
async function runRevokeCheck(notify = true): Promise<boolean> {
  const source = tdConfig.load().revokeSource
  revokeState = { at: Date.now(), ok: false, revoked: false, source }
  if (!source) return false
  let revoked = false
  try {
    revoked = await license.checkRevoked(source)
  } catch {
    return false          // 网络不通：放行
  }
  revokeState = { at: Date.now(), ok: true, revoked, source }
  licenseRevoked = revoked
  if (revoked) {
    logger.warn(LOG_MODULE, '联网复查发现本机已被停用，停止录制与拆解')
    try { recordingManager.stopAll() } catch { /* ignore */ }
    try { autoWatch?.stop() } catch { /* ignore */ }
    try { teardown.stop() } catch { /* ignore */ }
    if (notify) mainWindow?.webContents.send('license:on-revoked', { reason: '本机已被管理员停用' })
  }
  return revoked
}

const douyinLive = new DouyinLiveService()
export const danmuConnections = new Map<string, DanmuService>()
const recordingManager = new RecordingManager()
let autoWatch: AutoWatchManager | null = null

let mainWindow: BrowserWindow | null = null

let watchdog: ReturnType<typeof setInterval> | null = null
let pruneTimer: ReturnType<typeof setInterval> | null = null

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
  recordingManager.onUpdate = () => {
    mainWindow?.webContents.send('record:on-update', recordingManager.getState())
  }
}

export function registerIpcHandlers(): void {

  if (!autoWatch) {
    autoWatch = new AutoWatchManager(path.join(app.getPath('userData'), 'auto-watch.json'), {
      refreshRoom: async (room) => room.platform === 'douyin'
        ? await douyinLive.fetchLiveRoomInfo(room.url)
        : room,
      startDanmu: (room) => connectDanmuRoom(room),
      startRecording: (room) => startRecordingRoom(room),
      isDanmuConnected: (roomId) => danmuConnections.has(roomId),
      isRecording: (roomId) => recordingManager.has(roomId),
      onUpdate: (items) => mainWindow?.webContents.send('auto-watch:on-update', items)
    })
    autoWatch.start()
    setTimeout(() => { autoWatch?.checkNow().catch(() => { /* ignore */ }) }, 3500)
  }

  // 7×24 看门狗：每 5 分钟查一次目录配额和磁盘剩余空间
  if (!watchdog) {
    watchdog = setInterval(() => {
      try {
        const cfg = config.loadConfig()
        const dir = config.getEffectiveOutputPath(cfg)
        // 正在录 / 正在拆的场次一个都不能碰
        const q = enforceQuota(dir, cfg.maxGB, {
          protectPrefixes: [...recordingManager.activePrefixes(), ...teardown.protectedPrefixes()]
        })
        if (q.deleted) logger.info(LOG_MODULE, `配额清理：删 ${q.deleted} 个旧录像，释放 ${q.freedGB.toFixed(2)}GB`)

        const free = freeSpaceGB(dir)
        if (free < cfg.minFreeGB && recordingManager.activeRoomIds().length > 0) {
          logger.warn(LOG_MODULE, `磁盘只剩 ${free.toFixed(1)}GB，低于 ${cfg.minFreeGB}GB，停止全部录制`)
          recordingManager.stopAll()
          mainWindow?.webContents.send('record:on-update', recordingManager.getState())
        }
      } catch (ex) {
        logger.warn(LOG_MODULE, '磁盘看门狗出错', ex)
      }
    }, 5 * 60 * 1000)
  }

  // 弹幕库清理：启动跑一次，之后每 6 小时一次（默认保留 30 天）
  db.pruneOld().catch(() => { /* ignore */ })
  if (!pruneTimer) {
    pruneTimer = setInterval(() => { db.pruneOld().catch(() => { /* ignore */ }) }, 6 * 60 * 60 * 1000)
  }

  // 授权联网复查：每 30 分钟一次。
  // 以前的逻辑是“只在启动查一次”，运行中被停用的机器得重启才会生效。
  if (!revokeTimer) {
    revokeTimer = setInterval(() => { runRevokeCheck(true).catch(() => { /* ignore */ }) }, 30 * 60 * 1000)
  }

  // 数据汇总服务：老板机开了的话，启动就把服务拉起来
  // GitHub 私有库同步：运营开机后自动补传，老板端也能用它生成报表。
  githubSync.startAutoSync()
  const cc = collectServer.loadCollect()
  if (cc.enabled) {
    collectServer.startShare(cc).catch(() => { /* 起不来不影响本机使用 */ })
  }

  // 运营机：每天自动上报一次（默认开，可在设置里关）
  if (!collectTimer) {
    collectTimer = setInterval(() => {
      const c = collectClient.loadClientConfig()
      if (!c.autoDaily) return
      // 距上次上报超过 20 小时就报一次；不是死磕 0 点，免得大家同时传
      if (Date.now() - (c.lastSentAt || 0) < 20 * 60 * 60 * 1000) return
      const r = collectClient.resolveServer()
      if (!r.url || !r.token) return
      collectClient.collectNow().catch(() => { /* 失败下次再传 */ })
    }, 60 * 60 * 1000)
  }


  // ===== Room =====
  ipcMain.handle('shell:open-external', async (_e, url: string) => {
    if (!/^https?:\/\//i.test(String(url || ''))) return false
    await shell.openExternal(String(url))
    return true
  })
  ipcMain.handle('room:fetch', async (_e, urls: string[], selectedPlatform = 'auto') => {
    const results: any[] = []
    for (const url of urls) {
      const platform = selectedPlatform === 'auto' ? detectPlatform(url) : String(selectedPlatform || 'other')
      try {
        if (platform === 'douyin') {
          const info = await douyinLive.fetchLiveRoomInfo(url)
          results.push({ ...info, url, platform: 'douyin', platformLabel: '抖音' })
        } else {
          results.push(genericRoomInfo(url, platform as any))
        }
      } catch (ex: any) {
        logger.error(LOG_MODULE, `roomFetch失败 url=${url}`, ex)
        results.push({ url, platform, platformLabel: platformLabel(platform), error: ex.message, enterRoomId: '', nickname: '', title: '', roomStatus: 0, likeCount: 0, viewCount: 0 })
      }
    }
    return results
  })

  ipcMain.handle('room:refresh-stats', async (_e, rooms: any[]) => {
    await douyinLive.refreshRoomStats(rooms.filter((r) => !r.platform || r.platform === 'douyin'))
    return rooms
  })

  ipcMain.handle('auto-watch:list', () => autoWatch?.snapshot() || [])
  ipcMain.handle('auto-watch:add', (_e, room: any) => autoWatch?.add(room || {}) || null)
  ipcMain.handle('auto-watch:remove', (_e, roomId: string) => autoWatch?.remove(roomId) || false)
  ipcMain.handle('auto-watch:check-now', () => autoWatch?.checkNow() || [])
  ipcMain.handle('auto-watch:clear-finished', () => autoWatch?.clearFinished() || 0)

  // ===== Danmu =====
  ipcMain.handle('danmu:connect', async (_e, roomId: string, nickname: string, platform = 'douyin') => {
    if (platform !== 'douyin') {
      throw new Error(`${platformLabel(platform)} 弹幕需要平台自己的登录态和协议适配；当前版本先支持多平台录制，弹幕仍为抖音专用。`)
    }
    await connectDanmuRoom({ enterRoomId: roomId, nickname, platform })
    return true
  })

  ipcMain.handle('danmu:disconnect', async (_e, roomId: string) => {
    const service = danmuConnections.get(roomId)
    if (service) {
      service.disconnect()
      danmuConnections.delete(roomId)
    }
  })

  ipcMain.handle('danmu:disconnect-all', async () => {
    for (const [roomId, service] of danmuConnections) {
      service.disconnect()
      mainWindow?.webContents.send('danmu:on-disconnect', { roomId, reason: '主动断开' })
    }
    danmuConnections.clear()
  })

  // 抖音登录：实测抖音只给【已登录】的网页端推弹幕，没登录会一条都收不到
  ipcMain.handle('danmu:login-state', async () => douyinLoginState())
  ipcMain.handle('danmu:login', async () => openDouyinLogin())

  // 手动重连：弹幕窗口卡住 / 掉线时，运营不用等自动重连（原来是等无数据 4 分钟）
  ipcMain.handle('danmu:reconnect', async () => {
    refreshAllRoomTaps('手动重连')
    logger.info('Danmu', `手动重连弹幕通道，当前通道数=${tapCount()}`)
    return { ok: true, taps: tapCount() }
  })

  // ===== AI 分析（把素材包直接发给 AI 出报告，运营就不用再转一手） =====
  ipcMain.handle('ai:config-get', () => ai.loadAiConfig())
  ipcMain.handle('ai:config-set', (_e, patch: any) => ai.saveAiConfig(patch))
  ipcMain.handle('ai:test', (_e, patch: any) => ai.testAiConnection(patch))
  ipcMain.handle('ai:read-report', (_e, input: string) => ai.readReport(input))
  // 轻量文本生成（标准孵化手册这类非拆解场景用）
  ipcMain.handle('ai:chat-text', (_e, system: string, user: string) => ai.chatText(system, user))
  // 通用存文本：保存对话框 + 写文件（孵化手册导出 .md 用）
  ipcMain.handle('ai:save-text', async (_e, defaultName: string, content: string) => {
    const picked = await (mainWindow
      ? dialog.showSaveDialog(mainWindow, { title: '保存文件', defaultPath: defaultName, filters: [{ name: 'Markdown', extensions: ['md'] }, { name: '文本', extensions: ['txt'] }] })
      : dialog.showSaveDialog({ title: '保存文件', defaultPath: defaultName, filters: [{ name: 'Markdown', extensions: ['md'] }, { name: '文本', extensions: ['txt'] }] }))
    if (picked.canceled || !picked.filePath) return ''
    fs.writeFileSync(picked.filePath, content, 'utf8')
    return picked.filePath
  })
  ipcMain.handle('ai:pick-images', async () => {
    if (!mainWindow) return []
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: '选择可选的画面补充图片',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    })
    return picked.canceled ? [] : picked.filePaths
  })
  // AI 共享：本机当服务器，给每个运营发一个密钥，并统计各自用量
  ipcMain.handle('ai:share-get', () => aiShare.loadShare())
  ipcMain.handle('ai:share-status', () => aiShare.shareStatus())
  ipcMain.handle('ai:share-set', async (_e, patch: any) => {
    const cfg = aiShare.saveShare({ ...aiShare.loadShare(), ...patch })
    if (cfg.enabled) await aiShare.startShare(cfg)
    else aiShare.stopShare()
    return { config: aiShare.loadShare(), status: aiShare.shareStatus() }
  })
  ipcMain.handle('ai:share-add', (_e, name: string) => {
    const client = aiShare.addClient(name)
    return { client, config: aiShare.loadShare(), status: aiShare.shareStatus() }
  })
  ipcMain.handle('ai:share-remove', (_e, token: string) => aiShare.removeClient(token))
  ipcMain.handle('ai:share-reset', () => aiShare.resetAllClients())
  ipcMain.handle('ai:share-add-many', (_e, names: string[]) => {
    const created = aiShare.addClients(names || [])
    return { created, config: aiShare.loadShare(), status: aiShare.shareStatus() }
  })

  // ===== 数据汇总 / 升级（局域网） =====
  // 老板机这一端：开服务收数据、发新版
  ipcMain.handle('collect:server-get', () => collectServer.loadCollect())
  ipcMain.handle('collect:server-status', () => collectServer.shareStatus())
  ipcMain.handle('collect:server-set', async (_e, patch: any) => {
    const cfg = collectServer.saveCollect(patch || {})
    if (cfg.enabled) await collectServer.startShare(cfg)
    else collectServer.stopShare()
    return { config: collectServer.loadCollect(), status: collectServer.shareStatus() }
  })
  ipcMain.handle('collect:open-inbox', async () => {
    const dir = collectServer.inboxRoot()
    try {
      fs.mkdirSync(dir, { recursive: true })
      await shell.openPath(dir)
      return { ok: true, dir }
    } catch (ex: any) {
      return { ok: false, message: String(ex?.message || ex) }
    }
  })
  ipcMain.handle('collect:browse-update-dir', async () => {
    if (!mainWindow) return null
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选装升级包的目录（把安装包 exe 放进去）', properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled ? null : r.filePaths[0]
  })

  // 运营这一端：上报数据 / 检查更新 / 一键升级
  ipcMain.handle('collect:config-get', () => collectClient.loadClientConfig())
  ipcMain.handle('collect:config-set', (_e, patch: any) => collectClient.saveClientConfig(patch || {}))
  ipcMain.handle('collect:adopt-from-ai', () => collectClient.adoptFromAi())
  ipcMain.handle('collect:resolve', () => collectClient.resolveServer())
  ipcMain.handle('collect:send-now', async () => {
    try { return await collectClient.collectNow() }
    catch (ex: any) { return { ok: false, message: String(ex?.message || ex) } }
  })
  ipcMain.handle('update:check', async () => {
    try { return await collectClient.checkUpdate() }
    catch (ex: any) { return { ok: false, message: String(ex?.message || ex) } }
  })
  ipcMain.handle('update:apply', async () => {
    try {
      const r = await collectClient.applyUpdate()
      if (r.ok) {
        // 给界面留一点时间把“正在升级”提示出来，然后退干净让安装程序接盘
        setTimeout(() => { try { cleanup().catch(() => { /* ignore */ }) } finally { app.exit(0) } }, 2500)
      }
      return r
    } catch (ex: any) {
      return { ok: false, message: String(ex?.message || ex) }
    }
  })

  // 外网访问（外地运营）：自动开路由器端口
  ipcMain.handle('ai:wan-ip', async () => {
    try { return { ok: true, ip: await upnp.wanIp() } }
    catch (ex: any) { return { ok: false, message: String(ex?.message || ex) } }
  })
  ipcMain.handle('ai:open-port', async (_e, port: number) => {
    const ips = aiShare.lanAddresses()
    if (!ips.length) return { ok: false, message: '没检测到本机内网 IP' }
    return upnp.openPort({ port, internalIp: ips[0], description: 'ZhongYi-AI-Share' })
  })
  ipcMain.handle('ai:close-port', async (_e, port: number) => upnp.closePort(port))
  ipcMain.handle('ai:analyze', async (_e, input: string, opts: any) => {
    try {
      return await ai.analyzePacket(input, (p) => mainWindow?.webContents.send('ai:on-progress', p), opts || {})
    } catch (ex: any) {
      return { ok: false, note: '分析失败：' + String(ex?.message || ex) }
    }
  })
  // 中途停止 AI 分析（跑完的部分会落盘）
  ipcMain.handle('ai:cancel', () => ai.cancelAnalyze())

  // ===== Record =====
  ipcMain.handle('license:status', () => (licenseRevoked
    ? { ...license.loadLicense(), licensed: false, revoked: true, reason: '本机已被管理员停用' }
    : license.loadLicense()))
  ipcMain.handle('license:machine-code', () => license.machineCode())
  ipcMain.handle('license:activate', (_e, text: string) => license.saveLicense(text))
  ipcMain.handle('license:set-revoke', (_e, src: string) => tdConfig.save({ revokeSource: String(src || '') }))
  ipcMain.handle('license:check-revoke', async () => {
    return runRevokeCheck(false)
  })
  // 授权联网复查：返回本次结果（查没查通、什么时候查的）
  ipcMain.handle('license:recheck', async () => {
    await runRevokeCheck(false)
    const st = license.loadLicense()
    return { ...revokeState, licensed: st.licensed, licenseReason: st.reason }
  })
  ipcMain.handle('license:browse', async () => {
    const blank = { licensed: false, reason: '', machineCode: license.machineCode(), payload: null, daysLeft: null, source: '' }
    if (!mainWindow) return blank
    const picked = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: '选择授权文件',
      filters: [{ name: '授权文件', extensions: ['json'] }, { name: '全部文件', extensions: ['*'] }]
    })
    if (picked.canceled || !picked.filePaths[0]) return license.loadLicense()
    let text = ''
    try {
      text = fs.readFileSync(picked.filePaths[0], 'utf-8')
    } catch (ex: any) {
      return { ...blank, reason: '读不了这个文件：' + ex.message }
    }
    return license.saveLicense(text)
  })

  ipcMain.handle('record:start-all', async (_e, rooms: any[]) => {
    const toRecord = (rooms || []).filter((r: any) => !r.error && r.roomStatus !== 2 && !recordingManager.has(r.enterRoomId))
    let firstError = ''
    for (const room of toRecord) {
      try {
        await startRecordingRoom(room)
      } catch (ex: any) {
        if (!firstError) firstError = String(ex?.message || ex || '录制启动失败')
        logger.warn(LOG_MODULE, `直播录制失败 roomId=${room?.enterRoomId || ''}：${firstError}`)
      }
    }
    const state = recordingManager.getState()
    return firstError ? { ...state, error: firstError } : state
  })

  ipcMain.handle('record:stop-all', async () => {
    recordingManager.stopAll()
    return recordingManager.getState()
  })

  ipcMain.handle('record:get-state', () => {
    return recordingManager.getState()
  })

  /** 只录一个直播间（录制页每个房间一个按钮） */
  ipcMain.handle('record:start-one', async (_e, room: any) => {
    try {
      await startRecordingRoom(room)
      return recordingManager.getState()
    } catch (ex: any) {
      const msg = String(ex?.message || ex || '录制启动失败')
      logger.warn(LOG_MODULE, msg)
      return { ...recordingManager.getState(), error: msg }
    }
  })

  // ===== Database =====
  ipcMain.handle('record:stop-one', (_e, roomId: string) => {
    recordingManager.stopOne(roomId)
    return recordingManager.getState()
  })

  ipcMain.handle('db:get-rooms', () => db.getRooms())
  ipcMain.handle('db:get-messages', (_e, roomId: string, typeFilter?: string, keyword?: string, username?: string) =>
    db.getMessages(roomId, typeFilter, keyword, username))
  ipcMain.handle('db:clear-all', () => { db.clearAll() })

  ipcMain.handle('db:export-messages', async (_e, roomId: string, nickname: string, typeFilter?: string, keyword?: string, username?: string, format: 'csv' | 'json' = 'csv') => {
    const messages = await db.getAllMessagesForExport(roomId, nickname, typeFilter, keyword, username)
    if (!mainWindow) return { success: false, error: 'No window' }

    const ext = format === 'json' ? 'json' : 'csv'
    const safeName = (nickname || roomId).replace(/[\\/:*?"<>|]/g, '_')
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${safeName}_弹幕记录.${ext}`,
      filters: [{ name: format === 'json' ? 'JSON 文件' : 'CSV 文件', extensions: [ext] }]
    })

    if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' }

    let content: string
    if (format === 'json') {
      // 原始数据超过 2000 字会被截断并贴上“⋯(截断)”，不再是合法 JSON；
      // 以前直接 JSON.parse 会让整个导出报错。解析不了就原样保留字符串。
      const parseRaw = (raw: string): unknown => {
        if (!raw) return null
        try { return JSON.parse(raw) } catch { return raw }
      }
      const data = messages.map(m => ({ time: m.time, type: m.type, userName: m.userName, content: m.content, giftName: m.giftName, giftCount: m.giftCount, giftPrice: m.giftPrice, likeCount: m.likeCount, avatar: m.avatar, profileUrl: m.profileUrl, rawData: parseRaw(m.rawData) }))
      content = JSON.stringify(data, null, 2)
    } else {
      const BOM = '﻿'
      const header = '时间,类型,用户名,内容,礼物名称,礼物数量,礼物价值,点赞次数,头像URL,主页链接,原始数据'
      const rows = messages.map(m =>
        [m.time, m.type, m.userName, m.content, m.giftName, m.giftCount, m.giftPrice, m.likeCount, m.avatar, m.profileUrl, m.rawData]
          .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(',')
      )
      content = BOM + header + '\n' + rows.join('\n')
    }

    fs.writeFileSync(result.filePath, content, 'utf-8')
    return { success: true, count: messages.length }
  })

  // ===== Config =====
  ipcMain.handle('config:load', () => config.loadConfig())
  ipcMain.handle('config:save', (_e, cfg: config.RecordConfig) => config.saveConfig(cfg))
  ipcMain.handle('config:browse-path', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: '选择录制文件保存路径'
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // ===== Window Controls =====
  // 环境自检：装到新电脑上先跑这个，缺什么一眼能看出来
  ipcMain.handle('env:check', (_e, model: string) => runEnvCheck(model || 'small'))

  // 双场对比：A = 对标主播，B = 自家主播
  ipcMain.handle('teardown:compare', async (_e, inputA: string, inputB: string, limit?: number) => {
    const lc = licenseOk()
    if (!lc.ok) return { error: '未授权：' + lc.reason }
    const a = teardown.readPacket(inputA)
    const b = teardown.readPacket(inputB)
    if (!a) return { error: `A 还没拆解过：${inputA}` }
    if (!b) return { error: `B 还没拆解过：${inputB}` }
    if (path.resolve(inputA) === path.resolve(inputB)) return { error: 'A 和 B 不能选同一场' }

    const label = (p: string) => path.basename(p).replace(/^直播_/, '').slice(0, 40)
    const lim = limit || tdConfig.load().contextLimit
    try {
      const result = buildComparison(
        { path: inputA, label: label(inputA), packet: a.content },
        { path: inputB, label: label(inputB), packet: b.content },
        lim
      )
      writeCompareParts(b.workDir, result.parts)
      return result
    } catch (ex: any) {
      logger.error(LOG_MODULE, '对比生成失败', ex)
      return { error: ex.message }
    }
  })

  ipcMain.handle('teardown:export-compare', async (_e, content: string, name: string) => {
    if (!mainWindow) return { success: false, error: 'No window' }
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: (name || '对比素材包').replace(/[\\/:*?"<>|]/g, '_') + '.md',
      filters: [{ name: 'Markdown 文件', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' }
    fs.writeFileSync(result.filePath, content, 'utf-8')
    return { success: true, path: result.filePath }
  })

  // ===== Teardown（拆解）=====
  teardown.setLogHandler((line: string) => {
    mainWindow?.webContents.send('teardown:on-log', line)
  })
  teardown.setStateHandler((s: teardown.TeardownState) => {
    mainWindow?.webContents.send('teardown:on-state', s)
  })

  // 下载模型 / GPU 运行库的输出（进度、结果）单独走一条通道
  teardown.setPrefetchHandler((e) => {
    mainWindow?.webContents.send('teardown:on-prefetch', e)
  })

  // 一键下载：转写模型（small / medium / …）
  ipcMain.handle('teardown:prefetch-model', async (_e, model: string) =>
    teardown.prefetch('model', [String(model || 'small')]))
  // 一键下载：GPU 运行库（cublas + cudnn，约 1GB）
  ipcMain.handle('teardown:prefetch-gpu', async () => teardown.prefetch('gpu'))
  ipcMain.handle('teardown:prefetch-cancel', () => teardown.cancelPrefetch())

  ipcMain.handle('teardown:engine-status', () => teardown.engineStatus())
  ipcMain.handle('teardown:list', () => teardown.listRecordings())
  ipcMain.handle('teardown:get-state', () => teardown.getState())
  ipcMain.handle('teardown:start', async (_e, input: string, model: string) => {
    if (/^https?:\/\//i.test(String(input || '').trim())) {
      return { running: false, stage: '链接需要先下载', error: '请先在拆解页点「下载链接」' }
    }
    const l = licenseOk()
    if (!l.ok) throw new Error('未授权：' + l.reason)
    // 一场直播可能有多个分段（每 30 分钟一段 / 断流重连再一段）：先合并再拆
    try { await teardown.prepareInput(input) } catch { /* 合并失败就用原文件 */ }
    return teardown.start(input, model)
  })
  ipcMain.handle('teardown:stop', () => teardown.stop())
  ipcMain.handle('teardown:resolve-url', async (_e, url: string, seconds: number) => {
    const l = licenseOk()
    if (!l.ok) throw new Error('未授权：' + l.reason)
    return teardown.resolveRemote(url, seconds)
  })
  ipcMain.handle('teardown:packet', (_e, input: string) => teardown.readPacket(input))

  ipcMain.handle('teardown:config-get', () => tdConfig.load())
  ipcMain.handle('teardown:config-set', (_e, patch: any) => tdConfig.save(patch || {}))
  ipcMain.handle('teardown:resplit', (_e, input: string, limit: number) => {
    if (limit) tdConfig.save({ contextLimit: limit })
    return teardown.resplit(input, limit)
  })

  // 把分片（或整包）导出到一个目录，方便直接发给别人
  ipcMain.handle('teardown:export-parts', async (_e, input: string) => {
    if (!mainWindow) return { success: false, error: 'No window' }
    const info = teardown.readPacket(input)
    if (!info) return { success: false, error: '还没有素材包' }

    const picked = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择导出位置'
    })
    if (picked.canceled || !picked.filePaths[0]) return { success: false, error: 'Cancelled' }

    const base = path.basename(input).replace(/[\\/:*?"<>|]/g, '_')
    const nick = String(info.nickname || '').replace(/[\\/:*?"<>|]/g, '_').trim()
    const dir = path.join(picked.filePaths[0], nick ? `${nick}_${base}` : base)
    try {
      fs.mkdirSync(dir, { recursive: true })
      const parts = info.split?.split ? info.split.parts : []
      if (parts.length) {
        for (const p of parts) fs.writeFileSync(path.join(dir, p.fileName), p.content, 'utf-8')
      } else {
        fs.writeFileSync(path.join(dir, '拆解素材包.md'), info.content, 'utf-8')
        if (nick) fs.writeFileSync(path.join(dir, `拆解素材包_${nick}.md`), info.content, 'utf-8')
      }
      if (info.offlineDraft && fs.existsSync(info.offlineDraft)) fs.copyFileSync(info.offlineDraft, path.join(dir, '报告草稿_离线.md'))
      if (info.segmentsStat && fs.existsSync(info.segmentsStat)) fs.copyFileSync(info.segmentsStat, path.join(dir, '分段统计.md'))

      const lines: string[] = ['# 怎么喂给 AI', '', `主播：${nick || '未识别主播'}`, '']
      if (info.split?.split) {
        lines.push(`本场素材包约 ${info.split.totalTokens} token，超过预算 ${info.split.limit}，已拆成 ${info.split.parts.length} 份：`, '')
        lines.push('按顺序一份一份贴给 AI，每份都自带基本信息与分析指令；最后让它把各段结论合并成一份完整报告。', '')
        lines.push('| 份 | 时间范围 | 文件 |', '|---|---|---|')
        for (const p of info.split.parts) lines.push(`| ${p.index}/${p.total} | ${p.timeRange} | ${p.fileName} |`)
      } else {
        lines.push(`本场素材包约 ${info.split?.totalTokens ?? 0} token，没超预算，整包喂即可。`)
      }
      fs.writeFileSync(path.join(dir, '喂给AI说明.md'), lines.join('\n') + '\n', 'utf-8')
      return { success: true, dir, count: parts.length || 1 }
    } catch (ex: any) {
      return { success: false, error: ex.message }
    }
  })

  ipcMain.handle('teardown:export', async (_e, input: string) => {
    const packet = teardown.readPacket(input)
    if (!packet) return { success: false, error: '还没生成素材包' }
    if (!mainWindow) return { success: false, error: 'No window' }
    const base = path.basename(input) || '素材包'
    const stamp = new Date().toISOString().substring(0, 10).replace(/-/g, '')
    const safe = base.replace(/[\\/:*?"<>|]/g, '_')
    const nick = String(packet.nickname || '').replace(/[\\/:*?"<>|]/g, '_').trim()
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${nick ? nick + '_' : ''}${safe}_${stamp}_拆解素材包.md`,
      filters: [{ name: 'Markdown 文件', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' }
    fs.writeFileSync(result.filePath, packet.content, 'utf-8')
    return { success: true, path: result.filePath }
  })

  ipcMain.handle('teardown:open', async (_e, target: string) => {
    if (!target) return false
    try {
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        await shell.openPath(target)
      } else {
        shell.showItemInFolder(target)
      }
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('teardown:browse', async (_e, kind: 'file' | 'dir') => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: kind === 'dir' ? ['openDirectory'] : ['openFile'],
      title: kind === 'dir' ? '选择录制目录' : '选择素材包(.md)或录像',
      // 第一项必须把 .md 带上：以前只列视频扩展名，运营打开对话框根本看不到
      // 自己的「拆解素材包.md」，就会说“识别不到 md 文件”。
      filters: kind === 'file'
        ? [
            { name: '素材包 / 录像（推荐）', extensions: ['md', 'markdown', 'txt', 'ts', 'mp4', 'mov', 'mkv', 'flv', 'm4v', 'avi', '3gp', 'webm', 'mpg', 'mpeg', 'wmv', 'mts', 'm2ts'] },
            { name: '只要录像', extensions: ['ts', 'mp4', 'mov', 'mkv', 'flv', 'm4v', 'avi', '3gp', 'webm', 'mpg', 'mpeg', 'wmv', 'mts', 'm2ts'] },
            { name: '全部文件', extensions: ['*'] }
          ]
        : undefined
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('window:minimize', () => { mainWindow?.minimize() })
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  ipcMain.handle('window:close', () => { mainWindow?.close() })

  // ===== 批量拆解 =====（转写吃 CPU，串行跑）
  teardownQueue.onUpdate = () => {
    mainWindow?.webContents.send('teardown:on-batch', teardownQueue.getState())
  }

  ipcMain.handle('teardown:batch-state', () => teardownQueue.getState())
  ipcMain.handle('teardown:batch-add', (_e, entries: any[], model: string, skipAnalyzed: boolean) => {
    const l = licenseOk()
    if (!l.ok) return { added: 0, error: '未授权：' + l.reason, ...teardownQueue.getState() }
    const added = teardownQueue.add(entries || [], model, skipAnalyzed !== false)
    return { added, ...teardownQueue.getState() }
  })
  ipcMain.handle('teardown:batch-stop', () => { teardownQueue.stop(); return teardownQueue.getState() })
  ipcMain.handle('teardown:batch-clear', () => { teardownQueue.clear(); return teardownQueue.getState() })

  // 把跑完的素材包（含分片）按主播分目录导出一个总文件夹
  ipcMain.handle('teardown:batch-export', async () => {
    if (!mainWindow) return { success: false, error: 'No window' }
    const st = teardownQueue.getState()
    const doneItems = st.items.filter((i) => i.status === '完成')
    if (!doneItems.length) return { success: false, error: '还没有跑完的场次' }

    const picked = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择导出位置'
    })
    if (picked.canceled || !picked.filePaths[0]) return { success: false, error: 'Cancelled' }

    const stamp = new Date().toISOString().substring(0, 10).replace(/-/g, '')
    const root = path.join(picked.filePaths[0], `素材包批量导出_${stamp}`)
    const index: string[] = ['# 本次导出的素材包', '', `导出时间：${new Date().toLocaleString('zh-CN')}`, '']
    index.push('| 场次 | 约 token | 分片数 |', '|---|---|---|')

    let count = 0
    for (const it of doneItems) {
      const info = teardown.readPacket(it.path)
      if (!info) continue
      const nick = String(info.nickname || '').replace(/[\\/:*?"<>|]/g, '_').trim()
      const safe = (it.name || path.basename(it.path)).replace(/[\\/:*?"<>|]/g, '_')
      const dir = path.join(root, nick ? `${nick}_${safe}` : safe)
      try {
        fs.mkdirSync(dir, { recursive: true })
        const parts = info.split?.split ? info.split.parts : []
        if (parts.length) {
          for (const p of parts) fs.writeFileSync(path.join(dir, p.fileName), p.content, 'utf-8')
        } else {
          fs.writeFileSync(path.join(dir, '拆解素材包.md'), info.content, 'utf-8')
        }
        if (info.offlineDraft && fs.existsSync(info.offlineDraft)) fs.copyFileSync(info.offlineDraft, path.join(dir, '报告草稿_离线.md'))
        if (info.segmentsStat && fs.existsSync(info.segmentsStat)) fs.copyFileSync(info.segmentsStat, path.join(dir, '分段统计.md'))

        if (nick && !parts.length) fs.writeFileSync(path.join(dir, `拆解素材包_${nick}.md`), info.content, 'utf-8')
        const usage: string[] = ['# 怎么喂给 AI', '', `主播：${nick || '未识别主播'}`, '']
        if (parts.length) {
          usage.push(`本场素材包约 ${info.split?.totalTokens} token，超过预算 ${info.split?.limit}，已拆成 ${parts.length} 份：`, '')
          usage.push('按顺序一份一份贴给 AI，每份都自带基本信息与分析指令；最后让它把各段结论合并成完整报告。', '')
          usage.push('| 份 | 时间范围 | 文件 |', '|---|---|---|')
          for (const p of parts) usage.push(`| ${p.index}/${p.total} | ${p.timeRange} | ${p.fileName} |`)
        } else {
          usage.push(`本场素材包约 ${info.split?.totalTokens ?? 0} token，没超预算，整包喂即可。`)
        }
        fs.writeFileSync(path.join(dir, '喂给AI说明.md'), usage.join('\n') + '\n', 'utf-8')

        index.push(`| ${safe} | ${info.split?.totalTokens ?? 0} | ${parts.length || 1} |`)
        count++
      } catch (ex) {
        logger.warn(LOG_MODULE, `导出失败 ${it.path}`, ex)
      }
    }

    try {
      fs.writeFileSync(path.join(root, '本次导出清单.md'), index.join('\n') + '\n', 'utf-8')
    } catch { /* ignore */ }

    return { success: true, dir: root, count }
  })
}

/**
 * 上次进程被强杀（或电脑重启）时，ffmpeg 不会被一起带走。
 * 启动时按命令行特征把残留的清掉，否则它们还在写文件、白占磁盘。
 */
async function killOrphanFfmpeg(): Promise<void> {
  try {
    const out = await new Promise<string>((resolve) => {
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='ffmpeg.exe'\" | Where-Object { $_.CommandLine -like '*-f segment*' } | Select-Object -ExpandProperty ProcessId"],
        { windowsHide: true, timeout: 15000 },
        (_err, stdout) => resolve(String(stdout || ''))
      )
    })
    const pids = out.split(/\s+/).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
    for (const pid of pids) {
      try { spawn('taskkill', ['/F', '/PID', String(pid)], { windowsHide: true }) } catch { /* ignore */ }
    }
    if (pids.length) logger.warn(LOG_MODULE, `开机清理上一次残留的 ffmpeg 进程：${pids.join(',')}`)
  } catch { /* ignore */ }
}

/**
 * 启动时的收尾：清孤儿 ffmpeg + 自动恢复上次在录的直播间。
 * 7×24 场景最怕半夜崩了/重启了没人知道，第二天发现整晚没录。
 */
export async function resumeAfterRestart(): Promise<void> {
  await killOrphanFfmpeg()
  const st = recordState.load()
  if (!st.rooms.length) return
  if (Date.now() - st.savedAt > 6 * 60 * 60 * 1000) {
    logger.info(LOG_MODULE, '上次的录制状态超过 6 小时，不自动恢复')
    recordState.clear()
    return
  }
  const l = licenseOk()
  if (!l.ok) return
  const cfg = config.loadConfig()
  let started = 0
  for (const r of st.rooms) {
    if (recordingManager.has(r.roomId)) continue
    const { success, pullUrl, nickname } = await resolveRoomPull({ enterRoomId: r.roomId, url: r.sourceUrl, platform: r.platform })
    if (!success) continue
    if (recordingManager.startRecording(r.roomId, pullUrl, nickname || r.nickname, cfg.outputFormat, r.platform || 'douyin', r.sourceUrl || '')) started++
  }
  if (started) {
    logger.info(LOG_MODULE, `崩溃/重启后自动恢复录制 ${started} 个直播间`)
    mainWindow?.webContents.send('record:on-update', recordingManager.getState())
  }
}

// ---------------- 孵化系统（独立模块：新增 incubate:* 通道，不动现有通道） ----------------
ipcMain.handle('incubate:schema', () => incubate.TABLES)
  // GitHub 数据同步（外网可用，不依赖老板电脑一直开着）
  ipcMain.handle('sync:get', () => githubSync.loadSyncConfig())
  ipcMain.handle('sync:set', (_e, patch: any) => githubSync.saveSyncConfig(patch || {}))
  ipcMain.handle('sync:now', () => githubSync.syncNow())
  ipcMain.handle('sync:test', () => githubSync.testConnection())
  ipcMain.handle('sync:reports', () => githubSync.generateReports())
ipcMain.handle('incubate:list', async (_e, table: string) => incubate.listRows(table))
ipcMain.handle('incubate:add', async (_e, table: string, row: any) => incubate.addRow(table, row))
ipcMain.handle('incubate:update', async (_e, table: string, id: number, row: any) => incubate.updateRow(table, id, row))
ipcMain.handle('incubate:delete', async (_e, table: string, id: number) => incubate.deleteRow(table, id))
// 资料一键导入：选文件 → 解析预览 → 确认入库（话术库 / PK玩法库）
ipcMain.handle('incubate:knowledge-pick', async (_e, table: string) => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  const r = await dialog.showOpenDialog(win, {
    title: '选择要导入的资料（话术 / PK玩法）',
    properties: ['openFile'],
    filters: [
      { name: '资料文件', extensions: ['pdf', 'docx', 'txt', 'md', 'csv'] },
      { name: '全部文件', extensions: ['*'] }
    ]
  })
  if (r.canceled || !r.filePaths[0]) return { canceled: true }
  try {
    const file = r.filePaths[0]
    const parsed = importKnowledge.parseKnowledgeFile(file, table)
    return {
      canceled: false,
      fileName: path.basename(file),
      kind: parsed.kind,
      total: parsed.rows.length,
      sample: parsed.rows.slice(0, 5),
      rows: parsed.rows
    }
  } catch (e: any) {
    return { canceled: false, error: String(e?.message || e) }
  }
})
ipcMain.handle('incubate:knowledge-import', async (_e, table: string, rows: any[]) => {
  if (!incubate.TABLES[table]) throw new Error('未知库：' + table)
  const key = table === 'PK玩法库' ? '惩罚内容' : '回复方案'
  const exist = new Set((await incubate.listRows(table)).map((r: any) => String(r[key] || '').trim()))
  const miss = (rows || []).filter((r: any) => r && r[key] && !exist.has(String(r[key]).trim()))
  if (!miss.length) return { added: 0, skipped: (rows || []).length }
  const res = await incubate.importRows(table, miss)
  return { added: res.added, skipped: (rows || []).length - miss.length }
})

// ---------------- 曲库（抖音无版权禁播清单） ----------------
ipcMain.handle('music:folders', async () => musicLibrary.listFolders())
ipcMain.handle('music:folder-add', async (_e, name: string) => musicLibrary.addFolder(name))
ipcMain.handle('music:folder-rename', async (_e, id: string, name: string) => musicLibrary.renameFolder(id, name))
ipcMain.handle('music:folder-remove', async (_e, id: string) => musicLibrary.removeFolder(id))
ipcMain.handle('music:list', async (_e, search: string, status: string, folderId: string) => musicLibrary.listSongs(search, status, folderId))
ipcMain.handle('music:stats', async (_e, folderId: string) => musicLibrary.stats(folderId || ''))
ipcMain.handle('music:add', async (_e, song: any) => musicLibrary.addSong(song || {}))
ipcMain.handle('music:update', async (_e, id: string, patch: any) => musicLibrary.updateSong(id, patch || {}))
ipcMain.handle('music:remove', async (_e, id: string) => musicLibrary.removeSong(id))
ipcMain.handle('music:import', async (_e, file: string, folderId: string, forceBlocked: boolean) => musicLibrary.importFile(file, folderId || musicLibrary.BLOCKED_FOLDER_ID, forceBlocked === true))
ipcMain.handle('music:check-file', async (_e, file: string) => musicLibrary.checkFile(file))
ipcMain.handle('music:save-check', async (_e, results: any[], folderId: string, source: string) => musicLibrary.saveCheckedResults(results || [], folderId, source || ''))
ipcMain.handle('music:pick-file', async () => {
  const opts: any = { title: '选择抖音无版权歌单（XLSX / CSV）', properties: ['openFile'], filters: [{ name: '歌单', extensions: ['xlsx', 'xls', 'csv', 'tsv'] }] }
  const r = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts)
  return r.canceled ? '' : (r.filePaths[0] || '')
})
ipcMain.handle('music:open-data', async () => {
  shell.showItemInFolder(musicLibrary.dataFilePath())
  return true
})
ipcMain.handle('music:pick-audio', async () => {
  const opts: any = { title: '选择要加入曲库的歌曲文件', properties: ['openFile', 'multiSelections'], filters: [{ name: '音频', extensions: ['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'opus', 'wma', 'ape', 'aiff', 'aif', 'amr', 'ac3', 'mka'] }] }
  const r = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts)
  return r.canceled ? [] : r.filePaths
})
ipcMain.handle('music:upload', async (_e, files: string[], folderId: string) => musicLibrary.addAudioFiles(files || [], folderId))
ipcMain.handle('music:open-song', async (_e, id: string) => {
  const error = await shell.openPath(musicLibrary.openSong(id))
  if (error) throw new Error('系统没有可播放这个格式的程序：' + error)
  return true
})
ipcMain.handle('music:open-folder', async (_e, id: string) => shell.openPath(musicLibrary.openFolder(id)))
ipcMain.handle('incubate:score', async (_e, month?: string) => incubate.scoreOperators(month))
ipcMain.handle('incubate:seed', async () => incubate.seedIfEmpty())
ipcMain.handle('incubate:tracks', () => ({ tracks: incubate.TRACKS, common: incubate.COMMON_METRICS, defaultTrack: incubate.DEFAULT_TRACK }))
ipcMain.handle('incubate:import-streamers', async (_e, text: string, operator: string, defaultTrack: string) => incubate.importStreamers(text, operator, defaultTrack))
ipcMain.handle('incubate:depart-streamer', async (_e, name: string, date: string) => incubate.departStreamer(name, date))
ipcMain.handle('incubate:restore-streamer', async (_e, name: string) => incubate.restoreStreamer(name))
ipcMain.handle('incubate:update-streamer', async (_e, name: string, patch: any) => incubate.updateStreamerIdentity(name, patch || {}))
ipcMain.handle('incubate:delete-streamer', async (_e, name: string) => incubate.deleteStreamer(name))
ipcMain.handle('incubate:import', async (_e, dir: string) => incubate.importFromTeardown(dir))
ipcMain.handle('incubate:open-data-dir', () => incubate.openDataFolder())
ipcMain.handle('incubate:instruction', () => V5_FULL_INSTRUCTION)
// ---------------------------------------------------------------- 人事（极简）
// 人事不另建档案：读写的还是孵化那张「主播学籍」，所以录一次，运营那边自动就有。
ipcMain.handle('hr:overview', async (_e, month?: string) => hr.overview(month))
ipcMain.handle('hr:pick-sheet', async () => {
  const opts: any = {
    title: '选新人表（Excel / CSV）',
    properties: ['openFile'],
    filters: [
      { name: '表格 (xlsx / csv / tsv)', extensions: ['xlsx', 'xlsm', 'csv', 'tsv', 'txt'] },
      { name: '全部文件', extensions: ['*'] }
    ]
  }
  const r = mainWindow
    ? await dialog.showOpenDialog(mainWindow, opts)
    : await dialog.showOpenDialog(opts)
  if (r.canceled || !r.filePaths.length) return null
  return r.filePaths[0]
})
ipcMain.handle('hr:sheet-preview', async (_e, filePath: string) => hr.readSheetFile(filePath))
ipcMain.handle('hr:import-apply', async (_e, filePath: string, mapping: any, defaults: any) =>
  hr.applyImport(filePath, mapping || {}, defaults || {}))
ipcMain.handle('hr:add-one', async (_e, input: any) => hr.addOne(input || {}))
ipcMain.handle('incubate:browse-dir', async () => {
  // 重要：Windows 的对话框不能同时「选文件 + 选文件夹」（同时传只会弹选文件夹），
  // 这就是运营反馈「任何文件都不识别」的原因。现在拆成两个入口。
  const opts: any = { title: '选整个 work 目录（会自动往下找报告）', properties: ['openDirectory'] }
  const r = mainWindow
    ? await dialog.showOpenDialog(mainWindow, opts)
    : await dialog.showOpenDialog(opts)
  if (r.canceled || !r.filePaths.length) return null
  return r.filePaths[0]
})
ipcMain.handle('incubate:pick-report', async () => {
  // 只选单个报告文件（.md/.txt）：运营的主入口
  const opts: any = {
    title: '选 AI 拆解报告（md/txt/Word/WPS）',
    properties: ['openFile'],
    filters: [
      { name: '报告文件 (md/txt/Word/WPS)', extensions: ['md', 'markdown', 'txt', 'docx', 'doc', 'wps', 'rtf'] },
      { name: '全部文件', extensions: ['*'] }
    ]
  }
  const r = mainWindow
    ? await dialog.showOpenDialog(mainWindow, opts)
    : await dialog.showOpenDialog(opts)
  if (r.canceled || !r.filePaths.length) return null
  return r.filePaths[0]
})
ipcMain.handle('incubate:import-text', async (_e, text: string, name: string) =>
  incubatePlan.importReportText(text, name || '粘贴的报告'))
ipcMain.handle('incubate:generate-plan', async (_e, opts: any) => incubatePlan.generateTrainingPlan(opts || {}))
ipcMain.handle('incubate:plan', async (_e, streamer: string) => incubatePlan.getPlan(streamer))
ipcMain.handle('incubate:feedback-save', async (_e, row: any) => incubatePlan.saveFeedback(row || {}))
ipcMain.handle('incubate:custom-course-add', async (_e, opts: any) => incubatePlan.addCustomCourse(opts || {}))
ipcMain.handle('incubate:custom-course-update', async (_e, id: number, opts: any) => incubatePlan.updateCustomCourse(Number(id), opts || {}))
// 主播作业：选文件（图片/视频/Word 等）复制存档；飞书等走链接登记
ipcMain.handle('incubate:homework-pick', async (_e, streamer: string, title: string, note: string, date: string) => {
  const opts = {
    title: '选择主播作业文件',
    properties: ['openFile' as const],
    filters: [
      { name: '作业文件（图片/视频/音频/文档）', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'mov', 'avi', 'mkv', 'flv', 'webm', 'mp3', 'wav', 'm4a', 'doc', 'docx', 'wps', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'txt', 'md'] },
      { name: '全部文件', extensions: ['*'] }
    ]
  }
  const r = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts)
  if (r.canceled || !r.filePaths.length) return { ok: false, id: 0 }
  return incubate.addHomeworkFile(r.filePaths[0], streamer, title, note, date)
})
ipcMain.handle('incubate:homework-add-link', async (_e, streamer: string, title: string, url: string, note: string, date: string) => incubate.addHomeworkLink(streamer, title, url, note, date))
ipcMain.handle('incubate:homework-open', async (_e, id: number) => incubate.openHomework(Number(id)))
ipcMain.handle('incubate:homework-delete', async (_e, id: number) => incubate.deleteHomework(Number(id)))
ipcMain.handle('update:check-url', async (_e, url: string) => updater.checkUrl(url))
ipcMain.handle('update:download-manifest', async (e, m: any) => updater.downloadManifest(m || {}, (p: number) => e.sender.send('update:on-progress', p)))
ipcMain.handle('update:install-file', async (_e, file: string) => updater.install(file))
ipcMain.handle('incubate:export-csv', async () => {
  const r = mainWindow
    ? await dialog.showOpenDialog(mainWindow, { title: '选导出目录', properties: ['openDirectory', 'createDirectory'] })
    : await dialog.showOpenDialog({ title: '选导出目录', properties: ['openDirectory', 'createDirectory'] })
  if (r.canceled || !r.filePaths.length) return { files: [] as string[] }
  return incubate.exportCsv(r.filePaths[0])
})
ipcMain.handle('incubate:export-xlsx', async () => {
  const r = mainWindow
    ? await dialog.showSaveDialog(mainWindow, { title: '导出运营数据', defaultPath: '运营数据.xlsx', filters: [{ name: 'Excel', extensions: ['xlsx'] }] })
    : await dialog.showSaveDialog({ title: '导出运营数据', defaultPath: '运营数据.xlsx', filters: [{ name: 'Excel', extensions: ['xlsx'] }] })
  if (r.canceled || !r.filePath) return { path: '' }
  return incubate.exportXlsx(r.filePath)
})

export async function cleanup(): Promise<void> {
  if (teardown.isRunning()) teardown.stop()
  for (const [, service] of danmuConnections) service.disconnect()
  // 隐藏窗口（弹幕旁听 / 扫码登录）必须一并关掉：留着它们，main 里的 window-all-closed
  // 不会触发，程序就会“窗口关了但进程还在”，再装新版提示文件被占用
  closeAllRoomTaps()
  closeLoginWindow()
  aiShare.stopShare()
  collectServer.stopShare()
  danmuConnections.clear()
  autoWatch?.stop()
  recordingManager.stopAll()
  await db.flushDb()
  await incubate.flushIncubate()
}
