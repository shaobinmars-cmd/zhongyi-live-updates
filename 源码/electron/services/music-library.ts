/**
 * 曲库：内置抖音无版权歌单，并允许运营建立文件夹、上传歌曲文件、继续导入歌单。
 * 数据与音频都放在 userData，软件升级不会覆盖。
 */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import { app } from 'electron'
import { spawn } from 'child_process'
import { resolveEngineRoot, engineStatus } from './teardown'
import * as logger from './logger'

const LOG = 'MusicLibrary'
const SEED_VERSION = '2026-10-19-v2'
export const BLOCKED_FOLDER_ID = '__blocked__'
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg', '.wma'])

export type MusicStatus = 'blocked' | 'ok' | 'unknown'

export interface MusicFolder {
  id: string
  name: string
  system: boolean
  createdAt: string
}

export interface MusicSong {
  id: string
  folderId: string
  title: string
  artist: string
  status: MusicStatus
  note: string
  source: string
  filePath: string
  updatedAt: string
}

interface MusicStore {
  version: string
  updatedAt: string
  folders: MusicFolder[]
  songs: MusicSong[]
}

export interface MusicStats {
  total: number
  blocked: number
  ok: number
  unknown: number
}

export interface MusicCheckResult {
  title: string
  artist: string
  result: 'blocked' | 'suspected' | 'ok'
  matchedTitle: string
  matchedArtist: string
  note: string
}

function storePath(): string {
  return path.join(app.getPath('userData'), 'music-library.json')
}

function filesRoot(): string {
  return path.join(app.getPath('userData'), 'music-library-files')
}

function seedPath(): string {
  const res = String((process as any).resourcesPath || '')
  const candidates = [
    res ? path.join(res, 'music-library-seed.json') : '',
    path.join(process.cwd(), 'data', 'music-library-seed.json'),
    path.join(app.getAppPath(), 'data', 'music-library-seed.json'),
    path.join(__dirname, '..', '..', 'data', 'music-library-seed.json')
  ]
  return candidates.find((p) => p && fs.existsSync(p)) || candidates[candidates.length - 1]
}

function normalize(s: unknown): string {
  return String(s || '').replace(/\s+/g, '').toLowerCase()
}

function artistKey(s: unknown): string {
  return normalize(String(s || '').normalize('NFKC').replace(/[／/&＆、,，+＋·\-—_]/g, ''))
}

function titleVariants(title: string): Set<string> {
  const full = normalize(String(title || '').normalize('NFKC'))
  const noBracket = normalize(String(title || '').normalize('NFKC').replace(/[（(\[【].*?[\]）)】]/g, ''))
  const noVersion = noBracket.replace(/(?:live|dj|remix|伴奏|翻唱|现场版|完整版|纯享|女版|男版|女声版|男声版|片段)/gi, '')
  return new Set([full, noBracket, noVersion].filter(Boolean))
}

function safePart(s: unknown, fallback = '未命名'): string {
  return String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100) || fallback
}

