// 本地假 AI 接口：验证 App 的「AI 分析」链路（不依赖外网/上游状态）
// 用法：node mock-ai-server.mjs [端口]
import http from 'http'

const PORT = Number(process.argv[2] || 57999)

const server = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    if (!/chat\/completions/.test(req.url || '')) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }
    let body = {}
    try { body = JSON.parse(raw) } catch { /* ignore */ }
    const user = body.messages?.find((m) => m.role === 'user')?.content || ''
    const system = body.messages?.find((m) => m.role === 'system')?.content || ''
    const auth = req.headers.authorization || ''
    console.log(`[mock] 收到请求：user=${user.length}字 system=${system.length}字 model=${body.model} auth=${auth.slice(0, 12)}… max_tokens=${body.max_tokens}`)

    const report = [
      '## 总体判断（mock）',
      '',
      `- 收到素材包正文 ${user.length} 字，系统提示 ${system.length} 字`,
      '- 这是一份模拟报告，用来验证 App 的请求格式、分片拼接和落盘。',
      '',
      '## 分钟级时间轴',
      '',
      '| 时间 | 在做什么 | 关键原话 | 作用 | 可复制度 |',
      '| --- | --- | --- | --- | --- |',
      '| 00:10 | 开场问候 | 原句（mock） | 留人 | 高 |',
      '',
      '## 话术库',
      '',
      '- 场景：欢迎新人 / 原句：「欢迎新来的家人」/ 变体：… / 时机：每 2-3 分钟'
    ].join('\n')

    // 故意走 reasoning_content，验证 App 对推理型模型的兼容
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      id: 'mock-' + Date.now(),
      object: 'chat.completion',
      model: body.model || 'mock',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '', reasoning_content: report } }]
    }))
  })
})

server.listen(PORT, '127.0.0.1', () => console.log(`[mock] 假 AI 接口已启动：http://127.0.0.1:${PORT}/v1`))
