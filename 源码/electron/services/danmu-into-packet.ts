/**
 * 把「弹幕 / 礼物」按时间段并进拆解素材包。
 *
 * 为什么要有这个：素材包里本来只有「主播说了什么 + 画面」，没有「观众怎么反应」。
 * 复盘里最值钱的恰恰是这两者对上——哪句话说完观众开始刷屏、哪个点集中送礼。
 *
 * 怎么知道某场录像对应哪个房间、从几点开始：
 * 录制开始时会在录像旁边写一份 `xxx.meta.json`（房间号 + 开始时间），
 * 这里读它，再去弹幕库里按时间段把记录捞出来。
 */

import * as fs from 'fs'
import * as path from 'path'
import { getDanmuWindow, DanmuRow } from './database'
import * as logger from './logger'

const LOG_MODULE = 'DanmuPacket'

/** 弹幕原文最多写多少条（防止素材包爆掉） */
const MAX_CHAT_LINES = 600
/** 礼物明细最多写多少条 */
const MAX_GIFT_LINES = 400

interface RecMeta {
  roomId: string
  nickname: string
  startedAtUtc: string
}

/** 从录像文件名找旁边的旁注：xxx_001.mp4 → xxx.meta.json */
function findMeta(videoPath: string): RecMeta | null {
  const dir = path.dirname(videoPath)
  const base = path.basename(videoPath)
  const stem = base.replace(/\.[^.]+$/, '').replace(/_\d{3,4}$/, '')
  for (const name of [`${stem}.meta.json`, `${base}.meta.json`]) {
    const p = path.join(dir, name)
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf-8')) as RecMeta
      } catch {
        return null
      }
    }
  }
  return null
}

/** UTC 时间戳 + 秒数（库里存的是 UTC） */
function addSeconds(ts: string, sec: number): string {
  const d = new Date(ts.replace(' ', 'T') + 'Z')
  if (isNaN(d.getTime())) return ts
  d.setUTCSeconds(d.getUTCSeconds() + Math.round(sec))
  return d.toISOString().replace('T', ' ').substring(0, 19)
}

