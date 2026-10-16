import { ipcMain, BrowserWindow, dialog } from 'electron'
import { shell } from 'electron'
import { DouyinLiveService } from './services/douyin-live'
import { DanmuService, DanmuMsg } from './services/danmu'
import { douyinLoginState, openDouyinLogin, refreshAllRoomTaps, tapCount, closeAllRoomTaps, closeLoginWindow } from './services/danmu-capture'
import * as ai from './services/ai-analyze'
import * as aiShare from './services/ai-server'
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
import * as db from './services/database'
import * as incubate from './services/incubate'
import { V5_INSTRUCTION } from './services/teardown-instruction'
import * as config from './services/record-config'
import * as logger from './services/logger'
import * as fs from 'fs'
import * as path from 'path'
import { execFile, spawn } from 'child_process'
import * as recordState from './services/record-state'

const LOG_MODULE = 'IPC'

// 授权状态：未授权（或已被吊销）时，录制/拆解/对比一律拒绝
let licenseRevoked = false
export function setLicenseRevoked(v: boolean): void { licenseRevoked = v }
function licenseOk(): { ok: boolean; reason: string } {
  if (licenseRevoked) return { ok: false, reason: '本机已被管理员停用' }
  const st = license.loadLicense()
  return st.licensed ? { ok: true, reason: '' } : { ok: false, reason: st.reason || '未授权' }
}

