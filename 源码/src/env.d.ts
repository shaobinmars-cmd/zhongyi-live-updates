declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface Window {
  electronAPI: {
    roomFetch: (urls: string[]) => Promise<any[]>
    roomRefreshStats: (rooms: any[]) => Promise<any[]>
    autoWatchList: () => Promise<any[]>
    autoWatchAdd: (room: any) => Promise<any>
    autoWatchRemove: (roomId: string) => Promise<boolean>
    autoWatchCheckNow: () => Promise<any[]>
    autoWatchClearFinished: () => Promise<number>
    onAutoWatchUpdate: (cb: (items: any[]) => void) => void
    removeAutoWatchListeners: () => void
    danmuConnect: (roomId: string, nickname: string) => Promise<boolean>
    danmuDisconnect: (roomId: string) => Promise<void>
    danmuDisconnectAll: () => Promise<void>
    danmuLoginState: () => Promise<{ loggedIn: boolean }>
    danmuLogin: () => Promise<{ ok: boolean; message: string }>
    danmuReconnect: () => Promise<{ ok: boolean; taps: number }>
    onDanmuMessage: (cb: (data: any) => void) => void
    onDanmuStatus: (cb: (data: any) => void) => void
    onDanmuDisconnect: (cb: (data: any) => void) => void
    removeDanmuListeners: () => void
    recordStartAll: (rooms: any[]) => Promise<any>
    recordStartOne: (room: any) => Promise<any>
    recordStopOne: (roomId: string) => Promise<any>
    recordStopAll: () => Promise<any>
    recordGetState: () => Promise<any>
    onRecordUpdate: (cb: (data: any) => void) => void
    removeRecordListeners: () => void
    dbGetRooms: () => Promise<any[]>
    dbGetMessages: (roomId: string, typeFilter?: string, keyword?: string, username?: string) => Promise<any[]>
    dbClearAll: () => Promise<void>
    configLoad: () => Promise<any>
    configSave: (cfg: any) => Promise<void>
    configBrowsePath: () => Promise<string | null>
    windowMinimize: () => Promise<void>
    teardownEngineStatus: () => Promise<any>
    teardownList: () => Promise<any[]>
    teardownGetState: () => Promise<any>
    teardownStart: (input: string, model: string) => Promise<any>
    teardownStop: () => Promise<any>
    teardownPacket: (input: string) => Promise<any>
    teardownConfigGet: () => Promise<any>
    teardownConfigSet: (patch: any) => Promise<any>
    teardownResplit: (input: string, limit: number) => Promise<any>
    teardownExportParts: (input: string) => Promise<any>
    teardownCompare: (a: string, b: string, limit: number) => Promise<any>
    teardownExportCompare: (content: string, name: string) => Promise<any>
    batchState: () => Promise<any>
    batchAdd: (entries: any[], model: string, skipAnalyzed: boolean) => Promise<any>
    batchStop: () => Promise<any>
    batchClear: () => Promise<any>
    batchExport: () => Promise<any>
    onBatchUpdate: (cb: (data: any) => void) => void
    removeBatchListeners: () => void
    teardownExport: (input: string) => Promise<any>
    teardownOpen: (target: string) => Promise<boolean>
    teardownBrowse: (kind: 'file' | 'dir') => Promise<string | null>
    onTeardownLog: (cb: (line: string) => void) => void
    onTeardownState: (cb: (state: any) => void) => void
    teardownPrefetchModel: (model: string) => Promise<{ ok: boolean; message: string }>
    teardownPrefetchGpu: () => Promise<{ ok: boolean; message: string }>
    teardownPrefetchCancel: () => Promise<boolean>
    onPrefetchProgress: (cb: (data: any) => void) => void
    removePrefetchListeners: () => void
    removeTeardownListeners: () => void
    licenseStatus: () => Promise<any>
    licenseMachineCode: () => Promise<string>
    licenseActivate: (text: string) => Promise<any>
    licenseBrowse: () => Promise<any>
    licenseCheckRevoke: () => Promise<boolean>
    licenseRecheck: () => Promise<{ at: number; ok: boolean; revoked: boolean; source: string; licensed: boolean; licenseReason: string }>
    onLicenseRevoked: (cb: (data: any) => void) => void
    removeLicenseListeners: () => void
    licenseSetRevoke: (src: string) => Promise<any>
    windowMaximize: () => Promise<void>
    windowClose: () => Promise<void>
    getFilePath: (file: File) => string
    incubateImportStreamers: (text: string, operator: string, defaultTrack: string) => Promise<any>
    incubateDepartStreamer: (name: string, date: string) => Promise<any>
    incubateRestoreStreamer: (name: string) => Promise<any>
    incubateUpdateStreamer: (name: string, patch: any) => Promise<any>
    incubateDeleteStreamer: (name: string) => Promise<any>
    hrOverview: (month?: string) => Promise<any>
    hrPickSheet: () => Promise<string | null>
    hrSheetPreview: (filePath: string) => Promise<any>
    hrImportApply: (filePath: string, mapping: any, defaults: any) => Promise<any>
    hrAddOne: (input: any) => Promise<any>
    incubateCustomCourseAdd: (opts: any) => Promise<any>
    incubateCustomCourseUpdate: (id: number, opts: any) => Promise<any>
    incubateHomeworkPick: (streamer: string, title: string, note: string, date: string) => Promise<{ ok: boolean; id: number }>
    incubateHomeworkAddLink: (streamer: string, title: string, url: string, note: string, date: string) => Promise<{ ok: boolean; id: number }>
    incubateHomeworkOpen: (id: number) => Promise<boolean>
    incubateHomeworkDelete: (id: number) => Promise<{ ok: boolean }>
    musicList: (search?: string, status?: string, folderId?: string) => Promise<any[]>
    musicFolders: () => Promise<any[]>
    musicFolderAdd: (name: string) => Promise<any>
    musicFolderRename: (id: string, name: string) => Promise<any>
    musicFolderRemove: (id: string) => Promise<any>
    musicStats: (folderId?: string) => Promise<any>
    musicAdd: (song: any) => Promise<any>
    musicUpdate: (id: string, patch: any) => Promise<any>
    musicRemove: (id: string) => Promise<any>
    musicImport: (file: string, folderId: string, forceBlocked?: boolean) => Promise<any>
    musicCheckFile: (file: string) => Promise<any>
    musicSaveCheck: (results: any[], folderId: string, source: string) => Promise<any>
    musicPickFile: () => Promise<string>
    musicPickAudio: () => Promise<string[]>
    musicUpload: (files: string[], folderId: string) => Promise<any>
    musicOpenSong: (id: string) => Promise<any>
    musicOpenFolder: (id: string) => Promise<any>
    musicOpenData: () => Promise<any>
    envCheck: (model: string) => Promise<any>
  }
}
