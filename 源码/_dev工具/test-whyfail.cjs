// 单独复现：第二场拆解为什么转写失败（打印全部日志）
const { app } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFileSync } = require('child_process')

app.setPath('userData', path.join(app.getPath('appData'), 'douyin-live-info'))
process.env.TEARDOWN_ENGINE = 'H:\\众艺传媒运营工具\\直播拆解引擎'
app.on('window-all-closed', () => { /* 别退 */ })

const LOGFILE = path.join(os.tmpdir(), 'test-whyfail.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  try { process.stdout.write(String(s) + '\n') } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => log('UNCAUGHT: ' + ((e && e.stack) || e)))

const DIR = 'H:\\迅雷下载'
const FFMPEG = 'H:\\众艺传媒运营工具\\直播拆解引擎\\bin\\ffmpeg\\bin\\ffmpeg.exe'
const SRC = 'H:\\众艺传媒运营工具\\直播拆解引擎\\录像\\直播_九九🍷（经典老歌）_344779995264_20261010_1926\\chunk_05.ts'
const CLIP = path.join(DIR, '复现_20261015130000_001.mp4')

app.whenReady().then(async () => {
  const td = require('../dist-electron/services/teardown.js')
  td.setLogHandler((l) => log('  ' + l))

  if (!fs.existsSync(CLIP)) {
    execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '150', '-t', '45',
      '-i', SRC, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-c:a', 'aac', '-b:a', '96k',
      '-movflags', '+frag_keyframe+empty_moov+default_base_moof', CLIP])
  }
  log('素材：' + CLIP + '  ' + fs.statSync(CLIP).size + ' 字节')

  // 先直接跑引擎的转写脚本，看看到底报什么
  const py = 'H:\\众艺传媒运营工具\\直播拆解引擎\\python-embed\\python.exe'
  const script = 'H:\\众艺传媒运营工具\\直播拆解引擎\\scripts\\transcript.py'
  const outDir = path.join(DIR, 'work_复现_20261015130000')
  fs.mkdirSync(outDir, { recursive: true })
  log('\n--- 直接跑 transcript.py ---')
  try {
    const r = execFileSync(py, [script, CLIP, '--out', path.join(outDir, 'transcript.json'), '--source', 'whisper', '--lang', 'zh'],
      { encoding: 'utf-8', timeout: 600000, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } })
    log('  转写输出：' + r.slice(-600))
  } catch (ex) {
    log('  转写失败：' + String(ex.stdout || '').slice(-1500))
    log('  stderr：' + String(ex.stderr || '').slice(-1500))
  }

  log('\n（清理）')
  try { fs.unlinkSync(CLIP) } catch { /* ignore */ }
  try { fs.rmSync(outDir, { recursive: true, force: true }) } catch { /* ignore */ }
  app.exit(0)
}).catch((e) => log('失败: ' + ((e && e.stack) || e)))
