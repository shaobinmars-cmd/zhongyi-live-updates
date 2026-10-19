// 素材包/报告主播名专项：素材包写标题、基本信息、带名字副本。
const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const temp = path.join(os.tmpdir(), `zy-packet-identity-${Date.now()}`)
app.setPath('userData', temp)
app.on('window-all-closed', () => { /* 测试脚本自己退出 */ })

function assert(ok, message) {
  if (!ok) throw new Error(message)
  console.log('[OK] ' + message)
}

app.whenReady().then(() => {
  try {
    const td = require('../dist-electron/services/teardown.js')
    const work = path.join(temp, 'work_测试主播_20261019_1200')
    fs.mkdirSync(work, { recursive: true })
    const packet = path.join(work, '拆解素材包.md')
    fs.writeFileSync(packet, '# 直播拆解素材包\n\n## 一、基本信息\n\n- 视频文件：测试.mp4\n\n## 二、技术索引\n', 'utf-8')

    const named = td.stampPacketIdentity(packet, path.join(temp, '测试主播_20261019_1200_001.mp4'))
    const text = fs.readFileSync(packet, 'utf-8')
    assert(text.startsWith('# 直播拆解素材包 · 测试主播'), '素材包标题包含主播名')
    assert(text.includes('- 主播：测试主播'), '素材包基本信息包含主播名')
    assert(named && fs.existsSync(named) && path.basename(named).includes('测试主播'), '生成带主播名的素材包副本')

    const info = td.readPacket(packet)
    assert(info?.nickname === '测试主播', '读取素材包时能识别主播名')
    console.log('PACKET IDENTITY OK')
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* ignore */ }
    app.exit(0)
  } catch (e) {
    console.error(e && e.stack ? e.stack : e)
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* ignore */ }
    app.exit(1)
  }
})
