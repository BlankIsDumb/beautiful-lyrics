$ErrorActionPreference = 'Stop'
# Compatibility shortcut; all lifecycle behavior lives in the cross-platform CLI.
& node (Join-Path (Split-Path $PSScriptRoot -Parent) 'spicy-proxy.mjs') start
if ($LASTEXITCODE -ne 0) { throw 'Spicy proxy could not start. See the CLI output above.' }
