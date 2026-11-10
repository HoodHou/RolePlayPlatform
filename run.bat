@echo off
rem Starts the RolePlay platform: double-click this file.
rem   run.bat             build the web UI, start the server, open the browser
rem   run.bat dev         server and web UI that reload on change (for working on the code)
rem   run.bat --no-open   do not open the browser
rem The work is done by scripts\launch.mjs; this only finds Node.js and keeps the window open on an error.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20.12 or newer from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

node scripts\launch.mjs %*
if errorlevel 1 (
  echo.
  pause
)
endlocal
