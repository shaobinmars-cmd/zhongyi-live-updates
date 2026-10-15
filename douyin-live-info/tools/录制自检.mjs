// 录制自检：用一个本地 HTTP 流，按正式录制用的那套 ffmpeg 参数真跑一遍，
// 验证「按时长切段」确实会切出多个可用分段。
//
//   node tools/录制自检.mjs
//
// 不需要抖音直播间，也不改任何配置，跑完自己清理临时文件。

import { spawn } from 'child_process'
import * as http from 'http'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FFMPEG = fs.existsSync(path.join(HERE, '..', 'ffmpeg.exe'))
  ? path.join(HERE, '..', 'ffmpeg.exe')
  : 'ffmpeg'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-check-'))
const CLIP = path.join(TMP, 'source.ts')
const SEG_SEC = 6
const CLIP_SEC = 24

// 必须用异步 spawn：spawnSync 会堵死事件循环，
// 本进程里的 HTTP 服务器就没法响应 ffmpeg 的请求，测试会假失败。
function run(bin, args) {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { windowsHide: true })
    let out = ''
    let err = ''
    p.stdout?.on('data', (d) => { out += d.toString() })
    p.stderr?.on('data', (d) => { err += d.toString() })
    p.on('close', (code) => resolve({ status: code, stdout: out, stderr: err }))
    p.on('error', (e) => resolve({ status: -1, stdout: out, stderr: String(e) }))
  })
}

async function probeDuration(file) {
  const r = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
  return parseFloat((r.stdout || '').trim()) || 0
}

console.log('临时目录：' + TMP)

console.log(`1) 生成 ${CLIP_SEC} 秒测试流…`)
const gen = await run(FFMPEG, [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', `testsrc=size=640x360:rate=25:duration=${CLIP_SEC}`,
  '-f', 'lavfi', '-i', `sine=frequency=440:duration=${CLIP_SEC}`,
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-shortest', '-f', 'mpegts', CLIP
])
if (!fs.existsSync(CLIP)) {
  console.error('生成测试流失败：' + (gen.stderr || '').slice(0, 400))
  process.exit(1)
}
console.log(`   源文件 ${(fs.statSync(CLIP).size / 1024).toFixed(0)} KB`)

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'video/mp2t' })
  fs.createReadStream(CLIP).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${server.address().port}/live.ts`
console.log('2) 本地流地址：' + url)

/** 和 stream-recorder.ts 的 buildArgs 保持一致的参数模板 */
function buildArgs(ext, outPattern) {
  const args = ['-hide_banner', '-loglevel', 'warning']
  args.push(
    '-reconnect', '1', '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5', '-rw_timeout', '15000000'
  )
  args.push('-i', url)
  if (ext === 'mp3') args.push('-vn', '-acodec', 'libmp3lame', '-q:a', '2')
  else if (ext === 'wav') args.push('-vn', '-acodec', 'pcm_s16le')
  else args.push('-c', 'copy')
  args.push('-f', 'segment', '-segment_format', ext)
  if (ext === 'mp4') {
    args.push('-segment_format_options', 'movflags=+frag_keyframe+empty_moov+default_base_moof')
  }
  args.push('-segment_time', String(SEG_SEC), '-reset_timestamps', '1', '-y', outPattern)
  return args
}

let failed = 0
for (const ext of ['mp3', 'mp4', 'flv']) {
  const dir = path.join(TMP, ext)
  fs.mkdirSync(dir, { recursive: true })
  console.log(`3) 测试 ${ext.toUpperCase()} 切段…`)
  const r = await run(FFMPEG, buildArgs(ext, path.join(dir, `seg_%03d.${ext}`)))
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.' + ext)).sort()
  if (files.length === 0) {
    console.log('   ✗ 没切出任何文件' + (r.stderr ? '：' + r.stderr.slice(0, 300) : ''))
    failed++
    continue
  }
  const zero = files.filter((f) => fs.statSync(path.join(dir, f)).size === 0).length
  const dur = await probeDuration(path.join(dir, files[0]))
  console.log(`   ✓ 切出 ${files.length} 段，首段 ${dur.toFixed(1)} 秒，空文件 ${zero} 个`)
  if (files.length < 2) { console.log('   ✗ 没有发生切段，参数有问题'); failed++ }
  if (zero > 0) { console.log('   ✗ 出现 0 字节分段'); failed++ }
}

// 4) 断流后 ffmpeg 会不会自己退出（只做观察；正式流程里 app 另有卡死看门狗兜底）
console.log('4) 观察断流行为：录 3 秒后关掉服务器…')
const dir2 = path.join(TMP, 'drop')
fs.mkdirSync(dir2, { recursive: true })
const p = spawn(FFMPEG, buildArgs('mp3', path.join(dir2, 'drop_%03d.mp3')), { windowsHide: true })
await new Promise((r) => setTimeout(r, 3000))
server.close()
server.closeAllConnections?.()
const exited = await new Promise((resolve) => {
  const t = setTimeout(() => resolve(false), 20000)
  p.on('exit', () => { clearTimeout(t); resolve(true) })
})
if (exited) console.log('   ✓ ffmpeg 自行退出，外层重连逻辑会接管')
else {
  console.log('   ⚠ ffmpeg 没有自己退出 —— 靠 app 里的「卡死看门狗」兜底（超时无数据就杀掉重启）')
  try { p.kill() } catch { /* ignore */ }
}

console.log('\n' + (failed === 0 ? '切段全部通过 ✓' : `有 ${failed} 项没通过 ✗`))
try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* ignore */ }
process.exit(failed === 0 ? 0 : 1)
