$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$bundle = Join-Path $repository 'dist/beautiful-lyrics-local.mjs'
if (-not (Test-Path -LiteralPath $bundle)) { throw 'Run npm ci and npm run build first.' }

$config = (& spicetify -c).Trim()
$extensions = (& spicetify path -e root).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not locate the Spicetify extension directory.' }
$backup = Join-Path $repository ('local-backups/' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
Copy-Item -LiteralPath $config -Destination (Join-Path $backup 'config-xpui.ini')
$destination = Join-Path $extensions 'beautiful-lyrics-local.mjs'
if (Test-Path -LiteralPath $destination) {
    Copy-Item -LiteralPath $destination -Destination (Join-Path $backup 'beautiful-lyrics-local.mjs')
}
Copy-Item -LiteralPath $bundle -Destination $destination
# `spicetify -h` documents extensions as an array and config as append semantics.
# Verify that contract as well: restore the config before refresh if anything
# existing disappears, or if the selected theme/scheme changes.
$existingExtensions = ((& spicetify config extensions).Trim() -split '\|') | Where-Object { $_ }
$existingTheme = (& spicetify config current_theme).Trim()
$existingScheme = (& spicetify config color_scheme).Trim()
& spicetify config extensions beautiful-lyrics-local.mjs
if ($LASTEXITCODE -ne 0) { throw 'Could not enable the local extension.' }
$updatedExtensions = (& spicetify config extensions).Trim() -split '\|'
$missing = @($existingExtensions | Where-Object { $_ -notin $updatedExtensions })
if ($missing.Count -gt 0 -or
    (& spicetify config current_theme).Trim() -ne $existingTheme -or
    (& spicetify config color_scheme).Trim() -ne $existingScheme) {
    Copy-Item -LiteralPath (Join-Path $backup 'config-xpui.ini') -Destination $config
    throw 'Configuration preservation check failed; restored original config without refreshing Spotify.'
}
# First registration needs apply to regenerate index.html's module script list.
# Subsequent rebuilds only need an extension refresh.
if ('beautiful-lyrics-local.mjs' -notin $existingExtensions) {
    & spicetify apply -n
} else {
    & spicetify -e refresh -n
}
if ($LASTEXITCODE -ne 0) { throw 'Spicetify apply/refresh failed; the backup is in local-backups.' }
Write-Host "Installed Beautiful Lyrics locally. Reload Spotify to activate it. Backup: $backup"
