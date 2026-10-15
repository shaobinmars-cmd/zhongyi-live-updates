const { app } = require('electron')
const path = require('path')
app.setPath('userData', path.join(app.getPath('appData'), 'douyin-live-info'))
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const db = require('../dist-electron/services/database.js')
  const rooms = await db.getRooms()
  const t = rooms.filter(r => r.messageCount > 0).sort((a,b) => b.messageCount - a.messageCount)[0]
  const rows = await db.getDanmuWindow(t.roomId, '2000-01-01 00:00:00', '2099-01-01 00:00:00')
  const gifts = rows.filter(r => r.type === 'Gift')
  console.log('房间：' + t.nickname + '  礼物行数=' + gifts.length)
  console.log('样例（前 8 条）：')
  for (const g of gifts.slice(0, 8)) console.log('  ' + JSON.stringify({ t: g.time.substring(11), gift: g.giftName, cnt: g.giftCount, price: g.giftPrice, user: g.userName.slice(0,6) }))
  const names = {}
  for (const g of gifts) { const k = g.giftName + '|' + g.giftPrice; names[k] = (names[k] || 0) + 1 }
  console.log('礼物种类（名称|单价 -> 条数）：'); for (const [k,v] of Object.entries(names).slice(0,20)) console.log('  ' + k + ' -> ' + v)
  const stats = rows.filter(r => r.type === 'Stats')
  console.log('统计行数=' + stats.length + '，样例：' + (stats[0] ? stats[0].content : '无'))
  const members = rows.filter(r => r.type === 'Member').length
  const social = rows.filter(r => r.type === 'Social').length
  const likes = rows.filter(r => r.type === 'Like').length
  console.log(`进场=${members} 关注=${social} 点赞=${likes}`)
  app.exit(0)
}).catch(e => { console.log('失败: ' + e.message); app.exit(1) })