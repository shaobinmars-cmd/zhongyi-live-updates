// 验证「分享给运营」：一人一密钥 + 用量统计 + 无效密钥被拒
// 运行：electron test-share.cjs

const { app } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

app.setPath('userData', path.join(app.getPath('appData'), 'douyin-live-info'))
app.on('window-all-closed', () => { /* 别退 */ })

const LOGFILE = path.join(os.tmpdir(), 'test-share.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  try { process.stdout.write(String(s) + '\n') } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => log('UNCAUGHT: ' + ((e && e.stack) || e)))

const PORT = 57911

async function post(token, text) {
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ model: 'whatever', messages: [{ role: 'user', content: text }], max_tokens: 100 })
  })
  let data = null
  try { data = await res.json() } catch { /* ignore */ }
  return { status: res.status, data }
}

app.whenReady().then(async () => {
  const ai = require('../dist-electron/services/ai-analyze.js')
  const share = require('../dist-electron/services/ai-server.js')

  // 上游指向本地假接口（真上游 DeepSeek 现在在 503，先不依赖它）
  ai.saveAiConfig({ baseUrl: 'http://127.0.0.1:57999/v1', apiKey: 'sk-mock', model: 'mock-model' })

  // 从干净状态开始
  share.saveShare({ enabled: false, port: PORT, clients: [] })
  const c1 = share.addClient('张测试')
  const c2 = share.addClient('李测试')
  log(`已生成两把密钥：\n  ${c1.name} = ${c1.token}\n  ${c2.name} = ${c2.token}`)

  share.saveShare({ ...share.loadShare(), enabled: true, port: PORT })
  const started = await share.startShare(share.loadShare())
  log('启动共享服务：' + JSON.stringify(started))
  log('状态：' + JSON.stringify(share.shareStatus()))

  await new Promise((r) => setTimeout(r, 500))

  log('---- 用「张测试」的密钥调一次 ----')
  const r1 = await post(c1.token, '这是一段测试素材包正文，请随便回点东西')
  log(`HTTP ${r1.status}，返回 model=${r1.data?.model}，内容长度=${String(r1.data?.choices?.[0]?.message?.reasoning_content || r1.data?.choices?.[0]?.message?.content || '').length}`)

  log('---- 用一个不存在的密钥调一次（应该 401）----')
  const r2 = await post('zy-badtoken0000', '你好')
  log(`HTTP ${r2.status}，返回：${JSON.stringify(r2.data)}`)

  log('---- 用「李测试」的密钥调一次 ----')
  const r3 = await post(c2.token, '第二个人也来一次')
  log(`HTTP ${r3.status}`)

  await new Promise((r) => setTimeout(r, 300))
  log('---- 用量统计 ----')
  for (const c of share.loadShare().clients) {
    log(`  ${c.name}：调用 ${c.requests} 次，传上去 ${c.tokensIn} tok，生成 ${c.tokensOut} tok，最后 ${c.lastUsedAt || '未用'}`)
  }

  // 收尾：恢复成 DeepSeek 默认，别把测试配置留在老板机器上
  ai.saveAiConfig({ baseUrl: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat', maxOutputTokens: 8000, temperature: 0.3 })
  share.saveShare({ enabled: false, port: 57888, clients: [] })
  share.stopShare()
  log('已清理测试配置')
  app.exit(0)
}).catch((e) => log('失败: ' + ((e && e.stack) || e)))
