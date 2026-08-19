@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "HOST=127.0.0.1"
set "PORT=3010"
set "JARVIS_STANDALONE=1"
set "LAB_URL=http://%HOST%:%PORT%/jarvis-lab"
set "HEALTH_URL=http://%HOST%:%PORT%/api/health"

title Jarvis Lab  %LAB_URL%
color 0B

echo.
echo   JARVIS COMMAND CENTER
echo   %LAB_URL%
echo   Standalone lab  (Discord is not started)
echo   Close this window or press Ctrl+C to stop.
echo.

where node >nul 2>&1
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
)
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found in PATH.
  echo Install Node 18+ and open a new terminal, then try again.
  goto :fail
)

if not exist "node_modules\" (
  echo node_modules is missing. Installing dependencies...
  call npm ci
  if errorlevel 1 (
    echo npm ci failed. Fix the install error, then run start.bat again.
    goto :fail
  )
  echo.
)

powershell -NoProfile -Command ^
  "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%HEALTH_URL%'; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>&1
if %errorlevel%==0 (
  echo Server is already running. Opening the lab...
  start "" "%LAB_URL%"
  echo.
  echo You can close this window. The existing server stays up.
  timeout /t 4 >nul
  exit /b 0
)

echo Starting server...
start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 4; Start-Process '%LAB_URL%'"
call npm run dev
set "EXIT_CODE=%errorlevel%"
if not "%EXIT_CODE%"=="0" goto :fail
exit /b 0

:fail
echo.
pause
exit /b 1
