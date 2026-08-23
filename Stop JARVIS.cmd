@echo off
setlocal
cd /d "%~dp0"
title Stop JARVIS
echo Stopping JARVIS-owned services...
node --import tsx scripts/launch_jarvis_community.ts stop
if errorlevel 1 pause
