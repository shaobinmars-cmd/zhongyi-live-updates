// 把「拆解素材包」按模型上下文预算自动切成多份。
// 每份自带基本信息、本段镜头索引和分析指令，可以独立喂给模型；
// 切分点只落在整句之间，不会把一句话截断。

import * as fs from 'fs'
import * as path from 'path'

export interface PacketPart {
  index: number
  total: number
  fileName: string
  filePath: string
  timeRange: string
  chars: number
  tokens: number
  content: string
}

export interface SplitResult {
  totalTokens: number
  limit: number
  split: boolean
  parts: PacketPart[]
  note: string
}

/**
 * 粗略 token 估算：中文按 0.7 token/字（保守偏高），其余按 4 字符/token。
 * 宁可估高一点，也别让运营把超长的包喂进去。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) || 0
    if (c >= 0x4e00 && c <= 0x9fff) cjk++
    else if (c >= 0x3000 && c <= 0x303f) cjk++   // 中文标点
    else if (c >= 0xff00 && c <= 0xffef) cjk++   // 全角
  }
  const other = text.length - cjk
  return Math.ceil(cjk * 0.7 + other / 4) + 1
}

export function parseTimeLabel(label: string): number {
  const m = /^(\d+):(\d\d)(?:\.(\d))?$/.exec(label.trim())
  if (!m) return -1
  return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 10 : 0)
}

export function fmtClock(sec: number): string {
  if (sec < 0) return '--:--'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

interface Section { title: string; body: string }
interface Parsed { h1: string; sections: Section[] }

interface IndexShots { head: string[]; shots: { t: number; line: string }[] }

const ITEM_RE = /^(\d+):(\d\d)(?:\.(\d))?\t/
const SHOT_RE = /^#\d+\s+(\d+):(\d\d)/

function labelOf(line: string): string {
  const i = line.indexOf('\t')
  return i >= 0 ? line.slice(0, i) : line
}

function parsePacket(text: string): Parsed {
  const lines = text.split('\n')
  let h1 = ''
  let i = 0
  for (; i < lines.length; i++) {
    if (lines[i].startsWith('# ')) { h1 = lines[i]; i++; break }
  }
  const sections: Section[] = []
  let cur: Section | null = null
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('## ')) {
      if (cur) sections.push(cur)
      cur = { title: line, body: '' }
    } else if (cur) {
      cur.body += (cur.body ? '\n' : '') + line
    }
  }
  if (cur) sections.push(cur)
  return { h1, sections }
}

function findBy(sections: Section[], keyword: string): Section | null {
  return sections.find((s) => s.title.includes(keyword)) || null
}

/** 从 index 小节里拆出「说明行」和「带时间戳的镜头行」 */
function extractIndexShots(body: string): IndexShots {
  const head: string[] = []
  const shots: { t: number; line: string }[] = []
  for (const raw of body.split('\n')) {
    if (raw.trim().startsWith('```')) continue
    const m = SHOT_RE.exec(raw.trim())
    if (m) {
      shots.push({ t: Number(m[1]) * 60 + Number(m[2]), line: raw })
    } else if (shots.length === 0 && raw.trim()) {
      head.push(raw)
    }
  }
  return { head, shots }
}

function block(title: string, body: string): string {
  return `${title}\n${body}`.trimEnd()
}

function singlePart(text: string, total: number, limit: number, note: string): SplitResult {
  return {
    totalTokens: total,
    limit,
    split: false,
    note,
    parts: [{
      index: 1, total: 1, fileName: '拆解素材包.md', filePath: '',
      timeRange: '', chars: text.length, tokens: total, content: text
    }]
  }
}

/** 兜底切分：拿不到话术段时按行顺序切，绝不再把超大整包直接丢给 AI */
function splitFallback(text: string, total: number, limit: number, why: string): SplitResult {
  const lines = text.split('\n')
  const budget = Math.max(limit - 600, Math.floor(limit * 0.6))
  const groups: string[][] = []
  let cur: string[] = []
  let used = 0
  for (const line of lines) {
    const t = estimateTokens(line) + 1
    if (cur.length > 0 && used + t > budget) { groups.push(cur); cur = []; used = 0 }
    cur.push(line)
    used += t
  }
  if (cur.length) groups.push(cur)
  const parts: PacketPart[] = groups.map((g, gi) => {
    const content = [
      `# 直播拆解素材包（第 ${gi + 1} / ${groups.length} 部分）`,
      '',
      `> ${why}，已按内容顺序切分（共 ${groups.length} 份）。请只就本片给结论。`,
      '',
      ...g
    ].join('\n').replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n'
    return {
      index: gi + 1, total: groups.length,
      fileName: `拆解素材包_p${String(gi + 1).padStart(2, '0')}of${String(groups.length).padStart(2, '0')}.md`,
      filePath: '', timeRange: '', chars: content.length, tokens: estimateTokens(content), content
    }
  })
  return {
    totalTokens: total, limit, split: true, parts,
    note: `全文约 ${total} token，超过预算 ${limit}；${why}，已按内容顺序切成 ${parts.length} 份。`
  }
}