function localNow(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function songId(folderId: string, title: string, artist: string): string {
  return crypto.createHash('sha1').update(`${folderId}|${normalize(title)}|${normalize(artist)}`).digest('hex').slice(0, 16)
}

function makeFolder(name: string, id = ''): MusicFolder {
  const clean = safePart(name, '新文件夹')
  return { id: id || crypto.createHash('sha1').update(`${clean}|${Date.now()}`).digest('hex').slice(0, 12), name: clean, system: false, createdAt: localNow() }
}

function makeSong(input: Partial<MusicSong>, source = '手动添加'): MusicSong {
  const folderId = String(input.folderId || BLOCKED_FOLDER_ID)
  const title = String(input.title || '').trim()
  const artist = String(input.artist || '').trim()
  const status: MusicStatus = input.status === 'ok' || input.status === 'unknown' || input.status === 'blocked'
    ? input.status
    : folderId === BLOCKED_FOLDER_ID ? 'blocked' : 'unknown'
  return {
    id: input.id || songId(folderId, title, artist),
    folderId,
    title,
    artist,
    status,
    note: String(input.note || '').trim(),
    source: String(input.source || source).trim(),
    filePath: String(input.filePath || '').trim(),
    updatedAt: String(input.updatedAt || localNow())
  }
}

function blockedFolder(): MusicFolder {
  return { id: BLOCKED_FOLDER_ID, name: '抖音无版权（禁播）', system: true, createdAt: '2026-10-19 00:00' }
}

function readSeed(): MusicSong[] {
  try {
    const raw = JSON.parse(fs.readFileSync(seedPath(), 'utf-8'))
    const rows = Array.isArray(raw?.songs) ? raw.songs : []
    return rows
      .map((x: any) => makeSong({ ...x, folderId: BLOCKED_FOLDER_ID, status: x.status || 'blocked' }, x.source || '抖音无版权清单'))
      .filter((x: MusicSong) => x.title)
  } catch (ex: any) {
    logger.warn(LOG, `读取内置曲库失败：${ex?.message || ex}`)
    return []
  }
}

function normalizeFolders(data: any): MusicFolder[] {
  const folders: MusicFolder[] = Array.isArray(data?.folders)
    ? data.folders.map((f: any) => ({ id: String(f.id || ''), name: String(f.name || '').trim(), system: f.system === true, createdAt: String(f.createdAt || localNow()) })).filter((f: MusicFolder) => f.id && f.name)
    : []
  if (!folders.some((f) => f.id === BLOCKED_FOLDER_ID)) folders.unshift(blockedFolder())
  return folders
}

function validStore(data: any): MusicStore | null {
  if (!data || !Array.isArray(data.songs)) return null
  const folders = normalizeFolders(data)
  const ids = new Set(folders.map((f) => f.id))
  const songs = data.songs
    .map((x: any) => makeSong({ ...x, folderId: ids.has(String(x.folderId || '')) ? x.folderId : BLOCKED_FOLDER_ID }))
    .filter((x: MusicSong) => x.title)
  return { version: String(data.version || SEED_VERSION), updatedAt: String(data.updatedAt || localNow()), folders, songs }
}

function save(data: MusicStore): MusicStore {
  data.updatedAt = localNow()
  fs.mkdirSync(path.dirname(storePath()), { recursive: true })
  fs.writeFileSync(storePath(), JSON.stringify(data, null, 2), 'utf-8')
  return data
}

function load(): MusicStore {
  let data: MusicStore | null = null
  try {
    data = validStore(JSON.parse(fs.readFileSync(storePath(), 'utf-8')))
  } catch { /* 首次使用或文件损坏 */ }
  if (!data || !data.songs.length) {
    const seed = readSeed()
    data = save({ version: SEED_VERSION, updatedAt: localNow(), folders: [blockedFolder()], songs: seed })
  }
  return data
}

function songKey(s: Pick<MusicSong, 'folderId' | 'title' | 'artist'>): string {
  return `${s.folderId}|${normalize(s.title)}|${normalize(s.artist)}`
}

function merge(songs: MusicSong[], incoming: Partial<MusicSong>[], source: string): { added: number; updated: number; songs: MusicSong[] } {
  const map = new Map<string, MusicSong>()
  for (const s of songs) map.set(songKey(s), s)
  let added = 0
  let updated = 0
  for (const item of incoming) {
    const song = makeSong(item, source)
    if (!song.title) continue
    const key = songKey(song)
    const old = map.get(key)
    if (!old) {
      map.set(key, song)
      added++
      continue
    }
    const next = makeSong({
      ...old,
      status: song.status === 'blocked' ? 'blocked' : old.status,
      note: song.note || old.note,
      source: song.source || old.source
    })
    map.set(key, next)
    updated++
  }
  return { added, updated, songs: Array.from(map.values()) }
}

export function listFolders(): Array<MusicFolder & { count: number }> {
  const data = load()
  return data.folders.map((f) => ({ ...f, count: data.songs.filter((s) => s.folderId === f.id).length }))
}

export function listSongs(search = '', status = '', folderId = ''): MusicSong[] {
  const q = normalize(search)
  return load().songs
    .filter((s) => !folderId || s.folderId === folderId)
    .filter((s) => !status || s.status === status)
    .filter((s) => !q || normalize(`${s.title} ${s.artist} ${s.note}`).includes(q))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'blocked' ? -1 : b.status === 'blocked' ? 1 : 0
      return a.title.localeCompare(b.title, 'zh-CN') || a.artist.localeCompare(b.artist, 'zh-CN')
    })
}

