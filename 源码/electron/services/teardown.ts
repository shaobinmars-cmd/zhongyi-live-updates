import { spawn, ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { app } from 'electron'
import * as logger from './logger'
import { loadConfig, getEffectiveOutputPath } from './record-config'
import { splitPacket, writeParts, SplitResult } from './packet-split'
import { appendDanmuSection } from './danmu-into-packet'
import * as tdConfig from './teardown-config'

const LOG_MODULE = 'Teardown'

const VIDEO_EXTS = [
  '.ts', '.mp4', '.mov', '.mkv', '.flv', '.m4v', '.avi',
  '.3gp', '.webm', '.mpg', '.mpeg', '.wmv', '.mts', '.m2ts'
]

const MAX_LOG_LINES = 3000

export interface EngineStatus {
  ok: boolean
  root: string
  python: string
  script: string
  ffmpeg: string
  pythonExists: boolean
  scriptExists: boolean
  ffmpegExists: boolean
  models: string[]
  modelDir: string
}

export interface TeardownState {
  running: boolean
  input: string
  model: string
  stage: string
  startedAt: number
  finishedAt: number
  exitCode: number | null
  workDir: string
  packetPath: string
  error: string
  lines: string[]
}

export interface RecordingEntry {
  kind: 'file' | 'dir'
  path: string
  name: string
  nickname: string
  sizeBytes: number
  mtime: number
  analyzed: boolean
  packetPath: string
  /** 录像文件已经不在了（被清理删掉），但 work_ 里的素材包/报告还在 */
  videoMissing?: boolean
}

export interface PacketInfo {
  split: SplitResult | null
  packetPath: string
  workDir: string
  offlineDraft: string
  segmentsStat: string
  grids: string[]
  transcriptPath: string
  content: string
}

// ---------------------------------------------------------------- engine root

let cachedRoot: string | null = null

function looksLikeEngine(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, 'python-embed', 'python.exe')) &&
      fs.existsSync(path.join(dir, '直播拆解工具.py'))
  } catch {
    return false
  }
}

/** 引擎目录：环境变量 > 打包内置 > 项目内 engine\ > 新项目根目录 */
export function resolveEngineRoot(): string {
  const candidates: string[] = []
  if (process.env.TEARDOWN_ENGINE) candidates.push(process.env.TEARDOWN_ENGINE)
  if (app.isPackaged) candidates.push(path.join(process.resourcesPath, 'engine'))
  try {
    candidates.push(path.join(app.getAppPath(), 'engine'))
  } catch { /* ignore */ }
  try {
    candidates.push(path.join(app.getAppPath(), '..', '直播拆解引擎'))
  } catch { /* ignore */ }
  candidates.push('H:\\众艺传媒运营工具\\直播拆解引擎')

  for (const c of candidates) {
    if (c && looksLikeEngine(c)) {
      if (cachedRoot !== c) logger.info(LOG_MODULE, `使用拆解引擎: ${c}`)
      cachedRoot = c
      return c
    }
  }
  return candidates[0] || ''
}

function modelCacheDir(): string {
  return path.join(os.homedir(), '.cache', 'huggingface', 'hub')
}

