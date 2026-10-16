@echo off
rem Re-save every .ps1 in this folder as UTF-8 WITH BOM.
rem Run this after editing any .ps1 by hand, otherwise PowerShell 5.1
rem reads it as ANSI and the Chinese text turns into garbage.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0' -Filter *.ps1 | ForEach-Object { $t = [IO.File]::ReadAllText($_.FullName, [Text.Encoding]::UTF8); [IO.File]::WriteAllText($_.FullName, $t, (New-Object Text.UTF8Encoding $true)); Write-Host ('fixed: ' + $_.Name) }"
pause
