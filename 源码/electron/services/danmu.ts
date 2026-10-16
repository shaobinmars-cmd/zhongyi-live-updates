import { gunzipSync } from 'zlib'
import { parse, getFieldString, getFieldDict, getLongField, getIntField, ProtobufMap } from './protobuf-parser'
import { initializeTable, insertMessage } from './database'
import { openRoomTap, closeRoomTap, douyinLoginState, RawDanmuMessage } from './danmu-capture'
import * as logger from './logger'

export interface DanmuMsg {
  type: string
  userName: string
  content: string
  giftName: string
  giftCount: number
  giftPrice: number
  likeCount: number
  totalUser: number
  totalLike: number
  time: string
  roomName: string
  avatar: string
  profileUrl: string
  rawData: string
}

const LOG_MODULE = 'Danmu'

/** 等待页面打开的最长时间，超时也放行，避免界面卡在「正在连接」 */
const CONNECT_TIMEOUT_MS = 30000

/**
 * 弹幕服务
 *
 * 数据来源：不再自己算签名直连抖音推送接口（签名一变就「显示已连接但一条弹幕都没有」），
 * 改成由 App 内置的隐身浏览器窗口打开直播间页面，旁听页面自己收到的弹幕推送帧。
 * 详见 ./danmu-capture.ts。
 */
export class DanmuService {
  private roomId = ''
  private nickname = ''
  private connected = false
  private loggedIn = false
  private closed = false
  private msgCount = 0

  public onMessage: ((msg: DanmuMsg) => void) | null = null
  public onStatusChanged: ((status: string) => void) | null = null
  public onDisconnected: ((reason: string) => void) | null = null

  get isConnected(): boolean {
    return this.connected
  }

  /**
   * @param roomId 房间号（enterRoomId，内部唯一标识，也是入库的 key）
   * @param webRid 直播间网页地址里的短号，即 live.douyin.com/<webRid>
   * @param nick   主播昵称
   */
  async connect(roomId: string, webRid: string, nick: string): Promise<void> {
    this.roomId = roomId
    this.nickname = nick
    this.closed = false
    this.msgCount = 0

    // 抖音只给已登录的网页端推弹幕：没登录时先提醒，免得运营以为程序坏了
    const login = await douyinLoginState().catch(() => ({ loggedIn: false }))
    this.loggedIn = login.loggedIn

    this.onStatusChanged?.(login.loggedIn ? '正在打开弹幕通道...' : '未登录抖音，弹幕收不到（请到「弹幕」页登录）')
    logger.info(LOG_MODULE, `连接直播间 房间=${roomId} 网页号=${webRid || roomId} 主播=${nick} 已登录抖音=${login.loggedIn ? '是' : '否'}`)

    initializeTable(roomId, nick)

    const opening = openRoomTap(roomId, webRid || roomId, {
      onMessages: (msgs: RawDanmuMessage[]) => this.handleMessages(msgs),
      onStatus: (status: string) => {
        this.connected = status === '已连接'
        this.onStatusChanged?.(status)
      },
      onError: (reason: string) => {
        this.connected = false
        logger.warn(LOG_MODULE, `弹幕通道异常 房间=${this.roomId}：${reason}`)
        this.onDisconnected?.(reason)
      }
    })

    await Promise.race([
      opening.catch((ex: any) => {
        logger.error(LOG_MODULE, `打开弹幕窗口失败 房间=${roomId}：${ex.message}`)
        throw new Error(`弹幕通道打开失败：${ex.message}`)
      }),
      new Promise((resolve) => setTimeout(resolve, CONNECT_TIMEOUT_MS))
    ])

    if (!this.closed) {
      this.connected = true
      this.onStatusChanged?.(this.loggedIn ? '已连接' : '已连接（未登录抖音，收不到弹幕）')
    }
  }

  disconnect(): void {
    this.closed = true
    this.connected = false
    closeRoomTap(this.roomId)
    logger.info(LOG_MODULE, `主动断开 房间=${this.roomId} 累计消息=${this.msgCount}`)
  }

