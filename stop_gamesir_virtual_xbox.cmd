@echo off
setlocal
set "PORT=3780"

powershell.exe -NoProfile -NonInteractive -Command "try { Invoke-RestMethod -Method Post 'http://127.0.0.1:%PORT%/api/runtime/stop' | ConvertTo-Json -Compress; exit 0 } catch { Write-Error $_; exit 1 }"
