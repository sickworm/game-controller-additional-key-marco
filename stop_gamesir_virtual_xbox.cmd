@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop_gamesir_virtual_xbox.ps1"
exit /b %errorlevel%
