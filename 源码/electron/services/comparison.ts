// 双场对比：把两个直播间的素材包拼成一份「对比素材包」，
// 让 AI 在同一个上下文里横向比（A = 对标主播，B = 自家主播）。
// 超过上下文预算时，按时间切片对齐拆分，每份同时含两边同一时间窗的内容。

import * as fs from 'fs'
import * as path from 'path'
import { estimateTokens, parseTimeLabel, fmtClock } from './packet-split'

const ITEM_RE = /^(\d+):(\d\d)(?:\.(\d))?\t/
const SHOT_RE = /^#\d+\s+(\d+):(\d\d)/

interface Section { title: string; body: string }

export interface CompareSide {
  path: string
  label: string
  packet: string
}

export interface ComparePart {
  index: number
  total: number
  fileName: string
  filePath: string
  rangeA: string
  rangeB: string
  tokens: number
  content: string
}

export interface CompareResult {
  totalTokens: number
  limit: number
  split: boolean
  parts: ComparePart[]
  note: string
}

function parseSections(text: string): Section[] {
  const lines = text.split('\n')
  const out: Section[] = []
  let cur: Section | null = null
  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (cur) out.push(cur)
      cur = { title: line, body: '' }
    } else if (cur) {
      cur.body += (cur.body ? '\n' : '') + line
    }
  }
  if (cur) out.push(cur)
  return out
}

function find(sections: Section[], keyword: string): Section | null {
  return sections.find((s) => s.title.includes(keyword)) || null
}

function block(title: string, body: string): string {
  return `${title}\n${body}`.trimEnd()
}

function labelOf(line: string): string {
  const i = line.indexOf('\t')
  return i >= 0 ? line.slice(0, i) : line
}

function talkLines(sections: Section[]): string[] {
  const s = find(sections, '逐句话术稿')
  if (!s) return []
  return s.body.split('\n').filter((l) => ITEM_RE.test(l))
}

interface Shots { head: string[]; shots: { t: number; line: string }[] }

/** 把「七、弹幕与礼物」那一节拆成可对齐的几块 */
interface DanmuPack {
  head: string[]                                   // 汇总行
  perMinute: { t: number; line: string }[]         // 每分钟互动密度表的行
  online: { t: number; line: string }[]            // 在线人数变化的行
  giftTables: string[]                             // 礼物汇总 / 送礼榜（整场）
  chat: { t: number; line: string }[]              // 弹幕原文行
  baseSec: number                                  // 开播时间（当天秒数），把墙钟时间换算成偏移；-1 = 没读到
}

const HM_RE = /^\|?\s*(\d{1,2}):(\d\d)\s*\|/
const CHAT_RE = /^(\d{1,2}):(\d\d)\s+\S/

function parseDanmu(sections: Section[]): DanmuPack {
  const out: DanmuPack = { head: [], perMinute: [], online: [], giftTables: [], chat: [], baseSec: -1 }
  const s = find(sections, '弹幕与礼物')
  if (!s) return out

  // 表里是墙钟时间（12:28 这种），对比要的是「相对开播的偏移」，靠这行换算
  for (const l of s.body.split('\n')) {
    const m = /起点：\s*(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/.exec(l)
    if (m) { out.baseSec = Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6]); break }
  }
  const toOffset = (minOfDay: number): number => {
    if (out.baseSec < 0) return minOfDay * 60
    let d = minOfDay * 60 - out.baseSec
    if (d < -43200) d += 86400
    if (d > 43200) d -= 86400
    return d
  }

  let mode = ''
  let tableBuf: string[] = []
  const flushTable = () => {
    if (tableBuf.length) { out.giftTables.push(tableBuf.join('\n')) ; tableBuf = [] }
  }

  for (const raw of s.body.split('\n')) {
    const line = raw.trimEnd()
    if (line.startsWith('### ')) {
      flushTable()
      mode = line.slice(4).trim()
      continue
    }
    if (line.startsWith('## ')) { flushTable(); mode = ''; continue }
    const hm = HM_RE.exec(line)
    if (mode.startsWith('每分钟互动密度') || mode.startsWith('在线人数')) {
      if (hm) {
        const t = toOffset(Number(hm[1]) * 60 + Number(hm[2]))
        if (mode.startsWith('每分钟')) out.perMinute.push({ t, line }); else out.online.push({ t, line })
      }
      continue
    }
    if (mode.startsWith('礼物汇总') || mode.startsWith('送礼榜')) {
      if (line.trim()) tableBuf.push(line)
      continue
    }
    if (mode.startsWith('弹幕原文')) {
      const cm = CHAT_RE.exec(line)
      if (cm) out.chat.push({ t: toOffset(Number(cm[1]) * 60 + Number(cm[2])), line })
      continue
    }
    if (!mode && line.trim()) out.head.push(line)
  }
  flushTable()
  return out
}

