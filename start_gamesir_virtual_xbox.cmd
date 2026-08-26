@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_gamesir_virtual_xbox.ps1"
exit /b %errorlevel%
