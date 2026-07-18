@echo off
REM ============================================================================
REM  Resume Talos - COMPLETE DEPLOY launcher (desktop icon target).
REM  One double-click: pull latest from GitHub, ensure config + dependencies,
REM  build the production bundle, start the server, and open the browser.
REM  Self-locating (no hardcoded drive); the repo root is the parent of this
REM  scripts\ folder. Keep this window open while using the app; Ctrl+C stops.
REM ============================================================================
setlocal enableextensions
title Resume Talos - Deploy
cd /d "%~dp0.."

set "PORT=3200"
set "ANTHROPIC_BASE_URL=https://api.anthropic.com/v1"
set "COREPACK_ENABLE_DOWNLOAD_PROMPT=0"
REM Locate corepack next to node.exe on PATH; fall back to bare 'corepack'.
REM (Node may live in Program Files, nvm, fnm, hermes, volta, etc.)
set "COREPACK="
for %%I in (node.exe) do if not defined COREPACK set "NODEDIR=%%~dp$PATH:I"
if defined NODEDIR if exist "%NODEDIR%corepack.cmd" set "COREPACK=%NODEDIR%corepack.cmd"
if not defined COREPACK set "COREPACK=corepack"

echo.
echo  ============================================================
echo    RESUME TALOS  -  COMPLETE DEPLOY
echo  ============================================================
echo    Repo: %CD%
echo    URL : http://localhost:%PORT%/applications
echo  ============================================================
echo.

echo  [1/5] Pulling latest from GitHub...
git pull --ff-only
if errorlevel 1 echo        Skipped or failed - continuing with local code.
echo.

echo  [2/5] Checking local config .env.local ...
if not exist ".env.local" (
  copy /y ".env.local.example" ".env.local" >nul
  echo        Created .env.local from example. Fill in your keys for full function.
) else (
  echo        Found.
)
echo.

echo  [3/5] Installing dependencies...
call "%COREPACK%" pnpm@11 install
if errorlevel 1 goto :fail
echo.

echo  [4/5] Building production bundle - this is the slow step...
call "%COREPACK%" pnpm@11 build
if errorlevel 1 goto :fail
echo.

echo  [5/5] Starting server on http://localhost:%PORT% ...
echo        A browser tab opens automatically when the app is ready.
echo        Keep THIS window open while you use the app. Press Ctrl+C to stop.
echo.
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_open-when-ready.ps1" %PORT%
call "%COREPACK%" pnpm@11 start
goto :end

:fail
echo.
echo  ============================================================
echo   DEPLOY FAILED. Review the messages above for the cause.
echo  ============================================================
echo.
pause
exit /b 1

:end
endlocal
