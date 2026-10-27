$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$name = 'just-enough-lyrics.mjs'
$bundle = Join-Path $repository ('dist/' + $name)
if (-not (Test-Path -LiteralPath $bundle)) { throw 'Run npm ci and npm run build first.' }

# Stop alone does not turn native exit codes into errors in every PowerShell.
function Invoke-Spicetify {
    $output = & spicetify @args
    if ($LASTEXITCODE -ne 0) { throw "Spicetify failed: $($args -join ' ')" }
    return $output
}
function Get-ExtensionNames {
    return @((Invoke-Spicetify config extensions) -split '[|\r\n]+' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}
function Test-LocalFork([string] $path) {
    if (-not (Test-Path -LiteralPath $path)) { return $false }
    $text = [IO.File]::ReadAllText($path)
    return $text.Contains('BeautifulLyricsLocal') -and $text.Contains('5.1.0-local.')
}

$config = ([string](Invoke-Spicetify -c)).Trim()
$extensions = ([string](Invoke-Spicetify path -e root)).Trim()
$destination = Join-Path $extensions $name
$existing = @(Get-ExtensionNames)
$theme = ([string](Invoke-Spicetify config current_theme)).Trim()
$scheme = ([string](Invoke-Spicetify config color_scheme)).Trim()
$retired = @()
foreach ($oldName in @('beautiful-lyrics-local.mjs', 'beautiful-lyrics.mjs')) {
    if ($oldName -notin $existing) { continue }
    # A filename alone is not proof that this is our fork. Never silently disable
    # an upstream extension registered under its original name.
    if (-not (Test-LocalFork (Join-Path $extensions $oldName))) {
        throw "Enabled $oldName is not a recognized local fork. Resolve that registration before installing JEL."
    }
    $retired += $oldName
}
if ((Test-Path -LiteralPath $destination) -and -not (Test-LocalFork $destination)) {
    throw "Refusing to replace an unrecognized $name."
}
if (-not (Test-LocalFork $bundle)) { throw 'The build is not a recognized self-contained local fork.' }

$backup = Join-Path $repository ('local-backups/install-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $backup | Out-Null
Copy-Item -LiteralPath $config -Destination (Join-Path $backup 'config-xpui.ini')
$hadDestination = Test-Path -LiteralPath $destination
foreach ($filename in @($name) + $retired) {
    $path = Join-Path $extensions $filename
    if (Test-Path -LiteralPath $path) { Copy-Item -LiteralPath $path -Destination (Join-Path $backup $filename) }
}
$staged = Join-Path $extensions ('.jel-' + [guid]::NewGuid().ToString('N') + '.tmp')
$applyAttempted = $false
try {
    # Stage/hash before replacing the destination; failed copies cannot truncate
    # the working bundle. Retired files remain available for rollback.
    Copy-Item -LiteralPath $bundle -Destination $staged
    if ((Get-FileHash -LiteralPath $bundle).Hash -ne (Get-FileHash -LiteralPath $staged).Hash) { throw 'Staged bundle hash mismatch.' }
    Move-Item -LiteralPath $staged -Destination $destination -Force
    foreach ($oldName in $retired) { Invoke-Spicetify config extensions ($oldName + '-') | Out-Null }
    if ($name -notin $existing) { Invoke-Spicetify config extensions $name | Out-Null }

    $expected = @($existing | Where-Object { $_ -notin $retired -and $_ -ne $name }) + @($name)
    $updated = @(Get-ExtensionNames)
    if (@(Compare-Object $expected $updated).Count -ne 0 -or @($updated | Where-Object { $_ -eq $name }).Count -ne 1 -or
        ([string](Invoke-Spicetify config current_theme)).Trim() -ne $theme -or
        ([string](Invoke-Spicetify config color_scheme)).Trim() -ne $scheme) {
        throw 'Configuration preservation check failed.'
    }
    $applyAttempted = $true
    # Filename migration changes index.html's script list and needs apply. Stable
    # canonical registrations only refresh extensions on subsequent updates.
    if ($retired.Count -gt 0 -or $name -notin $existing) { Invoke-Spicetify apply -n | Out-Null }
    else { Invoke-Spicetify -e refresh -n | Out-Null }
    if ((Get-FileHash -LiteralPath $destination).Hash -ne (Get-FileHash -LiteralPath $bundle).Hash) { throw 'Installed bundle hash mismatch.' }
} catch {
    $failure = $_
    Copy-Item -LiteralPath (Join-Path $backup 'config-xpui.ini') -Destination $config -Force
    if ($hadDestination) { Copy-Item -LiteralPath (Join-Path $backup $name) -Destination $destination -Force }
    elseif (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination }
    # apply may have partially rewritten Spotify. Reapply the restored config;
    # report rollback failure explicitly rather than claiming clean recovery.
    if ($applyAttempted) {
        try { Invoke-Spicetify apply -n | Out-Null }
        catch { Write-Warning "Rollback files restored, but Spotify reapply failed. Backup: $backup" }
    }
    throw "Installation failed; prior config/bundle restored. Backup: $backup. $failure"
} finally {
    if (Test-Path -LiteralPath $staged) { Remove-Item -LiteralPath $staged }
}
Write-Host "Installed Just Enough Lyrics locally. Reload Spotify to activate it. Backup: $backup"
