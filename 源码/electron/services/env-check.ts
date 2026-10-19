// 环境自检：把「装到别的电脑就莫名其妙崩」的情况，变成一眼能看懂的检查项。
//
// 每一项都对应我们真实踩过的坑：
//   - 引擎缺失 / Python 起不来
//   - VC++ 运行库太老（MSVCP140.dll < 14.40）→ whisper 加载时静默崩溃
//   - 模型没下全 / 下了一半（旧版只按 >1MB 判断，残缺文件也当完整）
//   - 内存不够加载选中的模型 → 同样会静默崩溃
//   - 装了 N 卡驱动的机器上 whisper 误选 CUDA → 报 cublas64_12.dll 找不到

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import { engineStatus } from './teardown'

export interface CheckItem {
  key: string
  level: 'ok' | 'warn' | 'bad'
  title: string
  detail: string
  fix: string
}

export interface EnvReport {
  ok: boolean
  checkedAt: number
  items: CheckItem[]
}

/** 各模型的真实体积（MB）和跑起来大概要多少内存（GB） —— 体积是我实测的 */
export const MODEL_INFO: Record<string, { sizeMB: number; ramGB: number; zh: string; speed: string }> = {
  tiny: { sizeMB: 74, ramGB: 0.5, zh: '能用，错字较多', speed: '约 5 分钟/小时' },
  base: { sizeMB: 143, ramGB: 0.8, zh: '一般', speed: '约 8 分钟/小时' },
  small: { sizeMB: 462, ramGB: 1.8, zh: '够用', speed: '约 17 分钟/小时' },
  medium: { sizeMB: 1459, ramGB: 3.5, zh: '明显更准', speed: '约 60 分钟/小时' },
  'large-v3': { sizeMB: 2948, ramGB: 7.0, zh: '最好', speed: '约 150 分钟/小时' }
}

function gb(bytes: number): number {
  return bytes / 1024 ** 3
}

function runPS(script: string): Promise<string> {
  return new Promise((resolve) => {
    try {
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script],
        { windowsHide: true, timeout: 15000 },
        (_err, stdout) => resolve(String(stdout || '').trim()))
    } catch {
      resolve('')
    }
  })
}

function parseVersion(v: string): number[] {
  return String(v || '').split('.').map((x) => parseInt(x, 10) || 0)
}

/** 比较 a 是否 >= b（按点分数字逐段比） */
function versionGE(a: string, b: string): boolean {
  const x = parseVersion(a)
  const y = parseVersion(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const xa = x[i] || 0
    const yb = y[i] || 0
    if (xa !== yb) return xa > yb
  }
  return true
}

/** 模型缓存里最大的那个文件有多大（MB）；blobs 里放的是真身，snapshots 是软链 */
function modelBlobMB(model: string): number {
  const dir = path.join(os.homedir(), '.cache', 'huggingface', 'hub',
    `models--Systran--faster-whisper-${model}`, 'blobs')
  let max = 0
  try {
    for (const f of fs.readdirSync(dir)) {
      try {
        const s = fs.statSync(path.join(dir, f)).size
        if (s > max) max = s
      } catch { /* ignore */ }
    }
  } catch { /* 目录不存在 */ }
  return max / 1024 ** 2
}

function cudaRuntimeDlls(): string[] {
  const roots: string[] = []
  const local = String(process.env.LOCALAPPDATA || '')
  const roaming = String(process.env.APPDATA || '')
  if (local) roots.push(path.join(local, 'douyin-live-info', 'gpu-runtime', 'nvidia'))
  if (roaming) roots.push(path.join(roaming, 'douyin-live-info', 'gpu-runtime', 'nvidia'))
  const eng = engineStatus()
  if (eng.root) roots.push(path.join(eng.root, 'python-embed', 'Lib', 'site-packages', 'nvidia'))
  const out: string[] = []
  for (const root of roots) {
    try {
      for (const name of fs.readdirSync(root)) {
        const bin = path.join(root, name, 'bin')
        if (!fs.existsSync(bin)) continue
        for (const f of fs.readdirSync(bin)) {
          const low = f.toLowerCase()
          if (low.endsWith('.dll') && (low.includes('cublas') || low.includes('cudnn'))) out.push(path.join(bin, f))
        }
      }
    } catch { /* ignore */ }
  }
  return Array.from(new Set(out))
}