/** 按时间窗取一段 */
/** 每分钟一行的表：只要这一分钟和窗口有重叠就算在内（不然跨界的首/尾那分钟会丢） */
function minutesInRange<T extends { t: number }>(items: T[], first: number, last: number): T[] {
  if (first < 0 || last < 0) return []
  return items.filter((x) => x.t + 60 >= first - 0.05 && x.t <= last + 0.05)
}

function inRange<T extends { t: number }>(items: T[], first: number, last: number): T[] {
  if (first < 0 || last < 0) return []
  return items.filter((x) => x.t >= first - 0.05 && x.t <= last + 0.05)
}

/** 没有时间范围时按份数均分（两边份数对得上） */
function evenChunks<T>(items: T[], parts: number, i: number): T[] {
  if (!items.length) return []
  const per = Math.ceil(items.length / parts)
  return items.slice(i * per, (i + 1) * per)
}

/** 这场有没有观众反应数据 */
function dmText(p: DanmuPack): string {
  return [...p.head, ...p.giftTables, ...p.perMinute.map((x) => x.line), ...p.online.map((x) => x.line), ...p.chat.map((x) => x.line)].join('\n')
}

/** 每份里弹幕原文最多带多少条（防单份爆掉） */
const MAX_CHAT_PER_PART = 150

/** 拼出「观众反应」这块；给了时间窗就只取那一段 */
function dmBlock(p: DanmuPack, first = -1, last = -1): string {
  const out: string[] = []
  if (p.head.length) out.push(p.head.join('\n'))
  if (p.giftTables.length) {
    p.giftTables.forEach((t, i) => out.push(`### ${i === 0 ? '礼物汇总（按名称）' : '送礼榜（谁出手）'}\n${t}`))
  }

  const mins = first < 0 ? p.perMinute : minutesInRange(p.perMinute, first, last)
  if (mins.length) {
    out.push('每分钟互动密度：\n| 时间 | 弹幕数 | 礼物数 | 当时弹幕样例 |\n|---|---|---|---|\n' + mins.map((x) => x.line).join('\n'))
  }
  const on = first < 0 ? p.online : minutesInRange(p.online, first, last)
  if (on.length) out.push('在线人数变化：\n| 时间 | 在线 |\n|---|---|\n' + on.map((x) => x.line).join('\n'))

  const chats = first < 0 ? p.chat : inRange(p.chat, first, last)
  const capped = chats.slice(0, MAX_CHAT_PER_PART)
  if (capped.length) {
    const label = chats.length > MAX_CHAT_PER_PART ? `前 ${MAX_CHAT_PER_PART} 条，共 ${chats.length} 条` : '全部'
    out.push(`弹幕原文（${label}）：\n` + capped.map((x) => x.line).join('\n'))
  }
  return out.join('\n\n')
}

function indexShots(sections: Section[]): Shots {
  const s = find(sections, '技术索引')
  if (!s) return { head: [], shots: [] }
  const head: string[] = []
  const shots: { t: number; line: string }[] = []
  for (const raw of s.body.split('\n')) {
    if (raw.trim().startsWith('```')) continue
    const m = SHOT_RE.exec(raw.trim())
    if (m) shots.push({ t: Number(m[1]) * 60 + Number(m[2]), line: raw })
    else if (shots.length === 0 && raw.trim()) head.push(raw)
  }
  return { head, shots }
}

