@echo off
setlocal
title AMS2 Coach
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js isn't installed.
  echo   Install the LTS version from https://nodejs.org, then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo.
  echo   Installing dependencies. This only happens the first time...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo   Install failed. See the messages above.
    pause
    exit /b 1
  )
)

call npm start -- --open %*
pause
