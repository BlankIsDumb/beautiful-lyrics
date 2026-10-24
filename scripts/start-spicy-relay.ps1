$ErrorActionPreference = 'Stop'
try {
    $health = Invoke-RestMethod 'http://127.0.0.1:8967/health' -TimeoutSec 2
    if ($health.service -eq 'beautiful-lyrics-spicy-relay') { Write-Host 'Spicy relay is already running.'; return }
} catch { }
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$relayScript = Join-Path $PSScriptRoot 'spicy-relay.mjs'
$logDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) 'local-backups'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$relayProcess = Start-Process -FilePath $nodeExecutable -ArgumentList ('"' + $relayScript + '"') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'spicy-relay.out.log') -RedirectStandardError (Join-Path $logDirectory 'spicy-relay.err.log')
for ($attempt=0; $attempt -lt 15; $attempt++) {
    Start-Sleep -Milliseconds 200
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:8967/health' -TimeoutSec 1
        if ($health.service -eq 'beautiful-lyrics-spicy-relay') { Write-Host "Spicy relay started (PID $($relayProcess.Id)). Run this script again after signing in/rebooting; no startup settings were changed."; return }
    } catch { }
}
throw 'Spicy relay did not start. See local-backups/spicy-relay.err.log.'
