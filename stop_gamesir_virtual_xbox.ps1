$ErrorActionPreference = 'Stop'
$language = if ($env:GAMESIR_LANG -eq 'en') { 'en' } else { 'zh-CN' }
$sessionPath = Join-Path $PSScriptRoot 'runtime\runtime-session.json'
$port = if ($env:PORT) { [int]$env:PORT } else { 3780 }

try {
  if (Test-Path -LiteralPath $sessionPath) {
    $session = Get-Content -Raw -LiteralPath $sessionPath | ConvertFrom-Json
    if ($session.service.port) { $port = [int]$session.service.port }
  }
  Invoke-RestMethod -Method Post "http://127.0.0.1:$port/api/runtime/stop" | ConvertTo-Json -Compress
  exit 0
} catch {
  $message = if ($language -eq 'en') { "Unable to stop this project session on port ${port}: $($_.Exception.Message)" } else { "无法停止端口 $port 上的本项目会话：$($_.Exception.Message)" }
  Write-Error $message
  exit 1
}
