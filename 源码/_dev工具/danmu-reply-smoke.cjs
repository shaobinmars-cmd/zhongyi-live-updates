// 弹幕—主播回应对齐专项测试（纯函数，不读写正式数据）
const { app } = require('electron')

app.on('window-all-closed', () => { /* 测试脚本自己退出 */ })

function assert(ok, message) {
  if (!ok) throw new Error(message)
  console.log('[OK] ' + message)
}

app.whenReady().then(() => {
  try {
    const { pairChatReplies } = require('../dist-electron/services/danmu-into-packet.js')
    const chats = [
      { time: '2026-10-19 10:00:05', type: 'Chat', userName: '观众甲', content: '你真好看', giftName: '', giftCount: 0, giftPrice: 0, likeCount: 0 },
      { time: '2026-10-19 10:00:06', type: 'Chat', userName: '观众乙', content: '今天唱什么', giftName: '', giftCount: 0, giftPrice: 0, likeCount: 0 },
      { time: '2026-10-19 10:00:30', type: 'Chat', userName: '观众丙', content: '再来一首', giftName: '', giftCount: 0, giftPrice: 0, likeCount: 0 }
    ]
    const segments = [
      { t_ms: 6500, end_ms: 8500, t_label: '00:06.5', text: '谢谢，你们今天嘴真甜' },
      { t_ms: 34000, end_ms: 37000, t_label: '00:34.0', text: '好，再来一首，想听什么直接报' },
      { t_ms: 60000, end_ms: 62000, t_label: '01:00.0', text: '这句后面没有对应弹幕' }
    ]
    const pairs = pairChatReplies(chats, segments, '2026-10-19 10:00:00')
    assert(pairs.length === 2, '两条主播回复各聚合为一组')
    assert(pairs[0].chats.length === 2, '同一段回复前的两条弹幕合并')
    assert(pairs[0].reply.includes('嘴真甜') && pairs[0].firstDelay === 0.5, '回复文本和延迟计算正确')
    assert(pairs[1].chats[0].includes('再来一首'), '下一条弹幕能匹配后续回复')
    console.log('DANMU REPLY PAIR OK')
    app.exit(0)
  } catch (e) {
    console.error(e && e.stack ? e.stack : e)
    app.exit(1)
  }
})
