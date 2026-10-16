// 两小时规模的双场对比测试：验证不会超上下文、每份都含两边同一时间窗的弹幕/礼物
const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

app.on('window-all-closed', () => { /* 别退 */ })

const LOGFILE = path.join(os.tmpdir(), 'test-compare2h.log')
try { fs.writeFileSync(LOGFILE, '') } catch { /* ignore */ }
const log = (s) => {
  try { fs.appendFileSync(LOGFILE, String(s) + '\r\n') } catch { /* ignore */ }
  try { process.stdout.write(String(s) + '\n') } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => log('UNCAUGHT: ' + ((e && e.stack) || e)))

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

// 真实素材包里是墙钟时间（12:28 这种），这里模拟开播 12:28:05
const BASE = 12 * 3600 + 28 * 60 + 5
const wall = (minuteOffset, secOffset = 0) => {
  const t = BASE + minuteOffset * 60 + secOffset
  const p = (n) => String(n).padStart(2, '0')
  return p(Math.floor(t / 3600)) + ':' + p(Math.floor((t % 3600) / 60)) + ':' + p(t % 60)
}

/** 造一份「两小时直播」规模的素材包 */
function fakePacket(who, linesPerMin, giftsPerMin) {
  const DUR = 120 * 60
  const L = []
  L.push('# 直播拆解素材包')
  L.push('')
  L.push('## 一、基本信息')
  L.push(`- ${who}的直播`)
  L.push('- 文件：merged.mp4')
  L.push('- 时长：7200.0 秒（120.0 分钟）')
  L.push('')
  L.push('## 二、技术索引（镜头/运动/响度突变/静音）')
  L.push('```')
  for (let t = 0; t < DUR; t += 300) L.push(`#${Math.floor(t / 300) + 1}  ${mmss(t)}  shot  motion=0.42  loud+  静音0.8s`)
  L.push('```')
  L.push('')
  L.push('## 四、逐句话术稿（简体，带时间戳）')
  L.push('')
  for (let i = 0; i < linesPerMin * 120; i++) {
    const t = Math.floor((DUR / (linesPerMin * 120)) * i)
    L.push(`${mmss(t)}\t${who}第${i}句：欢迎新来的家人，点点关注不迷路（这句是测试话术，用来撑到两小时规模）`)
  }
  L.push('')
  L.push('## 五、画面网格图（每格带时间戳）')
  L.push(`- work/grid_000.jpg`)
  L.push('')
  L.push('## 六、给分析 AI 的指令')
  L.push('')
  L.push('按结构产出报告。')
  L.push('')
  // 第七节：观众反应
  L.push('## 七、弹幕与礼物（观众实时反应）')
  L.push('')
  L.push(`- 本场直播观众互动：弹幕 ${linesPerMin * 120} 条、礼物 ${giftsPerMin * 120} 件（合计约 ${giftsPerMin * 120 * 10} 钻）、进场 ${linesPerMin * 100} 次、点赞 0 次`)
  L.push('- 时间已换算成本机时间，覆盖约 120 分钟')
  L.push('- 起点：2026-10-15 12:28:05（下面所有时间都以本机时间为准）')
  L.push('')
  L.push('### 礼物汇总（按礼物名称）')
  L.push('')
  L.push('| 礼物 | 单价(钻) | 件数 | 合计(钻) |')
  L.push('|---|---|---|---|')
  L.push(`| 鲜花 | 10 | ${giftsPerMin * 60} | ${giftsPerMin * 600} |`)
  L.push(`| 棒棒糖 | 9 | ${giftsPerMin * 60} | ${giftsPerMin * 540} |`)
  L.push('')
  L.push('### 送礼榜（谁在这个点出手）')
  L.push('')
  L.push('| 观众 | 件数 | 合计(钻) |')
  L.push('|---|---|---|')
  L.push(`| 测试大哥 | ${giftsPerMin * 60} | ${giftsPerMin * 600} |`)
  L.push('')
  L.push('### 每分钟互动密度')
  L.push('')
  L.push('| 时间 | 弹幕数 | 礼物数 | 当时弹幕样例 |')
  L.push('|---|---|---|---|')
  for (let m = 0; m < 120; m++) {
    L.push(`| ${wall(m).slice(0, 5)} | ${linesPerMin} | ${giftsPerMin} | 好听 / 主播加油 / 666 |`)
  }
  L.push('')
  L.push('### 在线人数变化（每分钟最后一个采样）')
  L.push('')
  L.push('| 时间 | 在线 |')
  L.push('|---|---|')
  for (let m = 0; m < 120; m++) {
    L.push(`| ${wall(m).slice(0, 5)} | ${100 + m} |`)
  }
  L.push('')
  L.push('### 礼物明细')
  L.push('')
  for (let m = 0; m < 120; m += 4) L.push(`- ${mmss(m * 60)} 测试大哥 赠送 鲜花 x1（10 钻/个，小计 10 钻）`)
  L.push('')
  L.push('### 弹幕原文（全部）')
  L.push('')
  for (let m = 0; m < 120; m++) {
    for (let k = 0; k < 5; k++) {
      L.push(`${wall(m, k * 10).slice(0, 5)} 观众${k}：${who}弹幕第${m}-${k}条`)
    }
  }
  L.push('')
  return L.join('\n')
}

app.whenReady().then(() => {
  const cmp = require('../dist-electron/services/comparison.js')
  const split = require('../dist-electron/services/packet-split.js')

  const a = fakePacket('A别家优秀主播', 10, 2)
  const b = fakePacket('B自家主播', 8, 1)
  log(`A 素材包 ${a.length} 字，B 素材包 ${b.length} 字`)
  log(`各自 token 估算：A≈${split.estimateTokens(a)}，B≈${split.estimateTokens(b)}，合计≈${split.estimateTokens(a) + split.estimateTokens(b)}`)

  const LIMIT = 24000
  const r = cmp.buildComparison(
    { path: 'A', label: '别家 · 优秀主播', packet: a },
    { path: 'B', label: '自家 · 我们主播', packet: b },
    LIMIT
  )
  log(`\n对比结果：${r.note}`)
  log(`分片数=${r.parts.length}，limit=${r.limit}`)

  let allOk = true
  r.parts.forEach((p, i) => {
    const over = p.tokens > LIMIT
    if (over) allOk = false
    const hasA = /A · 观众反应/.test(p.content)
    const hasB = /B · 观众反应/.test(p.content)
    const hasGift = /礼物汇总/.test(p.content)
    const hasDensity = /每分钟互动密度/.test(p.content)
    const hasChat = /弹幕原文/.test(p.content)
    log(`  第 ${i + 1}/${r.parts.length} 份：${p.tokens} token${over ? ' ✗超了' : ' ✓'}｜A${p.rangeA} B${p.rangeB}｜含A反应=${hasA} 含B反应=${hasB} 礼物汇总=${hasGift} 密度表=${hasDensity} 弹幕=${hasChat}`)
  })
  log(`\n每份是否都不超 ${LIMIT}：${allOk ? '是 ✓' : '否 ✗'}`)

  // 看看第一份长什么样
  log('\n——— 第 1 份的开头（节选）———')
  log(r.parts[0].content.slice(0, 700))
  const idx = r.parts[0].content.indexOf('## 六、A · 观众反应')
  if (idx >= 0) log('\n——— 第 1 份里的 A 观众反应（节选）———\n' + r.parts[0].content.slice(idx, idx + 500))

  app.exit(0)
}).catch((e) => log('失败: ' + ((e && e.stack) || e)))