/** 本机已缓存的 whisper 模型名（tiny/base/small/medium/large-v3…） */
export function cachedModels(): string[] {
  const dir = modelCacheDir()
  const out: string[] = []
  try {
    for (const name of fs.readdirSync(dir)) {
      const m = /^models--Systran--faster-whisper-(.+)$/.exec(name)
      if (!m) continue
      const snapshots = path.join(dir, name, 'snapshots')
      try {
        if (fs.existsSync(snapshots) && fs.readdirSync(snapshots).length > 0) out.push(m[1])
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return out.sort()
}

export function engineStatus(): EngineStatus {
  const root = resolveEngineRoot()
  const python = root ? path.join(root, 'python-embed', 'python.exe') : ''
  const script = root ? path.join(root, '直播拆解工具.py') : ''
  const ffmpeg = root ? path.join(root, 'bin', 'ffmpeg', 'bin', 'ffmpeg.exe') : ''
  const pythonExists = !!python && fs.existsSync(python)
  const scriptExists = !!script && fs.existsSync(script)
  const ffmpegExists = !!ffmpeg && fs.existsSync(ffmpeg)
  return {
    ok: pythonExists && scriptExists,
    root,
    python,
    script,
    ffmpeg,
    pythonExists,
    scriptExists,
    ffmpegExists,
    models: cachedModels(),
    modelDir: modelCacheDir()
  }
}

// ------------------------------------------------------------------ job state

function emptyState(): TeardownState {
  return {
    running: false,
    input: '',
    model: 'small',
    stage: '',
    startedAt: 0,
    finishedAt: 0,
    exitCode: null,
    workDir: '',
    packetPath: '',
    error: '',
    lines: []
  }
}

let state: TeardownState = emptyState()
let proc: ChildProcess | null = null

let logHandler: ((line: string) => void) | null = null
let stateHandler: ((s: TeardownState) => void) | null = null

export function setLogHandler(cb: (line: string) => void): void { logHandler = cb }
export function setStateHandler(cb: (s: TeardownState) => void): void { stateHandler = cb }

export function getState(): TeardownState {
  return state
}

function pushLine(line: string): void {
  state.lines.push(line)
  if (state.lines.length > MAX_LOG_LINES) {
    state.lines.splice(0, state.lines.length - MAX_LOG_LINES)
  }
  logHandler?.(line)
}

function emitState(): void {
  stateHandler?.({ ...state, lines: [] })
}

/** 从日志文案里推一个粗略的阶段名，给界面显示进度用 */
function guessStage(line: string): string {
  if (line.includes('检查转写模型') || line.includes('[model]')) return '准备转写模型'
  if (line.includes('合并')) return '合并分段'
  if (line.includes('[index]')) return '镜头/响度索引'
  if (line.includes('[frames]') || line.includes('网格')) return '生成画面网格图'
  if (line.includes('[whisper]') || line.includes('[transcript]')) return '语音转写'
  if (line.includes('分段统计') || line.includes('离线草稿')) return '汇总分段与草稿'
  if (line.includes('素材包已生成')) return '生成素材包'
  return ''
}

export function workDirFor(input: string): string {
  try {
    const st = fs.statSync(input)
    // 老录制工具是「一场一个文件夹」，work 放里面。
    if (st.isDirectory()) return path.join(input, 'work')
  } catch { /* 录像可能已经被删了：下面仍然按路径算，别直接认输 */ }
  // 新录制器把文件平铺在输出目录里：按文件各用一个 work 目录。
  // 同前缀的分段（_000 / _001 / _1000…）算「同一场」，共用一个 work 目录。
  const base = path.basename(input, path.extname(input)).replace(/_\d{3,4}$/, '')
  return path.join(path.dirname(input), `work_${base}`)
}

/** 兼容旧版本：那时所有录像共用一个 work，翻出里面属于这个文件的那份 */
function legacyWorkDir(input: string): string {
  try {
    if (fs.statSync(input).isDirectory()) return ''
    const shared = path.join(path.dirname(input), 'work')
    const packet = path.join(shared, '拆解素材包.md')
    if (!fs.existsSync(packet)) return ''
    return fs.readFileSync(packet, 'utf-8').includes(path.basename(input)) ? shared : ''
  } catch {
    return ''
  }
}

export function packetPathFor(input: string): string {
  const wd = workDirFor(input)
  return wd ? path.join(wd, '拆解素材包.md') : ''
}

export function readPacket(input: string, limit?: number): PacketInfo | null {
  // 直接把「拆解素材包.md」拖进来：它自己就是素材包，
  // 不用配套录像、也不用 work 目录。以前这种情况直接被当成“找不到那场”，
  // 界面上一点反应都没有（运营说“拖进去没反应”就是这个）。
  let workDir = ''
  let packetPath = ''
  if (/\.md$/i.test(input) && fs.existsSync(input)) {
    packetPath = input
    workDir = path.dirname(input)
  } else {
    workDir = workDirFor(input)
    if (!workDir) return null
    packetPath = path.join(workDir, '拆解素材包.md')
    if (!fs.existsSync(packetPath)) {
      const legacy = legacyWorkDir(input)
      if (legacy) {
        workDir = legacy
        packetPath = path.join(workDir, '拆解素材包.md')
      }
    }
  }
  if (!fs.existsSync(packetPath)) return null
  const grids: string[] = []
  try {
    for (const f of fs.readdirSync(workDir)) {
      // 网格图现在是 jpg（体积小、适合喂 AI），旧的 png 也认，避免老素材包读不出来
      if (/^grid_\d+\.(png|jpe?g)$/i.test(f)) grids.push(path.join(workDir, f))
    }
  } catch { /* ignore */ }
  grids.sort()

  const opt = (name: string): string => {
    const p = path.join(workDir, name)
    return fs.existsSync(p) ? p : ''
  }

  let content = ''
  try {
    content = fs.readFileSync(packetPath, 'utf-8')
  } catch { /* ignore */ }

  return {
    packetPath,
    workDir,
    split: content ? splitPacket(content, limit || tdConfig.load().contextLimit) : null,
    offlineDraft: opt('报告草稿_离线.md'),
    segmentsStat: opt('分段统计.md'),
    grids,
    transcriptPath: opt('transcript.json'),
    content
  }
}

// -------------------------------------------------------------------- listing

function sizeOfFile(p: string): number {
  try { return fs.statSync(p).size } catch { return 0 }
}

function dirSize(p: string, depth = 0): number {
  if (depth > 3) return 0
  let total = 0
  try {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, e.name)
      if (e.isDirectory()) total += dirSize(full, depth + 1)
      else if (e.isFile()) total += sizeOfFile(full)
    }
  } catch { /* ignore */ }
  return total
}

function safeStat(p: string): fs.Stats | null {
  try { return fs.statSync(p) } catch { return null }
}

function entryFor(p: string, nicknameHint = ''): RecordingEntry | null {
  const st = safeStat(p)
  if (!st) return null
  const isDir = st.isDirectory()
  const base = path.basename(p)
  let nickname = nicknameHint
  if (!nickname) nickname = base.split('_')[0] || base
  const packet = packetPathFor(p)
  return {
    kind: isDir ? 'dir' : 'file',
    path: p,
    name: base,
    nickname,
    sizeBytes: isDir ? dirSize(p) : st.size,
    mtime: st.mtimeMs,
    analyzed: !!packet && fs.existsSync(packet),
    packetPath: packet
  }
}

/** 扫一个目录，挑出可以拆解的素材（视频文件 / 含 chunk_*.ts 的录制目录） */
function scanDir(dir: string, out: RecordingEntry[], maxEntries = 200): void {
  if (!dir || !fs.existsSync(dir)) return
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch { return }

  // 先按名字排序，保证 _000 在 _001 前面（下面分组时拿第一个当代表）
  entries.sort((a, b) => a.name.localeCompare(b.name))
  const sameSession = new Set<string>()

  for (const e of entries) {
    if (out.length >= maxEntries) return
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      // 拆解工具录的目录：直播_<主播>_<房间号>_<时间>
      let hasChunks = false
      try { hasChunks = fs.readdirSync(full).some(f => f.toLowerCase().startsWith('chunk_')) } catch { /* ignore */ }
      if (hasChunks || e.name.startsWith('直播_') || e.name.startsWith('下载_')) {
        const parts = e.name.split('_')
        const entry = entryFor(full, parts[1] || '')
        if (entry) out.push(entry)
        continue
      }
      continue
    }
    if (!e.isFile()) continue
    const ext = path.extname(e.name).toLowerCase()
    if (!VIDEO_EXTS.includes(ext)) continue
    // 一场直播会写成多个分段（每 30 分钟一段、断流重连再一段）：合起来只显示一条
    const sessionKey = path.join(dir, e.name.replace(/\.[^.]+$/, '').replace(/_\d{3,4}$/, ''))
    if (sameSession.has(sessionKey)) continue
    sameSession.add(sessionKey)
    const entry = entryFor(full)
    if (entry) out.push(entry)
  }
}

