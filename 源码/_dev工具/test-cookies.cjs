// 对比两个会话分区的 cookie，找出「能收弹幕」的分区和普通分区的差别。
// 运行：electron test-cookies.cjs

const { app, session } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

const LOGFILE = path.join(os.tmpdir(), 'test-cookies.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  try { process.stdout.write(String(s) + '\n') } catch { /* ignore */ }
}

app.whenReady().then(async () => {
  for (const name of ['persist:danmu-probe', 'persist:douyin-danmu', 'persist:warm-a']) {
    const part = session.fromPartition(name)
    const cookies = await part.cookies.get({})
    log(`===== ${name}　cookie 数=${cookies.length} =====`)
    for (const c of cookies) {
      const v = String(c.value || '')
      log(`  ${c.name} = ${v.length > 24 ? v.slice(0, 24) + '…(' + v.length + ')' : v}   [${c.domain}]`)
    }
  }
  app.exit(0)
}).catch((e) => log('失败: ' + ((e && e.stack) || e)))
