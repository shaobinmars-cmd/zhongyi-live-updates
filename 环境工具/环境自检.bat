@echo off
rem ---------------------------------------------------------------------------
rem  Operator-PC self check for DouyinLiveInfo (ASCII-only on purpose:
rem  cmd.exe reads .bat with the OEM code page and would mangle any non-ASCII).
rem  Double-click it. It writes check-result.txt next to itself, then opens it.
rem  Send that file back -- it contains everything needed to diagnose the
rem  "transcription dies with no error" problem.
rem ---------------------------------------------------------------------------
setlocal
set "OUT=%~dp0check-result.txt"

rem  Auto-detect the engine: the install folder name may be Chinese or
rem  user-chosen ("allowToChangeInstallationDirectory"), so never hard-code
rem  it -- just scan the usual roots for resources\engine\python-embed.
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

echo ==== 0. ENGINE PATH ==== > "%OUT%"
echo %PY% >> "%OUT%"
if not exist "%PY%" (
  echo.
  echo   [X] Cannot find the engine. Expected file:
  echo       resources\engine\python-embed\python.exe
  echo       Install the app first, or edit PY= in this .bat by hand.
  echo       Looked in: LOCALAPPDATA\Programs, Program Files, Program Files x86
  echo.
  pause
  goto :done
)

echo ==== 1. CPU ==== >> "%OUT%"
rem  PowerShell CIM instead of wmic: wmic is removed on Windows 11 24H2+,
rem  and its UTF-16 output made the result file hard to read.
powershell -NoProfile -Command "Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed | Format-List" >> "%OUT%" 2>&1

echo ==== 2. MEMORY ==== >> "%OUT%"
powershell -NoProfile -Command "$cs=Get-CimInstance Win32_ComputerSystem; $os=Get-CimInstance Win32_OperatingSystem; 'TotalPhysicalMemory(GB): ' + [math]::Round($cs.TotalPhysicalMemory/1GB,1); 'FreePhysicalMemory(GB): ' + [math]::Round($os.FreePhysicalMemory/1MB,1); 'TotalVisibleMemorySize(GB): ' + [math]::Round($os.TotalVisibleMemorySize/1MB,1)" >> "%OUT%" 2>&1

echo ==== 3. ANTIVIRUS ==== >> "%OUT%"
powershell -NoProfile -Command "$av=@(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue); if ($av.Count -eq 0) { 'SecurityCenter2: no antivirus registered' } else { $av | Select-Object displayName,productState | Format-List }" >> "%OUT%" 2>&1
rem  SecurityCenter2 is empty on some PCs -- also ask Defender directly.
powershell -NoProfile -Command "$d=Get-MpComputerStatus -ErrorAction SilentlyContinue; if ($d) { $d | Select-Object AntivirusEnabled,RealTimeProtectionEnabled,AMServiceEnabled,AntivirusSignatureLastUpdated | Format-List } else { 'Defender status: not available on this PC' }" >> "%OUT%" 2>&1

echo ==== 4. PYTHON ==== >> "%OUT%"
"%PY%" -c "import sys;print(sys.version)" >> "%OUT%" 2>&1
echo ERRORLEVEL=%errorlevel% >> "%OUT%"
"%PY%" -c "import ctranslate2;print('ctranslate2',ctranslate2.__version__);print('cuda_devices',ctranslate2.get_cuda_device_count());print('cpu_types',ctranslate2.get_supported_compute_types('cpu'))" >> "%OUT%" 2>&1
echo ERRORLEVEL=%errorlevel% >> "%OUT%"

echo ==== 5. LOAD small ON CPU ==== >> "%OUT%"
"%PY%" -c "import faulthandler;faulthandler.enable();from faster_whisper import WhisperModel;m=WhisperModel('small',device='cpu',compute_type='int8');print('LOADED OK cpu')" >> "%OUT%" 2>&1
echo ERRORLEVEL=%errorlevel% >> "%OUT%"

echo ==== 6. LOAD small AUTO ==== >> "%OUT%"
"%PY%" -c "import faulthandler;faulthandler.enable();from faster_whisper import WhisperModel;m=WhisperModel('small',device='auto',compute_type='int8');print('LOADED OK auto')" >> "%OUT%" 2>&1
echo ERRORLEVEL=%errorlevel% >> "%OUT%"

echo ==== 7. LOAD small FLOAT32 ==== >> "%OUT%"
"%PY%" -c "import faulthandler;faulthandler.enable();from faster_whisper import WhisperModel;m=WhisperModel('small',device='cpu',compute_type='float32');print('LOADED OK float32')" >> "%OUT%" 2>&1
echo ERRORLEVEL=%errorlevel% >> "%OUT%"

echo ==== 8. MODEL CACHE ==== >> "%OUT%"
dir /s "%USERPROFILE%\.cache\huggingface\hub\models--Systran--faster-whisper-small" >> "%OUT%" 2>&1

:done
echo.
echo   Done. The result file is:
echo   %OUT%
echo   Please send that file back.
echo.
start notepad "%OUT%"
pause
