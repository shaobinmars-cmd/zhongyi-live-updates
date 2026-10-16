/**
 * v5 指令开关的验证（开发用）：
 * 1) teardown.json 能存/读 useV5；
 * 2) 编译后的 ai-analyze.js 里确实带了 v5 指令文本与开关分支；
 * 3) 默认值必须是 false（不改动现有行为）。
 */
const path = require('path')
const fs = require('fs')
const os = require('os')
const { app } = require('electron')

const tmp = path.join(os.tmpdir(), 'inc-smoke-' + Date.now())
fs.mkdirSync(tmp, { recursive: true })
app.setPath('userData', tmp)

function ok(label, cond, extra) {
  console.log((cond ? '[OK]   ' : '[FAIL] ') + label + (extra !== undefined ? '  → ' + extra : ''))
  if (!cond) process.exitCode = 1
}

app.whenReady().then(() => {
  try {
    const root = path.join(__dirname, '..')
    const tdConfig = require(path.join(root, 'dist-electron', 'services', 'teardown-config.js'))
    const inst = require(path.join(root, 'dist-electron', 'services', 'teardown-instruction.js'))

    ok('默认关闭（不改动现有行为）', tdConfig.load().useV5 === false, String(tdConfig.load().useV5))
    tdConfig.save({ useV5: true })
    ok('能打开', tdConfig.load().useV5 === true)
    tdConfig.save({ useV5: false })
    ok('能关闭', tdConfig.load().useV5 === false)

    const code = fs.readFileSync(path.join(root, 'dist-electron', 'services', 'ai-analyze.js'), 'utf-8')
    ok('ai-analyze 已接开关', code.includes('useV5'))
    ok('ai-analyze 引用了 v5 指令模块', code.includes('teardown-instruction'))
    const instCode = fs.readFileSync(path.join(root, 'dist-electron', 'services', 'teardown-instruction.js'), 'utf-8')
    ok('指令文本已在指令模块里', instCode.includes('主播执行卡') && instCode.includes('30 天孵化清单'))
    ok('指令模块可读', typeof inst.V5_INSTRUCTION === 'string' && inst.V5_INSTRUCTION.length > 500, inst.V5_INSTRUCTION.length + ' 字')
  } catch (e) {
    console.error('[EXCEPTION]', e && e.stack ? e.stack : e)
    process.exitCode = 1
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
    app.quit()
  }
})
