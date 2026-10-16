/**
 * 「从拆解产物导入」实测（开发用）：拿真实报告跑一遍，看抽到多少资产/课表
 * 用法：electron.exe _dev工具\test-import.js "<报告文件或目录>" ["<第二个路径>"]
 * 数据写在临时目录，跑完自动清理。
 */
const path = require('path')
const fs = require('fs')
const os = require('os')
const { app } = require('electron')

const tmp = path.join(os.tmpdir(), 'incubate-import-' + Date.now())
fs.mkdirSync(tmp, { recursive: true })
app.setPath('userData', tmp)

const targets = process.argv.slice(2).filter((a) => a && !a.endsWith('.js') && !a.endsWith('electron.exe'))

app.whenReady().then(async () => {
  try {
    const inc = require(path.join(__dirname, '..', 'dist-electron', 'services', 'incubate.js'))
    for (const t of targets) {
      console.log('\n==================== ' + t)
      if (!fs.existsSync(t)) { console.log('  [跳过] 路径不存在'); continue }
      const r = await inc.importFromTeardown(t)
      console.log('  结果：' + r.message)
      const r2 = await inc.importFromTeardown(t)
      console.log('  再导一次：' + r2.message)
      const assets = await inc.listRows('资产库')
      const mine = assets.filter((x) => String(x['来源场次'] || '').includes(r.caseName || '___'))
      console.log(`  资产库总 ${assets.length} 条，本次来源 ${mine.length} 条`)
      for (const a of mine.slice(0, 4)) console.log(`    · ${a['编号']} [${a['类型']}] ${String(a['内容']).slice(0, 70)}  时间戳=${a['时间戳'] || '-'}`)
      const sched = await inc.listRows('课表')
      console.log(`  课表 ${sched.length} 条`)
      for (const s of sched.slice(0, 3)) console.log(`    · ${s['日期']} ${String(s['今天练什么']).slice(0, 70)}`)
    }
  } catch (e) {
    console.error('[EXCEPTION]', e && e.stack ? e.stack : e)
    process.exitCode = 1
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
    app.quit()
  }
})
