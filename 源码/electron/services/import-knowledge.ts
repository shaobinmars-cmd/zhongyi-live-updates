/**
 * 资料一键导入引擎：PDF / Word(docx) / TXT / CSV / Markdown → 话术库·PK玩法库 条目
 * 零外部依赖：
 *  - PDF：手写最小解析器（FlateDecode 解压 + ToUnicode CMap 反查 CID→Unicode + 按 Tm 坐标重组行）
 *  - DOCX：zip 容器手工遍历 + word/document.xml 提取 w:t 文本
 *  - 文本切分：编号(1. 2、3)) / 中文小节标题(一、二、) / CSV 列 三种启发式
 * 适配 Word/WPS 导出的中文文本型 PDF；扫描件（图片型）提不出文字会如实提示。
 */
import * as fs from 'fs'
import * as path from 'path'
import * as zlib from 'zlib'
import type { Row } from './incubate'

// ------------------------------------------------------------------ PDF 文本提取
interface Frag { seq: number; y: number; x: number; t: string }

function pdfStreams(data: Buffer): { head: Buffer; dec: Buffer | null }[] {
  const out: { head: Buffer; dec: Buffer | null }[] = []
  let pos = 0
  for (;;) {
    const s = data.indexOf(Buffer.from('stream'), pos)
    if (s < 0) break
    let start = s + 6
    if (data[start] === 0x0d && data[start + 1] === 0x0a) start += 2
    else if (data[start] === 0x0a) start += 1
    const e = data.indexOf(Buffer.from('endstream'), start)
    if (e < 0) break
    const raw = data.subarray(start, e)
    const head = data.subarray(Math.max(0, s - 400), s)
    let dec: Buffer | null = null
    try { dec = zlib.inflateSync(raw) } catch { /* 非 flate 流跳过 */ }
    out.push({ head, dec })
    pos = e + 9
  }
  return out
}

function uniFromHex(hex: string): string {
  try {
    const buf = Buffer.from(hex, 'hex')
    // UTF-16BE（含代理对）
    return buf.swap16().toString('utf16le')
  } catch { return '' }
}

