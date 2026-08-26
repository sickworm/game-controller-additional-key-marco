$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$port = if ($env:PORT) { [int]$env:PORT } else { 3780 }
$baseUrl = "http://127.0.0.1:$port"
$serverPath = Join-Path $root 'app\server\server.mjs'
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) { $nodeCommand = Get-Command node -ErrorAction SilentlyContinue }
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { $null }

function Wait-ForService {
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 "$baseUrl/health" | Out-Null; return }
    catch { Start-Sleep -Milliseconds 250 }
  }
  throw "Configuration service did not become ready on port $port."
}

function Show-StartupError([string]$reason) {
  Write-Host ''
  Write-Host '======================================================================'
  Write-Host '  STARTUP FAILED'
  Write-Host '======================================================================'
  Write-Host "  Reason: $reason"
  Write-Host ''
  Read-Host 'Press Enter to exit' | Out-Null
}

try {
  try { $status = (Invoke-RestMethod -TimeoutSec 1 "$baseUrl/api/status").data } catch { $status = $null }
  $owned = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*$serverPath*" }
  $serverUpdated = $false
  if ($status.service.sessionId -and $owned) {
    $serverUpdated = ($owned | ForEach-Object { $_.CreationDate -lt (Get-Item -LiteralPath $serverPath).LastWriteTime } | Where-Object { $_ } | Measure-Object).Count -gt 0
  }
  if (-not $status.service.sessionId -or $serverUpdated) {
    if ($owned) { $owned | ForEach-Object { Stop-Process -Id $_.ProcessId -Force } }
    if (-not $nodePath -or -not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js was not found in PATH. Install Node.js, reopen this window, then run the launcher again.' }
    Start-Process -FilePath $nodePath -ArgumentList ('"' + $serverPath + '"') -WorkingDirectory $root -WindowStyle Hidden
  }
  Wait-ForService
  try { Invoke-RestMethod -Method Post -TimeoutSec 20 "$baseUrl/api/runtime/check-environment" | Out-Null }
  catch {
    $reason = $_.Exception.Message
    if ($_.Exception.Response) {
      $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
      try { $payload = $reader.ReadToEnd() | ConvertFrom-Json; if ($payload.error.message) { $reason = $payload.error.message } }
      catch {} finally { $reader.Dispose() }
    }
    throw $reason
  }
  $state = (Invoke-RestMethod -TimeoutSec 3 "$baseUrl/api/status").data
  Clear-Host
  Write-Host '======================================================================'
  Write-Host '  GameSir Virtual Xbox'
  Write-Host '======================================================================'
  Write-Host ''
  Write-Host '  Runtime status'
  Write-Host "    Service        : $($state.service.status)"
  Write-Host '    HidHide cloak  : enabled'
  Write-Host "    AHK + vJoy     : $($state.ahk.status)"
  Write-Host "    XOutput        : $($state.xoutput.status)"
  Write-Host '    Virtual Xbox   : confirm Controller shows Stop in XOutput'
  Write-Host ''
  Write-Host '  Keyboard controls'
  Write-Host '    Ctrl+I         : open Configuration Center'
  Write-Host '    Ctrl+Z         : stop virtual mode and return to native GameSir'
  Write-Host ''
  Write-Host '  Keep this window open while virtual mode is in use.'
  Write-Host '======================================================================'
  $raw = $Host.UI.RawUI
  while ($true) {
    $key = $raw.ReadKey('NoEcho,IncludeKeyDown')
    $ctrl = ($key.ControlKeyState -band 12) -ne 0
    if ($ctrl -and $key.VirtualKeyCode -eq 73) { Start-Process "$baseUrl/"; Write-Host ''; Write-Host 'Configuration Center opened.' }
    if ($ctrl -and $key.VirtualKeyCode -eq 90) { break }
  }
  Write-Host ''
  Write-Host 'Stopping virtual mode...'
  $result = (Invoke-RestMethod -Method Post "$baseUrl/api/runtime/stop").data
  Write-Host "  AHK      : $($result.ahk)"
  Write-Host "  XOutput  : $($result.xoutput)"
  Write-Host "  HidHide  : $($result.hidhide)"
  if ($result.hidhide -eq 'disabled') { Write-Host 'Native GameSir mode is restored.' }
  else { Write-Host 'HidHide cloak was kept on; see the status above.' }
  exit 0
} catch {
  Show-StartupError $_.Exception.Message
  exit 1
}
