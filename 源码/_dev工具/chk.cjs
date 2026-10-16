const { app } = require('electron')
const path = require('path')
app.setPath('userData', path.join(app.getPath('appData'), 'douyin-live-info'))
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const db = require('../dist-electron/services/database.js')
  for (const [name, id, start] of [['S码的Teacher牛','7696729443973843727','2026-10-15 04:28:02'], ['小妖晶🦋','7696743951100857124','2026-10-15 04:28:00']]) {
    const rows = await db.getDanmuWindow(id, start, '2026-10-15 04:30:00')
    const g = rows.filter(r => r.type === 'Gift').length
    const c = rows.filter(r => r.type === 'Chat').length
    console.log(`${name}：窗口内弹幕 ${c} 条、礼物 ${g} 件（共 ${rows.length} 条记录）`)
  }
  app.exit(0)
}).catch(e => { console.log('失败: ' + e.message); app.exit(1) })