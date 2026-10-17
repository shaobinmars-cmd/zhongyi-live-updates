/**
 * 报告文件取文字：md/txt + Word/WPS（docx/doc/wps/rtf）。
 * 不依赖任何第三方库：docx 是 zip（自己读），rtf 直接解，doc/wps 做正文启发式提取。
 */
import * as fs from 'fs'
import * as path from 'path'
import * as zlib from 'zlib'

/** 从 zip 里取一个文件（只支持 store/deflate，docx 就这两种） */
function readZipEntry(buf: Buffer, entryName: string): Buffer | null {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) return null
  const cdOffset = buf.readUInt32LE(eocd + 16)
  const entries = buf.readUInt16LE(eocd + 10)
  let p = cdOffset
  for (let i = 0; i < entries; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    // 有的压缩工具（如 PowerShell）会用反斜杠，统一成正斜杠再比
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8').replace(/\\/g, '/')
    if (name === entryName) {
      if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) return null
      const lNameLen = buf.readUInt16LE(localOffset + 26)
      const lExtraLen = buf.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + lNameLen + lExtraLen
      const data = buf.subarray(dataStart, dataStart + compSize)
      if (method === 0) return data
      if (method === 8) return zlib.inflateRawSync(data)
      return null
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return null
}

function xmlToText(xml: string): string {
  let s = xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:tc>/g, ' | ')
  s = s.replace(/<[^>]+>/g, '')
  s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  return s.replace(/\n{3,}/g, '\n\n').trim()
}

/** RTF：WPS/Word 都能“另存为 RTF”，纯文本解出来最稳 */
function rtfToText(src: string): string {
  let s = src
  // 去掉字体表/颜色表/元数据组，只留正文
  s = s.replace(/\{\\fonttbl[\s\S]*?\}\}/g, '').replace(/\{\\colortbl[\s\S]*?\}\}/g, '').replace(/\{\\\*[\s\S]*?\}\}/g, '')
  s = s.replace(/\\u(-?\d+)\??/g, (_m, n) => String.fromCharCode(((Number(n) % 65536) + 65536) % 65536))
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
  const table: Record<string, string> = { par: '\n', line: '\n', tab: '\t', cell: '\t', row: '\n' }
  s = s.replace(/\\(par|line|tab|cell|row)\b/g, (_m, w) => table[w] || '')
  s = s.replace(/\\[a-zA-Z]+-?\d* ?/g, '')
  s = s.replace(/[{}]/g, '')
  return s.replace(/\n{3,}/g, '\n\n').trim()
}

function cjkCount(s: string): number {
  return (s.match(/[\u4e00-\u9fff]/g) || []).length
}

/** 旧版 .doc/.wps：正文常见为 UTF-16LE，按可读片段抽取 */
function binaryDocToText(buf: Buffer): string {
  const chunks: string[] = []
  let cur = ''
  const flush = () => { if (cur.trim().length >= 4) chunks.push(cur); cur = '' }
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const code = buf.readUInt16LE(i)
    const ok = (code >= 0x20 && code <= 0x7e) || (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3000 && code <= 0x303f) || (code >= 0xff00 && code <= 0xffef) || code === 0x09
    if (code === 0x0d || code === 0x0a) { flush(); continue }
    if (ok) cur += String.fromCharCode(code)
    else flush()
    if (cur.length > 4000) flush()
  }
  flush()
  return chunks.join('\n')
}

/** 读报告文本；读不出来就带原因抛错 */
export function extractReportText(filePath: string): { text: string; format: string } {
  const ext = path.extname(filePath).toLowerCase()
  const buf = fs.readFileSync(filePath)

  if (['.md', '.markdown', '.txt'].includes(ext)) {
    let text = buf.toString('utf8')
    if (text.includes('\uFFFD')) {
      try { text = new TextDecoder('gbk').decode(buf) } catch { /* 保持 utf8 结果 */ }
    }
    return { text, format: ext.slice(1) }
  }

  if (ext === '.docx') {
    const xml = readZipEntry(buf, 'word/document.xml')
    if (!xml) throw new Error('这个 .docx 解不开（可能加密了，请另存为新的 docx）')
    return { text: xmlToText(xml.toString('utf8')), format: 'docx' }
  }

  if (ext === '.rtf') {
    return { text: rtfToText(buf.toString('utf8')), format: 'rtf' }
  }

  if (ext === '.doc' || ext === '.wps') {
    const text = binaryDocToText(buf)
    if (cjkCount(text) < 30) {
      throw new Error('旧版 .doc/.wps 读不出正文：请在 WPS 里「另存为 → Word 文档(.docx)」，或直接粘贴报告全文')
    }
    return { text, format: ext.slice(1) }
  }

  throw new Error('不支持这个文件类型（' + (ext || '无扩展名') + '）：请用 .md/.txt/.docx/.rtf，或粘贴全文')
}
