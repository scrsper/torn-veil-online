param([string]$Engine = 'C:\Program Files\Epic Games\UE_5.8')
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
if (Test-Path "$repo/.debug/AutoSDK") { $env:UE_SDKS_ROOT = "$repo/.debug/AutoSDK" }
& "$PSScriptRoot/Setup-Assets.ps1" -Engine $Engine
Start-Process -FilePath "$Engine/Engine/Binaries/Win64/UnrealEditor.exe" -ArgumentList @("`"$repo/unreal/TornVeilOnline/TornVeilOnline.uproject`"", '-RCWebControlEnable', '-RCWebInterfaceEnable') -WindowStyle Hidden
