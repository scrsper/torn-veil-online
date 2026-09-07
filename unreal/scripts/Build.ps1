param([string]$Engine = 'C:\Program Files\Epic Games\UE_5.8')
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
if (Test-Path "$repo/.debug/AutoSDK") { $env:UE_SDKS_ROOT = "$repo/.debug/AutoSDK" }
& "$PSScriptRoot/Setup-Assets.ps1" -Engine $Engine
& "$Engine/Engine/Build/BatchFiles/Build.bat" TornVeilOnlineEditor Win64 Development "-Project=$repo/unreal/TornVeilOnline/TornVeilOnline.uproject" -WaitMutex -NoHotReloadFromIDE
if ($LASTEXITCODE -ne 0) { throw "Unreal build failed ($LASTEXITCODE)" }
