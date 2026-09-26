param(
    [string]$Engine = 'C:\Program Files\Epic Games\UE_5.8',
    [int]$Port = 8791,
    [string]$Output = '.debug/combat-repair-probe',
    [string]$Executable = '',
    [ValidateSet('keyboard','gamepad','switch')][string]$Device = 'keyboard',
    [switch]$Capture,
    [switch]$GuardCapture,
    [switch]$EnableHardware,
    [switch]$Refinement,
    [switch]$Flow
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
$scene = Invoke-RestMethod "http://127.0.0.1:$Port/scene" -TimeoutSec 3
if (!$scene.arena) { throw 'Start-CombatArena.ps1 -ServerOnly must be running on this port.' }
$outputPath = [IO.Path]::GetFullPath((Join-Path $repo $Output))
if (Test-Path -LiteralPath $outputPath) { throw 'Choose a new evidence directory.' }
New-Item -ItemType Directory -Path $outputPath | Out-Null
$env:TORN_VEIL_PORT = "$Port"
$env:TV_REPAIR_OUTPUT = $outputPath
$env:TV_REPAIR_DEVICE = $Device
$env:TV_REPAIR_CAPTURE = if ($Capture) { '1' } elseif ($GuardCapture) { 'guard' } else { '0' }
$probe = if ($Flow) { 'TV.CombatFlowProbe' } elseif ($Refinement) { 'TV.CombatRefinementProbe' } else { 'TV.CombatRepairProbe' }
$gamePath = "$Engine/Engine/Binaries/Win64/UnrealEditor.exe"
$runArguments = @()
if ($Executable) {
    $gamePath = (Resolve-Path -LiteralPath $Executable).Path
    if ([IO.Path]::GetFileName($gamePath) -like 'UnrealEditor*') { throw 'Executable must be a packaged client.' }
}
else { $runArguments += ('"' + "$repo/unreal/TornVeilOnline/TornVeilOnline.uproject" + '"') }
$runArguments += @(
    '/Game/TornVeil/Maps/TornVeilWorld', '-game', '-windowed', '-ResX=1280', '-ResY=720', '-NoSound',
    ('-TVServer=127.0.0.1:'+$Port), '-TVAccount=arena-probe', '-TVToken=noncredential-isolated-arena',
    ('-TVProfile=arena-probe-'+[Guid]::NewGuid().ToString('N')),
    ('-ExecCmds="t.MaxFPS 60,t.IdleWhenNotForeground 0,' + $probe + '"'),
    ('-abslog="' + "$outputPath/unreal.log" + '"')
)
if (!$EnableHardware) { $runArguments += '-unattended' }
$game = Start-Process -FilePath $gamePath -WorkingDirectory (Split-Path $gamePath) -WindowStyle Hidden -PassThru -ArgumentList $runArguments
@{executable=$gamePath; packaged=[bool]$Executable; inputMode=$Device; startedAt=(Get-Date).ToUniversalTime().ToString('o'); revision=(git -C $repo rev-parse HEAD)} | ConvertTo-Json | Set-Content (Join-Path $outputPath 'run.json')
if (!$game.WaitForExit(120000)) { $game.Kill(); throw "Probe timed out; inspect $outputPath/unreal.log" }
if ($game.ExitCode -ne 0) { throw "Probe process failed: $($game.ExitCode)" }
$result = Get-Content -LiteralPath "$outputPath/probe.json" -Raw | ConvertFrom-Json
if ($result.status -ne 'complete') { throw "Probe: $($result.status)" }
Write-Output "Completed ordinary input probe: $outputPath/probe.json"
if ($Capture) { Write-Output 'Screenshot capture stalls frames. Encode using recorded frame timestamps; use a separate uncaptured run for timing.' }
