// 连到已经带 --remote-debugging-port 的 Chrome，旁听抖音直播间的 WebSocket 二进制帧，
// 用二进制安全的 protobuf 解析器把弹幕解出来。—— 只验证解码链路，不动页面。
// 用法：node cdp-danmu-probe.mjs [监听秒数]

import { createRequire } from 'module'
import { gunzipSync } from 'zlib'

const APP_PKG = 'H:/360MoveData/Users/Administrator/Documents/ChatGPT/直播间拆解项目github/douyin-live-info/package.json'
const require = createRequire(APP_PKG)
const WebSocket = require('ws')

const SECONDS = Number(process.argv[2]) || 40
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PORT = Number(process.env.CDP_PORT || 9222)
const ROOM = process.env.CDP_ROOM || ''

// ---------- 最小二进制安全 protobuf 读取 ----------
function readVarint(buf, off) {
  let v = 0n, shift = 0n
  while (off < buf.length) {
    const b = buf[off++]
    v |= BigInt(b & 0x7f) << shift
    if ((b & 0x80) === 0) return { value: v, next: off }
    shift += 7n
    if (shift > 70n) throw new Error('varint too long')
  }
  throw new Error('varint eof')
}

/** 返回 [{ no, wire, value }]，wire=2 时 value 是 Buffer，其他是 BigInt */
function readFields(buf) {
  const out = []
  let off = 0
  while (off < buf.length) {
    const t = readVarint(buf, off); off = t.next
    const tag = Number(t.value)
    const no = tag >> 3
    const wire = tag & 7
    if (no === 0) break
    if (wire === 0) {
      const r = readVarint(buf, off); off = r.next
      out.push({ no, wire, value: r.value })
    } else if (wire === 1) {
      out.push({ no, wire, value: buf.readBigUInt64LE(off) }); off += 8
    } else if (wire === 2) {
      const l = readVarint(buf, off); off = l.next
      const len = Number(l.value)
      out.push({ no, wire, value: buf.subarray(off, off + len) }); off += len
    } else if (wire === 5) {
      out.push({ no, wire, value: BigInt(buf.readUInt32LE(off)) }); off += 4
    } else {
      throw new Error('bad wire ' + wire)
    }
  }
  return out
}

const fields = (buf) => {
  const m = {}
  for (const f of readFields(buf)) (m[f.no] ||= []).push(f.value)
  return m
}
const one = (m, no) => (m[no] ? m[no][0] : undefined)
const str = (m, no) => {
  const v = one(m, no)
  return v == null ? '' : Buffer.isBuffer(v) ? v.toString('utf8') : String(v)
}
const num = (m, no) => {
  const v = one(m, no)
  return v == null ? 0 : Number(v)
}

function maybeGunzip(buf) {
  if (buf && buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) return gunzipSync(buf)
  return buf
}

// ---------- 帧 -> 消息列表 ----------
function decodeFrame(buf) {
  const f = fields(buf)
  const headers = {}
  for (const hb of f[5] ?? []) {
    const hm = fields(hb)
    const k = str(hm, 1)
    if (k) headers[k] = str(hm, 2)
  }
  const payloadType = str(f, 7)
  let payload = one(f, 8)
  payload = maybeGunzip(payload)
  const messages = []
  if (payloadType === 'msg' || payloadType === 'push') {
    const r = fields(payload)
    for (const mb of r[1] ?? []) {
      const mm = fields(mb)
      messages.push({ method: str(mm, 1), msgId: num(mm, 3), payload: one(mm, 2) })
    }
  }
  return { headers, payloadType, messages }
}

// ---------- 消息体解码 ----------
function decodeUser(buf) {
  const u = fields(buf)
  const avatarField = one(u, 9)
  let avatar = ''
  if (avatarField) {
    try {
      const im = fields(avatarField)
      avatar = str(im, 1)
    } catch { /* 不是嵌套结构 */ }
  }
  return { nickname: str(u, 3), secUid: str(u, 46), avatar }
}