/** 列出可拆解的素材：本机录制目录 + 拆解工具自己的录像目录 */
export function listRecordings(): RecordingEntry[] {
  const seen = new Set<string>()
  const out: RecordingEntry[] = []

  const roots: string[] = []
  try {
    const cfg = loadConfig()
    roots.push(getEffectiveOutputPath(cfg))
  } catch { /* ignore */ }
  const engine = resolveEngineRoot()
  if (engine) roots.push(path.join(engine, '录像'))

  for (const r of roots) {
    const before = out.length
    scanDir(r, out)
    for (let i = before; i < out.length; i++) {
      if (seen.has(out[i].path)) { out.splice(i, 1); i--; continue }
      seen.add(out[i].path)
    }

    // 录像被清盘删掉之后，work_ 里的素材包和 AI 报告还在硬盘上。
    // 以前只扫录像文件，所以「以前的场次」在界面上直接消失了，根本没地方点。
    // 这里把这类「录像没了、产物还在」的场次也列出来。
    try {
      for (const name of fs.readdirSync(r)) {
        if (!name.startsWith('work_')) continue
        const prefix = name.slice(5)
        if (!prefix) continue
        // 录像还在的话，scanDir 已经列过这一场了，不重复
        if (out.some((e) => e.kind === 'file' && e.name.startsWith(prefix + '_'))) continue
        const wd = path.join(r, name)
        const st = safeStat(wd)
        if (!st || !st.isDirectory()) continue
        const presumed = path.join(r, prefix + '.mp4')
        if (seen.has(presumed)) continue
        seen.add(presumed)
        out.push({
          kind: 'file',
          path: presumed,
          name: prefix + '  ·录像已删',
          nickname: prefix.split('_')[0] || prefix,
          sizeBytes: dirSize(wd),
          mtime: st.mtimeMs,
          analyzed: fs.existsSync(path.join(wd, '拆解素材包.md')),
          packetPath: path.join(wd, '拆解素材包.md'),
          videoMissing: true
        })
      }
    } catch { /* 目录读不到就算了 */ }
  }
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}

