// 把「已登录」分区的抖音登录态搬到 App 正式用的分区（仅本机验证用）。
// 运行：electron seed-login.cjs [源分区] [目标分区]

const { app, session } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

const LOGFILE = path.join(os.tmpdir(), 'seed-login.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  try { process.stdout.write(String(s) + '\n') } catch { /* ignore */ }
}

const SOURCE = process.argv[2] || 'persist:danmu-probe'
const TARGET = process.argv[3] || 'persist:douyin-danmu'

app.whenReady().then(async () => {
  const src = session.fromPartition(SOURCE)
  const dst = session.fromPartition(TARGET)
  const cookies = await src.cookies.get({})
  let ok = 0
  let fail = 0
  for (const c of cookies) {
    const url = `${c.secure ? 'https' : 'http'}://${String(c.domain || '').replace(/^\./, '')}${c.path || '/'}`
    try {
      await dst.cookies.set({
        url, name: c.name, value: c.value, domain: c.domain, path: c.path,
        secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, expirationDate: c.expirationDate
      })
      ok++
    } catch { fail++ }
  }
  const have = (await dst.cookies.get({ name: 'sessionid' })).length > 0
  log(`从 ${SOURCE} 搬 ${ok} 个 cookie 到 ${TARGET}（失败 ${fail}），目标已登录=${have ? '是' : '否'}`)
  app.exit(0)
}).catch((e) => log('失败: ' + ((e && e.stack) || e)))
