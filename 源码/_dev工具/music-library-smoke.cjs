// 曲库专项：内置清单、文件夹、歌单导入、音频上传、状态与删除。
const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const temp = path.join(os.tmpdir(), `zy-music-smoke-${Date.now()}`)
app.setPath('userData', temp)
app.on('window-all-closed', () => { /* 测试脚本自己退出 */ })

function assert(ok, message) {
  if (!ok) throw new Error(message)
  console.log('[OK] ' + message)
}

app.whenReady().then(async () => {
  try {
    const music = require('../dist-electron/services/music-library.js')
    let s = music.stats()
    assert(s.total >= 1250, `内置曲库已加载（${s.total} 首）`)
    assert(s.blocked >= 1200, '内置歌曲默认标记为抖音无版权')
    assert(music.listSongs('飞鸟和蝉', 'blocked').some((x) => x.title === '飞鸟和蝉'), '可以按歌名搜索')

    const folder = music.addFolder('主播A测试曲库')
    assert(folder.id && music.listFolders().some((f) => f.id === folder.id), '可以新建运营文件夹')

    const checkCsv = path.join(temp, '待检测600首.csv')
    fs.writeFileSync(checkCsv, '\ufeff歌曲名,歌手\n飞鸟和蝉,任然\n飞鸟和蝉,另一个歌手\n完全不存在的测试歌曲,测试歌手\n', 'utf-8')
    const checked = await music.checkFile(checkCsv)
    assert(checked.blocked === 1 && checked.suspected === 1 && checked.okCount === 1, '批量检测能分成禁播/疑似/未命中三档')
    const checkedSaved = music.saveCheckedResults(checked.results, folder.id, '待检测600首.csv')
    assert(checkedSaved.added === 3, '批量检测结果可以保存到指定文件夹')

    const blockCsv = path.join(temp, '禁播更新.csv')
    fs.writeFileSync(blockCsv, '\ufeff歌曲名,歌手,状态\n强制禁播测试,测试歌手,可播放\n', 'utf-8')
    await music.importFile(blockCsv, music.BLOCKED_FOLDER_ID, true)
    const forced = music.listSongs('强制禁播测试', 'blocked', music.BLOCKED_FOLDER_ID)[0]
    assert(!!forced, '更新禁播歌曲会强制标记为禁止播放')
    music.removeSong(forced.id)

    const csv = path.join(temp, '更新歌单.csv')
    fs.writeFileSync(csv, '\ufeff歌曲名,歌手,状态,备注\n测试新歌,测试歌手,抖音无版权,禁止播放\n测试可用歌,测试歌手,可播放,已确认\n', 'utf-8')
    const imported = await music.importFile(csv, folder.id)
    assert(imported.ok && imported.added === 2, '歌单可以导入指定文件夹')
    assert(music.listSongs('测试新歌', 'blocked', folder.id).length === 1, '无版权歌曲状态正确')
    const okSong = music.listSongs('测试可用歌', 'ok', folder.id)[0]
    assert(!!okSong, '可播放歌曲状态正确')

    const changed = music.updateSong(okSong.id, { status: 'blocked', note: '后来发现禁播' })
    assert(changed.status === 'blocked', '可以修改歌曲状态')
    assert(music.removeSong(changed.id), '可以删除测试歌曲')

    const audio = path.join(temp, '主播测试歌.mp3')
    fs.writeFileSync(audio, Buffer.alloc(2048))
    const uploaded = music.addAudioFiles([audio], folder.id)
    assert(uploaded.added === 1, '可以上传音频文件到指定文件夹')
    const audioSong = music.listSongs('主播测试歌', '', folder.id)[0]
    assert(!!audioSong?.filePath && fs.existsSync(music.openSong(audioSong.id)), '上传后的音频可找到并播放')
    assert(music.renameFolder(folder.id, '主播A改名').name === '主播A改名', '文件夹可以重命名')

    for (const song of music.listSongs('', '', folder.id)) music.removeSong(song.id)
    assert(music.removeFolder(folder.id), '空文件夹可以删除')

    const moveA = music.addFolder('歌曲迁移测试A')
    const moveB = music.addFolder('歌曲迁移测试B')
    const moveAudio = path.join(temp, '歌曲迁移测试.mp3')
    fs.writeFileSync(moveAudio, Buffer.alloc(2048))
    music.addAudioFiles([moveAudio], moveA.id)
    const moveSong = music.listSongs('歌曲迁移测试', '', moveA.id)[0]
    const movedSong = music.updateSong(moveSong.id, { folderId: moveB.id })
    assert(movedSong.folderId === moveB.id && music.openSong(movedSong.id).includes(`${path.sep}${moveB.id}${path.sep}`), '歌曲切换文件夹时音频文件同步迁移')
    music.removeSong(movedSong.id)
    assert(music.removeFolder(moveA.id) && music.removeFolder(moveB.id), '歌曲迁移后的文件夹可正常清理')
    const formats = music.addFolder('常见播放器格式测试')
    const flac = path.join(temp, '无损测试.flac')
    const ape = path.join(temp, 'APE测试.ape')
    const kgm = path.join(temp, '酷狗加密测试.kgm')
    fs.writeFileSync(flac, Buffer.alloc(1024))
    fs.writeFileSync(ape, Buffer.alloc(1024))
    fs.writeFileSync(kgm, Buffer.alloc(1024))
    const commonFormats = music.addAudioFiles([flac, ape], formats.id)
    assert(commonFormats.added === 2, '支持 FLAC、APE 等常见播放器无损格式')
    const encrypted = music.addAudioFiles([kgm], formats.id)
    assert(encrypted.added === 0 && encrypted.skipped === 1, '酷狗加密 KGM 不会冒充普通音频导入')
    for (const song of music.listSongs('', '', formats.id)) music.removeSong(song.id)
    assert(music.removeFolder(formats.id), '格式测试文件夹可正常清理')
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* ignore */ }
    console.log('MUSIC LIBRARY OK')
    app.exit(0)
  } catch (e) {
    console.error(e && e.stack ? e.stack : e)
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* ignore */ }
    app.exit(1)
  }
})