// ------------------------------------------------------------------ the job
/**
 * 一场直播往往有多个分段（每 30 分钟一段 + 断流重连再一段），
 * 而引擎只吃单个视频文件 —— 所以拆之前先按同前缀合并成一个文件。
 * 已经合并过且比分段新，就直接复用。
 */
export async function prepareInput(input: string): Promise<string> {
  let st: fs.Stats
  try { st = fs.statSync(input) } catch { return input }
  if (st.isDirectory()) return input   // 老录制工具的目录，引擎自己会合并 chunk

  const dir = path.dirname(input)
  const ext = path.extname(input)
  const prefix = path.basename(input, ext).replace(/_\d{3,4}$/, '')

  let segs: string[] = []
  try {
    segs = fs.readdirSync(dir)
      .filter((f) => f.startsWith(prefix + '_') && f.toLowerCase().endsWith(ext.toLowerCase()) && /_\d{3,4}\./.test(f))
      .sort()
  } catch { return input }
  if (segs.length <= 1) return input

  const outFile = path.join(dir, `${prefix}${ext}`)
  try {
    const outStat = fs.statSync(outFile)
    const newest = Math.max(...segs.map((s) => fs.statSync(path.join(dir, s)).mtimeMs))
    if (outStat.size > 0 && outStat.mtimeMs >= newest) {
      pushLine(`—— 已合并过，直接用：${path.basename(outFile)} ——`)
      return outFile
    }
  } catch { /* 还没合并过 */ }

  const ffmpeg = engineStatus().ffmpeg
  if (!ffmpeg || !fs.existsSync(ffmpeg)) {
    pushLine('—— 找不到 ffmpeg，无法合并分段，先拆第一段 ——')
    return input
  }

  const listFile = path.join(dir, `${prefix}.concat.txt`)
  fs.writeFileSync(listFile, segs.map((s) => `file '${path.join(dir, s).replace(/\\/g, '/')}'`).join('\n'), 'utf-8')
  pushLine(`—— 本场有 ${segs.length} 个分段，正在合并（不重新编码，很快）——`)

  const ok = await new Promise<boolean>((resolve) => {
    const p = spawn(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outFile], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr?.on('data', (c: Buffer) => { err += c.toString() })
    p.on('exit', (code) => {
      try {
        if (code === 0 && fs.statSync(outFile).size > 0) return resolve(true)
      } catch { /* ignore */ }
      pushLine('合并失败：' + (err.trim().split('\n').pop() || `退出码 ${code}`))
      resolve(false)
    })
    p.on('error', () => resolve(false))
  })
  try { fs.unlinkSync(listFile) } catch { /* ignore */ }
  if (!ok) return input
  pushLine(`—— 合并完成：${path.basename(outFile)}（${(fs.statSync(outFile).size / 1024 / 1024).toFixed(1)} MB）——`)
  return outFile
}

/** 有合并文件就用合并文件（prepareInput 已经合过了），否则用原文件 */
function pickMerged(input: string): string {
  try {
    if (fs.statSync(input).isDirectory()) return ''
    const ext = path.extname(input)
    const prefix = path.basename(input, ext).replace(/_\d{3,4}$/, '')
    const outFile = path.join(path.dirname(input), `${prefix}${ext}`)
    return fs.existsSync(outFile) ? outFile : ''
  } catch {
    return ''
  }
}
/** 找出要拆的录像文件（input 可能是文件，也可能是装了分段/合并文件的目录） */
function resolveVideo(input: string): string {
  try {
    if (fs.statSync(input).isFile()) return input
  } catch { return '' }
  for (const name of ['merged.ts', 'merged.mp4', 'merged.flv']) {
    const p = path.join(input, name)
    if (fs.existsSync(p)) return p
  }
  try {
    const hit = fs.readdirSync(input).filter((f) => /\.(ts|mp4|flv)$/i.test(f)).sort()[0]
    return hit ? path.join(input, hit) : ''
  } catch { return '' }
}