export async function runEnvCheck(model = 'small'): Promise<EnvReport> {
  const items: CheckItem[] = []

  // ---- 1) 引擎 ----
  const eng = engineStatus()
  items.push(eng.ok
    ? { key: 'engine', level: 'ok', title: '拆解引擎', detail: `就绪（${eng.root}）`, fix: '' }
    : {
        key: 'engine', level: 'bad', title: '拆解引擎',
        detail: `不完整：${eng.root || '未找到引擎目录'}`,
        fix: '软件安装不完整。请重新运行安装包，或把工具目录整个解压一次（不要只拖出单个文件）。'
      })

  // ---- 2) VC++ 运行库 ----
  // whisper 的推理内核需要 MSVCP140.dll >= 14.40，否则加载模型时进程直接崩、还不报错。
  const ps = [
    "$f=(Get-Item ($env:SystemRoot+'\\System32\\msvcp140.dll') -ErrorAction SilentlyContinue).VersionInfo.FileVersion",
    "$r=(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*Visual C++ 2015-2022*Redistributable (x64)*' } | Select-Object -First 1).DisplayVersion",
    "'FILE='+$f; 'REDIST='+$r"
  ].join('; ')
  const out = await runPS(ps)
  const fileV = (/FILE=([\d.]+)/.exec(out) || [, ''])[1]
  const redistV = (/REDIST=([\d.]+)/.exec(out) || [, ''])[1]
  const okVc = versionGE(fileV, '14.40')
  items.push(okVc
    ? { key: 'vc', level: 'ok', title: 'C++ 运行库', detail: `MSVCP140.dll ${fileV}`, fix: '' }
    : {
        key: 'vc', level: 'bad', title: 'C++ 运行库太旧',
        detail: `当前 MSVCP140.dll 是 ${fileV || '探测失败'}${redistV ? `（运行库版本 ${redistV}）` : ''}，转写需要 14.40 或更高`,
        fix: '不装的话，转写会毫无提示地直接失败。处理：退出软件 → 双击安装包同目录里的 vc_redist.x64.exe（或软件安装目录 resources\\vc_redist.x64.exe）→ 装完重启电脑。'
      })

  // ---- 3) 模型 ----
  const info = MODEL_INFO[model]
  const gotMB = modelBlobMB(model)
  if (!info) {
    items.push({ key: 'model', level: 'warn', title: `模型 ${model}`, detail: '未知模型', fix: '在设置里换一个模型。' })
  } else if (gotMB <= 0) {
    items.push({
      key: 'model', level: 'warn', title: `模型 ${model} 还没下载`,
      detail: `第一次拆解会自动下载（约 ${info.sizeMB} MB），需要联网`,
      fix: '确认这台电脑能上网；公司网络如果下不动，可以把别的电脑上下好的模型缓存目录整个拷过来。'
    })
  } else if (gotMB < info.sizeMB * 0.9) {
    items.push({
      key: 'model', level: 'bad', title: `模型 ${model} 下载不完整`,
      detail: `应该有约 ${info.sizeMB} MB，实际只有 ${gotMB.toFixed(0)} MB`,
      fix: '把模型缓存目录里这个模型删掉重下一次：打开 %USERPROFILE%\\.cache\\huggingface\\hub，删掉 models--Systran--faster-whisper-' + model + '，然后重新拆解。'
    })
  } else {
    items.push({ key: 'model', level: 'ok', title: `模型 ${model}`, detail: `已就绪（约 ${gotMB.toFixed(0)} MB），中文准确度：${info.zh}`, fix: '' })
  }

  // ---- 4) 内存 ----
  const freeGB = gb(os.freemem())
  const totalGB = gb(os.totalmem())
  const need = info ? info.ramGB : 2
  if (freeGB >= need) {
    items.push({ key: 'ram', level: 'ok', title: '内存', detail: `空闲 ${freeGB.toFixed(1)}G / 共 ${totalGB.toFixed(1)}G`, fix: '' })
  } else {
    items.push({
      key: 'ram', level: freeGB >= need * 0.7 ? 'warn' : 'bad',
      title: '内存偏紧',
      detail: `跑 ${model} 大约需要 ${need}G，现在只剩 ${freeGB.toFixed(1)}G（共 ${totalGB.toFixed(1)}G）`,
      fix: '关掉浏览器、直播伴侣回放窗口等再用；或者把转写模型换成更小的（tiny / base）。内存不够时 whisper 会直接崩掉、不给报错。'
    })
  }

  // ---- 5) 显卡（只提示，不影响） ----
  const gpu = await runPS("(Get-CimInstance Win32_VideoController | Select-Object -First 1).Name")
  if (gpu && /nvidia|geforce|rtx|gtx/i.test(gpu)) {
    items.push({
      key: 'gpu', level: 'ok', title: '显卡', detail: `${gpu} —— 支持 GPU 加速`,
      fix: ''
    })
    const dlls = cudaRuntimeDlls()
    const names = dlls.map((x) => path.basename(x).toLowerCase()).join(' ')
    const ready = names.includes('cublas64') && names.includes('cudnn')
    items.push(ready
      ? { key: 'cuda', level: 'ok', title: 'GPU 运行库', detail: `已就绪（${dlls.length} 个 CUDA 库，保存在用户目录，升级软件不会丢）`, fix: '' }
      : { key: 'cuda', level: 'warn', title: 'GPU 运行库未安装', detail: '这台电脑有 NVIDIA 显卡，但还没装 cublas/cudnn；不装只能用 CPU 转写', fix: '打开「拆解 → 转写设置」，点「安装/校验 GPU 运行库」。GPU 库放在用户目录，以后升级软件不用重复安装。' })
  }

  return {
    ok: !items.some((i) => i.level === 'bad'),
    checkedAt: Date.now(),
    items
  }
}
