// 端到端验证：直接用编译好的生产代码（dist-electron/services/danmu.js）跑一遍弹幕采集。
// 运行：electron test-danmu.cjs [webRid] [秒数]

const { app } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

const LOGFILE = path.join(os.tmpdir(), 'test-danmu.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  try { process.stdout.write(String(s) + '\n') } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => log('UNCAUGHT: ' + ((e && e.stack) || e)))
process.on('unhandledRejection', (e) => log('UNHANDLED: ' + ((e && e.stack) || e)))

const WEB_RID = process.argv[2] || '166871145084'
const SECONDS = Number(process.argv[3] || 75)

app.whenReady().then(async () => {
  log('app ready，准备加载生产弹幕服务')
  const { DanmuService } = require('../dist-electron/services/danmu.js')

  const svc = new DanmuService()
  const counts = {}

  svc.onStatusChanged = (s) => log('[状态] ' + s)
  svc.onDisconnected = (r) => log('[断开] ' + r)
  svc.onMessage = (msg) => {
    counts[msg.type] = (counts[msg.type] || 0) + 1
    if (msg.type === 'Chat') log(`[弹幕] ${msg.userName}：${msg.content}`)
    else if (msg.type === 'Gift') log(`[礼物] ${msg.userName} 送出 ${msg.giftName} x${msg.giftCount}`)
    else if (msg.type === 'Member') log(`[进场] ${msg.userName}`)
    else if (msg.type === 'Like') log(`[点赞] ${msg.userName}`)
    else if (msg.type === 'Stats') log(`[统计] 在线 ${msg.totalUser}`)
  }

  log('开始连接 webRid=' + WEB_RID)
  await svc.connect('test-room-' + WEB_RID, WEB_RID, '联调测试')

  setTimeout(() => {
    log('')
    log('===== 结果 =====')
    log('消息统计 ' + JSON.stringify(counts))
    const chat = counts.Chat || 0
    log(chat > 0 ? `成功：拿到 ${chat} 条弹幕 OK` : '本次窗口内没拿到弹幕（房间可能太冷清）')
    log('isConnected=' + svc.isConnected)
    svc.disconnect()
    setTimeout(() => app.exit(0), 500)
  }, SECONDS * 1000)
}).catch((e) => log('whenReady 失败: ' + ((e && e.stack) || e)))
