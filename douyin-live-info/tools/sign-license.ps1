# 授权签发（交互式）—— 众艺传媒 直播运营中控台
#
# 双击 tools\一键签发授权.bat 即可，不用手敲命令。
#
# 注意：这个文件必须以「UTF-8 带 BOM」保存。Windows PowerShell 5.1 读没有 BOM 的
# .ps1 会按 ANSI 解，里面的中文会变乱码甚至让脚本跑不起来。
# 改完内容后双击 tools\修复编码.bat 重新转一次编码即可。

$ErrorActionPreference = 'Stop'
try { $Host.UI.RawUI.WindowTitle = '给运营签授权' } catch { }
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Pause-Exit($code) {
  Write-Host ''
  Read-Host '按回车关闭' | Out-Null
  exit $code
}

Write-Host '=========================================================='
Write-Host '   授权签发  —  众艺传媒 直播运营中控台'
Write-Host '=========================================================='
Write-Host ''

# ---- 1) 找 node ----
$node = $null
$cands = @(
  (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'),
  'D:\APP\手机对接\.tools\node-v22.23.3-win-x64\node.exe'
)
foreach ($c in $cands) { if ($c -and (Test-Path -LiteralPath $c)) { $node = $c; break } }
if (-not $node) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { $node = $cmd.Source }
}
if (-not $node) {
  Write-Host '  [X] 没找到 Node.js，签不了。' -ForegroundColor Red
  Write-Host '      把 node.exe 的完整路径告诉我，我改一下这个脚本。'
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

Write-Host '  运营打开软件后，激活页上会显示一串机器码，长这样：'
Write-Host '     0DD8-FD0F-CC3E-8587-795F'
Write-Host '  让他把那串复制发给你，你在这里粘一下就行，一共只问三件事。'
Write-Host ''

$mc = (Read-Host '   1) 粘贴机器码').Trim()
if (-not $mc) { Write-Host '   机器码不能空。' -ForegroundColor Red; Pause-Exit 1 }

$who = (Read-Host '   2) 这个运营叫什么').Trim()
if (-not $who) { Write-Host '   名字不能空。' -ForegroundColor Red; Pause-Exit 1 }

$due = (Read-Host '   3) 到期日期 如 2027-12-31（直接回车 = 一年后）').Trim()

Write-Host ''
Write-Host '   --------------------------------------------------------'

$signArgs = @($signer, '--机器码', $mc, '--运营', $who)
if ($due) { $signArgs += @('--到期', $due) }

& $node @signArgs

if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host '   [X] 签发失败，把上面的红字发给我。' -ForegroundColor Red
  Pause-Exit 1
}

Write-Host ''
Write-Host '   --------------------------------------------------------'
Write-Host '   已经签好了。json 文件就在项目根目录，名字以「授权_」开头。'
Write-Host ''
Write-Host '   怎么发给运营（推荐第 1 种）：'
Write-Host '     1. 用记事本打开那个 json，全选复制，把内容当文字发过去，'
Write-Host '        让运营粘贴到激活页点「激活」。不会传丢，最省事。'
Write-Host '     2. 直接把 json 文件发过去，让他点激活页的「选择授权文件」。'
Write-Host ''
Write-Host '   提醒：私钥 tools\授权密钥\私钥.pem 只在你这里，别外传。'
Write-Host ''
Write-Host '   顺便说一下：签出来的这些 json 文件发完之后都可以删，'
Write-Host '   但项目里的「授权.json」（没有下划线和名字的那个）是你自己这台机器的，别删。'

$hit = Get-ChildItem -LiteralPath $Root -Filter '授权_*.json' -ErrorAction SilentlyContinue |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($hit) {
  Write-Host ''
  Write-Host '   刚签出来的文件在这里：' -NoNewline
  Write-Host $hit.FullName -ForegroundColor Yellow
}
Pause-Exit 0
