@echo off
setlocal
cd /d "%~dp0"
title JARVIS Community
echo Starting JARVIS...
node --import tsx scripts/launch_jarvis_community.ts
if errorlevel 1 pause
