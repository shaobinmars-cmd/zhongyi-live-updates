// 测试路由器 UPnP 自动端口映射
// 运行：electron test-upnp.cjs [端口]
const { app } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

app.setPath('userData', path.join(app.getPath('appData'), 'douyin-live-info'))
app.on('window-all-closed', () => { /* 别退 */ })

const LOGFILE = path.join(os.tmpdir(), 'test-upnp.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  try { process.stdout.write(String(s) + '\n') } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => log('UNCAUGHT: ' + ((e && e.stack) || e)))

const PORT = Number(process.argv[2] || 57888)

app.whenReady().then(async () => {
  const upnp = require('../dist-electron/services/upnp.js')
  const share = require('../dist-electron/services/ai-server.js')

  log('本机内网 IP：' + JSON.stringify(share.lanAddresses()))

  log('查询路由器外网 IP…')
  try {
    const ip = await upnp.wanIp()
    log('路由器报告的外网 IP：' + ip)
  } catch (ex) {
    log('查不到外网 IP：' + ex.message)
  }

  log(`尝试自动开放端口 ${PORT}…`)
  const r = await upnp.openPort({ port: PORT, internalIp: share.lanAddresses()[0] || '192.168.3.79', description: 'ZhongYi-AI-Test' })
  log('结果：' + JSON.stringify(r))

  if (r.ok) {
    log('现在可以验证：在手机上（关掉 WiFi 用 4G）打开浏览器访问 http://' + r.externalIp + ':' + PORT + '/health')
  }
  app.exit(0)
}).catch((e) => log('失败: ' + ((e && e.stack) || e)))
