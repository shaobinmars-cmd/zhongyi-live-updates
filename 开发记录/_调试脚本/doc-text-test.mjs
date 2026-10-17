// 测试 docx / rtf / doc 的文字提取
import { createRequire } from 'module'
const require = createRequire('H:/众艺直播运营工具/源码/package.json')
const { extractReportText } = require('H:/众艺直播运营工具/源码/dist-electron/services/doc-text.js')
for (const f of process.argv.slice(2)) {
  try {
    const r = extractReportText(f)
    console.log(f.split(/[\\/]/).pop() + ' → ' + r.format + '，' + r.text.length + ' 字 | ' + r.text.slice(0, 90).replace(/\n/g, ' '))
  } catch (e) {
    console.log(f.split(/[\\/]/).pop() + ' → 失败：' + e.message)
  }
}
