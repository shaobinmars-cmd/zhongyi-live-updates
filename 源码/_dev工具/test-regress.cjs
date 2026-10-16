// 回归测试（2.4.1）：
//  1) 断流重连不覆盖已录文件（分段号往后跳）
//  2) 两场连着拆 → 各自进自己的目录、后者不覆盖前者
//  3) 两场素材包都含第七节（弹幕/礼物）
const { app } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFileSync } = require('child_process')

app.setPath('userData', path.join(app.getPath('appData'), 'douyin-live-info'))
process.env.TEARDOWN_ENGINE = 'D:\\直播拆解工具'
app.on('window-all-closed', () => { /* 别退 */ })

const LOGFILE = path.join(os.tmpdir(), 'test-regress.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  try { process.stdout.write(String(s) + '\n') } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => log('UNCAUGHT: ' + ((e && e.stack) || e)))
process.on('unhandledRejection', (e) => log('UNHANDLED: ' + ((e && e.stack) || e)))

const DIR = 'H:\\迅雷下载'
const FFMPEG = 'D:\\直播拆解工具\\bin\\ffmpeg\\bin\\ffmpeg.exe'
const SRC = 'D:\\直播拆解工具\\录像\\直播_九九🍷（经典老歌）_344779995264_20261010_1926\\chunk_05.ts'

// 注意：chunk_05 只有 140 秒，起点别超过它（上次就是截空了才导致转写失败）
const A = { name: '回归甲_20261015130000', off: 20 }
const B = { name: '回归乙_20261015130000', off: 70 }

function makeClip(name, off) {
  const p = path.join(DIR, `${name}_001.mp4`)
  if (!fs.existsSync(p)) {
    execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(off), '-t', '45',
      '-i', SRC, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-c:a', 'aac', '-b:a', '96k',
      '-movflags', '+frag_keyframe+empty_moov+default_base_moof', p])
  }
  const p2 = path.join(DIR, `${name}_002.mp4`)
  const size = fs.statSync(p).size
  if (size < 100 * 1024) throw new Error(`截出来的测试素材太小（${size} 字节），起点可能超了素材时长`)
  if (!fs.existsSync(p2)) fs.copyFileSync(p, p2)
  return p
}

function waitDone(td, label) {
  return new Promise((resolve) => {
    const t = setInterval(() => {
      if (!td.getState().running) { clearInterval(t); setTimeout(resolve, 1200) }
    }, 3000)
  })
}

