param([string]$Engine = 'C:\Program Files\Epic Games\UE_5.8',
    [ValidateRange(1,7200)][int]$TimeoutSeconds = 1800, [string]$LogPath = '')
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
Push-Location $repo
try { & npx tsx scripts/generate-interaction-spec.ts --check; if ($LASTEXITCODE -ne 0) { throw 'Shared interaction specification is stale. Run npx tsx scripts/generate-interaction-spec.ts.' } }
finally { Pop-Location }
if (Test-Path "$repo/.debug/AutoSDK") { $env:UE_SDKS_ROOT = "$repo/.debug/AutoSDK" }
& "$PSScriptRoot/Setup-Assets.ps1" -Engine $Engine
if (!$LogPath) { $LogPath = Join-Path $repo ('.debug/unreal/build-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log') }
& "$PSScriptRoot/Invoke-BoundedBuild.ps1" -BatchFile "$Engine/Engine/Build/BatchFiles/Build.bat" -TimeoutSeconds $TimeoutSeconds -LogPath $LogPath `
    -Arguments @('TornVeilOnlineEditor','Win64','Development', ('-Project="'+$repo+'/unreal/TornVeilOnline/TornVeilOnline.uproject"'), '-WaitMutex','-NoHotReloadFromIDE')