/** 从引擎产物里读这场录像的时长（秒），读不到就返回 0 */
function readDuration(workDir: string): number {
  for (const name of ['manifest.json', 'transcript.json']) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(workDir, name), 'utf-8'))
      if (typeof j.duration_s === 'number' && j.duration_s > 0) return j.duration_s
    } catch { /* 没这个文件就算了 */ }
  }
  return 0
}

/**
 * 引擎产物里没写时长时，直接拿 ffmpeg 探一次录像长度（秒）。
 * 为什么需要：弹幕并入素材包要按“本场从几点到几点”取数据，
 * 以前拿不到时长就默认按 6 小时算，会把同一房间后面那场的弹幕也并进来。
 */
export function probeDurationSec(video: string): Promise<number> {
  return new Promise((resolve) => {
    const ffmpeg = engineStatus().ffmpeg
    if (!ffmpeg || !fs.existsSync(ffmpeg) || !video || !fs.existsSync(video)) return resolve(0)
    let settled = false
    const done = (v: number) => {
      if (settled) return
      settled = true
      try { p.kill() } catch { /* ignore */ }
      resolve(v)
    }
    let p: ChildProcess
    try {
      p = spawn(ffmpeg, ['-hide_banner', '-i', video], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    } catch {
      return resolve(0)
    }
    let err = ''
    p.stderr?.on('data', (c: Buffer) => {
      err += c.toString()
      // ffmpeg 读完文件头就会打 Duration，不用等它把整个文件读完
      const m = /Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(err)
      if (m) done(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]))
    })
    p.on('error', () => done(0))
    p.on('exit', () => done(0))
    setTimeout(() => done(0), 30000)
  })
}


function splitLines(buf: string, push: (line: string) => void): string {
  let rest = buf
  let idx = rest.indexOf('\n')
  while (idx >= 0) {
    push(rest.slice(0, idx).replace(/\r$/, ''))
    rest = rest.slice(idx + 1)
    idx = rest.indexOf('\n')
  }
  return rest
}

export interface RemoteResolveResult { ok: boolean; path?: string; message: string }