/** UTC → 本机时间 HH:MM */
function hhmm(ts: string): string {
  const d = new Date(ts.replace(' ', 'T') + 'Z')
  if (isNaN(d.getTime())) return ts.substring(11, 16)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** UTC → 本机时间 YYYY-MM-DD HH:MM:SS（对比时要用它算偏移） */
function localFull(ts: string): string {
  const d = new Date(ts.replace(' ', 'T') + 'Z')
  if (isNaN(d.getTime())) return ts
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function buildSection(rows: DanmuRow[], meta: RecMeta, durationSec: number): string {
  const chats = rows.filter((r) => r.type === 'Chat' && r.content)
  const gifts = rows.filter((r) => r.type === 'Gift')
  const members = rows.filter((r) => r.type === 'Member')
  const likes = rows.filter((r) => r.type === 'Like')

  // 礼物按名称汇总：名称 / 单价 / 件数 / 合计价值
  const giftAgg = new Map<string, { price: number; count: number; total: number }>()
  for (const g of gifts) {
    const key = g.giftName || '未识别礼物'
    const e = giftAgg.get(key) || { price: g.giftPrice || 0, count: 0, total: 0 }
    const n = g.giftCount || 1
    e.count += n
    e.total += (g.giftPrice || 0) * n
    if (!e.price && g.giftPrice) e.price = g.giftPrice
    giftAgg.set(key, e)
  }
  // 送礼榜：谁送得多（按价值）
  const senderAgg = new Map<string, { count: number; total: number }>()
  for (const g of gifts) {
    const key = g.userName || '未知用户'
    const e = senderAgg.get(key) || { count: 0, total: 0 }
    const n = g.giftCount || 1
    e.count += n
    e.total += (g.giftPrice || 0) * n
    senderAgg.set(key, e)
  }
  const giftValue = [...giftAgg.values()].reduce((n, e) => n + e.total, 0)
  const unknownGiftCount = gifts.filter((g) => !g.giftPrice).length

  const byMin = new Map<string, { chat: number; gift: number; samples: string[] }>()
  const bump = (min: string, kind: 'chat' | 'gift', sample?: string) => {
    const e = byMin.get(min) || { chat: 0, gift: 0, samples: [] }
    if (kind === 'chat') {
      e.chat++
      if (sample && e.samples.length < 3) e.samples.push(sample.slice(0, 24))
    } else e.gift++
    byMin.set(min, e)
  }
  for (const r of chats) bump(hhmm(r.time), 'chat', r.content)
  for (const r of gifts) bump(hhmm(r.time), 'gift')

  const L: string[] = []
  L.push('')
  L.push('## 七、弹幕与礼物（观众实时反应）')
  L.push('')
  L.push(`- 本场直播观众互动：弹幕 ${chats.length} 条、礼物 ${gifts.length} 件（合计约 ${giftValue} 钻）、进场 ${members.length} 次、点赞 ${likes.length} 次`)
  if (unknownGiftCount) L.push(`- 其中 ${unknownGiftCount} 件是抖音新礼物/未识别，未计入价值`)
  L.push(`- 时间已换算成本机时间${durationSec ? `，覆盖约 ${Math.round(durationSec / 60)} 分钟` : ''}`)
  // 这行是给「双场对比」用的：对比要按「相对开播的偏移」对齐，
  // 而下面是墙钟时间（12:28 这种），没这行就算不出偏移。
  L.push(`- 起点：${localFull(meta.startedAtUtc)}（下面所有时间都以本机时间为准）`)
  L.push('- 用法：把「弹幕密度高的分钟」和上面的逐句话术稿对照，就是「哪句话/哪个动作把场子带起来了」')
  L.push('')
  if (giftAgg.size) {
    L.push('### 礼物汇总（按礼物名称）')
    L.push('')
    L.push('| 礼物 | 单价(钻) | 件数 | 合计(钻) |')
    L.push('|---|---|---|---|')
    for (const [name, e] of [...giftAgg.entries()].sort((a, b) => b[1].total - a[1].total)) {
      L.push(`| ${name} | ${e.price || '-'} | ${e.count} | ${e.total || '-'} |`)
    }
    L.push('')
  }

  if (senderAgg.size) {
    L.push('### 送礼榜（谁在这个点出手）')
    L.push('')
    L.push('| 观众 | 件数 | 合计(钻) |')
    L.push('|---|---|---|')
    for (const [user, e] of [...senderAgg.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 15)) {
      L.push(`| ${user} | ${e.count} | ${e.total || '-'} |`)
    }
    L.push('')
  }
  L.push('### 每分钟互动密度')
  L.push('')
  L.push('| 时间 | 弹幕数 | 礼物数 | 当时弹幕样例 |')
  L.push('|---|---|---|---|')
  for (const [min, e] of [...byMin.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    L.push(`| ${min} | ${e.chat} | ${e.gift} | ${e.samples.join(' / ').replace(/\|/g, '/')} |`)
  }
  L.push('')

  if (gifts.length) {
    L.push('### 礼物明细')
    L.push('')
    for (const g of gifts.slice(0, MAX_GIFT_LINES)) {
      const v = (g.giftPrice || 0) * (g.giftCount || 1)
      const priceTxt = g.giftPrice ? `${g.giftPrice} 钻/个，小计 ${v} 钻` : '单价未知（抖音新礼物）'
      L.push(`- ${hhmm(g.time)} ${g.userName || '某位观众'} 赠送 ${g.giftName || '礼物'} x${g.giftCount || 1}（${priceTxt}）`)
    }
    if (gifts.length > MAX_GIFT_LINES) L.push(`- ……（其余 ${gifts.length - MAX_GIFT_LINES} 条省略）`)
    L.push('')
  }

  if (chats.length) {
  // 在线人数变化（从「统计」消息里解析）—— 看观众留没留住
  const onlineByMin = new Map<string, number>()
  for (const r of rows) {
    if (r.type !== 'Stats' || !r.content) continue
    const m = r.content.match(/在线[:：]\s*(\d+)/)
    if (m) onlineByMin.set(hhmm(r.time), Number(m[1]))
  }
  if (onlineByMin.size) {
    L.push('### 在线人数变化（每分钟最后一个采样）')
    L.push('')
    L.push('| 时间 | 在线 |')
    L.push('|---|---|')
    for (const [min, v] of [...onlineByMin.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      L.push(`| ${min} | ${v} |`)
    }
    L.push('')
  }

  if (members.length) {
    L.push(`### 进场记录（${members.length > 200 ? `前 200 条，共 ${members.length} 条` : '全部'}）`)
    L.push('')
    for (const m of members.slice(0, 200)) L.push(`${hhmm(m.time)} ${m.userName || '观众'} 进入直播间`)
    if (members.length > 200) L.push(`……（其余 ${members.length - 200} 条省略）`)
    L.push('')
  }

  const socials = rows.filter((r) => r.type === 'Social')
  if (socials.length) {
    L.push('### 关注记录')
    L.push('')
    for (const s of socials.slice(0, 200)) L.push(`${hhmm(s.time)} ${s.userName || '观众'} 关注了主播`)
    L.push('')
  }

    L.push(`### 弹幕原文（${chats.length > MAX_CHAT_LINES ? `前 ${MAX_CHAT_LINES} 条，共 ${chats.length} 条` : '全部'}）`)
    L.push('')
    for (const c of chats.slice(0, MAX_CHAT_LINES)) {
      L.push(`${hhmm(c.time)} ${c.userName || '观众'}：${c.content}`)
    }
    if (chats.length > MAX_CHAT_LINES) L.push(`……（其余 ${chats.length - MAX_CHAT_LINES} 条省略）`)
    L.push('')
  }

  return L.join('\n')
}

/**
 * 把弹幕/礼物并进素材包（就地在 拆解素材包.md 末尾追加一节）
 * @returns 追加成功返回素材包路径，没数据/对不上号返回 null
 */
export async function appendDanmuSection(
  workDir: string,
  videoPath: string,
  durationSec: number
): Promise<string | null> {
  const packetPath = path.join(workDir, '拆解素材包.md')
  if (!fs.existsSync(packetPath)) return null

  const meta = findMeta(videoPath)
  if (!meta?.roomId || !meta?.startedAtUtc) {
    logger.info(LOG_MODULE, `录像旁边没有 .meta.json，跳过弹幕合并：${path.basename(videoPath)}`)
    return null
  }

  // 时长优先用引擎给的；没有的话上层会用 ffmpeg 探一次。
  // 都拿不到时只取 3 小时窗口 —— 以前默认 6 小时，会把同一房间后面那场的弹幕也并进来。
  const windowSec = durationSec > 0 ? durationSec : 3600 * 3
  if (durationSec <= 0) {
    logger.info(LOG_MODULE, `没拿到本场时长，弹幕按 ${windowSec / 3600} 小时窗口并入（房间 ${meta.roomId}）`)
  }
  const to = addSeconds(meta.startedAtUtc, windowSec)
  const rows = await getDanmuWindow(meta.roomId, meta.startedAtUtc, to)
  if (!rows.length) {
    logger.info(LOG_MODULE, `这段时间没有弹幕记录（房间 ${meta.roomId}），跳过`)
    return null
  }

  const section = buildSection(rows, meta, durationSec)
  fs.appendFileSync(packetPath, section, 'utf-8')
  logger.info(LOG_MODULE, `已把 ${rows.length} 条观众互动并进素材包：${packetPath}`)
  return packetPath
}
