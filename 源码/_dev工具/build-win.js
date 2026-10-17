/**
 * 打 Windows 安装包（开发用）：nsis + portable
 * 运行：ELECTRON_RUN_AS_NODE=1 electron.exe _dev工具\build-win.js
 * 等价于 npm run electron:build（只是本机没有 node/npm，借用自带 Electron 当 Node）。
 */
const path = require('path')
const fs = require('fs')
const { build, Platform } = require('electron-builder')

const root = path.join(__dirname, '..')

/**
 * 打完包自动把最新安装包放进「升级包」目录（老板机当升级服务器用的那个）。
 * 顺手清掉里面旧的，保证运营点「一键升级」拉到的永远是最新一版。
 * 失败也不影响打包 —— 只是多发一次网盘的事。
 */
const UPDATE_DIR = 'H:\\升级包'
function publishInstaller() {
  try {
    const rel = path.join(root, 'release')
    const setups = fs.readdirSync(rel)
      .filter((f) => /Setup .*\.exe$/i.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(rel, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    if (!setups.length) {
      console.log('  (没找到 Setup 安装包，跳过升级包目录)')
      return
    }
    const newest = setups[0].f
    fs.mkdirSync(UPDATE_DIR, { recursive: true })
    for (const f of fs.readdirSync(UPDATE_DIR)) {
      if (/Setup .*\.exe$/i.test(f) && f !== newest) {
        try { fs.unlinkSync(path.join(UPDATE_DIR, f)) } catch { /* ignore */ }
      }
    }
    fs.copyFileSync(path.join(rel, newest), path.join(UPDATE_DIR, newest))
    console.log('  已放进升级包目录：' + path.join(UPDATE_DIR, newest))
  } catch (e) {
    console.log('  (放进升级包目录失败，不影响打包：' + (e && e.message ? e.message : e) + ')')
  }
}
build({
  projectDir: root,
  config: path.join(root, 'electron-builder.yml'),
  targets: Platform.WINDOWS.createTarget(['nsis', 'portable']),
  publish: 'never'
})
  .then((res) => {
    console.log('BUILD OK')
    for (const f of res || []) console.log('  ' + f)
    publishInstaller()
  })
  .catch((e) => {
    console.error('BUILD FAIL:', e && e.message ? e.message : e)
    console.error(e && e.stack ? e.stack : e)
    process.exit(1)
  })
