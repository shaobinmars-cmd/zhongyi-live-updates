/**
 * 打 Windows 安装包（开发用）：nsis + portable
 * 运行：ELECTRON_RUN_AS_NODE=1 electron.exe _dev工具\build-win.js
 * 等价于 npm run electron:build（只是本机没有 node/npm，借用自带 Electron 当 Node）。
 */
const path = require('path')
const { build, Platform } = require('electron-builder')

const root = path.join(__dirname, '..')
build({
  projectDir: root,
  config: path.join(root, 'electron-builder.yml'),
  targets: Platform.WINDOWS.createTarget(['nsis', 'portable']),
  publish: 'never'
})
  .then((res) => {
    console.log('BUILD OK')
    for (const f of res || []) console.log('  ' + f)
  })
  .catch((e) => {
    console.error('BUILD FAIL:', e && e.message ? e.message : e)
    console.error(e && e.stack ? e.stack : e)
    process.exit(1)
  })
