import { contextBridge, ipcRenderer, webUtils } from 'electron'

/**
 * 传给主进程的参数必须是「能结构化克隆的普通数据」。
 * 前端一不小心会把 Vue 的响应式对象直接传过来，那样会报
 * 「An object could not be cloned.」——报错信息完全看不出是哪里的问题
 * （运营机上填完 AI 密钥点保存/测试就撞过这个）。
 * 这里统一清洗一遍，只留普通数据。
 */
function cleanArg(v: any): any {
  if (v === null || typeof v !== 'object') return v
  if (v instanceof Date) return v.toISOString()
  try {
    return JSON.parse(JSON.stringify(v))
  } catch {
    return v
  }
}

const invoke = (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args.map(cleanArg))

const api = {
  // —— 孵化系统（独立模块：数据在 incubate.db，不动弹幕库）——
  incubateSchema: () => invoke('incubate:schema'),
  incubateList: (table: string) => invoke('incubate:list', table),
  incubateAdd: (table: string, row: any) => invoke('incubate:add', table, row),
  incubateUpdate: (table: string, id: number, row: any) => invoke('incubate:update', table, id, row),
  incubateDelete: (table: string, id: number) => invoke('incubate:delete', table, id),
  incubateKnowledgePick: (table: string) => invoke('incubate:knowledge-pick', table),
  incubateKnowledgeImport: (table: string, rows: any[]) => invoke('incubate:knowledge-import', table, rows),
  incubateScore: (month?: string) => invoke('incubate:score', month),
  incubateSeed: () => invoke('incubate:seed'),
  incubateTracks: () => invoke('incubate:tracks'),
  incubateImportStreamers: (text: string, operator: string, defaultTrack: string) => invoke('incubate:import-streamers', text, operator, defaultTrack),
  incubateDepartStreamer: (name: string, date: string) => invoke('incubate:depart-streamer', name, date),
  incubateRestoreStreamer: (name: string) => invoke('incubate:restore-streamer', name),
  incubateUpdateStreamer: (name: string, patch: any) => invoke('incubate:update-streamer', name, patch),
  incubateDeleteStreamer: (name: string) => invoke('incubate:delete-streamer', name),
  // 主播作业：文件复制存档 + 飞书等链接登记
  incubateHomeworkPick: (streamer: string, title: string, note: string, date: string) => invoke('incubate:homework-pick', streamer, title, note, date),
  incubateHomeworkAddLink: (streamer: string, title: string, url: string, note: string, date: string) => invoke('incubate:homework-add-link', streamer, title, url, note, date),
  incubateHomeworkOpen: (id: number) => invoke('incubate:homework-open', id),
  incubateHomeworkDelete: (id: number) => invoke('incubate:homework-delete', id),
  incubateInstruction: () => invoke('incubate:instruction'),
  // 人事：读写的还是孵化那张「主播学籍」，不另建第二份档案
  hrOverview: (month?: string) => invoke('hr:overview', month),
  hrPickSheet: () => invoke('hr:pick-sheet'),
  hrSheetPreview: (filePath: string) => invoke('hr:sheet-preview', filePath),
  hrImportApply: (filePath: string, mapping: any, defaults: any) => invoke('hr:import-apply', filePath, mapping, defaults),
  hrAddOne: (input: any) => invoke('hr:add-one', input),
  incubateImport: (dir: string) => invoke('incubate:import', dir),
  incubateExportCsv: () => invoke('incubate:export-csv'),
  incubateExportXlsx: () => invoke('incubate:export-xlsx'),
  incubateBrowseDir: () => invoke('incubate:browse-dir'),
  incubatePickReport: () => invoke('incubate:pick-report'),
  incubateImportText: (text: string, name: string) => invoke('incubate:import-text', text, name),
  incubateGeneratePlan: (opts: any) => invoke('incubate:generate-plan', opts),
  incubatePlan: (streamer: string) => invoke('incubate:plan', streamer),
  incubateFeedbackSave: (row: any) => invoke('incubate:feedback-save', row),
  incubateCustomCourseAdd: (opts: any) => invoke('incubate:custom-course-add', opts),
  incubateCustomCourseUpdate: (id: number, opts: any) => invoke('incubate:custom-course-update', id, opts),
  musicList: (search = '', status = '', folderId = '') => invoke('music:list', search, status, folderId),
  musicFolders: () => invoke('music:folders'),
  musicFolderAdd: (name: string) => invoke('music:folder-add', name),
  musicFolderRename: (id: string, name: string) => invoke('music:folder-rename', id, name),
  musicFolderRemove: (id: string) => invoke('music:folder-remove', id),
  musicStats: (folderId = '') => invoke('music:stats', folderId),
  musicAdd: (song: any) => invoke('music:add', song),
  musicUpdate: (id: string, patch: any) => invoke('music:update', id, patch),
  musicRemove: (id: string) => invoke('music:remove', id),
  musicImport: (file: string, folderId: string, forceBlocked = false) => invoke('music:import', file, folderId, forceBlocked),
  musicCheckFile: (file: string) => invoke('music:check-file', file),
  musicSaveCheck: (results: any[], folderId: string, source: string) => invoke('music:save-check', results, folderId, source),
  musicPickFile: () => invoke('music:pick-file'),
  musicPickAudio: () => invoke('music:pick-audio'),
  musicUpload: (files: string[], folderId: string) => invoke('music:upload', files, folderId),
  musicOpenSong: (id: string) => invoke('music:open-song', id),
  musicOpenFolder: (id: string) => invoke('music:open-folder', id),
  musicOpenData: () => invoke('music:open-data'),
  updateCheckUrl: (url: string) => invoke('update:check-url', url),
  updateDownloadManifest: (m: any) => invoke('update:download-manifest', m),
  updateInstallFile: (file: string) => invoke('update:install-file', file),
  onUpdateProgress: (cb: (p: number) => void) => ipcRenderer.on('update:on-progress', (_e, p) => cb(p)),
  incubateOpenDataDir: () => invoke('incubate:open-data-dir'),
  syncGet: () => invoke('sync:get'),
  syncSet: (patch: any) => invoke('sync:set', patch),
  syncNow: () => invoke('sync:now'),
  syncTest: () => invoke('sync:test'),
  syncReports: () => invoke('sync:reports'),

  // Room
  roomFetch: (urls: string[], platform = 'auto') => invoke('room:fetch', urls, platform),
  openExternal: (url: string) => invoke('shell:open-external', url),
  roomRefreshStats: (rooms: any[]) => invoke('room:refresh-stats', rooms),
  autoWatchList: () => invoke('auto-watch:list'),
  autoWatchAdd: (room: any) => invoke('auto-watch:add', room),
  autoWatchRemove: (roomId: string) => invoke('auto-watch:remove', roomId),
  autoWatchCheckNow: () => invoke('auto-watch:check-now'),
  autoWatchClearFinished: () => invoke('auto-watch:clear-finished'),
  onAutoWatchUpdate: (cb: (items: any[]) => void) => ipcRenderer.on('auto-watch:on-update', (_e, items) => cb(items)),
  removeAutoWatchListeners: () => ipcRenderer.removeAllListeners('auto-watch:on-update'),

  // Danmu
  danmuConnect: (roomId: string, nickname: string, platform = 'douyin') => invoke('danmu:connect', roomId, nickname, platform),
  danmuDisconnect: (roomId: string) => invoke('danmu:disconnect', roomId),
  danmuDisconnectAll: () => invoke('danmu:disconnect-all'),
  // 抖音登录（弹幕前提）
  danmuLoginState: () => invoke('danmu:login-state'),
  danmuLogin: () => invoke('danmu:login'),
  // 手动重连弹幕通道（掉线时不用等自动重连）
  danmuReconnect: () => invoke('danmu:reconnect'),

  // AI 分析
  aiConfigGet: () => invoke('ai:config-get'),
  aiConfigSet: (patch: any) => invoke('ai:config-set', patch),
  aiTest: (patch: any) => invoke('ai:test', patch),
  aiAnalyze: (input: string, opts?: any) => invoke('ai:analyze', input, opts || {}),
  aiCancel: () => invoke('ai:cancel'),
  aiReadReport: (input: string) => invoke('ai:read-report', input),
  aiPickImages: () => invoke('ai:pick-images'),
  // 轻量文本生成（孵化手册）+ 通用存文本
  aiChatText: (system: string, user: string) => invoke('ai:chat-text', system, user),
  aiSaveText: (defaultName: string, content: string) => invoke('ai:save-text', defaultName, content),
  // AI 共享（老板机当服务器，一人一密钥）
  aiShareGet: () => invoke('ai:share-get'),
  aiShareStatus: () => invoke('ai:share-status'),
  aiShareSet: (patch: any) => invoke('ai:share-set', patch),
  aiShareAdd: (name: string) => invoke('ai:share-add', name),
  aiShareRemove: (token: string) => invoke('ai:share-remove', token),
  aiShareReset: () => invoke('ai:share-reset'),
  aiShareAddMany: (names: string[]) => invoke('ai:share-add-many', names),
  aiWanIp: () => invoke('ai:wan-ip'),
  // 数据汇总 / 升级（局域网）
  collectServerGet: () => invoke('collect:server-get'),
  collectServerStatus: () => invoke('collect:server-status'),
  collectServerSet: (patch: any) => invoke('collect:server-set', patch),
  collectOpenInbox: () => invoke('collect:open-inbox'),
  collectBrowseUpdateDir: () => invoke('collect:browse-update-dir'),
  collectConfigGet: () => invoke('collect:config-get'),
  collectConfigSet: (patch: any) => invoke('collect:config-set', patch),
  collectAdoptFromAi: () => invoke('collect:adopt-from-ai'),
  collectResolve: () => invoke('collect:resolve'),
  collectSendNow: () => invoke('collect:send-now'),
  updateCheck: () => invoke('update:check'),
  updateApply: () => invoke('update:apply'),
  aiOpenPort: (port: number) => invoke('ai:open-port', port),
  aiClosePort: (port: number) => invoke('ai:close-port', port),
  onAiProgress: (cb: (data: any) => void) => ipcRenderer.on('ai:on-progress', (_e, data) => cb(data)),
  removeAiListeners: () => ipcRenderer.removeAllListeners('ai:on-progress'),
  onDanmuMessage: (cb: (data: any) => void) => ipcRenderer.on('danmu:on-message', (_e, data) => cb(data)),
  onDanmuStatus: (cb: (data: any) => void) => ipcRenderer.on('danmu:on-status', (_e, data) => cb(data)),
  onDanmuDisconnect: (cb: (data: any) => void) => ipcRenderer.on('danmu:on-disconnect', (_e, data) => cb(data)),
  removeDanmuListeners: () => {
    ipcRenderer.removeAllListeners('danmu:on-message')
    ipcRenderer.removeAllListeners('danmu:on-status')
    ipcRenderer.removeAllListeners('danmu:on-disconnect')
  },

  // Record
  recordStartAll: (rooms: any[]) => invoke('record:start-all', rooms),
  recordStopAll: () => invoke('record:stop-all'),
  // 只录一个直播间（录制页每个房间一个按钮）
  recordStartOne: (room: any) => invoke('record:start-one', room),
  recordStopOne: (roomId: string) => invoke('record:stop-one', roomId),
  recordGetState: () => invoke('record:get-state'),
  onRecordUpdate: (cb: (data: any) => void) => ipcRenderer.on('record:on-update', (_e, data) => cb(data)),
  removeRecordListeners: () => ipcRenderer.removeAllListeners('record:on-update'),

  // Database
  dbGetRooms: () => invoke('db:get-rooms'),
  dbGetMessages: (roomId: string, typeFilter?: string, keyword?: string, username?: string) =>
    invoke('db:get-messages', roomId, typeFilter, keyword, username),
  dbClearAll: () => invoke('db:clear-all'),
  dbExportMessages: (roomId: string, nickname: string, typeFilter?: string, keyword?: string, username?: string, format?: 'csv' | 'json') =>
    invoke('db:export-messages', roomId, nickname, typeFilter, keyword, username, format),

  // Config
  configLoad: () => invoke('config:load'),
  configSave: (cfg: any) => invoke('config:save', cfg),
  configBrowsePath: () => invoke('config:browse-path'),

  // Window controls
  // 环境自检
  envCheck: (model: string) => invoke('env:check', model),

  // 拖进来的文件拿真实路径（Electron 32 起 File.path 被移除，必须走 webUtils）
  getFilePath: (file: File) => {
    try { return webUtils.getPathForFile(file) } catch { return '' }
  },

  // License（授权）
  licenseStatus: () => invoke('license:status'),
  licenseMachineCode: () => invoke('license:machine-code'),
  licenseActivate: (text: string) => invoke('license:activate', text),
  licenseBrowse: () => invoke('license:browse'),
  licenseCheckRevoke: () => invoke('license:check-revoke'),
  // 授权联网复查（返回本次结果：查没查通、何时查的）
  licenseRecheck: () => invoke('license:recheck'),
  onLicenseRevoked: (cb: (data: any) => void) => ipcRenderer.on('license:on-revoked', (_e, data) => cb(data)),
  removeLicenseListeners: () => ipcRenderer.removeAllListeners('license:on-revoked'),
  licenseSetRevoke: (src: string) => invoke('license:set-revoke', src),

  // Teardown（拆解）
  teardownEngineStatus: () => invoke('teardown:engine-status'),
  teardownList: () => invoke('teardown:list'),
  teardownGetState: () => invoke('teardown:get-state'),
  teardownStart: (input: string, model: string) => invoke('teardown:start', input, model),
  teardownResolveUrl: (url: string, seconds: number) => invoke('teardown:resolve-url', url, seconds),
  teardownStop: () => invoke('teardown:stop'),
  teardownPacket: (input: string) => invoke('teardown:packet', input),
  teardownConfigGet: () => invoke('teardown:config-get'),
  teardownConfigSet: (patch: any) => invoke('teardown:config-set', patch),
  teardownResplit: (input: string, limit: number) => invoke('teardown:resplit', input, limit),
  teardownExportParts: (input: string) => invoke('teardown:export-parts', input),
  teardownCompare: (a: string, b: string, limit: number) => invoke('teardown:compare', a, b, limit),
  teardownExportCompare: (content: string, name: string) => invoke('teardown:export-compare', content, name),
  batchState: () => invoke('teardown:batch-state'),
  batchAdd: (entries: any[], model: string, skipAnalyzed: boolean) => invoke('teardown:batch-add', entries, model, skipAnalyzed),
  batchStop: () => invoke('teardown:batch-stop'),
  batchClear: () => invoke('teardown:batch-clear'),
  batchExport: () => invoke('teardown:batch-export'),
  onBatchUpdate: (cb: (data: any) => void) => ipcRenderer.on('teardown:on-batch', (_e, data) => cb(data)),
  removeBatchListeners: () => ipcRenderer.removeAllListeners('teardown:on-batch'),
  teardownExport: (input: string) => invoke('teardown:export', input),
  teardownOpen: (target: string) => invoke('teardown:open', target),
  teardownBrowse: (kind: 'file' | 'dir') => invoke('teardown:browse', kind),
  onTeardownLog: (cb: (line: string) => void) => ipcRenderer.on('teardown:on-log', (_e, line) => cb(line)),
  onTeardownState: (cb: (state: any) => void) => ipcRenderer.on('teardown:on-state', (_e, state) => cb(state)),
  // 一键下载：转写模型 / GPU 运行库
  teardownPrefetchModel: (model: string) => invoke('teardown:prefetch-model', model),
  teardownPrefetchGpu: () => invoke('teardown:prefetch-gpu'),
  teardownPrefetchCancel: () => invoke('teardown:prefetch-cancel'),
  onPrefetchProgress: (cb: (data: any) => void) => ipcRenderer.on('teardown:on-prefetch', (_e, data) => cb(data)),
  removePrefetchListeners: () => ipcRenderer.removeAllListeners('teardown:on-prefetch'),
  removeTeardownListeners: () => {
    ipcRenderer.removeAllListeners('teardown:on-log')
    ipcRenderer.removeAllListeners('teardown:on-state')
  },

  windowMinimize: () => invoke('window:minimize'),
  windowMaximize: () => invoke('window:maximize'),
  windowClose: () => invoke('window:close'),
}

contextBridge.exposeInMainWorld('electronAPI', api)