export function stats(folderId = ''): MusicStats {
  const all = load().songs.filter((s) => !folderId || s.folderId === folderId)
  return {
    total: all.length,
    blocked: all.filter((s) => s.status === 'blocked').length,
    ok: all.filter((s) => s.status === 'ok').length,
    unknown: all.filter((s) => s.status === 'unknown').length
  }
}

export function addFolder(name: string): MusicFolder {
  if (!String(name || '').trim()) throw new Error('文件夹名称不能为空')
  const data = load()
  const folder = makeFolder(name)
  data.folders.push(folder)
  save(data)
  return folder
}

export function renameFolder(id: string, name: string): MusicFolder {
  const data = load()
  const folder = data.folders.find((f) => f.id === id)
  if (!folder) throw new Error('找不到文件夹')
  if (folder.system && id === BLOCKED_FOLDER_ID) throw new Error('禁播清单是系统文件夹，不能改名')
  folder.name = safePart(name, folder.name)
  save(data)
  return folder
}

export function removeFolder(id: string): boolean {
  const data = load()
  const folder = data.folders.find((f) => f.id === id)
  if (!folder) return false
  if (folder.system) throw new Error('系统文件夹不能删除')
  if (data.songs.some((s) => s.folderId === id)) throw new Error('文件夹里还有歌曲，先移动或删除歌曲')
  data.folders = data.folders.filter((f) => f.id !== id)
  save(data)
  try { fs.rmSync(path.join(filesRoot(), id), { recursive: true, force: true }) } catch { /* ignore */ }
  return true
}

export function addSong(input: Partial<MusicSong>): MusicSong {
  const data = load()
  const folderId = String(input.folderId || BLOCKED_FOLDER_ID)
  if (!data.folders.some((f) => f.id === folderId)) throw new Error('目标文件夹不存在')
  const song = makeSong({ ...input, folderId, id: '' }, input.source || '手动添加')
  if (!song.title) throw new Error('歌曲名不能为空')
  const merged = merge(data.songs, [song], song.source)
  save({ ...data, songs: merged.songs })
  return merged.songs.find((s) => songKey(s) === songKey(song)) || song
}

export function updateSong(id: string, patch: Partial<MusicSong>): MusicSong {
  const data = load()
  const i = data.songs.findIndex((s) => s.id === id)
  if (i < 0) throw new Error('找不到这首歌')
  const folderId = String(patch.folderId || data.songs[i].folderId)
  if (!data.folders.some((f) => f.id === folderId)) throw new Error('目标文件夹不存在')
  const next = makeSong({ ...data.songs[i], ...patch, folderId, updatedAt: localNow() })
  if (!next.title) throw new Error('歌曲名不能为空')
  const previousFolderId = data.songs[i].folderId
  if (next.filePath && previousFolderId !== folderId) {
    const root = path.resolve(filesRoot()) + path.sep
    const oldFull = path.resolve(app.getPath('userData'), next.filePath)
    if (!oldFull.startsWith(root)) throw new Error('歌曲文件路径异常，已拒绝移动')
    const targetDir = path.join(filesRoot(), folderId)
    fs.mkdirSync(targetDir, { recursive: true })
    const ext = path.extname(oldFull)
    const stem = path.basename(oldFull, ext)
    let target = path.join(targetDir, path.basename(oldFull))
    let n = 1
    while (target !== oldFull && fs.existsSync(target)) target = path.join(targetDir, `${stem}_${n++}${ext}`)
    if (target !== oldFull) {
      if (!fs.existsSync(oldFull)) throw new Error('歌曲文件不存在，无法移动到新文件夹')
      fs.renameSync(oldFull, target)
      next.filePath = path.relative(app.getPath('userData'), target)
    }
  }
  data.songs[i] = next
  save(data)
  return next
}

export function removeSong(id: string): boolean {
  const data = load()
  const song = data.songs.find((s) => s.id === id)
  if (!song) return false
  data.songs = data.songs.filter((s) => s.id !== id)
  save(data)
  if (song.filePath) {
    const full = path.resolve(app.getPath('userData'), song.filePath)
    const root = path.resolve(filesRoot()) + path.sep
    if (full.startsWith(root)) { try { fs.unlinkSync(full) } catch { /* ignore */ } }
  }
  return true
}

