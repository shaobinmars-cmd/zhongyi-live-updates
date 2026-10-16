// 验证 P8：素材包超过预算但「没有话术段」时，也要切成多份（以前会返回整包）
// 用法：node split-fallback-test.mjs
import { createRequire } from 'module'

const APP_PKG = 'H:/360MoveData/Users/Administrator/Documents/ChatGPT/直播间拆解项目github/douyin-live-info/package.json'
const require = createRequire(APP_PKG)
const { splitPacket } = require('H:/360MoveData/Users/Administrator/Documents/ChatGPT/直播间拆解项目github/douyin-live-info/dist-electron/services/packet-split.js')

const lines = ['# 直播拆解素材包', '', '## 一、基本信息', '- 文件：测试.mp4', '']
for (let i = 0; i < 6000; i++) {
  lines.push(`第 ${i} 行：这是一段没有人声的直播内容记录，用来把素材包撑到超过上下文预算。`)
}
const text = lines.join('\n')
const r = splitPacket(text, 4000)
console.log('全文 token≈' + r.totalTokens + '  分片=' + r.split + '  份数=' + r.parts.length)
console.log('每份 token：' + r.parts.map((p) => p.tokens).join(', '))
console.log('说明：' + r.note)
const over = r.parts.filter((p) => p.tokens > 4000)
console.log(over.length ? '❌ 有分片超预算' : '✅ 每份都在预算内')
process.exit(over.length ? 1 : 0)
