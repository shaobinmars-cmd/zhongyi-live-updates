// 验证「弹幕/礼物并入素材包」：用今天真实收的弹幕数据跑一遍
// 运行：electron test-danmu-packet.cjs

const { app } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

app.setPath('userData', path.join(app.getPath('appData'), 'douyin-live-info'))
app.on('window-all-closed', () => { /* 别退 */ })

const LOGFILE = path.join(os.tmpdir(), 'test-danmu-packet.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  try { process.stdout.write(String(s) + '\n') } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => log('UNCAUGHT: ' + ((e && e.stack) || e)))

app.whenReady().then(async () => {
  const db = require('../dist-electron/services/database.js')
  const merge = require('../dist-electron/services/danmu-into-packet.js')

  const rooms = await db.getRooms()
  log('库里有多少个房间：' + rooms.length)
  for (const r of rooms.slice(0, 6)) log(`  ${r.nickname || '(没名字)'} roomId=${r.roomId} 消息=${r.messageCount} 最后=${r.lastActive}`)

  const target = rooms.filter((r) => r.messageCount > 0).sort((a, b) => b.messageCount - a.messageCount)[0]
  if (!target) { log('库里没有弹幕记录，先连一个直播间接一会儿再来测'); app.exit(1); return }
  log(`\n用这个房间来测：${target.nickname}（${target.messageCount} 条）`)

  // 取它的时间范围
  const all = await db.getDanmuWindow(target.roomId, '2000-01-01 00:00:00', '2099-01-01 00:00:00')
  log('时间范围：' + all[0].time + '  →  ' + all[all.length - 1].time + `（共 ${all.length} 条）`)

  // 造一个假的录像目录 + 旁注
  const dir = path.join(os.tmpdir(), 'danmu-packet-test')
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(path.join(dir, 'work'), { recursive: true })
  const video = path.join(dir, `${target.nickname || '测试主播'}_20261015120000_001.mp4`)
  fs.writeFileSync(video, 'fake')
  fs.writeFileSync(path.join(dir, `${path.basename(video, '.mp4').replace(/_\d{3}$/, '')}.meta.json`), JSON.stringify({
    roomId: target.roomId,
    nickname: target.nickname,
    format: 'mp4',
    startedAtUtc: all[0].time,
    startedAtLocal: '测试'
  }, null, 2), 'utf-8')
  fs.writeFileSync(path.join(dir, 'work', '拆解素材包.md'), '# 直播拆解素材包\n\n（这里本来是引擎生成的内容）\n', 'utf-8')

  const merged = await merge.appendDanmuSection(path.join(dir, 'work'), video, 1800)
  log('\n并入结果：' + (merged ? '成功 → ' + merged : '没并入（可能是时间对不上）'))

  if (merged) {
    const text = fs.readFileSync(merged, 'utf-8')
    log(`\n素材包现在 ${text.length} 字，新增的部分：\n`)
    const idx = text.indexOf('## 七、弹幕与礼物')
    log(text.slice(idx, idx + 1200))
  }
  app.exit(0)
}).catch((e) => log('失败: ' + ((e && e.stack) || e)))
