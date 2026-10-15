// 签发授权（管理员工具，不要发给运营）
//
// 用法：
//   node tools/签发授权.mjs --机器码 066A-03BC-E0B0-AD9B-7827 --运营 张三
//   node tools/签发授权.mjs --机器码 066A-... --运营 李四 --到期 2027-06-30 --备注 "试用"
//   node tools/签发授权.mjs --机器码 "*" --运营 管理员      （通用授权，换机不用重签，只给自己用）
//
// 可选参数：--到期 YYYY-MM-DD（默认一年后）、--单位、--备注、--输出 文件名
//
// 生成「吊销名单」：
//   node tools/签发授权.mjs --吊销 066A-...,1122-... --输出 吊销名单.txt

import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const KEY_PATH = path.join(HERE, '授权密钥', '私钥.pem')
const PAYLOAD_KEYS = ['v', '机器码', '运营', '单位', '签发', '到期', '备注']

function parseArgs(argv) {
  const out = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) { out[key] = next; i++ }
    else out[key] = true
  }
  return out
}

function todayStr() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function plusYear() {
  const d = new Date()
  d.setFullYear(d.getFullYear() + 1)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function canonical(obj) {
  const o = {}
  for (const k of PAYLOAD_KEYS) o[k] = obj?.[k] ?? ''
  return JSON.stringify(o)
}

const args = parseArgs(process.argv)

// ---- 生成吊销名单 ----
if (args['吊销']) {
  const codes = String(args['吊销']).split(/[,\s]+/).filter(Boolean)
  const file = String(args['输出'] || '吊销名单.txt')
  const body = [
    '# 每行一个机器码，命中就停用。可以用共享盘路径或网址让程序启动时读取。',
    `# 更新日期：${todayStr()}`,
    ...codes
  ].join('\n') + '\n'
  fs.writeFileSync(file, body, 'utf-8')
  console.log(`已生成吊销名单：${path.resolve(file)}（${codes.length} 个机器码）`)
  process.exit(0)
}

// ---- 签发授权 ----
const code = args['机器码']
const who = args['运营']
if (!code || !who) {
  console.error('必须给 --机器码 和 --运营。例如：')
  console.error('  node tools/签发授权.mjs --机器码 066A-03BC-E0B0-AD9B-7827 --运营 张三')
  process.exit(2)
}

if (!fs.existsSync(KEY_PATH)) {
  console.error(`找不到私钥：${KEY_PATH}`)
  console.error('私钥只应该留在管理员机器上，绝不外传。')
  process.exit(2)
}

const privateKey = fs.readFileSync(KEY_PATH, 'utf-8')
const due = String(args['到期'] || plusYear())
if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) {
  console.error(`--到期 格式应该是 2027-12-31，现在是 ${due}`)
  process.exit(2)
}

const payload = {
  v: 1,
  机器码: String(code).trim().toUpperCase(),
  运营: String(who),
  单位: String(args['单位'] || '太原烁金迪电子科技有限公司'),
  签发: todayStr(),
  到期: due,
  备注: String(args['备注'] || '')
}

const sig = crypto.sign(null, Buffer.from(canonical(payload), 'utf-8'), privateKey).toString('base64')
const license = { ...payload, 签名: sig }

const outFile = String(args['输出'] || `授权_${payload.运营}_${payload.机器码}.json`)
fs.writeFileSync(outFile, JSON.stringify(license, null, 1), 'utf-8')
console.log('已签发：' + path.resolve(outFile))
console.log(`  运营：${payload.运营}　单位：${payload.单位}`)
console.log(`  机器码：${payload.机器码}　到期：${payload.到期}`)
console.log('把这个 json 发给对方，让对方在激活页面粘贴内容或选择该文件即可。')
