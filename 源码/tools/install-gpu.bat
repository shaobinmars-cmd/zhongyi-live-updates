@echo off
rem ---------------------------------------------------------------------------
rem  Install CUDA libraries into a persistent user folder (one-time, ~1 GB).
rem  After this, choose "GPU" as the transcription device in the app.
rem  ASCII-only on purpose: cmd.exe reads .bat with the OEM code page.
rem ---------------------------------------------------------------------------
setlocal
set "APP=%LOCALAPPDATA%\Programs\douyin-live-info"
if not exist "%APP%\resources\engine\python-embed\python.exe" set "APP=C:\Users\Administrator\AppData\Local\Programs\douyin-live-info"
set "PY=%APP%\resources\engine\python-embed\python.exe"
set "GPU_RUNTIME=%LOCALAPPDATA%\douyin-live-info\gpu-runtime"

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
echo   GPU dir: %GPU_RUNTIME%
echo   Size   : about 1 GB download
echo   Note   : only needed on computers that have an NVIDIA card
echo.
echo   Installing, please wait...
echo.

set "DOUYIN_GPU_RUNTIME_DIR=%GPU_RUNTIME%"
"%PY%" "%APP%\resources\engine\scripts\prefetch_gpu.py"

if errorlevel 1 (
  echo.
  echo   [X] Install failed. Check the network and run this again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Verifying...
"%PY%" "%APP%\resources\engine\scripts\prefetch_gpu.py" --check

echo.
echo   Done.
echo   Now open the app - teardown page - set the device to GPU - run one job.
echo   The log should say: GPU test passed / now transcribing on the GPU.
echo.
pause
