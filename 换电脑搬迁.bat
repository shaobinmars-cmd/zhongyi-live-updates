@echo off
setlocal enabledelayedexpansion
title 众艺 - 换电脑搬迁（备份 / 还原）

echo ============================================================
echo    换 电 脑 搬 迁
echo    把该带走的都带走（项目、数据、授权、Codex）
echo ============================================================
echo.
echo    1 = 备份到移动硬盘   （在旧电脑上做）
echo    2 = 从移动硬盘还原   （在新电脑上做）
echo.
set /p MODE=输入 1 或 2 然后按回车：

if "%MODE%"=="1" goto BACKUP
if "%MODE%"=="2" goto RESTORE
echo.
echo    只能输 1 或 2。
pause
exit /b 1


:BACKUP
echo.
set /p DEST=把移动硬盘插上，输入它的盘符（例如 E:\）再回车：
if not exist "%DEST%\" (
  echo.
  echo    [X] 找不到 %DEST% 这个盘，先确认盘符对不对。
  pause
  exit /b 1
)
set "ROOT=%DEST%众艺备份"
echo.
echo    备份到：%ROOT%
echo    大概 5GB，第一次要几分钟，后面重复备份会很快。
echo.
mkdir "%ROOT%\C盘_用户" 2>nul
mkdir "%ROOT%\H盘" 2>nul
mkdir "%ROOT%\D盘" 2>nul

echo [1/6] 项目目录（源码、资料、开发记录、私钥都在里面）...
robocopy "H:\众艺直播运营工具" "%ROOT%\H盘\众艺直播运营工具" /E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (echo    [X] 这一步失败了，检查空间和权限 & pause & exit /b 1)

echo [2/6] 拆解引擎...
robocopy "D:\直播拆解工具" "%ROOT%\D盘\直播拆解工具" /E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (echo    [X] 这一步失败了 & pause & exit /b 1)

echo [3/6] 软件数据（弹幕库、孵化库、汇总数据、密钥）...
robocopy "%APPDATA%\douyin-live-info" "%ROOT%\C盘_用户\douyin-live-info" /E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (echo    [X] 这一步失败了 & pause & exit /b 1)

echo [4/6] Codex 配置与技能...
robocopy "%USERPROFILE%\.codex" "%ROOT%\C盘_用户\codex" /E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (echo    [X] 这一步失败了 & pause & exit /b 1)

echo [5/6] Codex 的接口配置（CC Switch，没有它 Codex 用不了）...
if exist "%USERPROFILE%\.cc-switch" (
  robocopy "%USERPROFILE%\.cc-switch" "%ROOT%\C盘_用户\cc-switch" /E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
) else (
  echo     （这台没有 .cc-switch，跳过）
)

echo [6/6] 技能目录 .agents...
if exist "%USERPROFILE%\.agents" (
  robocopy "%USERPROFILE%\.agents" "%ROOT%\C盘_用户\agents" /E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
) else (
  echo     （这台没有 .agents，跳过）
)

echo.
echo ============================================================
echo    备份完成：%ROOT%
echo.
echo    提醒：
echo    1) 这里面已经有【授权私钥】（在 项目\源码\tools\授权密钥\），
echo       它是公司签发的命根子，这块移动硬盘别丢、别外借。
echo    2) 新电脑上把同样的盘符准备好（C / D / H），再跑本文件选 2 还原。
echo    3) 盘符如果变了，还原后要改两处路径：
echo       %APPDATA%\douyin-live-info\record.json 里的 outputPath
echo       项目\源码\electron-builder.yml 里引擎那一行
echo ============================================================
pause
exit /b 0


:RESTORE
echo.
echo    还原之前，请先：
echo      - 关掉本软件
echo      - 关掉 Codex
echo.
set /p SRC=输入移动硬盘盘符（例如 E:\）再回车：
if not exist "%SRC%众艺备份\" (
  echo.
  echo    [X] %SRC%众艺备份 不存在，确认盘符。
  pause
  exit /b 1
)
set "ROOT=%SRC%众艺备份"
echo.
echo    从 %ROOT% 还原到本机...

echo [1/6] 项目目录...
robocopy "%ROOT%\H盘\众艺直播运营工具" "H:\众艺直播运营工具" /E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (echo    [X] 失败 & pause & exit /b 1)

echo [2/6] 拆解引擎...
robocopy "%ROOT%\D盘\直播拆解工具" "D:\直播拆解工具" /E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (echo    [X] 失败 & pause & exit /b 1)

echo [3/6] 软件数据...
robocopy "%ROOT%\C盘_用户\douyin-live-info" "%APPDATA%\douyin-live-info" /E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (echo    [X] 失败 & pause & exit /b 1)

echo [4/6] Codex 配置...
robocopy "%ROOT%\C盘_用户\codex" "%USERPROFILE%\.codex" /E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (echo    [X] 失败 & pause & exit /b 1)

echo [5/6] Codex 接口配置...
if exist "%ROOT%\C盘_用户\cc-switch" robocopy "%ROOT%\C盘_用户\cc-switch" "%USERPROFILE%\.cc-switch" /E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul

echo [6/6] 技能目录...
if exist "%ROOT%\C盘_用户\agents" robocopy "%ROOT%\C盘_用户\agents" "%USERPROFILE%\.agents" /E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul

echo.
echo ============================================================
echo    还原完成。
echo    接下来：
echo    1) 装显卡/主板驱动，再打开本软件点「环境自检」
echo    2) 打开 Codex 试一句；这台是靠 CC Switch 的本地接口跑的，
echo       配置已经还原，正常的话不用重新登录
echo    3) 打开本软件看授权还在不在（C 盘没重装的话，机器码不变，授权照用）
echo ============================================================
pause
exit /b 0
