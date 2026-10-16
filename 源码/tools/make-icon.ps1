# Generate the app icon (512x512 PNG) for electron-builder.
#
#   powershell -ExecutionPolicy Bypass -File tools\make-icon.ps1
#
# Output: build\icon.png  (electron-builder turns it into .ico automatically)
#
# NOTE: this script is intentionally ASCII-only. Windows PowerShell 5.1 reads
# .ps1 files as ANSI unless they have a UTF-8 BOM, which would corrupt any
# non-ASCII literal. The brand glyph is therefore built from its code point.
#   0x4F17 = U+4F17 (the "zhong" character in the company name)

Add-Type -AssemblyName System.Drawing

$Root   = Split-Path -Parent $PSScriptRoot
$OutDir = Join-Path $Root 'build'
$Out    = Join-Path $OutDir 'icon.png'
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

$SIZE   = 512
$RADIUS = 116

# Brand colors, matching the app UI accent gradient
$C1 = [System.Drawing.Color]::FromArgb(255, 249, 115, 22)   # #f97316
$C2 = [System.Drawing.Color]::FromArgb(255, 225, 29, 72)    # #e11d48

$bmp = New-Object System.Drawing.Bitmap $SIZE, $SIZE
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.Clear([System.Drawing.Color]::Transparent)

function New-RoundedPath([int]$x, [int]$y, [int]$w, [int]$h, [int]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# 1) gradient base
$path  = New-RoundedPath 0 0 $SIZE $SIZE $RADIUS
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point 0, 0),
  (New-Object System.Drawing.Point $SIZE, $SIZE),
  $C1, $C2)
$g.FillPath($brush, $path)
$brush.Dispose()

# 2) soft top highlight so the block does not look flat
$hlTop = [int]($SIZE * 0.62)
$hl = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point 0, 0),
  (New-Object System.Drawing.Point 0, $hlTop),
  [System.Drawing.Color]::FromArgb(46, 255, 255, 255),
  [System.Drawing.Color]::FromArgb(0, 255, 255, 255))
$hlPath = New-RoundedPath 0 0 $SIZE $hlTop $RADIUS
$g.FillPath($hl, $hlPath)
$hl.Dispose(); $hlPath.Dispose()

# 3) white brand glyph
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment     = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center

$font = $null
foreach ($name in @('Microsoft YaHei UI', 'Microsoft YaHei', 'SimHei', 'Segoe UI')) {
  try {
    $try = New-Object System.Drawing.Font($name, 268, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    if ($try.Name -eq $name) { $font = $try; break }
    $try.Dispose()
  } catch { }
}
if (-not $font) {
  $font = New-Object System.Drawing.Font('Arial', 268, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
}

$glyph = [string][char]0x4F17
$rect  = New-Object System.Drawing.RectangleF 0, 10, $SIZE, $SIZE
$g.DrawString($glyph, $font, [System.Drawing.Brushes]::White, $rect, $sf)

$font.Dispose(); $sf.Dispose(); $g.Dispose()
$path.Dispose()

$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Host ("icon written: {0}  ({1} KB)" -f $Out, [math]::Round((Get-Item $Out).Length / 1KB))
