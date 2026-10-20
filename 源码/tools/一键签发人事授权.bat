@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sign-license-hr.ps1"
if errorlevel 1 pause
