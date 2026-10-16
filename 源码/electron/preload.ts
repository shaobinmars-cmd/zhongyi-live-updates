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
  incubateScore: (month?: string) => invoke('incubate:score', month),
  incubateSeed: () => invoke('incubate:seed'),
  incubateTracks: () => invoke('incubate:tracks'),
  incubateImportStreamers: (text: string, operator: string) => invoke('incubate:import-streamers', text, operator),
  incubateInstruction: () => invoke('incubate:instruction'),
  incubateImport: (dir: string) => invoke('incubate:import', dir),
  incubateExportCsv: () => invoke('incubate:export-csv'),
  incubateExportXlsx: () => invoke('incubate:export-xlsx'),
  incubateBrowseDir: () => invoke('incubate:browse-dir'),
  incubateOpenDataDir: () => invoke('incubate:open-data-dir'),

  // Room
  roomFetch: (urls: string[]) => invoke('room:fetch', urls),
  roomRefreshStats: (rooms: any[]) => invoke('room:refresh-stats', rooms),

  // Danmu
  danmuConnect: (roomId: string, nickname: string) => invoke('danmu:connect', roomId, nickname),
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
  aiAnalyze: (input: string) => invoke('ai:analyze', input),
  aiCancel: () => invoke('ai:cancel'),
  aiReadReport: (input: string) => invoke('ai:read-report', input),
  // AI 共享（老板机当服务器，一人一密钥）
  aiShareGet: () => invoke('ai:share-get'),
  aiShareStatus: () => invoke('ai:share-status'),
  aiShareSet: (patch: any) => invoke('ai:share-set', patch),
  aiShareAdd: (name: string) => invoke('ai:share-add', name),
  aiShareRemove: (token: string) => invoke('ai:share-remove', token),
  aiShareReset: () => invoke('ai:share-reset'),
  aiShareAddMany: (names: string[]) => invoke('ai:share-add-many', names),
  aiWanIp: () => invoke('ai:wan-ip'),
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
  licenseSetRevoke: (src: string) => invoke('license:set-revoke', src),

  // Teardown（拆解）
  teardownEngineStatus: () => invoke('teardown:engine-status'),
  teardownList: () => invoke('teardown:list'),
  teardownGetState: () => invoke('teardown:get-state'),
  teardownStart: (input: string, model: string) => invoke('teardown:start', input, model),
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
  removeTeardownListeners: () => {
    ipcRenderer.removeAllListeners('teardown:on-log')
    ipcRenderer.removeAllListeners('teardown:on-state')
  },

  windowMinimize: () => invoke('window:minimize'),
  windowMaximize: () => invoke('window:maximize'),
  windowClose: () => invoke('window:close'),
}

contextBridge.exposeInMainWorld('electronAPI', api)
