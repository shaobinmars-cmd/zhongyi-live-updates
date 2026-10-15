import { app, BrowserWindow } from 'electron'

app.commandLine.appendSwitch('disable-features', 'FontFlash')
// 开发/自动化调试用：设了 APP_DEBUG_PORT 才开远程调试端口，正常使用不受影响
if (process.env.APP_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.APP_DEBUG_PORT)
}
app.commandLine.appendSwitch('font-render-hinting', 'medium')
import * as path from 'path'
import { registerIpcHandlers, setMainWindow, cleanup } from './ipc-handlers'

// 固定数据目录：以后改应用显示名时，授权 / 配置 / 日志都不会跟着搬家。
// 不钉死的话，产品名一变 userData 就变，每个运营都得重新激活一次。
app.setPath('userData', path.join(app.getPath('appData'), 'douyin-live-info'))
import { setLicenseRevoked } from './ipc-handlers'
import { checkRevoked } from './services/license'
import { load as loadTdConfig } from './services/teardown-config'
import * as aiShare from './services/ai-server'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 680,
    minWidth: 900,
    minHeight: 550,
    frame: false,
    backgroundColor: '#f4f5f7',
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // 7×24 常驻：窗口被盖住/最小化时也别让渲染进程被节流，
      // 否则页面切换动画不会结束，界面会卡在上一页
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  })

  setMainWindow(mainWindow)

  // Development: load from Vite dev server
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('close', async (e) => {
    e.preventDefault()
    await cleanup()
    mainWindow?.destroy()
  })
}

app.whenReady().then(() => {
  registerIpcHandlers()

  // 上次开着「分享给运营」的话，开机自动把 AI 共享服务也拉起来
  const shareCfg = aiShare.loadShare()
  if (shareCfg.enabled) {
    aiShare.startShare(shareCfg).catch(() => { /* 启不来不影响本机使用 */ })
  }
  createWindow()

  // 启动时查一次吊销名单（共享盘或网址），读不到就放行，保证断网能用
  checkRevoked(loadTdConfig().revokeSource)
    .then((r) => setLicenseRevoked(r))
    .catch(() => { /* 查询失败不影响使用 */ })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  await cleanup()
  app.quit()
})