function splitByBudget(lines: string[], ownTokens: number, parts: number): string[][] {
  if (!lines.length) return Array.from({ length: parts }, () => [])
  // 按自己的总 token 等分成 parts 份 —— 两边份数才对得上
  const per = Math.max(Math.ceil(ownTokens / parts), 200)
  const groups: string[][] = []
  let cur: string[] = []
  let used = 0
  for (const line of lines) {
    const t = estimateTokens(line) + 1
    if (cur.length > 0 && used + t > per) { groups.push(cur); cur = []; used = 0 }
    cur.push(line)
    used += t
  }
  if (cur.length > 0) groups.push(cur)
  // 补齐到 parts 份，保证两边份数一致
  while (groups.length < parts) groups.push([])
  if (groups.length > parts) {
    // 多出来的并进最后一份
    const extra = groups.splice(parts)
    for (const g of extra) groups[parts - 1].push(...g)
  }
  return groups
}

function rangeOf(lines: string[]): string {
  if (!lines.length) return '—'
  const first = parseTimeLabel(labelOf(lines[0]))
  const last = parseTimeLabel(labelOf(lines[lines.length - 1]))
  return `${fmtClock(first)} - ${fmtClock(last)}`
}

function indexFor(sh: Shots, first: number, last: number, isLast: boolean): string {
  if (!sh.shots.length) return ''
  const inRange = sh.shots.filter((s) => s.t >= first - 0.05 && (s.t <= last + 0.05 || isLast))
  if (!inRange.length) return ''
  const out: string[] = ['```']
  if (sh.head.length) out.push(sh.head.join('\n'))
  out.push(...inRange.map((s) => s.line))
  out.push('```')
  return out.join('\n')
}

const INSTRUCTIONS = [
  '## 对比分析指令',
  '',
  'A 是对标主播（优秀样本），B 是我们自己的主播。请在同一个上下文里做横向对比，产出对比报告：',
  '',
  '1. **总体差距**：一句话结论 + 最关键的三条差距（要具体，不要「互动不够」这种废话）。',
  '2. **开场对比**：前 3 分钟 A 做了什么、B 做了什么，谁把人留住了，B 应该怎么改。',
  '3. **话术对照表**：| 场景 | A 的原句 | B 的原句 | 差距诊断 | B 改成什么 |',
  '   —— A 的原句和 B 的原句都必须逐字引用，不能概括。',
  '4. **节奏对比**：事件间隔、降速点、空转时长，两边横向比（用镜头索引里的时间戳）。',
  '5. **互动与转化**：谁在什么时间点引导关注/礼物/福袋，用了什么话术，B 缺哪一环。',
  '   —— 用两边的「观众反应」数据对照：同一时间点 A 的弹幕/礼物起来了没有、B 的起来了没有。',
  '6. **观众反应对照表**：| 时间点 | A 在做什么 | A 的弹幕/礼物 | B 在做什么 | B 的弹幕/礼物 | 差距 |',
  '   —— 礼物要写清楚名称和价值（多少钻），数据以素材包里第七节的统计为准。',
  '7. **B 可直接照做的 5 条动作**：下播前就能改完的具体动作，不要给「多互动」这类无法执行的建议。',
  '8. **证据索引**：每条结论标出 A 和 B 各自的时间戳。'
].join('\n')

const HEADER = [
  '# 直播对比拆解素材包',
  '',
  '> A = 对标主播（优秀样本），B = 自家主播。两边在同一份材料里给出，用于找差距、出改进动作。',
  '> 每条结论都要带时间戳，引用话术必须是原句。'
].join('\n')

