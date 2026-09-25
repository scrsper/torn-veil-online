param(
    [Parameter(Mandatory=$true)][string]$Package,
    [ValidatePattern('^[A-Za-z0-9_-]+$')][string]$Profile = 'default',
    [switch]$CheckOnly
)
# Human play launcher. No editor, automation commands, state fixtures, or command-line token.
$ErrorActionPreference = 'Stop'
$packageRoot = (Resolve-Path -LiteralPath $Package).Path
$manifestFile = Join-Path $packageRoot 'client-release.json'
$clientExe = Join-Path $packageRoot 'Windows/TornVeilOnline/Binaries/Win64/TornVeilOnline.exe'
if (!(Test-Path -LiteralPath $manifestFile) -or !(Test-Path -LiteralPath $clientExe)) { throw 'Expected a complete Package-Client.ps1 output directory.' }
$manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
$profileFile = Join-Path $env:LOCALAPPDATA "TornVeil/Client/$Profile.json"
$logDir = Join-Path $env:LOCALAPPDATA "TornVeil/Client/logs/$Profile"
if ($CheckOnly) {
    [ordered]@{ executable=$clientExe; revision=$manifest.revision; configuration=$manifest.configuration; profile=$profileFile; profileExists=(Test-Path -LiteralPath $profileFile); logDirectory=$logDir } | ConvertTo-Json
    return
}
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ((Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
# This entry point is invoked by the human player to open the interactive game.
$client = Start-Process -FilePath $clientExe -WorkingDirectory $packageRoot -WindowStyle Normal -PassThru `
    -ArgumentList @('-windowed', '-ResX=1920', '-ResY=1080', ('-TVProfile='+$Profile), ('-abslog="'+$logFile+'"'))
[ordered]@{ pid=$client.Id; profile=$Profile; log=$logFile } | ConvertTo-Json