  /** 处理旁听到的原始消息（method + payload 已在 danmu-capture 里拆好） */
  private handleMessages(msgs: RawDanmuMessage[]): void {
    if (this.closed) return
    for (const m of msgs) {
      try {
        const body = maybeDecompress(m.payload)
        const inner = parse(body)
        this.msgCount++
        this.parseByMethod(m.method, inner)
      } catch (ex: any) {
        logger.error(LOG_MODULE, `[MsgError] ${ex.message}`)
      }
    }
  }

  private parseByMethod(method: string, data: ProtobufMap): void {
    const rawJson = JSON.stringify({ method, data })

    if (method.includes('WebcastChatMessage')) this.parseChatMessage(data, rawJson)
    else if (method.includes('WebcastMemberMessage')) this.parseMemberMessage(data, rawJson)
    else if (method.includes('WebcastGiftSortMessage')) this.parseGiftSortMessage(data, rawJson)
    else if (method.includes('WebcastGiftMessage')) this.parseGiftMessage(data, rawJson)
    else if (method.includes('WebcastChatLikeMessage')) this.parseChatLikeMessage(data, rawJson)
    else if (method.includes('WebcastLikeMessage')) this.parseLikeMessage(data, rawJson)
    else if (method.includes('WebcastSocialMessage')) this.parseSocialMessage(data, rawJson)
    else if (method.includes('WebcastRoomStatsMessage')) this.parseStatsMessage(data, rawJson)
    else if (method.includes('WebcastRoomUserSeqMessage')) this.parseRoomUserSeqMessage(data, rawJson)
  }

  private emitMsg(partial: Partial<DanmuMsg>): void {
    const msg: DanmuMsg = {
      type: partial.type || 'Chat',
      userName: partial.userName || '',
      content: partial.content || '',
      giftName: partial.giftName || '',
      giftCount: partial.giftCount || 0,
      giftPrice: partial.giftPrice || 0,
      likeCount: partial.likeCount || 0,
      totalUser: partial.totalUser || 0,
      totalLike: partial.totalLike || 0,
      // 显示用当地时间（以前用的 ISO 是 UTC，比北京时间少 8 小时，看着总对不上）
      time: localStamp(),
      roomName: this.nickname,
      avatar: partial.avatar || '',
      profileUrl: partial.profileUrl || '',
      rawData: partial.rawData || ''
    }
    this.onMessage?.(msg)

    // Save to database
    const dbContent = msg.type === 'Stats' ? `在线: ${msg.totalUser} | 点赞: ${msg.totalLike}` : msg.content
    insertMessage(this.roomId, {
      type: msg.type,
      userName: msg.userName,
      content: dbContent,
      giftName: msg.giftName,
      giftCount: msg.giftCount,
      giftPrice: msg.giftPrice,
      likeCount: msg.likeCount,
      avatar: msg.avatar,
      profileUrl: msg.profileUrl,
      rawData: msg.rawData
    })
  }

  private parseChatMessage(data: ProtobufMap, rawJson: string): void {
    const user = getFieldDict(data, 'f2')
    if (!user) return
    this.emitMsg({
      type: 'Chat',
      userName: getNickname(user),
      content: getFieldString(data, 'f3') || '',
      avatar: extractAvatar(user),
      profileUrl: extractProfileUrl(user),
      rawData: rawJson
    })
  }

  private parseMemberMessage(data: ProtobufMap, rawJson: string): void {
    const user = getFieldDict(data, 'f2')
    if (!user) return
    this.emitMsg({
      type: 'Member',
      userName: getNickname(user),
      avatar: extractAvatar(user),
      profileUrl: extractProfileUrl(user),
      rawData: rawJson
    })
  }

  private parseGiftMessage(data: ProtobufMap, rawJson: string): void {
    const user = getFieldDict(data, 'f7') || getFieldDict(data, 'f2') || getFieldDict(data, 'f15')
    const gift = getFieldDict(data, 'f15') || getFieldDict(data, 'f2')

    let giftName = '礼物'
    if (gift) {
      giftName = getFieldString(gift, 'f16') || getFieldString(gift, 'f6') ||
        getFieldString(gift, 'f2') || getFieldString(gift, 'f1') || '礼物'
    }

    let giftCount = getIntField(data, 'f6', 0)
    if (giftCount === 0) giftCount = getIntField(data, 'f4', 0)
    if (giftCount === 0) giftCount = getIntField(gift || data, 'f5', 0)
    if (giftCount === 0) giftCount = 1

    let giftPrice = gift ? getLongField(gift, 'f12', 0) : 0
    if (giftPrice === 0 && gift) giftPrice = getLongField(gift, 'f10', 0)

    this.emitMsg({
      type: 'Gift',
      userName: user ? getNickname(user) : '未知用户',
      giftName, giftCount, giftPrice,
      avatar: user ? extractAvatar(user) : '',
      profileUrl: user ? extractProfileUrl(user) : '',
      rawData: rawJson
    })
  }

