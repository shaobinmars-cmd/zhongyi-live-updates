/**
 * 自动开路由器端口（UPnP / IGD）
 *
 * 外地运营要连老板这台机器，就得在路由器上把端口映射进来。
 * 让老板自己去路由器后台点太麻烦，这里用 UPnP 自动做：
 *   1) SSDP 广播找网关
 *   2) 拿设备描述，找到 WANIPConnection 服务的 controlURL
 *   3) SOAP 调 AddPortMapping 开端口、DeletePortMapping 关端口
 *
 * 很多家用/办公路由器默认开着 UPnP；如果关了，就退回"手动映射"的说明。
 */

import dgram from 'dgram'
import http from 'http'
import { URL } from 'url'
import * as logger from './logger'

const LOG_MODULE = 'Upnp'

const SSDP_ADDR = '239.255.255.250'
const SSDP_PORT = 1900
const SERVICE_TYPES = [
  'urn:schemas-upnp-org:service:WANIPConnection:2',
  'urn:schemas-upnp-org:service:WANIPConnection:1',
  'urn:schemas-upnp-org:service:WANPPPConnection:1'
]

interface Gateway {
  controlUrl: string
  serviceType: string
}

/** 广播找网关，拿到控制地址 */
/**
 * 广播找网关，把所有应答的设备都收集回来。
 * 为什么是“所有”：现在很多家庭/办公室是两层 NAT（光猫 + 路由器），
 * 只开内层路由器的端口，外面还是连不进来，所以两层都得开。
 */
function discoverAll(timeoutMs = 5000): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    const found = new Set<string>()
    let closed = false
    const done = () => {
      if (closed) return
      closed = true
      try { socket.close() } catch { /* ignore */ }
      if (found.size) resolve([...found])
      else reject(new Error('没找到路由器（UPnP 没开，或被路由器/光猫屏蔽了）'))
    }

    socket.on('message', (msg) => {
      const text = msg.toString('utf8')
      const loc = text.match(/LOCATION:\s*(\S+)/i)
      if (loc) found.add(loc[1].trim())
    })
    socket.on('error', (ex) => {
      if (!closed) { closed = true; reject(ex) }
    })

    socket.bind(() => {
      const req = Buffer.from(
        'M-SEARCH * HTTP/1.1\r\n' +
        `HOST: ${SSDP_ADDR}:${SSDP_PORT}\r\n` +
        'MAN: "ssdp:discover"\r\n' +
        'MX: 3\r\n' +
        'ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n' +
        '\r\n'
      )
      socket.send(req, 0, req.length, SSDP_PORT, SSDP_ADDR)
    })

    setTimeout(done, timeoutMs)
  })
}

interface GatewayInfo {
  location: string
  controlUrl: string
  serviceType: string
  externalIp: string
}

function isPrivateIp(ip: string): boolean {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || !ip
}

/** 抓一段 XML 里的标签值 */
function pick(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))
  return m ? m[1].trim() : ''
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = http.get(
      { host: u.hostname, port: u.port || 80, path: u.pathname + u.search, timeout: 6000 },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c) => { body += c })
        res.on('end', () => resolve(body))
      }
    )
    req.on('timeout', () => req.destroy(new Error('读取路由器信息超时')))
    req.on('error', reject)
  })
}

/** 在设备描述里找到管端口映射的那个服务 */
function findControl(xml: string, baseUrl: string): Gateway | null {
  const services = xml.split(/<service>/i).slice(1)
  for (const s of services) {
    const type = pick(s, 'serviceType')
    if (!SERVICE_TYPES.some((t) => type.startsWith(t))) continue
    const ctrl = pick(s, 'controlURL')
    if (!ctrl) continue
    const url = ctrl.startsWith('http') ? ctrl : new URL(ctrl, baseUrl).toString()
    return { controlUrl: url, serviceType: type }
  }
  return null
}