/** 把线上链接交给引擎下载成本地文件；直播链接按 durationSec 现录一段。 */
export function resolveRemote(url: string, durationSec = 600): Promise<RemoteResolveResult> {
  return new Promise((resolve) => {
    if (state.running) return resolve({ ok: false, message: '当前已有拆解或下载任务，先等它结束。' })
    if (!/^https?:\/\//i.test(String(url || '').trim())) return resolve({ ok: false, message: '链接格式不对，要以 http:// 或 https:// 开头。' })
    const status = engineStatus()
    const script = path.join(status.root || '', 'scripts', 'fetch_url.py')
    if (!status.ok || !fs.existsSync(script)) return resolve({ ok: false, message: '拆解引擎里缺少 fetch_url.py，请升级到最新版。' })

    const outDir = path.join(app.getPath('userData'), '网络素材')
    try { fs.mkdirSync(outDir, { recursive: true }) } catch { /* ignore */ }
    state = emptyState()
    state.running = true
    state.input = String(url || '').trim()
    state.model = ''
    state.startedAt = Date.now()
    state.stage = '解析/下载链接'
    emitState()
    pushLine('准备下载线上素材：' + state.input)

    const env: NodeJS.ProcessEnv = engineEnv({ WHISPER_DEVICE: tdConfig.load().whisperDevice || 'cpu' })
    const args = [script, state.input, '--out-dir', outDir, '--duration', String(Math.max(30, Number(durationSec) || 600))]
    let child: ChildProcess
    try {
      child = spawn(status.python, args, { cwd: status.root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      proc = child
    } catch (ex: any) {
      state.running = false
      state.stage = '链接下载失败'
      state.error = String(ex?.message || ex)
      emitState()
      return resolve({ ok: false, message: state.error })
    }

    let localPath = ''
    let tail = ''
    let outBuf = ''
    let errBuf = ''
    const handle = (chunk: Buffer, which: 'out' | 'err'): void => {
      const text = chunk.toString('utf-8')
      if (which === 'err') tail = (tail + text).slice(-4000)
      const push = (line: string): void => {
        const s = line.trim()
        if (!s) return
        if (s.startsWith('LOCAL_PATH:')) localPath = s.slice('LOCAL_PATH:'.length).trim()
        if (/下载|识别|直播|fetch/i.test(s)) state.stage = s.slice(0, 80)
        pushLine(s)
        emitState()
      }
      if (which === 'out') outBuf = splitLines(outBuf + text, push)
      else errBuf = splitLines(errBuf + text, push)
    }
    child.stdout?.on('data', (c: Buffer) => handle(c, 'out'))
    child.stderr?.on('data', (c: Buffer) => handle(c, 'err'))
    child.on('error', (err) => {
      state.error = '链接下载进程错误：' + err.message
      pushLine(state.error)
    })
    child.on('exit', (code) => {
      if (outBuf.trim()) pushLine(outBuf.trim())
      if (errBuf.trim()) pushLine(errBuf.trim())
      proc = null
      state.running = false
      state.exitCode = code
      state.finishedAt = Date.now()
      if (code === 0 && localPath && fs.existsSync(localPath)) {
        state.input = localPath
        state.workDir = workDirFor(localPath)
        state.stage = '链接素材已下载'
        pushLine('已下载到本地：' + localPath)
        emitState()
        resolve({ ok: true, path: localPath, message: '下载完成' })
      } else {
        state.stage = '链接下载失败'
        state.error = tail.trim().split(/\r?\n/).slice(-3).join(' ') || `下载进程退出码 ${code}`
        emitState()
        resolve({ ok: false, message: state.error })
      }
    })
  })
}

export function start(input: string, model = 'small'): TeardownState {
  if (state.running) {
    return state
  }

  const status = engineStatus()
  if (!status.ok) {
    state = emptyState()
    state.error = `拆解引擎不完整：找不到 ${status.pythonExists ? '' : 'python-embed\\python.exe '}${status.scriptExists ? '' : '直播拆解工具.py'}` +
      (status.root ? `（引擎目录：${status.root}）` : '（未找到引擎目录）')
    state.lines = [state.error]
    emitState()
    return state
  }

  if (!input || !fs.existsSync(input)) {
    state = emptyState()
    state.error = `输入不存在：${input}`
    state.lines = [state.error]
    emitState()
    return state
  }

  state = emptyState()
  state.running = true
  state.input = input
  state.model = model
  state.startedAt = Date.now()
  state.stage = '启动引擎'
  state.workDir = workDirFor(input)
  emitState()

  // 和下载脚本用同一套环境（UTF-8 + 模型镜像），不然运营机可能连不上 huggingface
  const env: NodeJS.ProcessEnv = engineEnv({
    WHISPER_DEVICE: tdConfig.load().whisperDevice || 'cpu'
  })

  logger.info(LOG_MODULE, `开始拆解 input=${input} model=${model}`)

  try {
    // 有合并文件就用合并文件（prepareInput 已经合好了）
    const engineInput = pickMerged(input) || input

    // 空文件（断流留下的 0 字节 / 只有个头的）提前拦住，别等跑到转写才报一个看不懂的错
    try {
      const st2 = fs.statSync(engineInput)
      if (st2.isFile() && st2.size < 32 * 1024) {
        state.running = false
        state.stage = '跳过（空文件）'
        state.error = `这个文件几乎是空的（${st2.size} 字节），没内容可拆 —— 多半是断流时留下的空文件，直接删掉重新录就行。`
        pushLine(state.error)
        emitState()
        return state
      }
    } catch { /* 拿不到大小就照常跑 */ }

    proc = spawn(status.python, [status.script, engineInput, model], {
      cwd: status.root,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (ex: any) {
    state.running = false
    state.error = `启动引擎失败：${ex.message}`
    pushLine(state.error)
    emitState()
    logger.error(LOG_MODULE, '启动引擎失败', ex)
    return state
  }

  let outBuf = ''
  let errBuf = ''

  const handle = (chunk: Buffer, which: 'out' | 'err'): void => {
    const text = chunk.toString('utf-8')
    const push = (line: string): void => {
      if (!line.trim()) return
      const stage = guessStage(line)
      if (stage) state.stage = stage
      pushLine(line)
      emitState()
    }
    if (which === 'out') outBuf = splitLines(outBuf + text, push)
    else errBuf = splitLines(errBuf + text, push)
  }

  proc.stdout?.on('data', (c: Buffer) => handle(c, 'out'))
  proc.stderr?.on('data', (c: Buffer) => handle(c, 'err'))

  proc.on('error', (err) => {
    state.error = `引擎进程错误：${err.message}`
    pushLine(state.error)
    logger.error(LOG_MODULE, '引擎进程错误', err)
  })

  proc.on('exit', async (code) => {
    if (outBuf.trim()) pushLine(outBuf.trim())
    if (errBuf.trim()) pushLine(errBuf.trim())
    proc = null
    state.running = false
    state.exitCode = code
    state.finishedAt = Date.now()

    const packet = packetPathFor(input)
    if (code === 0 && packet && fs.existsSync(packet)) {
      state.packetPath = packet
      state.stage = '完成'
      // 把这场的弹幕/礼物并进素材包（录制时写了旁注才做得了，没写就跳过）
      try {
        const video = pickMerged(input) || resolveVideo(input)
        if (video) {
          let dur = readDuration(state.workDir)
          if (!dur) {           // 引擎没写时长：自己探一次，别默认按 6 小时算
            dur = await probeDurationSec(video)
            if (dur > 0) pushLine(`—— 本场时长 ${Math.round(dur / 60)} 分钟（现场探得）——`)
          }
          const merged = await appendDanmuSection(state.workDir, video, dur)
          if (merged) pushLine('—— 已把本场弹幕/礼物并入素材包（第七节）——')
        }
      } catch (ex: any) {
        logger.warn(LOG_MODULE, `并入弹幕失败：${ex.message}`)
      }

      // 拆完把「为合并而生成的那个大文件」删掉：不然一场直播占两份空间。
      // 分段文件都还在，以后要重拆会自动再合并回来。
      try {
        const mi = pickMerged(input)
        if (mi && mi !== input && fs.existsSync(mi)) {
          fs.unlinkSync(mi)
          pushLine('—— 已删掉合并用的临时大文件（分段还在，可重复拆）——')
        }
      } catch (ex: any) {
        logger.warn(LOG_MODULE, `清理合并文件失败：${ex.message}`)
      }
      // 超过了上下文预算就自动分片，分片文件写在 work\分片\ 下
      try {
        const info = readPacket(input)
        if (info?.split?.split) {
          writeParts(info.workDir, info.split.parts)
          pushLine('—— ' + info.split.note + ' ——')
        }
      } catch (ex) {
        logger.warn(LOG_MODULE, '自动分片失败', ex)
      }
    } else if (code === 0) {
      state.stage = '结束（未生成素材包）'
      state.error = '分析跑完了但没找到 拆解素材包.md，看上面的日志定位。'
    } else {
      state.stage = '失败'
      state.error = state.error || `引擎以退出码 ${code} 结束，看上面的日志。`
    }
    pushLine(`—— ${state.stage} ——`)
    emitState()
    logger.info(LOG_MODULE, `拆解结束 code=${code} packet=${state.packetPath}`)
  })

  return state
}

export function stop(): TeardownState {
  if (!proc) return state
  const pid = proc.pid
  logger.info(LOG_MODULE, `停止拆解 pid=${pid}`)
  try {
    if (pid) {
      spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true })
    }
  } catch { /* ignore */ }
  try { proc.kill() } catch { /* ignore */ }
  state.stage = '已停止'
  pushLine('—— 已手动停止 ——')
  emitState()
  return state
}

export function isRunning(): boolean {
  return state.running
}

/** 正在拆解/合并的场次前缀（给磁盘清理做保护用，别把在用的文件删了） */
export function protectedPrefixes(): string[] {
  const out: string[] = []
  try {
    if (!state.running || !state.input) return out
    if (fs.statSync(state.input).isDirectory()) return out
    const prefix = path.basename(state.input, path.extname(state.input)).replace(/_\d{3,4}$/, '')
    if (prefix) out.push(prefix)
  } catch { /* ignore */ }
  return out
}

/** 按新的上下文预算重新分片，并写到 work\分片\ */
export function resplit(input: string, limit?: number): SplitResult | null {
  const info = readPacket(input, limit)
  if (!info || !info.split) return null
  if (info.split.split) writeParts(info.workDir, info.split.parts)
  return info.split
}

// ------------------------------------------------- 转写模型 / GPU 运行库（一键下载）

export interface PrefetchEvent {
  kind: 'model' | 'gpu'
  running: boolean
  line?: string
}

let prefetchHandler: ((e: PrefetchEvent) => void) | null = null
let prefetchProc: ChildProcess | null = null
let prefetchingKind: '' | 'model' | 'gpu' = ''

export function setPrefetchHandler(cb: (e: PrefetchEvent) => void): void { prefetchHandler = cb }

/** 给引擎的 Python 传一份和拆解时一致的环境（UTF-8 + 模型镜像） */
function engineEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    // 关键：不设这个，运营机下载模型会去 huggingface.co（国内连不上）
    HF_ENDPOINT: process.env.HF_ENDPOINT || 'https://hf-mirror.com',
    HF_HUB_DISABLE_XET: '1',
    ...extra
  }
}

/**
 * 跑一个引擎自带的下载脚本（prefetch_model.py / prefetch_gpu.py），
 * 输出一行一行推给界面，同时也写进日志。
 */
export function prefetch(kind: 'model' | 'gpu', args: string[] = []): Promise<{ ok: boolean; message: string }> {
  const status = engineStatus()
  if (!status.ok) {
    return Promise.resolve({ ok: false, message: '拆解引擎不完整，先确认引擎目录对不对。' })
  }
  if (prefetchingKind) {
    return Promise.resolve({ ok: false, message: '正在下载中，等它跑完再点一次。' })
  }
  if (state.running) {
    return Promise.resolve({ ok: false, message: '正在拆解，等拆完再下载。' })
  }

  const script = kind === 'model' ? 'prefetch_model.py' : 'prefetch_gpu.py'
  const scriptPath = path.join(status.root, 'scripts', script)
  if (!fs.existsSync(scriptPath)) {
    return Promise.resolve({ ok: false, message: `引擎里没有 ${script}（装的引擎太旧），装新版 App 后再试。` })
  }

  prefetchingKind = kind
  const send = (line?: string) => prefetchHandler?.({ kind, running: true, line })
  logger.info(LOG_MODULE, `开始下载 ${kind === 'model' ? '转写模型' : 'GPU 运行库'}：${args.join(' ')}`)
  send(`—— 开始下载${kind === 'model' ? '转写模型' : 'GPU 运行库'}${args[0] ? '：' + args[0] : ''} ——`)

  return new Promise((resolve) => {
    let proc: ChildProcess
    try {
      proc = spawn(status.python, [scriptPath, ...args], {
        cwd: status.root,
        env: engineEnv({ ...(status.ffmpegExists ? { PATH: path.dirname(status.ffmpeg) + path.delimiter + (process.env.PATH || '') } : {}) }),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (ex: any) {
      prefetchingKind = ''
      const msg = `启动下载脚本失败：${ex.message}`
      send(msg)
      prefetchHandler?.({ kind, running: false, line: msg })
      return resolve({ ok: false, message: msg })
    }

    prefetchProc = proc
    let buf = ''
    const onChunk = (c: Buffer) => {
      buf += c.toString('utf-8')
      let i = buf.indexOf('\n')
      while (i >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '')
        buf = buf.slice(i + 1)
        if (line.trim()) {
          logger.info(LOG_MODULE, `[prefetch] ${line.trim()}`)
          send(line.trim())
        }
        i = buf.indexOf('\n')
      }
    }
    proc.stdout?.on('data', onChunk)
    proc.stderr?.on('data', onChunk)
    proc.on('error', (err) => {
      logger.error(LOG_MODULE, '下载脚本进程错误', err)
      send(`下载脚本出错：${err.message}`)
    })
    proc.on('exit', (code) => {
      if (buf.trim()) send(buf.trim())
      prefetchProc = null
      prefetchingKind = ''
      const ok = code === 0
      const msg = ok
        ? (kind === 'model' ? '模型已就绪，可以开始拆解了。' : 'GPU 运行库已装好：把「转写设备」改成 GPU 再跑一场。')
        : `下载失败（退出码 ${code}），看上面的输出定位；多半是网络问题。`
      logger.info(LOG_MODULE, `下载结束 code=${code}`)
      prefetchHandler?.({ kind, running: false, line: `—— ${msg} ——` })
      resolve({ ok, message: msg })
    })
  })
}

export function cancelPrefetch(): boolean {
  if (!prefetchProc) return false
  try {
    const pid = prefetchProc.pid
    if (pid) spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true })
  } catch { /* ignore */ }
  return true
}
