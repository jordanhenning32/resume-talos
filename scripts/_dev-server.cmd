@echo off
REM Run the Next.js dev server in its own titled window so the user can
REM find it in the taskbar and Ctrl+C it later. Launched minimized by
REM the splash; restore it from the taskbar to see logs.
title Resume Talos Dev Server
cd /d "%~dp0.."
set "ANTHROPIC_BASE_URL=https://api.anthropic.com/v1"
REM Keep the launcher and direct pnpm dev path on the same port. The
REM package script pins 3200 too; this env var is a defensive fallback.
set "PORT=3200"
set "COREPACK_ENABLE_DOWNLOAD_PROMPT=0"
REM Locate corepack next to node.exe on PATH; fall back to bare 'corepack'.
set "COREPACK="
for %%I in (node.exe) do if not defined COREPACK set "NODEDIR=%%~dp$PATH:I"
if defined NODEDIR if exist "%NODEDIR%corepack.cmd" set "COREPACK=%NODEDIR%corepack.cmd"
if not defined COREPACK set "COREPACK=corepack"
call "%COREPACK%" pnpm@11 dev
