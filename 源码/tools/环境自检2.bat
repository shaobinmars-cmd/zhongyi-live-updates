@echo off
rem ---------------------------------------------------------------------------
rem  Round 2 -- find out WHICH dll crashes.
rem  ASCII-only on purpose (cmd.exe parses .bat with the OEM code page).
rem  Double-click it, wait ~1 min, then send check2-result.txt back.
rem ---------------------------------------------------------------------------
setlocal
set "OUT=%~dp0check2-result.txt"

set "PY=%LOCALAPPDATA%\Programs\DouyinLiveInfo\resources\engine\python-embed\python.exe"
if not exist "%PY%" set "PY=C:\Users\Administrator\AppData\Local\Programs\DouyinLiveInfo\resources\engine\python-embed\python.exe"
if not exist "%PY%" (
  echo [X] engine not found, edit PY= in this file
  pause
  goto :done
)

echo ==== 0. WINDOWS ==== > "%OUT%"
ver >> "%OUT%" 2>&1
wmic OS get Caption,Version,OSArchitecture >> "%OUT%" 2>&1

echo ==== 1. OPENMP / CUDA DLLs SEEN FROM THE ENGINE ==== >> "%OUT%"
dir /b "%LOCALAPPDATA%\Programs\DouyinLiveInfo\resources\engine\python-embed\Lib\site-packages\ctranslate2\*.dll" >> "%OUT%" 2>&1
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
