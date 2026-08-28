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

function Write-CoreRuntimeStatus($state, [switch]$Force) {
  if ($null -eq $state) {
    $key = 'service=unavailable'
    if (-not $Force -and $script:lastCoreStatusKey -eq $key) { return }
    $script:lastCoreStatusKey = $key
    Write-Host "  [$((Get-Date).ToString('HH:mm:ss'))] 状态服务：不可用" -ForegroundColor Red
    return
  }
  $ahk = switch ($state.ahk.status) { 'running' { '运行中' } 'degraded' { '配置异常' } default { '未运行' } }
  $input = if ($state.ahk.inputState -eq 'connected') { '已连接' } else { '已断开' }
  $xoutput = if ($state.xoutput.status -eq 'running') { '运行中' } else { '未运行' }
  $key = "ahk=$($state.ahk.status);input=$($state.ahk.inputState);xoutput=$($state.xoutput.status)"
  if (-not $Force -and $script:lastCoreStatusKey -eq $key) { return }
  $script:lastCoreStatusKey = $key
  $stamp = (Get-Date).ToString('HH:mm:ss')
  Write-Host "  [$stamp] AHK 执行器：$ahk"
  Write-Host "  [$stamp] 实体 GameSir XInput：$input"
  Write-Host "  [$stamp] XOutput：$xoutput"
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
  # Slot probing is safe only while the launcher is starting: AHK briefly
  # pauses forwarding and writes a vJoy signature to identify XOutput.  A
  # unique physical candidate is saved automatically; otherwise preserve the
  # user's existing slot and let the Configuration Center resolve it.
  $slotProbe = $null
  $slotProbeNote = 'not detected; open Configuration Center to choose a physical slot'
  try {
    $slotProbe = (Invoke-RestMethod -Method Post -TimeoutSec 8 "$baseUrl/api/xinput/probe").data
    $candidates = @($slotProbe.slots | Where-Object { $_.selectable })
    if ($slotProbe.autoSelected) {
      $slotProbeNote = "auto-selected XInput #$($slotProbe.selectedUser)"
    } elseif ($candidates.Count -eq 0) {
      $slotProbeNote = 'no physical XInput slot detected; existing selection was kept'
    } elseif ($candidates.Count -gt 1) {
      $slotProbeNote = 'multiple physical candidates; existing selection was kept'
    } else {
      $slotProbeNote = "using existing XInput #$($slotProbe.selectedUser)"
    }
  } catch {
    # Do not make a non-destructive convenience probe prevent virtual mode
    # from starting.  Its full diagnostic remains available in the page.
    $slotProbeNote = 'probe unavailable; existing selection was kept'
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
  Write-Host "    Physical slot  : $slotProbeNote"
  Write-Host '    Virtual Xbox   : confirm Controller shows Stop in XOutput'
  Write-Host ''
  Write-Host '  Keyboard controls'
  Write-Host '    Ctrl+I         : open Configuration Center'
  Write-Host '    Ctrl+Z         : stop virtual mode and return to native GameSir'
  Write-Host ''
  Write-Host '  Keep this window open while virtual mode is in use.'
  Write-Host '======================================================================'
  $raw = $Host.UI.RawUI
  $script:lastCoreStatusKey = $null
  Write-Host ''
  Write-Host '  Core runtime log (prints only when status changes)'
  Write-CoreRuntimeStatus $state -Force
  $nextStatusPollAt = [DateTime]::UtcNow
  while ($true) {
    if ($raw.KeyAvailable) {
      $key = $raw.ReadKey('NoEcho,IncludeKeyDown')
      $ctrl = ($key.ControlKeyState -band 12) -ne 0
      if ($ctrl -and $key.VirtualKeyCode -eq 73) { Start-Process "$baseUrl/"; Write-Host ''; Write-Host 'Configuration Center opened.' }
      if ($ctrl -and $key.VirtualKeyCode -eq 90) { break }
    }
    if ([DateTime]::UtcNow -ge $nextStatusPollAt) {
      try { Write-CoreRuntimeStatus (Invoke-RestMethod -TimeoutSec 1 "$baseUrl/api/status").data }
      catch { Write-CoreRuntimeStatus $null }
      $nextStatusPollAt = [DateTime]::UtcNow.AddSeconds(1)
    }
    Start-Sleep -Milliseconds 50
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