function parseToUnicode(cmap: Buffer): Map<number, string> {
  const mp = new Map<number, string>()
  const s = cmap.toString('latin1')
  const blocks = (tag: string) => {
    const re = new RegExp('begin' + tag + '([\\s\\S]*?)end' + tag, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(s))) yieldBlock(m[1])
  }
  const yieldBlock = (body: string) => { /* placeholder replaced below */ }
  // bfchar
  {
    const re = /beginbfchar([\s\S]*?)endbfchar/g
    let m: RegExpExecArray | null
    while ((m = re.exec(s))) {
      const lineRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g
      let lm: RegExpExecArray | null
      while ((lm = lineRe.exec(m[1]))) mp.set(parseInt(lm[1], 16), uniFromHex(lm[2]))
    }
  }
  // bfrange
  {
    const re = /beginbfrange([\s\S]*?)endbfrange/g
    let m: RegExpExecArray | null
    while ((m = re.exec(s))) {
      const body = m[1]
      // 数组形式 <a> <b> [<c1> <c2> …]
      const arrRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g
      let am: RegExpExecArray | null
      const consumed: [number, number][] = []
      while ((am = arrRe.exec(body))) {
        const a = parseInt(am[1], 16), b = parseInt(am[2], 16)
        const vals = [...am[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map((v) => v[1])
        for (let i = 0; i < Math.min(vals.length, b - a + 1); i++) mp.set(a + i, uniFromHex(vals[i]))
        consumed.push([am.index, am.index + am[0].length])
      }
      // 连续形式（跳过数组行）
      const cleaned = body.replace(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[[\s\S]*?\]/g, '')
      const seqRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g
      let sm: RegExpExecArray | null
      while ((sm = seqRe.exec(cleaned))) {
        const a = parseInt(sm[1], 16), b = parseInt(sm[2], 16), c = parseInt(sm[3], 16)
        for (let i = 0; i <= b - a; i++) mp.set(a + i, String.fromCodePoint(c + i))
      }
    }
  }
  void blocks
  return mp
}

export function extractPdfText(file: string): string {
  const data = fs.readFileSync(file)
  const streams = pdfStreams(data)
  // 1) obj → cmap
  const objCmap = new Map<number, Map<number, string>>()
  for (const { head, dec } of streams) {
    if (!dec || !(dec.includes(Buffer.from('beginbfchar')) || dec.includes(Buffer.from('beginbfrange')))) continue
    const om = /(\d+)\s+0\s+obj/.exec(head.toString('latin1'))
    if (om) objCmap.set(parseInt(om[1], 10), parseToUnicode(dec))
  }
  // 2) 字体对象 → cmap；资源名 → cmap
  const raw = data.toString('latin1')
  const fontObjCmap = new Map<number, Map<number, string>>()
  {
    const re = /(\d+)\s+0\s+obj([\s\S]*?)endobj/g
    let m: RegExpExecArray | null
    while ((m = re.exec(raw))) {
      const body = m[2]
      const tm = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(body)
      if (tm && (body.includes('/Font') || body.includes('/BaseFont'))) {
        const cm = objCmap.get(parseInt(tm[1], 10))
        if (cm) fontObjCmap.set(parseInt(m[1], 10), cm)
      }
    }
  }
  const nameCmap = new Map<string, Map<number, string>>()
  {
    const re = /\/([A-Za-z][A-Za-z0-9]{1,15})\s+(\d+)\s+0\s+R/g
    let m: RegExpExecArray | null
    while ((m = re.exec(raw))) {
      const cm = fontObjCmap.get(parseInt(m[2], 10))
      if (cm && !nameCmap.has(m[1])) nameCmap.set(m[1], cm)
    }
  }
  const globalMap = new Map<number, string>()
  for (const mp of objCmap.values()) for (const [k, v] of mp) globalMap.set(k, v)

  // 3) 内容流抓 (x, y, text)
  const frags: Frag[] = []
  let seq = 0
  for (const { dec } of streams) {
    if (!dec || !dec.includes(Buffer.from('BT'))) continue
    const s = dec.toString('latin1')
    const btRe = /BT([\s\S]*?)ET/g
    let bm: RegExpExecArray | null
    let curFont = ''
    while ((bm = btRe.exec(s))) {
      const blk = bm[1]
      const fm = [...blk.matchAll(/\/([A-Za-z][A-Za-z0-9]{1,15})\s+[\d.]+\s+Tf/g)]
      if (fm.length) curFont = fm[fm.length - 1][1]
      const tm = /([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm/.exec(blk)
      const x = tm ? parseFloat(tm[5]) : 0
      const y = tm ? parseFloat(tm[6]) : 0
      const mp = nameCmap.get(curFont) || globalMap
      let t = ''
      for (const hm of blk.matchAll(/<([0-9A-Fa-f]+)>/g)) {
        const hx = hm[1]
        for (let i = 0; i + 4 <= hx.length; i += 4) {
          const ch = mp.get(parseInt(hx.substr(i, 4), 16))
          if (ch) t += ch
        }
      }
      // 括号字符串（少见，兜底 GBK/UTF-16BE）
      for (const sm of blk.matchAll(/\((?:\\.|[^\\()])*\)/g)) {
        const b = Buffer.from(sm[0].slice(1, -1), 'latin1')
        if (b.length >= 2 && b.length % 2 === 0) {
          try { t += Buffer.from(b).swap16().toString('utf16le') } catch { /* ignore */ }
        }
      }
      if (t.trim()) frags.push({ seq: seq++, y, x, t })
    }
  }
  // 4) y 分行、x 排序
  frags.sort((a, b) => a.seq - b.seq)
  const lines: string[] = []
  let cur: { x: number; t: string }[] = []
  let curY: number | null = null
  for (const f of frags) {
    if (curY === null || Math.abs(f.y - curY) <= 3) {
      cur.push({ x: f.x, t: f.t })
      if (curY === null) curY = f.y
    } else {
      cur.sort((a, b) => a.x - b.x)
      lines.push(cur.map((c) => c.t).join(''))
      cur = [{ x: f.x, t: f.t }]
      curY = f.y
    }
  }
  if (cur.length) {
    cur.sort((a, b) => a.x - b.x)
    lines.push(cur.map((c) => c.t).join(''))
  }
  return lines.join('\n')
}

// ------------------------------------------------------------------ DOCX 文本提取
export function extractDocxText(file: string): string {
  const data = fs.readFileSync(file)
  // 手工遍历 zip local file headers，找 word/document.xml
  let pos = 0
  while (pos + 30 < data.length) {
    if (data.readUInt32LE(pos) !== 0x04034b50) break
    const method = data.readUInt16LE(pos + 8)
    const compSize = data.readUInt32LE(pos + 18)
    const nameLen = data.readUInt16LE(pos + 26)
    const extraLen = data.readUInt16LE(pos + 28)
    const name = data.subarray(pos + 30, pos + 30 + nameLen).toString('utf8')
    const bodyStart = pos + 30 + nameLen + extraLen
    if (name === 'word/document.xml') {
      let xml: Buffer
      const body = data.subarray(bodyStart, bodyStart + compSize)
      if (method === 8) xml = zlib.inflateRawSync(body)
      else if (method === 0) xml = body
      else return ''
      const s = xml.toString('utf8')
      // w:p → 换行；w:t → 文本
      const paras = s.split(/<\/w:p>/)
      const lines: string[] = []
      for (const p of paras) {
        const texts = [...p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) =>
          m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"'))
        const line = texts.join('').trim()
        if (line) lines.push(line)
      }
      return lines.join('\n')
    }
    pos = bodyStart + compSize
  }
  return ''
}

// ------------------------------------------------------------------ 文本 → 条目
const NUM_RE = /^\s*\d{1,3}\s*[.,、;；)）]\s*/
const SEC_RE = /^\s*([一二三四五六七八九十]+)[、.．]\s*(.{1,24})$/

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/[，,。.!！?？;；:：、~·\s]+$/, '').trim()
}

