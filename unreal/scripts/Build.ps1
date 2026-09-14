param([string]$Engine = 'C:\Program Files\Epic Games\UE_5.8')
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
Push-Location $repo
try { & npx tsx scripts/generate-interaction-spec.ts --check; if ($LASTEXITCODE -ne 0) { throw 'Shared interaction specification is stale. Run npx tsx scripts/generate-interaction-spec.ts.' } }
finally { Pop-Location }
if (Test-Path "$repo/.debug/AutoSDK") { $env:UE_SDKS_ROOT = "$repo/.debug/AutoSDK" }
& "$PSScriptRoot/Setup-Assets.ps1" -Engine $Engine
& "$Engine/Engine/Build/BatchFiles/Build.bat" TornVeilOnlineEditor Win64 Development "-Project=$repo/unreal/TornVeilOnline/TornVeilOnline.uproject" -WaitMutex -NoHotReloadFromIDE
if ($LASTEXITCODE -ne 0) { throw "Unreal build failed ($LASTEXITCODE)" }
