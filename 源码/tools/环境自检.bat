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

set "PY=%LOCALAPPDATA%\Programs\DouyinLiveInfo\resources\engine\python-embed\python.exe"
if not exist "%PY%" set "PY=C:\Users\Administrator\AppData\Local\Programs\DouyinLiveInfo\resources\engine\python-embed\python.exe"

echo ==== 0. ENGINE PATH ==== > "%OUT%"
echo %PY% >> "%OUT%"
if not exist "%PY%" (
  echo.
  echo   [X] Cannot find the DouyinLiveInfo engine.
  echo       Install DouyinLiveInfo first, or edit PY= in this .bat.
  echo.
  pause
  goto :done
)

echo ==== 1. CPU ==== >> "%OUT%"
wmic cpu get name >> "%OUT%" 2>&1
wmic cpu get MaxClockSpeed,NumberOfCores,NumberOfLogicalProcessors >> "%OUT%" 2>&1

echo ==== 2. MEMORY ==== >> "%OUT%"
wmic computersystem get TotalPhysicalMemory >> "%OUT%" 2>&1
wmic OS get FreePhysicalMemory,TotalVisibleMemorySize >> "%OUT%" 2>&1

echo ==== 3. ANTIVIRUS ==== >> "%OUT%"
wmic /namespace:\\root\SecurityCenter2 path AntiVirusProduct get displayName,productState >> "%OUT%" 2>&1

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
