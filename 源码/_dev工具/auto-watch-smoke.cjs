// 未开播自动等待专项：未开播不启动、开播后自动弹幕+录制、等待列表可持久化。
const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const temp = path.join(os.tmpdir(), `zy-auto-watch-${Date.now()}`)
app.setPath('userData', temp)
app.on('window-all-closed', () => { /* 测试脚本自己退出 */ })

function assert(ok, message) {
  if (!ok) throw new Error(message)
  console.log('[OK] ' + message)
}

app.whenReady().then(async () => {
  try {
    const { AutoWatchManager } = require('../dist-electron/services/auto-watch.js')
    const file = path.join(temp, 'auto-watch.json')
    let liveStatus = 2
    let danmuStarts = 0
    let recordStarts = 0
    let danmuConnected = false
    let recording = false
    const hooks = {
      refreshRoom: async (room) => ({ roomStatus: liveStatus, nickname: room.nickname || '测试主播' }),
      startDanmu: async () => { danmuStarts++; danmuConnected = true; return true },
      startRecording: async () => { recordStarts++; recording = true; return true },
      isDanmuConnected: () => danmuConnected,
      isRecording: () => recording
    }

    const manager = new AutoWatchManager(file, hooks, 60_000)
    manager.add({
      enterRoomId: '443854703170',
      url: 'https://live.douyin.com/443854703170',
      nickname: '测试主播',
      title: '测试直播',
      platform: 'douyin',
      platformLabel: '抖音',
      roomStatus: 2
    })

    await manager.checkNow()
    let item = manager.get('443854703170')
    assert(item?.state === 'waiting', '未开播时保持等待，不提前录制')
    assert(danmuStarts === 0 && recordStarts === 0, '未开播不会连接弹幕或启动录制')
    assert(fs.existsSync(file), '等待列表已经持久化')

    liveStatus = 0
    await manager.checkNow()
    item = manager.get('443854703170')
    assert(item?.state === 'started', '检测到开播后进入已启动状态')
    assert(danmuStarts === 1, '开播后自动连接一次弹幕')
    assert(recordStarts === 1, '开播后自动启动一次录制')
    assert(item?.message.includes('自动开始录制'), '状态中明确显示自动接入结果')

    manager.stop()
    const reloaded = new AutoWatchManager(file, hooks, 60_000)
    assert(reloaded.get('443854703170')?.state === 'started', '软件重启后能恢复自动任务记录')
    assert(reloaded.remove('443854703170'), '可以取消自动等待任务')
    reloaded.stop()

    const broken = JSON.parse(fs.readFileSync(file, 'utf-8'))
    broken.items = [{
      enterRoomId: '650405281312',
      url: 'https://live.douyin.com/650405281312',
      nickname: '中断恢复测试',
      title: '',
      platform: 'douyin',
      platformLabel: '抖音',
      roomStatus: 2,
      likeCount: 0,
      viewCount: 0,
      error: '',
      state: 'checking',
      message: '',
      addedAt: '',
      lastCheckAt: '',
      startedAt: '',
      attempts: 1
    }]
    fs.writeFileSync(file, JSON.stringify(broken), 'utf-8')
    const recovered = new AutoWatchManager(file, hooks, 60_000)
    assert(recovered.get('650405281312')?.state === 'waiting', '软件上次检查中断后会自动恢复等待')
    recovered.stop()

    console.log('AUTO WATCH OK')
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* ignore */ }
    app.exit(0)
  } catch (e) {
    console.error(e && e.stack ? e.stack : e)
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* ignore */ }
    app.exit(1)
  }
})
