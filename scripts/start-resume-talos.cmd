@echo off
REM Thin wrapper. -WindowStyle Hidden keeps the PowerShell console
REM invisible — the splash form (drawn by the .ps1) is the only UI the
REM user sees until the browser opens.
powershell.exe -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File "%~dp0start-resume-talos.ps1"