function runImport(file: string, defaultStatus: MusicStatus): Promise<any> {
  return new Promise((resolve, reject) => {
    const eng = engineStatus()
    const root = resolveEngineRoot()
    const script = path.join(root || '', 'scripts', 'music_import.py')
    if (!eng.ok || !fs.existsSync(script)) return reject(new Error('拆解引擎不完整，找不到曲库导入器。'))
    const out = path.join(os.tmpdir(), `zhongyi-music-${Date.now()}.json`)
    const p = spawn(eng.python, [script, file, '--out', out, '--default-status', defaultStatus], {
      cwd: root,
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try { p.kill() } catch { /* ignore */ }
      reject(new Error('导入超时，请把文件另存为 XLSX/CSV 再试。'))
    }, 120000)
    p.stdout?.on('data', (c: Buffer) => { stdout += c.toString('utf-8') })
    p.stderr?.on('data', (c: Buffer) => { stderr += c.toString('utf-8') })
    p.on('error', (ex) => { clearTimeout(timer); reject(ex) })
    p.on('exit', (code) => {
      clearTimeout(timer)
      try {
        if (code !== 0) return reject(new Error(stderr.trim().split(/\r?\n/).pop() || `导入器退出码 ${code}`))
        const data = JSON.parse(fs.readFileSync(out, 'utf-8'))
        try { fs.unlinkSync(out) } catch { /* ignore */ }
        resolve(data)
      } catch (ex: any) {
        reject(new Error(ex?.message || stderr || stdout || '导入失败'))
      }
    })
  })
}

export async function importFile(file: string, folderId = BLOCKED_FOLDER_ID, forceBlocked = false): Promise<any> {
  if (!file || !fs.existsSync(file)) throw new Error('没有选择歌单文件')
  const data = load()
  if (!data.folders.some((f) => f.id === folderId)) throw new Error('目标文件夹不存在')
  const defaultStatus: MusicStatus = folderId === BLOCKED_FOLDER_ID ? 'blocked' : 'unknown'
  const parsed = await runImport(file, defaultStatus)
  const incoming = (Array.isArray(parsed?.songs) ? parsed.songs : []).map((x: any) => ({ ...x, folderId, status: forceBlocked ? 'blocked' : x.status }))
  if (!incoming.length) throw new Error('文件里没有识别到歌曲，请确认有“歌曲名/歌名”和“歌手”列。')
  const source = path.basename(file)
  const merged = merge(data.songs, incoming, source)
  save({ ...data, songs: merged.songs })
  logger.info(LOG, `导入曲库：${source} -> ${folderId}，新增 ${merged.added}，更新 ${merged.updated}`)
  return {
    ok: true, added: merged.added, updated: merged.updated, count: incoming.length, total: merged.songs.length,
    message: `导入完成：新增 ${merged.added} 首，更新 ${merged.updated} 首`
  }
}

export async function checkFile(file: string): Promise<{ ok: boolean; count: number; blocked: number; suspected: number; okCount: number; results: MusicCheckResult[] }> {
  if (!file || !fs.existsSync(file)) throw new Error('没有选择歌单文件')
  const parsed = await runImport(file, 'unknown')
  const incoming = (Array.isArray(parsed?.songs) ? parsed.songs : []).map((x: any) => ({ title: String(x.title || '').trim(), artist: String(x.artist || '').trim() })).filter((x: any) => x.title)
  if (!incoming.length) throw new Error('文件里没有识别到歌曲，请确认有“歌曲名/歌名”和“歌手”列。')
  const blockedSongs = load().songs.filter((s) => s.folderId === BLOCKED_FOLDER_ID && s.status === 'blocked')
  const buckets = new Map<string, MusicSong[]>()
  for (const b of blockedSongs) {
    for (const v of titleVariants(b.title)) {
      const arr = buckets.get(v) || []
      arr.push(b)
      buckets.set(v, arr)
    }
  }
  const results: MusicCheckResult[] = incoming.map((song: any) => {
    const variants = [...titleVariants(song.title)]
    let candidates: MusicSong[] = []
    for (const v of variants) candidates = candidates.concat(buckets.get(v) || [])
    const unique = Array.from(new Map(candidates.map((s) => [s.id, s])).values())
    if (!unique.length) return { title: song.title, artist: song.artist, result: 'ok', matchedTitle: '', matchedArtist: '', note: '未命中抖音无版权禁播库，建议发布前再复核' }
    const a = artistKey(song.artist)
    const exact = a ? unique.find((b) => artistKey(b.artist) === a) : undefined
    if (exact) return { title: song.title, artist: song.artist, result: 'blocked', matchedTitle: exact.title, matchedArtist: exact.artist, note: `命中禁播库：${exact.title} / ${exact.artist || '歌手未知'}` }
    const b = unique[0]
    return { title: song.title, artist: song.artist, result: 'suspected', matchedTitle: b.title, matchedArtist: b.artist, note: `同名或同版本疑似禁播：${b.title} / ${b.artist || '歌手未知'}` }
  })
  const blocked = results.filter((r) => r.result === 'blocked').length
  const suspected = results.filter((r) => r.result === 'suspected').length
  return { ok: true, count: results.length, blocked, suspected, okCount: results.length - blocked - suspected, results }
}

