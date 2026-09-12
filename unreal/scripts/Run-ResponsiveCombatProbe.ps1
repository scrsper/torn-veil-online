param(
    [string]$Engine = 'C:\Program Files\Epic Games\UE_5.8',
    [int]$Port = 8791,
    [string]$Output = '.debug/combat-repair-probe',
    [switch]$Capture
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
$scene = Invoke-RestMethod "http://127.0.0.1:$Port/scene" -TimeoutSec 3
if (!$scene.arena) { throw 'Start-CombatArena.ps1 -ServerOnly must be running on this port.' }
$outputPath = [IO.Path]::GetFullPath((Join-Path $repo $Output))
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$env:TORN_VEIL_PORT = "$Port"
$env:TV_REPAIR_OUTPUT = $outputPath
$env:TV_REPAIR_CAPTURE = if ($Capture) { '1' } else { '0' }
$game = Start-Process "$Engine/Engine/Binaries/Win64/UnrealEditor.exe" -WindowStyle Hidden -PassThru -ArgumentList @(
    ('"' + "$repo/unreal/TornVeilOnline/TornVeilOnline.uproject" + '"'),
    '/Game/TornVeil/Maps/TornVeilWorld', '-game', '-unattended', '-windowed', '-ResX=1280', '-ResY=720', '-NoSound',
    '-ExecCmds="t.MaxFPS 60,t.IdleWhenNotForeground 0,TV.CombatRepairProbe"',
    ('-abslog="' + "$outputPath/unreal.log" + '"')
)
$game.WaitForExit()
if ($game.ExitCode -ne 0) { throw "Probe process failed: $($game.ExitCode)" }
$result = Get-Content -LiteralPath "$outputPath/probe.json" -Raw | ConvertFrom-Json
if ($result.status -ne 'complete') { throw "Probe: $($result.status)" }
Write-Output "Completed ordinary input probe: $outputPath/probe.json"
if ($Capture) { Write-Output 'Screenshot capture stalls frames. Encode using recorded frame timestamps; use a separate uncaptured run for timing.' }