export function splitPacket(text: string, limit: number): SplitResult {
  const total = estimateTokens(text)
  if (!limit || limit <= 0) limit = 24000

  if (total <= limit) {
    return singlePart(text, total, limit, `全文约 ${total} token，没超过预算 ${limit}，不需要分片。`)
  }

  const parsed = parsePacket(text)
  const talk = findBy(parsed.sections, '逐句话术稿')
  if (!talk) {
    // 没有话术段（纯音乐/静音场）：以前直接返回整包，等于没拆，AI 请求会超上下文
    return splitFallback(text, total, limit, '没找到「逐句话术稿」小节')
  }

  const itemLines = talk.body.split('\n').filter((l) => ITEM_RE.test(l))
  if (itemLines.length < 2) {
    return splitFallback(text, total, limit, '话术稿太短')
  }

  const meta = findBy(parsed.sections, '基本信息')
  const index = findBy(parsed.sections, '技术索引')
  const segs = findBy(parsed.sections, '自动分段')
  const grids = findBy(parsed.sections, '画面网格图')
  const instr = findBy(parsed.sections, '给分析 AI 的指令')

  // 每份都要带的最小开销（不含索引）
  const baseText = [
    parsed.h1,
    meta ? block(meta.title, meta.body) : '',
    grids ? block(grids.title, grids.body) : '',
    instr ? block(instr.title, instr.body) : ''
  ].filter(Boolean).join('\n\n')
  const baseTokens = estimateTokens(baseText) + 120
  const per = Math.max(limit - baseTokens, Math.floor(limit * 0.3))

  const indexShots = index ? extractIndexShots(index.body) : null
  const segTokens = segs ? estimateTokens(block(segs.title, segs.body)) : 0
  // 整场分段表比较小，只在第 1 部分给；太大就不给，避免撑爆单份
  const segInFirst = !!segs && segTokens <= limit * 0.5
  const droppedSeg = !!segs && !segInFirst

  // 贪心分段：装满一份才开下一份，避免出现「最后一份吃掉全部余量」
  // 第 1 份额外背着「镜头索引说明行 + 整场分段表」，它的正文额度要相应扣减
  const extraFirst = (indexShots?.head.length ? estimateTokens(indexShots.head.join('\n')) : 0) +
    (segInFirst && segs ? segTokens : 0)
  const perFirst = Math.max(per - extraFirst, Math.floor(limit * 0.25))

  const groups: string[][] = []
  let cur: string[] = []
  let used = 0
  for (const line of itemLines) {
    const budget = groups.length === 0 ? perFirst : per
    const t = estimateTokens(line) + 1
    if (cur.length > 0 && used + t > budget) {
      groups.push(cur)
      cur = []
      used = 0
    }
    cur.push(line)
    used += t
  }
  if (cur.length > 0) groups.push(cur)


  const parts: PacketPart[] = groups.map((g, gi) => {
    const first = parseTimeLabel(labelOf(g[0]))
    const last = parseTimeLabel(labelOf(g[g.length - 1]))
    const range = `${fmtClock(first)} - ${fmtClock(last)}`
    const out: string[] = []

    out.push(`# 直播拆解素材包（第 ${gi + 1} / ${groups.length} 部分）`, '')
    out.push(gi === 0
      ? `> 整场的第 1 部分（共 ${groups.length} 部分），覆盖时间 ${range}。请只就本段出结论，后面几段由人工汇总。`
      : `> 整场的第 ${gi + 1} 部分（共 ${groups.length} 部分），覆盖时间 ${range}，与前一部分直接衔接。`)
    out.push('')

    if (meta) out.push(block(meta.title, meta.body), '')

    // 镜头索引：按本段时间范围切，每份都带上自己那段
    if (indexShots && indexShots.shots.length > 0) {
      const inRange = indexShots.shots.filter((s) =>
        s.t >= first - 0.05 && (s.t <= last + 0.05 || gi === groups.length - 1))
      if (inRange.length > 0) {
        out.push(`## 二、技术索引（本段镜头｜${range}）`, '```')
        if (indexShots.head.length) out.push(indexShots.head.join('\n'))
        out.push(inRange.map((s) => s.line).join('\n'))
        out.push('```', '')
      }
    } else if (index && gi === 0) {
      out.push(block(index.title, index.body), '')
    }

    if (segs && segInFirst && gi === 0) out.push(block(segs.title, segs.body), '')

    out.push(`## 四、逐句话术稿（简体，带时间戳｜本部分 ${range}）`, '')
    out.push(g.join('\n'), '')

    if (grids) out.push(block(grids.title, grids.body), '')
    if (instr) out.push(block(instr.title, instr.body), '')

    const content = out.join('\n').replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n'
    return {
      index: gi + 1,
      total: groups.length,
      fileName: `拆解素材包_p${String(gi + 1).padStart(2, '0')}of${String(groups.length).padStart(2, '0')}_${range.replace(/[:\s-]/g, '')}.md`,
      filePath: '',
      timeRange: range,
      chars: content.length,
      tokens: estimateTokens(content),
      content
    }
  })

  const sizes = parts.map((p) => p.tokens)
  const note = `全文约 ${total} token，超过预算 ${limit}，已切成 ${parts.length} 份` +
    `（${Math.min(...sizes)}–${Math.max(...sizes)} token/份）。` +
    (segInFirst ? '' : droppedSeg ? '整场分段表偏大，未放进分片，见原始素材包。' : '')

  return { totalTokens: total, limit, split: true, parts, note }
}

/** 把分片写到 <work>/分片/ 下，返回带路径的分片 */
export function writeParts(workDir: string, parts: PacketPart[]): PacketPart[] {
  const dir = path.join(workDir, '分片')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch { /* ignore */ }
  return parts.map((p) => {
    if (p.total === 1 && p.fileName === '拆解素材包.md') {
      return { ...p, filePath: path.join(workDir, '拆解素材包.md') }
    }
    const filePath = path.join(dir, p.fileName)
    try {
      fs.writeFileSync(filePath, p.content, 'utf-8')
    } catch { /* ignore */ }
    return { ...p, filePath }
  })
}
