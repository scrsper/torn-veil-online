param([string]$Engine = 'C:\Program Files\Epic Games\UE_5.8', [ValidateSet('Playable','Ashford')][string]$Scenario = 'Playable')
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
if (Test-Path "$repo/.debug/AutoSDK") { $env:UE_SDKS_ROOT = "$repo/.debug/AutoSDK" }
& "$PSScriptRoot/Setup-Assets.ps1" -Engine $Engine
if ($Scenario -eq 'Playable' -and !(Test-Path "$repo/unreal/TornVeilOnline/Content/Characters/TornVeilActivities/A_TV_work.uasset")) {
    & "$PSScriptRoot/Run-EditorPython.ps1" -Engine $Engine -Script "$PSScriptRoot/create_activity_animations.py"
}
$map = if ($Scenario -eq 'Ashford') { '/Game/TornVeil/Maps/Ashford' } else { '/Game/TornVeil/Maps/TornVeilWorld' }
Start-Process -FilePath "$Engine/Engine/Binaries/Win64/UnrealEditor.exe" -ArgumentList @("`"$repo/unreal/TornVeilOnline/TornVeilOnline.uproject`"", $map, '-RCWebControlEnable', '-RCWebInterfaceEnable') -WindowStyle Hidden
