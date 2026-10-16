@echo off
rem ---------------------------------------------------------------------------
rem  Dev-only test: prove the engine auto-detect loop used by the shipped
rem  helper .bat files really finds an install whose folder name is Chinese,
rem  and does not trip over folders that are not the app.
rem
rem  ASCII-only on purpose: cmd.exe parses .bat with the OEM code page, and a
rem  non-ASCII byte can end a "rem" line early / break a parenthesised block.
rem  The Chinese folder name here comes from the filesystem, never a literal.
rem
rem  usage: test-engine-detect.bat            (negative run, real machine)
rem         set LOCALAPPDATA=<fake root> then run again   (positive run)
rem ---------------------------------------------------------------------------
setlocal

set "R1=%LOCALAPPDATA%\Programs"
set "R2=%ProgramFiles%"
set "R3=%ProgramFiles(x86)%"
set "PY="
for %%R in ("%R1%" "%R2%" "%R3%") do (
  for /d %%D in ("%%~R\*") do (
    if not defined PY if exist "%%~D\resources\engine\python-embed\python.exe" set "PY=%%~D\resources\engine\python-embed\python.exe"
  )
)
if not defined PY set "PY=%LOCALAPPDATA%\Programs\douyin-live-info\resources\engine\python-embed\python.exe"

echo SCANNED=[%R1%] [%R2%] [%R3%]
echo FOUND=[%PY%]
if exist "%PY%" (
  echo RESULT=ENGINE_FOUND
  exit /b 0
) else (
  echo RESULT=ENGINE_NOT_FOUND
  exit /b 2
)
