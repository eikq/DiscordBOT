@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-desktop-shortcuts.ps1"
echo.
echo Desktop folders:
echo   Desktop\JARVIS\Owner Edition
echo   Desktop\JARVIS\Community Edition
pause
