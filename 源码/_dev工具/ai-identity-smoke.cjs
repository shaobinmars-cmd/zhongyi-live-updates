// AI 报告主播名专项：用本地假接口验证报告标题、正文、文件名。
const { app } = require('electron')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')

const temp = path.join(os.tmpdir(), `zy-ai-identity-${Date.now()}`)
app.setPath('userData', temp)
app.on('window-all-closed', () => { /* 测试脚本自己退出 */ })

function assert(ok, message) {
  if (!ok) throw new Error(message)
  console.log('[OK] ' + message)
}

const server = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '## 总体判断\n\n测试报告。' } }]
    }))
  })
})

server.listen(0, '127.0.0.1', async () => {
  try {
    const port = server.address().port
    const work = path.join(temp, 'work_报告测试主播_20261019_1800')
    fs.mkdirSync(work, { recursive: true })
    const packet = path.join(work, '拆解素材包.md')
    fs.writeFileSync(packet, '# 直播拆解素材包\n\n## 一、基本信息\n\n- 视频文件：测试.mp4\n\n## 二、技术索引\n', 'utf-8')

    const ai = require('../dist-electron/services/ai-analyze.js')
    ai.saveAiConfig({
      enabled: true,
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: 'sk-test-key',
      model: 'mock-model',
      visionBaseUrl: '',
      visionApiKey: '',
      visionModel: ''
    })
    const result = await ai.analyzePacket(packet, undefined, { imageCount: 0 })
    assert(result.ok, 'AI 分析成功生成报告')

    const text = fs.readFileSync(result.reportPath, 'utf-8')
    assert(text.startsWith('# AI 分析报告 · 报告测试主播'), 'AI 报告标题包含主播名')
    assert(text.includes('- 主播：报告测试主播'), 'AI 报告基本信息包含主播名')
    const named = path.join(work, 'AI分析报告_报告测试主播.md')
    assert(fs.existsSync(named), 'AI 报告同时生成带主播名的文件名')
    assert(fs.readFileSync(named, 'utf-8').startsWith('# AI 分析报告 · 报告测试主播'), '带名字的报告内容一致')

    const packetText = fs.readFileSync(packet, 'utf-8')
    assert(packetText.startsWith('# 直播拆解素材包 · 报告测试主播'), '分析前素材包也自动补上主播名')
    console.log('AI REPORT IDENTITY OK')
    server.close(() => {
      try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* ignore */ }
      app.exit(0)
    })
  } catch (e) {
    console.error(e && e.stack ? e.stack : e)
    server.close(() => {
      try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* ignore */ }
      app.exit(1)
    })
  }
})
