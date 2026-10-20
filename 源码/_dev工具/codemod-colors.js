/**
 * 一次性色值收敛 codemod：把 src 下 .vue 文件里（除 <script> 块外）的硬编码 hex
 * 统一替换为 App.vue 的全局设计 token（var(--xxx)）。
 * 规则：跳过 App.vue（:root 定义所在，手改）；跳过 <script> 块（图表/数据色需要真实色值）。
 * 跑法：ELECTRON_RUN_AS_NODE=1 electron _dev工具/codemod-colors.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'src')

// 旧色值 → token。6 位在前，3 位在后；\b 保证 #fff 不会误伤 #fff7ed。
const MAP = [
  // —— 旧灰阶 → 冷墨四级 ——
  ['#1f2328', 'var(--ink)'],
  ['#374151', 'var(--ink-2)'],
  ['#334155', 'var(--ink-2)'],
  ['#6b7280', 'var(--ink-3)'],
  ['#64748b', 'var(--ink-3)'],
  ['#9aa1ab', 'var(--ink-4)'],
  ['#94a3b8', 'var(--ink-4)'],
  ['#c0c2c8', 'var(--line-2)'],
  // —— 旧灰线/灰面 → 冰蓝白 ——
  ['#e6e8ec', 'var(--line)'],
  ['#e2e8f0', 'var(--line)'],
  ['#d8dbe0', 'var(--line-2)'],
  ['#cbd5e1', 'var(--line-2)'],
  ['#f4f5f7', 'var(--surface-2)'],
  ['#f1f5f9', 'var(--surface-2)'],
  ['#f8fafc', 'var(--surface-2)'],
  ['#f8fbfd', 'var(--surface-2)'],
  ['#fbfdff', 'var(--surface-2)'],
  ['#ffffff', 'var(--surface)'],
  // —— 旧橙主色 → 深青蓝主色（旧橙不再做功能色） ——
  ['#f97316', 'var(--pulse-accent)'],
  ['#fb923c', 'var(--pulse-accent)'],
  ['#e67e22', 'var(--brand)'],
  ['#c2410c', 'var(--brand)'],
  ['#ff6a1a', 'var(--brand)'],
  // —— 语义四色 ——
  ['#10b981', 'var(--ok)'],
  ['#34d399', 'var(--ok)'],
  ['#0f9d82', 'var(--ok)'],
  ['#0f766e', 'var(--ok)'],
  ['#15803d', 'var(--ok)'],
  ['#ef4444', 'var(--bad)'],
  ['#f87171', 'var(--bad)'],
  ['#be123c', 'var(--bad)'],
  ['#f59e0b', 'var(--warn)'],
  ['#fbbf24', 'var(--warn)'],
  ['#fcd34d', 'var(--warn)'],
  ['#f2b705', 'var(--warn)'],
  ['#eab308', 'var(--warn)'],
  // —— 杂色蓝/青/紫 → 冷色主调 ——
  ['#3b82f6', 'var(--pulse-accent)'],
  ['#5b7cfa', 'var(--pulse-accent)'],
  ['#2563eb', 'var(--pulse-accent)'],
  ['#4f46e5', 'var(--pulse-accent)'],
  ['#0891b2', 'var(--pulse-accent)'],
  ['#06b6d4', 'var(--pulse-cyan)'],
  ['#22d3ee', 'var(--pulse-cyan)'],
  ['#67e8f9', 'var(--pulse-cyan)'],
  ['#0e9fb5', 'var(--pulse-cyan)'],
  ['#a855f7', 'var(--pulse-violet)'],
  ['#7c3aed', 'var(--pulse-violet)'],
  ['#ec4899', 'var(--brand-2)'],
  // —— 旧浅底 → 软色 ——
  ['#dbeafe', 'var(--pulse-soft)'],
  ['#edf8fd', 'var(--pulse-soft)'],
  ['#ecfdf5', 'var(--ok-soft)'],
  ['#fff7ed', 'var(--brand-soft)'],
  ['#fecaca', 'var(--bad-soft)'],
  ['#fef3c7', 'var(--warn-soft)'],
  // ——  canonical 色值也收敛成变量（App.vue 之外） ——
  ['#0b76be', 'var(--pulse-accent)'],
  ['#0a5fa8', 'var(--pulse-deep)'],
  ['#1e8fe0', 'var(--pulse-blue)'],
  ['#00c2d1', 'var(--pulse-cyan)'],
  ['#2bd8c0', 'var(--pulse-mint)'],
  ['#00b8d4', 'var(--signal)'],
  ['#0fa97a', 'var(--ok)'],
  ['#f5a524', 'var(--warn)'],
  ['#ef4e4e', 'var(--bad)'],
  ['#e2ebf4', 'var(--line)'],
  ['#cfddea', 'var(--line-2)'],
  ['#f7fbff', 'var(--surface-2)'],
  ['#56748a', 'var(--ink-3)'],
  ['#2c4658', 'var(--ink-2)'],
  ['#0c1f2e', 'var(--ink)'],
  ['#647f92', 'var(--ink-4)'],
  // —— 3 位最后 ——
  ['#fff', 'var(--surface)'],
  // —— 品牌渐变特殊值 ——
  ['#ffa63d', 'var(--brand)'],
  ['#ff2d6f', 'var(--brand-2)'],
  ['#ff4d6e', 'var(--brand-2)'],
  ['#0a4f8f', 'var(--pulse-deep)'],
  ['#0e7dc0', 'var(--pulse-accent)'],
  ['#12a6d6', 'var(--pulse-blue)']
].map(([hex, tok]) => [new RegExp(hex.replace('#', '#') + '\\b', 'gi'), tok])

// ---------------------------------------------------------------- HSL 兜底
// 精确表没覆盖的色值，按色相/明度/饱和度归入最近的 token 家族。
function hexToHsl(hex) {
  let h = hex.slice(1)
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let hh = 0
  if (d > 0) {
    if (max === r) hh = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) hh = ((b - r) / d + 2) * 60
    else hh = ((r - g) / d + 4) * 60
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  return [hh, s, l]
}

function classify(hex) {
  const [h, s, l] = hexToHsl(hex)
  // 近灰：只看明度
  if (s < 0.14) {
    if (l >= 0.96) return 'var(--surface)'
    if (l >= 0.92) return 'var(--surface-2)'
    if (l >= 0.86) return 'var(--line)'
    if (l >= 0.72) return 'var(--line-2)'
    if (l >= 0.55) return 'var(--ink-4)'
    if (l >= 0.38) return 'var(--ink-3)'
    if (l >= 0.22) return 'var(--ink-2)'
    return 'var(--ink)'
  }
  // 浅底（软色标签/提示条底色）
  if (l >= 0.88) {
    if (h < 20 || h >= 340) return 'var(--bad-soft)'
    if (h < 45) return 'var(--brand-soft)'
    if (h < 70) return 'var(--warn-soft)'
    if (h >= 140 && h < 175) return 'var(--ok-soft)'
    return 'var(--pulse-soft)'
  }
  // 浅线/描边
  if (l >= 0.74) return 'var(--line-2)'
  // 深色文字/图标
  if (l <= 0.42) {
    if (h < 15 || h >= 340) return 'var(--bad)'
    if (h < 45) return 'var(--brand)'
    if (h < 70) return 'var(--warn)'
    if (h >= 140 && h < 175) return 'var(--ok)'
    return 'var(--pulse-deep)'
  }
  // 中间 vivid
  if (h < 15 || h >= 340) return 'var(--bad)'
  if (h < 40) return 'var(--brand)'
  if (h < 70) return 'var(--warn)'
  if (h >= 140 && h < 175) return 'var(--ok)'
  if (h >= 175 && h < 200) return 'var(--pulse-cyan)'
  if (h >= 260) return 'var(--pulse-violet)'
  return 'var(--pulse-accent)'
}

const ANY_HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.vue$/.test(f)) out.push(p)
  }
  return out
}

let changedFiles = 0
let totalHits = 0
for (const file of walk(ROOT)) {
  if (path.basename(file) === 'App.vue') continue
  const src = fs.readFileSync(file, 'utf8')
  // 拆出 <script> 块，只处理模板与样式段
  const segs = []
  let last = 0
  const re = /<script[\s\S]*?<\/script>/g
  let m
  while ((m = re.exec(src))) {
    segs.push({ skip: false, x: src.slice(last, m.index) })
    segs.push({ skip: true, x: m[0] })
    last = m.index + m[0].length
  }
  segs.push({ skip: false, x: src.slice(last) })

  let hits = 0
  for (const seg of segs) {
    if (seg.skip) continue
    for (const [re2, tok] of MAP) {
      seg.x = seg.x.replace(re2, () => {
        hits++
        return tok
      })
    }
    // 精确表过完，剩余色值走 HSL 兜底
    seg.x = seg.x.replace(ANY_HEX, (hex) => {
      hits++
      return classify(hex.toLowerCase())
    })
  }
  const out = segs.map((s) => s.x).join('')
  if (out !== src) {
    fs.writeFileSync(file, out)
    changedFiles++
    totalHits += hits
    console.log('updated', path.relative(ROOT, file), hits)
  }
}
console.log(`done: ${changedFiles} files, ${totalHits} replacements`)