function decodeBody(method, payload) {
  const b = fields(maybeGunzip(payload))
  if (method.includes('ChatMessage')) {
    const user = one(b, 2) ? decodeUser(one(b, 2)) : null
    return { kind: 'Chat', ...user, content: str(b, 3) }
  }
  if (method.includes('MemberMessage')) {
    const user = one(b, 2) ? decodeUser(one(b, 2)) : null
    return { kind: 'Member', ...user, memberCount: num(b, 3) }
  }
  if (method.includes('GiftMessage')) {
    const user = one(b, 7) ? decodeUser(one(b, 7)) : null
    const g = one(b, 15) ? fields(one(b, 15)) : {}
    return {
      kind: 'Gift', ...user,
      giftName: str(g, 16), diamond: num(g, 12),
      count: num(b, 5) || num(b, 4) || num(b, 6) || 1
    }
  }
  if (method.includes('LikeMessage')) {
    const user = one(b, 5) ? decodeUser(one(b, 5)) : null
    return { kind: 'Like', ...user, count: num(b, 2), total: num(b, 3) }
  }
  if (method.includes('SocialMessage')) {
    const user = one(b, 2) ? decodeUser(one(b, 2)) : null
    return { kind: 'Social', ...user, action: num(b, 4) }
  }
  if (method.includes('RoomUserSeqMessage')) {
    return { kind: 'Stats', total: num(b, 3), popularity: num(b, 6), totalUser: num(b, 7) }
  }
  if (method.includes('RoomStatsMessage')) {
    return { kind: 'Stats', total: num(b, 3), totalUser: num(b, 4) }
  }
  return { kind: 'Other', method }
}

// ---------- 接 CDP ----------
async function pickPage() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const page = list.find((t) => t.type === 'page' && /live\.douyin\.com/.test(t.url || ''))
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* 还没起来 */ }
    await sleep(1000)
  }
  throw new Error('没找到 live.douyin.com 页面（Chrome 带 --remote-debugging-port=9222 了吗？）')
}

const page = await pickPage()
console.log('已连上页面：' + page.url)
console.log('标题：' + (page.title || ''))

if (ROOM && !String(page.url).includes('/' + ROOM)) {
  console.log('当前页面不是目标房间，正在跳转…')
  const nav = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 1024 * 1024 })
  await new Promise((res, rej) => { nav.on('open', res); nav.on('error', rej) })
  nav.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url: 'https://live.douyin.com/' + ROOM } }))
  await sleep(10000)
  nav.close()
}

const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 128 * 1024 * 1024 })
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
let id = 0
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }))

const stats = { frames: 0, text: 0, binary: 0, decoded: 0, failed: 0, kinds: {} }
const chats = []
const wsUrls = {}

ws.on('message', (raw) => {
  let msg
  try { msg = JSON.parse(raw.toString()) } catch { return }
  if (msg.method !== 'Network.webSocketFrameReceived') return
  const p = msg.params || {}
  const opcode = p.response?.opcode
  stats.frames++
  if (opcode === 1) { stats.text++; return }
  stats.binary++
  const url = (p.response?.url || '').slice(0, 60)
  wsUrls[url] = (wsUrls[url] || 0) + 1
  let buf
  try { buf = Buffer.from(p.response?.payloadData || '', 'base64') } catch { return }
  let decoded
  try {
    decoded = decodeFrame(buf)
  } catch (e) {
    stats.failed++
    if (stats.failed <= 3) console.log('  解帧失败：' + e.message)
    return
  }
  stats.decoded++
  for (const m of decoded.messages) {
    let body
    try { body = decodeBody(m.method, m.payload) } catch (e) {
      console.log('  解消息失败 ' + m.method + '：' + e.message)
      continue
    }
    stats.kinds[body.kind] = (stats.kinds[body.kind] || 0) + 1
    if (body.kind === 'Chat' && chats.length < 200) {
      chats.push(`  [弹幕] ${body.nickname}: ${body.content}`)
      console.log(`  [弹幕] ${body.nickname}：${body.content}`)
    } else if (body.kind === 'Gift') {
      console.log(`  [礼物] ${body.nickname} 送出 ${body.giftName} x${body.count}`)
    } else if (body.kind === 'Stats') {
      console.log(`  [统计] 在线 ${body.totalUser} 热度 ${body.total} 人气 ${body.popularity}`)
    } else if (body.kind === 'Member') {
      console.log(`  [进场] ${body.nickname}`)
    } else if (body.kind === 'Other') {
      console.log(`  [其他] ${body.method}`)
    }
  }
})

send('Network.enable')
send('Runtime.enable')

console.log(`\n开始旁听 ${SECONDS} 秒…`)
await sleep(SECONDS * 1000)

console.log('\n===== 结果 =====')
console.log(`总帧 ${stats.frames}（文本 ${stats.text} / 二进制 ${stats.binary}）`)
console.log(`解帧成功 ${stats.decoded}　失败 ${stats.failed}`)
console.log('消息类型分布：' + JSON.stringify(stats.kinds))
console.log('WS 连接：')
for (const [u, n] of Object.entries(wsUrls)) console.log(`  ${n} 帧  ${u}`)
console.log(stats.kinds.Chat ? `\n结论：收到 ${stats.kinds.Chat} 条弹幕 ✅` : '\n结论：还没解出弹幕 ❌')
ws.close()