const douyinLive = new DouyinLiveService()
export const danmuConnections = new Map<string, DanmuService>()
const recordingManager = new RecordingManager()

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


  // ===== Room =====
  ipcMain.handle('room:fetch', async (_e, urls: string[]) => {
    const results: any[] = []
    for (const url of urls) {
      try {
        const info = await douyinLive.fetchLiveRoomInfo(url)
        results.push({ ...info, url })
      } catch (ex: any) {
        logger.error(LOG_MODULE, `roomFetch失败 url=${url}`, ex)
        results.push({ url, error: ex.message, enterRoomId: '', nickname: '', title: '', roomStatus: 0, likeCount: 0, viewCount: 0 })
      }
    }
    return results
  })

  ipcMain.handle('room:refresh-stats', async (_e, rooms: any[]) => {
    await douyinLive.refreshRoomStats(rooms)
    return rooms
  })

  // ===== Danmu =====
  ipcMain.handle('danmu:connect', async (_e, roomId: string, nickname: string) => {
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

    // 第二个参数传直播间网页短号（live.douyin.com/<短号>），弹幕窗口靠它打开页面
    await service.connect(roomId, douyinLive.webRidOf(roomId), nickname)
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
  ipcMain.handle('ai:analyze', async (_e, input: string) => {
    try {
      return await ai.analyzePacket(input, (p) => mainWindow?.webContents.send('ai:on-progress', p))
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
    const r = await license.checkRevoked(tdConfig.load().revokeSource)
    licenseRevoked = r
    return r
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
    const l = licenseOk()
    if (!l.ok) return { items: [], count: 0, error: l.reason }
    const cfg = config.loadConfig()
    const outDir = config.getEffectiveOutputPath(cfg)

    // 开录前先看磁盘：低于阈值就不开，免得把盘写爆
    const free = freeSpaceGB(outDir)
    if (free < cfg.minFreeGB) {
      const msg = `磁盘剩余 ${free.toFixed(1)}GB，低于设定的 ${cfg.minFreeGB}GB，先清理录像再录`
      logger.warn(LOG_MODULE, msg)
      return { ...recordingManager.getState(), error: msg }
    }
    // 超过目录配额就先删最老的
    const q = enforceQuota(outDir, cfg.maxGB, {
      protectPrefixes: [...recordingManager.activePrefixes(), ...teardown.protectedPrefixes()]
    })
    if (q.deleted) logger.info(LOG_MODULE, `开录前清理：删 ${q.deleted} 个旧录像，释放 ${q.freedGB.toFixed(2)}GB`)

    const format = cfg.outputFormat
    const toRecord = rooms.filter((r: any) => !r.error && r.roomStatus !== 2 && !recordingManager.has(r.enterRoomId))

    for (const room of toRecord) {
      const { success, pullUrl, nickname } = await getPullUrl(room.enterRoomId)
      if (!success) {
        logger.warn(LOG_MODULE, `获取直播流失败 roomId=${room.enterRoomId}`)
        continue
      }

      const nick = nickname || room.nickname
      recordingManager.startRecording(room.enterRoomId, pullUrl, nick, format)
    }

    return recordingManager.getState()
  })

  ipcMain.handle('record:stop-all', async () => {
    recordingManager.stopAll()
    return recordingManager.getState()
  })

  ipcMain.handle('record:get-state', () => {
    return recordingManager.getState()
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
      const data = messages.map(m => ({ time: m.time, type: m.type, userName: m.userName, content: m.content, giftName: m.giftName, giftCount: m.giftCount, giftPrice: m.giftPrice, likeCount: m.likeCount, avatar: m.avatar, profileUrl: m.profileUrl, rawData: m.rawData ? JSON.parse(m.rawData) : null }))
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

  ipcMain.handle('teardown:engine-status', () => teardown.engineStatus())
  ipcMain.handle('teardown:list', () => teardown.listRecordings())
  ipcMain.handle('teardown:get-state', () => teardown.getState())
  ipcMain.handle('teardown:start', async (_e, input: string, model: string) => {
    const l = licenseOk()
    if (!l.ok) throw new Error('未授权：' + l.reason)
    // 一场直播可能有多个分段（每 30 分钟一段 / 断流重连再一段）：先合并再拆
    try { await teardown.prepareInput(input) } catch { /* 合并失败就用原文件 */ }
    return teardown.start(input, model)
  })
  ipcMain.handle('teardown:stop', () => teardown.stop())
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
    const dir = path.join(picked.filePaths[0], base)
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

      const lines: string[] = ['# 怎么喂给 AI', '']
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
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${safe}_${stamp}_拆解素材包.md`,
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
      title: kind === 'dir' ? '选择录制目录' : '选择视频文件',
      filters: kind === 'file'
        ? [{ name: '视频文件', extensions: ['ts', 'mp4', 'mov', 'mkv', 'flv', 'm4v', 'avi', '3gp', 'webm', 'mpg', 'mpeg', 'wmv', 'mts', 'm2ts'] }, { name: '全部文件', extensions: ['*'] }]
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
      const safe = (it.name || path.basename(it.path)).replace(/[\\/:*?"<>|]/g, '_')
      const dir = path.join(root, safe)
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

        const usage: string[] = ['# 怎么喂给 AI', '']
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
    const { success, pullUrl, nickname } = await getPullUrl(r.roomId)
    if (!success) continue
    if (recordingManager.startRecording(r.roomId, pullUrl, nickname || r.nickname, cfg.outputFormat)) started++
  }
  if (started) {
    logger.info(LOG_MODULE, `崩溃/重启后自动恢复录制 ${started} 个直播间`)
    mainWindow?.webContents.send('record:on-update', recordingManager.getState())
  }
}

// ---------------- 孵化系统（独立模块：新增 incubate:* 通道，不动现有通道） ----------------
ipcMain.handle('incubate:schema', () => incubate.TABLES)
ipcMain.handle('incubate:list', async (_e, table: string) => incubate.listRows(table))
ipcMain.handle('incubate:add', async (_e, table: string, row: any) => incubate.addRow(table, row))
ipcMain.handle('incubate:update', async (_e, table: string, id: number, row: any) => incubate.updateRow(table, id, row))
ipcMain.handle('incubate:delete', async (_e, table: string, id: number) => incubate.deleteRow(table, id))
ipcMain.handle('incubate:score', async (_e, month?: string) => incubate.scoreOperators(month))
ipcMain.handle('incubate:seed', async () => incubate.seedIfEmpty())
ipcMain.handle('incubate:tracks', () => ({ tracks: incubate.TRACKS, common: incubate.COMMON_METRICS, defaultTrack: incubate.DEFAULT_TRACK }))
ipcMain.handle('incubate:import-streamers', async (_e, text: string, operator: string) => incubate.importStreamers(text, operator))
ipcMain.handle('incubate:import', async (_e, dir: string) => incubate.importFromTeardown(dir))
ipcMain.handle('incubate:open-data-dir', () => incubate.openDataFolder())
ipcMain.handle('incubate:instruction', () => V5_INSTRUCTION)
ipcMain.handle('incubate:browse-dir', async () => {
  const r = mainWindow
    ? await dialog.showOpenDialog(mainWindow, { title: '选择拆解产物目录', properties: ['openDirectory'] })
    : await dialog.showOpenDialog({ title: '选择拆解产物目录', properties: ['openDirectory'] })
  if (r.canceled || !r.filePaths.length) return null
  return r.filePaths[0]
})
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
  danmuConnections.clear()
  recordingManager.stopAll()
  await db.flushDb()
  await incubate.flushIncubate()
}