function soap(controlUrl: string, serviceType: string, action: string, args: string): Promise<string> {
  const body =
    '<?xml version="1.0"?>\r\n' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<s:Body><u:${action} xmlns:u="${serviceType}">${args}</u:${action}></s:Body></s:Envelope>`

  return new Promise((resolve, reject) => {
    const u = new URL(controlUrl)
    const req = http.request(
      {
        host: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        method: 'POST',
        timeout: 8000,
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          'Content-Length': Buffer.byteLength(body),
          SOAPAction: `"${serviceType}#${action}"`
        }
      },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (c) => { text += c })
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`路由器拒绝了（HTTP ${res.statusCode}）：${text.slice(0, 160)}`))
          } else resolve(text)
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('路由器响应超时')))
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

/** 把所有应答的设备都摸一遍，拿到控制地址和各自的外网 IP */
async function listGateways(): Promise<GatewayInfo[]> {
  const locations = await discoverAll()
  const out: GatewayInfo[] = []
  for (const loc of locations) {
    try {
      const xml = await httpGet(loc)
      const gw = findControl(xml, loc)
      if (!gw) continue
      let externalIp = ''
      try {
        const r = await soap(gw.controlUrl, gw.serviceType, 'GetExternalIPAddress', '')
        externalIp = pick(r, 'NewExternalIPAddress')
      } catch { /* 有的设备不给查，不影响 */ }
      out.push({ location: loc, controlUrl: gw.controlUrl, serviceType: gw.serviceType, externalIp })
    } catch { /* 单个设备失败不影响其它 */ }
  }
  if (!out.length) throw new Error('路由器不支持自动端口映射（没找到 UPnP 服务）')
  return out
}

async function mapPort(g: GatewayInfo, port: number, internalIp: string): Promise<void> {
  const args =
    '<NewRemoteHost></NewRemoteHost>' +
    `<NewExternalPort>${port}</NewExternalPort>` +
    '<NewProtocol>TCP</NewProtocol>' +
    `<NewInternalPort>${port}</NewInternalPort>` +
    `<NewInternalClient>${internalIp}</NewInternalClient>` +
    '<NewEnabled>1</NewEnabled>' +
    '<NewPortMappingDescription>ZhongYi-AI</NewPortMappingDescription>' +
    '<NewLeaseDuration>0</NewLeaseDuration>'
  await soap(g.controlUrl, g.serviceType, 'AddPortMapping', args)
}

/** 查当前对外的公网 IP（两层 NAT 时取最外层那个） */
export async function wanIp(): Promise<string> {
  const gws = await listGateways()
  const pub = gws.find((g) => g.externalIp && !isPrivateIp(g.externalIp))
  return (pub || gws[0]).externalIp || ''
}

/** 开端口：两层 NAT 就先开内层，再开外层（外层要指向内层的 WAN 地址） */
export async function openPort(opts: { port: number; internalIp: string; description?: string }): Promise<{ ok: boolean; message: string; externalIp?: string }> {
  try {
    const gws = await listGateways()
    const inner = gws.filter((g) => !g.externalIp || isPrivateIp(g.externalIp))
    const outer = gws.filter((g) => g.externalIp && !isPrivateIp(g.externalIp))
    const steps: string[] = []

    for (const g of inner) {
      try {
        await mapPort(g, opts.port, opts.internalIp)
        steps.push(`内层路由器已开→${opts.internalIp}`)
      } catch (ex: any) {
        steps.push(`内层没开成：${ex.message}`)
      }
    }

    for (const g of outer) {
      const via = inner[0]?.externalIp || opts.internalIp
      try {
        await mapPort(g, opts.port, via)
        steps.push(`外层光猫/上级路由已开→${via}`)
      } catch (ex: any) {
        steps.push(`外层没开成：${ex.message}`)
      }
    }

    const externalIp = outer[0]?.externalIp || ''
    const okPublic = !!externalIp && !isPrivateIp(externalIp)
    logger.info(LOG_MODULE, `端口映射：${steps.join('；')}　公网=${externalIp || '未知'}`)
    return {
      ok: okPublic,
      externalIp,
      message: okPublic
        ? '外网端口已开放：' + steps.join('；')
        : '内网端口开好了，但外层（光猫/上级路由）没能自动开放，需要手动处理：' + steps.join('；')
    }
  } catch (ex: any) {
    logger.warn(LOG_MODULE, `自动开端口失败：${ex.message}`)
    return { ok: false, message: String(ex?.message || ex) }
  }
}

/** 关端口 */
export async function closePort(port: number): Promise<{ ok: boolean; message: string }> {
  try {
    const gws = await listGateways()
    for (const g of gws) {
      try {
        await soap(g.controlUrl, g.serviceType, 'DeletePortMapping',
          '<NewRemoteHost></NewRemoteHost>' + `<NewExternalPort>${port}</NewExternalPort>` + '<NewProtocol>TCP</NewProtocol>')
      } catch { /* 个别设备删不掉不影响别的 */ }
    }
    logger.info(LOG_MODULE, `端口映射已删除：${port}`)
    return { ok: true, message: '已关闭外网端口' }
  } catch (ex: any) {
    return { ok: false, message: String(ex?.message || ex) }
  }
}
