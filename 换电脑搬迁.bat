@echo off
chcp 65001 >nul
setlocal EnableExtensions
title 众艺传媒运营工具 - 项目搬迁备份与恢复

set "PROJECT=H:\众艺传媒运营工具"
set "RUNTIME=%APPDATA%\douyin-live-info"

echo ============================================================
echo   众艺传媒运营工具 - 项目备份与恢复
echo ============================================================
echo.
echo   1 = 备份到移动硬盘
echo   2 = 从移动硬盘恢复到本机
echo.
set /p MODE=请输入 1 或 2，然后回车：

if "%MODE%"=="1" goto BACKUP
if "%MODE%"=="2" goto RESTORE
echo.
echo   只能输入 1 或 2。
pause
exit /b 1

:BACKUP
echo.
set /p DEST=请输入移动硬盘盘符，例如 E:\，然后回车：
if not exist "%DEST%\" (
  echo.
  echo   [X] 找不到 %DEST%，请检查盘符。
  pause
  exit /b 1
)

set "ROOT=%DEST%众艺传媒运营工具_备份"
echo.
echo   将备份到：%ROOT%
echo   注意：备份中包含授权、配置和 Codex 数据，移动硬盘必须妥善保管。
echo.

call :COPY "项目总目录" "%PROJECT%" "%ROOT%\项目"
call :COPY "App 运行数据" "%RUNTIME%" "%ROOT%\运行数据\douyin-live-info"
if exist "%USERPROFILE%\.codex" call :COPY "Codex 数据" "%USERPROFILE%\.codex" "%ROOT%\用户数据\.codex"
if exist "%USERPROFILE%\.cc-switch" call :COPY "Codex 接口配置" "%USERPROFILE%\.cc-switch" "%ROOT%\用户数据\.cc-switch"
if exist "%USERPROFILE%\.agents" call :COPY "Agents 数据" "%USERPROFILE%\.agents" "%ROOT%\用户数据\.agents"

echo.
echo   备份完成：%ROOT%
pause
exit /b 0

:RESTORE
echo.
set /p SRC=请输入备份盘符，例如 E:\，然后回车：
set "ROOT=%SRC%众艺传媒运营工具_备份"
if not exist "%ROOT%\" (
  echo.
  echo   [X] 找不到 %ROOT%，请检查盘符。
  pause
  exit /b 1
)

echo.
echo   恢复前请先关闭众艺传媒运营工具。
pause
echo.
call :COPY "项目总目录" "%ROOT%\项目" "%PROJECT%"
call :COPY "App 运行数据" "%ROOT%\运行数据\douyin-live-info" "%RUNTIME%"
if exist "%ROOT%\用户数据\.codex" call :COPY "Codex 数据" "%ROOT%\用户数据\.codex" "%USERPROFILE%\.codex"
if exist "%ROOT%\用户数据\.cc-switch" call :COPY "Codex 接口配置" "%ROOT%\用户数据\.cc-switch" "%USERPROFILE%\.cc-switch"
if exist "%ROOT%\用户数据\.agents" call :COPY "Agents 数据" "%ROOT%\用户数据\.agents" "%USERPROFILE%\.agents"

echo.
echo   恢复完成。打开软件后先做一次环境自检。
pause
exit /b 0

:COPY
echo [复制] %~1
if not exist "%~2\" (
  echo       跳过：源目录不存在
  exit /b 0
)
robocopy "%~2" "%~3" /E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo       [X] 复制失败，请检查磁盘空间和文件权限。
  pause
  exit /b 1
)
exit /b 0