/**
 * 通用切分：
 * - CSV/TSV（≥2 列且首行像表头或多行同列数）→ 按列映射
 * - 编号清单 → 每条一个条目；中文小节标题作为【小类】前缀
 * - 无编号 → 每行一条
 */
export function splitTextToItems(text: string): { sec: string; body: string }[] {
  const items: { sec: string; body: string }[] = []
  const lines = text.split(/\r?\n/)
  // CSV / TSV 判定：超过 3 行含同一分隔符且列数 ≥2
  const delimLines = lines.filter((l) => (l.includes('\t') || (l.match(/,/g) || []).length >= 1))
  if (delimLines.length >= 3 && delimLines.length >= lines.filter((l) => l.trim()).length * 0.6) {
    for (const l of lines) {
      if (!l.trim()) continue
      const cols = l.includes('\t') ? l.split('\t') : l.split(/[,，]/)
      const body = clean(cols[cols.length - 1] || '')
      const sec = clean(cols.slice(0, -1).join(' '))
      if (body && body.length >= 4 && !/^(场景|分类|回复|内容|惩罚|游客说)/.test(body)) items.push({ sec, body })
    }
    if (items.length) return items
  }
  let sec = ''
  let buf: string[] = []
  const flush = () => {
    const body = clean(buf.join(' '))
    if (body && body.length >= 4 && !(body.length < 40 && body.includes('话术'))) items.push({ sec, body })
    buf = []
  }
  for (const raw of lines) {
    const l = raw.trim()
    if (!l) { flush(); continue }
    const sm = SEC_RE.exec(l)
    if (sm && l.length <= 26) { flush(); sec = clean(sm[2]); continue }
    if (NUM_RE.test(l)) {
      flush()
      const body = l.replace(NUM_RE, '')
      if (body) buf.push(body)
      continue
    }
    // 单独短标题行（要礼物切入那种小节名）：无论 buf 是否非空都切小节
    if (l.length <= 16 && !/[。!?，,;；]$/.test(l) && !/^\d/.test(l) && !/[。!?]/.test(l)) { flush(); sec = clean(l); continue }
    buf.push(l)
  }
  flush()
  // 全文无编号也无小节：每行一条
  if (!items.length) {
    for (const raw of lines) {
      const body = clean(raw.replace(NUM_RE, ''))
      if (body && body.length >= 4) items.push({ sec: '', body })
    }
  }
  return items
}

/** 组装成目标库的行：话术库(场景/游客说/回复方案) | PK玩法库(分类/惩罚内容/安全提示) */
export function itemsToRows(table: string, items: { sec: string; body: string }[], source: string): Row[] {
  const rows: Row[] = []
  const seen = new Set<string>()
  for (const it of items) {
    const body = it.body.slice(0, 600)
    if (seen.has(body)) continue
    seen.add(body)
    if (table === 'PK玩法库') {
      rows.push({ 分类: it.sec || '导入资料', 惩罚内容: body, 安全提示: '请主播量力而行，不逞强、不涉险', 出处: source })
    } else {
      rows.push({ 场景: it.sec || '导入资料', 游客说: '', 回复方案: body, 出处: source })
    }
  }
  return rows
}

/** 入口：按扩展名解析文件 → 条目行 */
export function parseKnowledgeFile(file: string, table: string): { rows: Row[]; textChars: number; kind: string } {
  const ext = path.extname(file).toLowerCase()
  const base = path.basename(file).replace(/\.[^.]+$/, '')
  let text = ''
  let kind = ext.replace('.', '')
  if (ext === '.pdf') text = extractPdfText(file)
  else if (ext === '.docx') text = extractDocxText(file)
  else if (ext === '.txt' || ext === '.md' || ext === '.csv') {
    const buf = fs.readFileSync(file)
    // UTF-8 / GBK 粗判：含大量 0x80+ 且 utf8 解码失败则按 GBK 不处理（Windows 简中常见 ANSI）
    text = buf.toString('utf8')
    if (text.includes('�')) {
      try { text = new TextDecoder('gbk' as any).decode(buf) } catch { /* 保持 utf8 */ }
    }
  } else {
    throw new Error('不支持的格式：' + ext + '（支持 PDF / Word(docx) / TXT / CSV / Markdown）')
  }
  if (!text.trim()) throw new Error(kind.toUpperCase() + ' 里没有提取到文字（扫描件/图片型文档提不了文字，可换成文字版再导）')
  const items = splitTextToItems(text)
  const rows = itemsToRows(table, items, base)
  if (!rows.length) throw new Error('没有识别出有效条目（内容太短或格式不像是清单）')
  return { rows, textChars: text.length, kind }
}