  private parseGiftSortMessage(data: ProtobufMap, rawJson: string): void {
    const user = getFieldDict(data, 'f3') || getFieldDict(data, 'f7')
    const gift = getFieldDict(data, 'f5') || getFieldDict(data, 'f2')

    let giftName = '礼物'
    if (gift) {
      giftName = getFieldString(gift, 'f6') || getFieldString(gift, 'f2') ||
        getFieldString(gift, 'f1') || '礼物'
    }

    let giftCount = getIntField(data, 'f6', 0)
    if (giftCount === 0) giftCount = getIntField(data, 'f4', 0)
    if (giftCount === 0) giftCount = 1

    this.emitMsg({
      type: 'Gift',
      userName: user ? getNickname(user) : '未知用户',
      giftName, giftCount,
      giftPrice: gift ? getLongField(gift, 'f12', 0) : 0,
      avatar: user ? extractAvatar(user) : '',
      profileUrl: user ? extractProfileUrl(user) : '',
      rawData: rawJson
    })
  }

  private parseLikeMessage(data: ProtobufMap, rawJson: string): void {
    const user = getFieldDict(data, 'f5')
    if (!user) return
    this.emitMsg({
      type: 'Like',
      userName: getNickname(user),
      likeCount: getIntField(data, 'f2', 1),
      avatar: extractAvatar(user),
      profileUrl: extractProfileUrl(user),
      rawData: rawJson
    })
  }

  private parseChatLikeMessage(_data: ProtobufMap, rawJson: string): void {
    this.emitMsg({ type: 'Like', userName: '观众', likeCount: 1, rawData: rawJson })
  }

  private parseSocialMessage(data: ProtobufMap, rawJson: string): void {
    const user = getFieldDict(data, 'f2')
    if (!user) return
    this.emitMsg({
      type: 'Social',
      userName: getNickname(user),
      avatar: extractAvatar(user),
      profileUrl: extractProfileUrl(user),
      rawData: rawJson
    })
  }

  private parseStatsMessage(data: ProtobufMap, rawJson: string): void {
    this.emitMsg({
      type: 'Stats',
      totalUser: getLongField(data, 'f2', 0),
      totalLike: getLongField(data, 'f3', 0),
      rawData: rawJson
    })
  }

  private parseRoomUserSeqMessage(data: ProtobufMap, rawJson: string): void {
    this.emitMsg({
      type: 'Stats',
      totalUser: getLongField(data, 'f3', 0),
      totalLike: getLongField(data, 'f7', 0),
      rawData: rawJson
    })
  }
}

function getNickname(user: ProtobufMap): string {
  return getFieldString(user, 'f3') || getFieldString(user, 'f1') || getFieldString(user, 'f2') || '未知'
}

function extractAvatar(user: ProtobufMap): string {
  const raw = getFieldString(user, 'f9')
  if (raw) {
    // f9 is a string: "\n" + one char + actual url
    return raw.length > 2 ? raw.substring(2) : raw.replace(/^\s+/, '')
  }
  // f9 may be a nested dict with f1 as the avatar url
  const f9dict = getFieldDict(user, 'f9')
  if (f9dict) {
    return getFieldString(f9dict, 'f1') || ''
  }
  return ''
}

function extractProfileUrl(user: ProtobufMap): string {
  const secUid = getFieldString(user, 'f46') || ''
  if (!secUid) return ''
  return `https://www.douyin.com/user/${secUid}`
}

function maybeDecompress(data: Buffer): Buffer {
  if (data.length > 2 && data[0] === 0x1F && data[1] === 0x8B) {
    return gunzipSync(data)
  }
  return data
}

/** 本地时间戳：YYYY-MM-DD HH:MM:SS */
function localStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