app.whenReady().then(async () => {
  const td = require('../dist-electron/services/teardown.js')
  const db = require('../dist-electron/services/database.js')
  td.setLogHandler((l) => { if (/合并|素材包|第七节|错误|失败/.test(l)) log('    ' + l) })

  // ---------- 1) 重连不覆盖：同一前缀，第二次用分段号 1000 ----------
  log('=== 1) 断流重连不覆盖已录文件 ===')
  const tmp = path.join(os.tmpdir(), 'segtest')
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.mkdirSync(tmp, { recursive: true })
  const pat = path.join(tmp, 'cam_%03d.mp4')
  const base = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10', '-t', '1',
    '-f', 'segment', '-segment_time', '1', '-segment_format', 'mp4']
  execFileSync(FFMPEG, [...base, pat])
  const first = fs.readdirSync(tmp).filter((f) => f.endsWith('.mp4')).sort()
  const sizeAfterFirst = fs.statSync(path.join(tmp, first[0])).size
  log(`   第一次录制生成：${first.join(', ')}（${first[0]} ${sizeAfterFirst} 字节）`)
  execFileSync(FFMPEG, [...base, '-segment_start_number', '1000', pat])
  const after = fs.readdirSync(tmp).filter((f) => f.endsWith('.mp4')).sort()
  const sizeNow = fs.statSync(path.join(tmp, first[0])).size
  log(`   重连后目录：${after.join(', ')}`)
  log(`   原文件是否被改：${sizeNow === sizeAfterFirst ? '没被改 ✓' : '被覆盖 ✗（' + sizeAfterFirst + ' -> ' + sizeNow + '）'}`)
  log(`   新分段是否另存：${after.includes('cam_1000.mp4') ? '是 ✓' : '否 ✗'}`)

  // ---------- 2) 两场连着拆 ----------
  log('\n=== 2) 两场连着拆，互不覆盖 ===')
  const rooms = (await db.getRooms()).filter((r) => r.messageCount > 0).sort((a, b) => b.messageCount - a.messageCount)
  if (rooms.length < 1) { log('库里没有弹幕记录，跳过'); app.exit(1); return }

  const startA = makeClip(A.name, A.off)
  const startB = makeClip(B.name, B.off)
  const clipA = path.join(DIR, `${A.name}.mp4`)
  const clipB = path.join(DIR, `${B.name}.mp4`)

  for (const [cfg, st, room] of [[A, startA, rooms[0]], [B, startB, rooms[Math.min(1, rooms.length - 1)]]]) {
    const rows = await db.getDanmuWindow(room.roomId, '2000-01-01 00:00:00', '2099-01-01 00:00:00')
    fs.writeFileSync(path.join(DIR, `${cfg.name}.meta.json`), JSON.stringify({
      roomId: room.roomId, nickname: cfg.name, format: 'mp4',
      startedAtUtc: rows[0].time, startedAtLocal: '测试'
    }, null, 2), 'utf-8')
    log(`   ${cfg.name} → 绑定房间「${room.nickname}」，起点 ${rows[0].time}`)
  }

  log('\n   —— 拆第一场（甲） ——')
  td.start(startA, 'small')
  await waitDone(td, 'A')
  const pA = td.packetPathFor(startA)
  log('   甲 素材包：' + pA + (fs.existsSync(pA) ? ' ✓ 存在' : ' ✗ 不存在'))
  const aStat = fs.existsSync(pA) ? fs.statSync(pA) : null
  const aText = aStat ? fs.readFileSync(pA, 'utf-8') : ''

  log('\n   —— 拆第二场（乙） ——')
  td.start(startB, 'small')
  await waitDone(td, 'B')
  const pB = td.packetPathFor(startB)
  log('   乙 素材包：' + pB + (fs.existsSync(pB) ? ' ✓ 存在' : ' ✗ 不存在'))

  log('\n=== 3) 检查结果 ===')
  log('   甲、乙是两个不同目录：' + (path.dirname(pA) !== path.dirname(pB) ? '是 ✓' : '不是 ✗（会互相覆盖）'))
  if (aStat && fs.existsSync(pA)) {
    const now = fs.statSync(pA)
    log('   拆完乙之后，甲的素材包：' + (now.size === aStat.size ? '原样未动 ✓' : `被改了 ✗（${aStat.size} -> ${now.size}）`))
  }
  log('   甲含第七节（弹幕礼物）：' + (aText.includes('## 七、弹幕与礼物') ? '是 ✓' : '否 ✗'))
  const bText = fs.existsSync(pB) ? fs.readFileSync(pB, 'utf-8') : ''
  log('   乙含第七节（弹幕礼物）：' + (bText.includes('## 七、弹幕与礼物') ? '是 ✓' : '否 ✗'))
  log('   甲字数=' + aText.length + '　乙字数=' + bText.length)

  // 清理测试素材
  for (const f of [startA, startB, clipA, clipB]) { try { fs.unlinkSync(f) } catch { /* ignore */ } }
  for (const n of [A.name, B.name]) { try { fs.unlinkSync(path.join(DIR, `${n}.meta.json`)) } catch { /* ignore */ } }
  try { fs.rmSync(path.join(DIR, `work_${A.name}`), { recursive: true, force: true }) } catch { /* ignore */ }
  try { fs.rmSync(path.join(DIR, `work_${B.name}`), { recursive: true, force: true }) } catch { /* ignore */ }
  log('\n（测试素材已清理）')
  app.exit(0)
}).catch((e) => log('失败: ' + ((e && e.stack) || e)))