export function saveCheckedResults(results: MusicCheckResult[], folderId: string, source: string): { added: number; updated: number } {
  const data = load()
  if (!data.folders.some((f) => f.id === folderId)) throw new Error('目标文件夹不存在')
  const byKey = new Map(data.songs.map((s) => [songKey(s), s]))
  let added = 0
  let updated = 0
  for (const r of results) {
    const status: MusicStatus = r.result === 'blocked' ? 'blocked' : r.result === 'ok' ? 'ok' : 'unknown'
    const existing = byKey.get(`${folderId}|${normalize(r.title)}|${normalize(r.artist)}`)
    if (existing) {
      existing.status = status
      existing.note = r.note
      existing.source = source || '匹配检测'
      existing.updatedAt = localNow()
      updated++
    } else {
      const row = makeSong({ folderId, title: r.title, artist: r.artist, status, note: r.note, source: source || '匹配检测' }, source || '匹配检测')
      data.songs.push(row)
      added++
    }
  }
  save(data)
  return { added, updated }
}

export function addAudioFiles(files: string[], folderId: string): { added: number; skipped: number } {
  const data = load()
  const folder = data.folders.find((f) => f.id === folderId)
  if (!folder) throw new Error('目标文件夹不存在')
  if (folder.id === BLOCKED_FOLDER_ID) throw new Error('禁播清单不能上传音频文件')
  const dir = path.join(filesRoot(), folderId)
  fs.mkdirSync(dir, { recursive: true })
  const incoming: Partial<MusicSong>[] = []
  let skipped = 0
  for (const src of files) {
    const ext = path.extname(src).toLowerCase()
    if (!AUDIO_EXTS.has(ext) || !fs.existsSync(src)) { skipped++; continue }
    const stem = path.basename(src, ext).trim() || '未命名歌曲'
    let fileName = `${safePart(stem)}${ext}`
    let n = 1
    while (fs.existsSync(path.join(dir, fileName))) fileName = `${safePart(stem)}_${n++}${ext}`
    const dest = path.join(dir, fileName)
    try {
      fs.copyFileSync(src, dest)
      incoming.push({ folderId, title: stem, artist: '', status: 'unknown', source: '上传文件', note: '', filePath: path.relative(app.getPath('userData'), dest) })
    } catch {
      skipped++
    }
  }
  if (!incoming.length) return { added: 0, skipped }
  const merged = merge(data.songs, incoming, '上传文件')
  save({ ...data, songs: merged.songs })
  return { added: merged.added, skipped }
}

export function openSong(id: string): string {
  const song = load().songs.find((s) => s.id === id)
  if (!song?.filePath) throw new Error('这首歌没有上传音频文件')
  const full = path.resolve(app.getPath('userData'), song.filePath)
  if (!fs.existsSync(full)) throw new Error('歌曲文件不存在，可能被移动或删除')
  return full
}

export function openFolder(id: string): string {
  const data = load()
  if (!data.folders.some((f) => f.id === id)) throw new Error('文件夹不存在')
  const dir = path.join(filesRoot(), id)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function dataFilePath(): string {
  return storePath()
}