/** 把两边的素材包合成一份对比素材包（必要时按时间对齐切分） */
export function buildComparison(sideA: CompareSide, sideB: CompareSide, limit: number): CompareResult {
  const sa = parseSections(sideA.packet)
  const sb = parseSections(sideB.packet)

  const metaA = find(sa, '基本信息')
  const metaB = find(sb, '基本信息')
  const gridsA = find(sa, '画面网格图')
  const gridsB = find(sb, '画面网格图')
  const shotsA = indexShots(sa)
  const shotsB = indexShots(sb)
  const talkA = talkLines(sa)
  const talkB = talkLines(sb)
  const dmA = parseDanmu(sa)
  const dmB = parseDanmu(sb)

  const baseParts = [
    HEADER,
    `## 一、两边基本信息\n\n### A · ${sideA.label}\n${metaA ? metaA.body.trim() : '(缺)'}\n\n` +
      `### B · ${sideB.label}\n${metaB ? metaB.body.trim() : '(缺)'}`,
    gridsA ? block(`## 附：A 画面网格图\n`, gridsA.body) : '',
    gridsB ? block(`## 附：B 画面网格图\n`, gridsB.body) : '',
    INSTRUCTIONS
  ].filter(Boolean)
  const baseText = baseParts.join('\n\n')
  const baseTokens = estimateTokens(baseText)

  const bodyTokens = estimateTokens(talkA.join('\n')) + estimateTokens(talkB.join('\n'))
  const idxTokensA = estimateTokens([shotsA.head.join('\n'), ...shotsA.shots.map((s) => s.line)].join('\n'))
  const idxTokensB = estimateTokens([shotsB.head.join('\n'), ...shotsB.shots.map((s) => s.line)].join('\n'))
  // 镜头索引也会进每一份，算预算时必须计进去，否则每份都会超
  // 观众反应（弹幕/礼物）也要算进预算，不然加进去就超了
  const dmTokensA = estimateTokens(dmText(dmA))
  const dmTokensB = estimateTokens(dmText(dmB))
  const total = baseTokens + idxTokensA + idxTokensB + bodyTokens + dmTokensA + dmTokensB

  const single = (): CompareResult => {
    const body = [
      HEADER,
      `## 一、两边基本信息\n\n### A · ${sideA.label}\n${metaA ? metaA.body.trim() : '(缺)'}\n\n` +
        `### B · ${sideB.label}\n${metaB ? metaB.body.trim() : '(缺)'}`,
      shotsA.shots.length ? `## 二、A · 镜头索引\n\`\`\`\n${[shotsA.head.join('\n'), ...shotsA.shots.map(s => s.line)].filter(Boolean).join('\n')}\n\`\`\`` : '',
      `## 三、A · 逐句话术稿\n\n${talkA.join('\n')}`,
      shotsB.shots.length ? `## 四、B · 镜头索引\n\`\`\`\n${[shotsB.head.join('\n'), ...shotsB.shots.map(s => s.line)].filter(Boolean).join('\n')}\n\`\`\`` : '',
      `## 五、B · 逐句话术稿\n\n${talkB.join('\n')}`,
      dmText(dmA) ? `## 六、A · 观众反应（弹幕/礼物）\n\n${dmBlock(dmA)}` : '',
      dmText(dmB) ? `## 七、B · 观众反应（弹幕/礼物）\n\n${dmBlock(dmB)}` : '',
      gridsA ? block('## 附：A 画面网格图', gridsA.body) : '',
      gridsB ? block('## 附：B 画面网格图', gridsB.body) : '',
      INSTRUCTIONS
    ].filter(Boolean).join('\n\n').replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n'
    const tokens = estimateTokens(body)
    return {
      totalTokens: tokens, limit, split: false,
      note: `两边合计约 ${tokens} token，没超过预算 ${limit}，整份喂即可。`,
      parts: [{
        index: 1, total: 1, fileName: '对比素材包.md', filePath: '',
        rangeA: rangeOf(talkA), rangeB: rangeOf(talkB), tokens, content: body
      }]
    }
  }

  if (!limit || limit <= 0) limit = 24000
  if (total <= limit) return single()

  // 留 8% 安全余量：每份除话术还有基本信息/指令/观众反应，
  // 按等分算容易刚好冒尖（实测超出过 169 token）
  const parts = Math.max(2, Math.ceil(total / (limit * 0.92)))
  const talkTokA = estimateTokens(talkA.join('\n'))
  const talkTokB = estimateTokens(talkB.join('\n'))
  const groupA = splitByBudget(talkA, talkTokA, parts)
  const groupB = splitByBudget(talkB, talkTokB, parts)

  const outParts: ComparePart[] = []
  for (let i = 0; i < parts; i++) {
    const ga = groupA[i] || []
    const gb = groupB[i] || []
    const first = (g: string[]) => (g.length ? parseTimeLabel(labelOf(g[0])) : -1)
    const last = (g: string[]) => (g.length ? parseTimeLabel(labelOf(g[g.length - 1])) : -1)
    const fa = first(ga), la = last(ga)
    const fb = first(gb), lb = last(gb)
    const rangeA = ga.length ? `${fmtClock(fa)} - ${fmtClock(la)}` : '—'
    const rangeB = gb.length ? `${fmtClock(fb)} - ${fmtClock(lb)}` : '—'

    const idxA = ga.length ? indexFor(shotsA, fa, la, i === parts - 1) : ''
    const idxB = gb.length ? indexFor(shotsB, fb, lb, i === parts - 1) : ''

    const out = [
      `# 直播对比拆解素材包（第 ${i + 1} / ${parts} 部分）`,
      '',
      `> 第 ${i + 1} / ${parts} 部分。A（${sideA.label}）覆盖 ${rangeA}；B（${sideB.label}）覆盖 ${rangeB}。` +
        `只就本段做对比，最后几段由人工汇总。`,
      '',
      `## 一、两边基本信息\n\n### A · ${sideA.label}\n${metaA ? metaA.body.trim() : '(缺)'}\n\n` +
        `### B · ${sideB.label}\n${metaB ? metaB.body.trim() : '(缺)'}`,
      idxA ? `## 二、A · 镜头索引（本段｜${rangeA}）\n${idxA}` : '',
      `## 三、A · 逐句话术稿（本段｜${rangeA}）\n\n${ga.join('\n')}`,
      idxB ? `## 四、B · 镜头索引（本段｜${rangeB}）\n${idxB}` : '',
      `## 五、B · 逐句话术稿（本段｜${rangeB}）\n\n${gb.join('\n')}`,
      dmText(dmA) ? `## 六、A · 观众反应（本段｜${rangeA}）\n\n${dmBlock(dmA, fa, la)}` : '',
      dmText(dmB) ? `## 七、B · 观众反应（本段｜${rangeB}）\n\n${dmBlock(dmB, fb, lb)}` : '',
      INSTRUCTIONS
    ].filter(Boolean).join('\n\n').replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n'

    outParts.push({
      index: i + 1,
      total: parts,
      fileName: `对比素材包_p${String(i + 1).padStart(2, '0')}of${String(parts).padStart(2, '0')}.md`,
      filePath: '',
      rangeA, rangeB,
      tokens: estimateTokens(out),
      content: out
    })
  }

  const sizes = outParts.map((p) => p.tokens)
  return {
    totalTokens: total, limit, split: true,
    note: `两边合计约 ${total} token，超过预算 ${limit}，已按时间对齐切成 ${parts} 份` +
      `（${Math.min(...sizes)}–${Math.max(...sizes)} token/份）。每份同时含 A 和 B 的同一时间窗。`,
    parts: outParts
  }
}

/** 写到 <work>/对比/ 下 */
export function writeCompareParts(workDir: string, parts: ComparePart[]): ComparePart[] {
  const dir = path.join(workDir, '对比')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch { /* ignore */ }
  return parts.map((p) => {
    const filePath = path.join(dir, p.fileName)
    try {
      fs.writeFileSync(filePath, p.content, 'utf-8')
    } catch { /* ignore */ }
    return { ...p, filePath }
  })
}
