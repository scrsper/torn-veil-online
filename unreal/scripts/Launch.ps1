param([string]$Engine = 'C:\Program Files\Epic Games\UE_5.8', [ValidateSet('Playable','Ashford')][string]$Scenario = 'Playable')
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
if (Test-Path "$repo/.debug/AutoSDK") { $env:UE_SDKS_ROOT = "$repo/.debug/AutoSDK" }
$project = "$repo/unreal/TornVeilOnline/TornVeilOnline.uproject"
if (!(Test-Path "$Engine/Engine/Binaries/Win64/UnrealEditor.exe")) { throw "Unreal Editor not found in $Engine. Pass -Engine <installed UE 5.8 path>." }
$running = Get-CimInstance Win32_Process -Filter "Name='UnrealEditor.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Replace('\','/').Contains($project.Replace('\','/')) }
if ($running) { throw 'This project is already open. Close its editor so Launch can verify/build the current native client, then launch again.' }
Write-Host "Torn Veil project: $repo"
# Incremental UBT checks actual source/dependency freshness. A git pull does not rebuild a DLL.
# Always complete this before launch; a stale native client must never silently run.
& "$PSScriptRoot/Build.ps1" -Engine $Engine
try {
    $health=Invoke-RestMethod 'http://127.0.0.1:8787/health' -TimeoutSec 3
    if ($Scenario -eq 'Playable' -and $health.regionProtocol -ne 2) { throw 'The bridge is stale. Restart npm run bridge:playable from this checkout.' }
    Write-Host "Bridge ready: $($health.settlements) settlements; player $($health.playerId) / $($health.controlledBodyId); server checkout $($health.projectRoot)"
    if ($health.projectRoot -and [IO.Path]::GetFullPath($health.projectRoot) -ne [IO.Path]::GetFullPath($repo)) { Write-Warning 'The bridge is running from a different checkout. Confirm that it is the intended version and save.' }
} catch { throw "Bridge prerequisite failed: $($_.Exception.Message) Run npm run bridge$(if($Scenario -eq 'Playable'){':playable'}) first." }
if ($Scenario -eq 'Playable' -and !(Test-Path "$repo/unreal/TornVeilOnline/Content/Characters/TornVeilActivities/A_TV_work.uasset")) {
    & "$PSScriptRoot/Run-EditorPython.ps1" -Engine $Engine -Script "$PSScriptRoot/create_activity_animations.py"
}
$map = if ($Scenario -eq 'Ashford') { '/Game/TornVeil/Maps/Ashford' } else { '/Game/TornVeil/Maps/TornVeilWorld' }
if (!(Test-Path "$repo/unreal/TornVeilOnline/Content/TornVeil/Maps/$(if($Scenario -eq 'Playable'){'TornVeilWorld'}else{'Ashford'}).umap")) { throw 'The required presentation map is missing. Restore the tracked Content files.' }
Start-Process -FilePath "$Engine/Engine/Binaries/Win64/UnrealEditor.exe" -ArgumentList @("`"$repo/unreal/TornVeilOnline/TornVeilOnline.uproject`"", $map, '-RCWebControlEnable', '-RCWebInterfaceEnable') -WindowStyle Hidden
