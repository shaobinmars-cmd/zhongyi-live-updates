@echo off
rem ---------------------------------------------------------------------------
rem  Round 2 -- find out WHICH dll crashes.
rem  ASCII-only on purpose (cmd.exe parses .bat with the OEM code page).
rem  Double-click it, wait ~1 min, then send check2-result.txt back.
rem ---------------------------------------------------------------------------
setlocal
set "OUT=%~dp0check2-result.txt"

rem  Auto-detect the engine (install folder name may be Chinese / user-chosen).
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
if not exist "%PY%" (
  echo [X] engine not found -- install the app first, or edit PY= in this file
  pause
  goto :done
)

echo ==== 0. WINDOWS ==== > "%OUT%"
ver >> "%OUT%" 2>&1
rem  PowerShell CIM instead of wmic (wmic is gone on Windows 11 24H2+).
powershell -NoProfile -Command "Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,OSArchitecture | Format-List" >> "%OUT%" 2>&1

echo ==== 1. OPENMP / CUDA DLLs SEEN FROM THE ENGINE ==== >> "%OUT%"
rem  engine folder is taken from the auto-detected PY (never hard-code it)
for %%P in ("%PY%") do set "ENGDIR=%%~dpP"
dir /b "%ENGDIR%Lib\site-packages\ctranslate2\*.dll" >> "%OUT%" 2>&1
echo -- system32 copies (if any) -- >> "%OUT%"
dir /b "%WINDIR%\System32\libiomp5md.dll" >> "%OUT%" 2>&1
dir /b "%WINDIR%\System32\vcomp140.dll" >> "%OUT%" 2>&1
dir /b "%WINDIR%\System32\cudnn*.dll" >> "%OUT%" 2>&1
dir /b "%WINDIR%\System32\nvcuda.dll" >> "%OUT%" 2>&1

echo ==== 2. LOAD tiny, cpu_threads=1 ==== >> "%OUT%"
"%PY%" -c "import faulthandler;faulthandler.enable();from faster_whisper import WhisperModel;m=WhisperModel('tiny',device='cpu',compute_type='int8',cpu_threads=1);print('LOADED OK threads1')" >> "%OUT%" 2>&1
echo ERRORLEVEL=%errorlevel% >> "%OUT%"

echo ==== 3. LOAD tiny, OMP disabled ==== >> "%OUT%"
set OMP_NUM_THREADS=1
set KMP_DUPLICATE_LIB_OK=TRUE
"%PY%" -c "import faulthandler;faulthandler.enable();from faster_whisper import WhisperModel;m=WhisperModel('tiny',device='cpu',compute_type='int8');print('LOADED OK omp1')" >> "%OUT%" 2>&1
echo ERRORLEVEL=%errorlevel% >> "%OUT%"
set KMP_DUPLICATE_LIB_OK=
set OMP_NUM_THREADS=

echo ==== 4. LOAD tiny from a LOCAL COPY (no symlinks) ==== >> "%OUT%"
set "LOCALDIR=%TEMP%\whisper-tiny-copy"
if exist "%LOCALDIR%" rmdir /s /q "%LOCALDIR%"
mkdir "%LOCALDIR%"
xcopy /y /q /k "%USERPROFILE%\.cache\huggingface\hub\models--Systran--faster-whisper-tiny\snapshots\*" "%LOCALDIR%\" >> "%OUT%" 2>&1
"%PY%" -c "import faulthandler;faulthandler.enable();from faster_whisper import WhisperModel;m=WhisperModel(r'%LOCALDIR%',device='cpu',compute_type='int8');print('LOADED OK localcopy')" >> "%OUT%" 2>&1
echo ERRORLEVEL=%errorlevel% >> "%OUT%"

echo ==== 5. WINDOWS CRASH RECORDS (faulting module) ==== >> "%OUT%"
powershell -NoProfile -Command "Get-WinEvent -FilterHashtable @{LogName='Application'; ProviderName='Application Error'} -MaxEvents 4 -ErrorAction SilentlyContinue | Format-List TimeCreated,Message" >> "%OUT%" 2>&1

:done
echo.
echo   Done. Send this file back:
echo   %OUT%
echo.
start notepad "%OUT%"
pause
