@echo off
rem ---------------------------------------------------------------------------
rem  Install CUDA libraries into the APP'S OWN Python (one-time, ~1 GB).
rem  After this, choose "GPU" as the transcription device in the app.
rem  ASCII-only on purpose: cmd.exe reads .bat with the OEM code page.
rem ---------------------------------------------------------------------------
setlocal
set "APP=%LOCALAPPDATA%\Programs\douyin-live-info"
if not exist "%APP%\resources\engine\python-embed\python.exe" set "APP=C:\Users\Administrator\AppData\Local\Programs\douyin-live-info"
set "PY=%APP%\resources\engine\python-embed\python.exe"

if not exist "%PY%" (
  echo.
  echo   [X] Cannot find the app's Python.
  echo       Install DouyinLiveInfo first, then run this file again.
  echo.
  pause
  exit /b 1
)

echo ============================================================
echo   DouyinLiveInfo - install GPU acceleration
echo ============================================================
echo.
echo   Target : %PY%
echo   Size   : about 1 GB download
echo   Note   : only needed on computers that have an NVIDIA card
echo.
echo   Installing, please wait...
echo.

"%PY%" -m pip install --no-warn-script-location ^
  -i https://pypi.tuna.tsinghua.edu.cn/simple ^
  nvidia-cuda-runtime-cu12 nvidia-cublas-cu12 nvidia-cudnn-cu12

if errorlevel 1 (
  echo.
  echo   [X] Install failed. Check the network and run this again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Verifying...
"%PY%" -c "import os,glob,sys;sp=[p for p in sys.path if p.endswith('site-packages')];hits=[f for p in sp for f in glob.glob(os.path.join(p,'nvidia','*','bin','*')) if 'cublas' in f.lower() or 'cudnn' in f.lower()];print('   found', len(hits), 'CUDA dll(s)');[print('     ', os.path.basename(h)) for h in hits[:8]]"

echo.
echo   Done.
echo   Now open the app - teardown page - set the device to GPU - run one job.
echo   The log should say: GPU test passed / now transcribing on the GPU.
echo.
pause
