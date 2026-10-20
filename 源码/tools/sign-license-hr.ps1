# 人事授权签发（交互式）—— 角色固定「人事」，签出来的人事页可见
#
# 双击 tools\一键签发人事授权.bat 即可，不用手敲命令。
# 本文件必须以「UTF-8 带 BOM」保存（PowerShell 5.1 按 ANSI 读无 BOM 会乱码）。
# 改完内容后双击 tools\修复编码.bat 重新转一次编码即可。

$ErrorActionPreference = 'Stop'
try { $Host.UI.RawUI.WindowTitle = '给人事签授权' } catch { }
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Pause-Exit($code) {
  Write-Host ''
  Read-Host '按回车关闭' | Out-Null
  exit $code
}

Write-Host '=========================================================='
Write-Host '   人事授权签发  —  签完人事页自动出现'
Write-Host '=========================================================='
Write-Host ''

# ---- 1) 找运行时：优先 node，没有就用项目自带 electron 顶 ----
$node = $null
$cands = @(
  (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
)
foreach ($c in $cands) { if ($c -and (Test-Path -LiteralPath $c)) { $node = $c; break } }
if (-not $node) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { $node = $cmd.Source }
}
$useElectron = $false
if (-not $node) {
  $elec = Join-Path $Root 'node_modules\electron\dist\electron.exe'
  if (Test-Path -LiteralPath $elec) { $node = $elec; $useElectron = $true }
}
if (-not $node) {
  Write-Host '  [X] 没找到 Node.js 也找不到项目 electron，签不了。' -ForegroundColor Red
  Pause-Exit 1
}

$signer = Join-Path $PSScriptRoot '签发授权.mjs'
$key    = Join-Path $PSScriptRoot '授权密钥\私钥.pem'
if (-not (Test-Path -LiteralPath $signer)) {
  Write-Host '  [X] 找不到 tools\签发授权.mjs' -ForegroundColor Red
  Pause-Exit 1
}
if (-not (Test-Path -LiteralPath $key)) {
  Write-Host '  [X] 找不到私钥 tools\授权密钥\私钥.pem，没法签发。' -ForegroundColor Red
  Pause-Exit 1
}

Write-Host '  人事打开软件后，激活页上会显示一串机器码，长这样：'
Write-Host '     0DD8-FD0F-CC3E-8587-795F'
Write-Host '  让她把那串复制发给你，你在这里粘一下就行。'
Write-Host '  （换电脑要重签；想签通用授权，机器码直接输入 * ）'
Write-Host ''

$mc = (Read-Host '   1) 粘贴人事电脑的机器码（或 * 签通用）').Trim()
if (-not $mc) { Write-Host '   机器码不能空。' -ForegroundColor Red; Pause-Exit 1 }

$due = (Read-Host '   2) 到期日期 如 2027-12-31（直接回车 = 一年后）').Trim()

Write-Host ''
Write-Host '   --------------------------------------------------------'

$signArgs = @($signer, '--机器码', $mc, '--运营', '人事', '--备注', '人事端授权')
if ($due) { $signArgs += @('--到期', $due) }

if ($useElectron) { $env:ELECTRON_RUN_AS_NODE = '1' }
$before = Get-Date
& $node @signArgs

# electron 顶 node 时退出码不可靠（签成了也可能非 0），以「项目根目录真的生成了
# 授权_人事*.json」为准，退出码只作辅助参考。
Start-Sleep -Milliseconds 500
$hit = Get-ChildItem -LiteralPath $Root -Filter '授权_人事*.json' -ErrorAction SilentlyContinue |
       Where-Object { $_.LastWriteTime -ge $before.AddSeconds(-5) } |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $hit) {
  Write-Host ''
  Write-Host '   [X] 签发失败，把上面的红字发给开发。' -ForegroundColor Red
  Pause-Exit 1
}

Write-Host ''
Write-Host '   --------------------------------------------------------'
Write-Host '   已经签好了。json 文件就在项目根目录，名字以「授权_人事」开头。'
Write-Host ''
Write-Host '   怎么发给人事（推荐第 1 种）：'
Write-Host '     1. 用记事本打开那个 json，全选复制，把内容当文字发过去，'
Write-Host '        让人事粘贴到激活页点「激活」。'
Write-Host '     2. 直接把 json 文件发过去，让她点激活页的「选择授权文件」。'
Write-Host ''
Write-Host '   激活后人事页会自动出现；运营授权看不到人事，不用管。'
Write-Host '   提醒：私钥 tools\授权密钥\私钥.pem 只在你这里，别外传。'

$hit = Get-ChildItem -LiteralPath $Root -Filter '授权_人事*.json' -ErrorAction SilentlyContinue |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($hit) {
  Write-Host ''
  Write-Host '   刚签出来的文件在这里：' -NoNewline
  Write-Host $hit.FullName -ForegroundColor Yellow
}
Pause-Exit 0
