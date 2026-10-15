declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface Window {
  electronAPI: {
    roomFetch: (urls: string[]) => Promise<any[]>
    roomRefreshStats: (rooms: any[]) => Promise<any[]>
    danmuConnect: (roomId: string, nickname: string) => Promise<boolean>
    danmuDisconnect: (roomId: string) => Promise<void>
    danmuDisconnectAll: () => Promise<void>
    onDanmuMessage: (cb: (data: any) => void) => void
    onDanmuStatus: (cb: (data: any) => void) => void
    onDanmuDisconnect: (cb: (data: any) => void) => void
    removeDanmuListeners: () => void
    recordStartAll: (rooms: any[]) => Promise<any>
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
    removeTeardownListeners: () => void
    licenseStatus: () => Promise<any>
    licenseMachineCode: () => Promise<string>
    licenseActivate: (text: string) => Promise<any>
    licenseBrowse: () => Promise<any>
    licenseCheckRevoke: () => Promise<boolean>
    licenseSetRevoke: (src: string) => Promise<any>
    windowMaximize: () => Promise<void>
    windowClose: () => Promise<void>
    getFilePath: (file: File) => string
    envCheck: (model: string) => Promise<any>
  }
}
