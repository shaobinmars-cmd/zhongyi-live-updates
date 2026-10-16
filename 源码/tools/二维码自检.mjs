// 二维码自检：解码 public 下的二维码图片，确认运营手机真的能扫。
// 依赖 jsqr + pngjs（装在临时目录，用 NODE_PATH 指过来）：
//   npm i --prefix %TEMP%\qrdec jsqr pngjs
//   set NODE_PATH=%TEMP%\qrdec\node_modules && node tools\二维码自检.mjs
//
// 可选：加 --render 参数，会把图片缩放到页面上的显示尺寸再解一次，
// 用来判断「原图能解、缩小后解不出」这种降采样问题。

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(HERE, '..', 'public')
const require = createRequire(import.meta.url)

let jsQR, PNG
try {
  jsQR = require('jsqr')
  PNG = require('pngjs').PNG
} catch (ex) {
  console.error('缺依赖：先跑  npm i --prefix %TEMP%\\qrdec jsqr pngjs')
  console.error(String(ex.message))
  process.exit(2)
}

const SCALE_TEST = process.argv.includes('--render')

/** 最近邻缩放：模拟浏览器把图缩到页面上那个尺寸时的样子 */
function nearestScale(img, size) {
  const out = { width: size, height: size, data: Buffer.alloc(size * size * 4) }
  for (let y = 0; y < size; y++) {
    const sy = Math.min(img.height - 1, Math.floor((y * img.height) / size))
    for (let x = 0; x < size; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x * img.width) / size))
      const si = (sy * img.width + sx) * 4
      const di = (y * size + x) * 4
      out.data[di] = img.data[si]
      out.data[di + 1] = img.data[si + 1]
      out.data[di + 2] = img.data[si + 2]
      out.data[di + 3] = img.data[si + 3]
    }
  }
  return out
}

function decode(img, label) {
  const r = jsQR(new Uint8ClampedArray(img.data), img.width, img.height)
  if (r) {
    console.log(`  ${label}: 能解 ✓  →  ${r.data.slice(0, 80)}`)
    return true
  }
  console.log(`  ${label}: 解不出来 ✗`)
  return false
}

for (const name of ['qq.png', 'wechat.png', 'douyin.png']) {
  const p = path.join(PUBLIC, name)
  if (!fs.existsSync(p)) { console.log(`${name}: 文件不存在`); continue }
  console.log(`${name}（${(fs.statSync(p).size / 1024).toFixed(0)} KB）`)
  const img = PNG.sync.read(fs.readFileSync(p))
  console.log(`  尺寸 ${img.width}x${img.height}`)
  decode(img, '原图')
  if (SCALE_TEST) {
    for (const size of [200, 240, 320, 420]) {
      decode(nearestScale(img, size), `缩到 ${size}px`)
    }
  }
}
