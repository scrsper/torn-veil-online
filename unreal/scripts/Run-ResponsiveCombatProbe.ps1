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
if (!$Flow -and !$Refinement) {
    # Completing an injected sequence alone does not establish that gameplay responded.
    # These observations certify the engine input path, never physical hardware or human play.
    $frames = @($result.samples | Where-Object event -eq 'frame')
    $walk = @($frames | Where-Object { $_.at -gt 14.8 -and $_.at -lt 15.25 } | ForEach-Object { $_.player.speedCmPerSecond })
    $sprint = @($frames | Where-Object { $_.at -gt 15.7 -and $_.at -lt 16.2 } | ForEach-Object { $_.player.speedCmPerSecond })
    $walkMean = ($walk | Measure-Object -Average).Average
    $sprintMean = ($sprint | Measure-Object -Average).Average
    $checks = [ordered]@{
        livePrediction = [bool]$result.diagnostics.predictionReady
        attacksObserved = @($frames | Where-Object { $_.player.liveKind -eq 'attack' }).Count -gt 0
        directionalDodgeObserved = @($frames | Where-Object { $_.player.liveKind -eq 'sidestep' }).Count -gt 0
        backstepObserved = @($frames | Where-Object { $_.player.liveKind -eq 'backstep' }).Count -gt 0
        heldGuardObserved = @($frames | Where-Object { $_.player.guardHeld }).Count -ge 5
        canonicalGuardObserved = @($frames | Where-Object { $_.player.canonicalGuard }).Count -ge 5
        targetLockObserved = @($frames | Where-Object { $_.player.targetLocked }).Count -gt 0
        explorationLockReleased = @($frames | Where-Object { $_.at -gt 14.6 -and $_.at -lt 16.3 -and $_.player.targetLocked }).Count -eq 0
        walkAndSprintObserved = $walk.Count -ge 5 -and $sprint.Count -ge 5 -and $walkMean -gt 100 -and $sprintMean -gt $walkMean * 1.25
        presentationCannotMoveCanonicalBody = @($frames | Where-Object { $_.player.actorTranslationAuthority -or $_.player.rootMotionAllowed }).Count -eq 0
        cameraObstructionEnabled = @($frames | Where-Object { !$_.player.cameraCollisionEnabled }).Count -eq 0
    }
    $passed = @($checks.Values | Where-Object { !$_ }).Count -eq 0
    @{passed=$passed; checks=$checks; frames=$frames.Count; walkCmPerSecond=$walkMean; sprintCmPerSecond=$sprintMean;
      inputMode=$Device; packaged=[bool]$Executable; scope='Injected engine input on isolated arena; physical hardware, human play and display latency remain separate'} |
        ConvertTo-Json -Depth 5 | Set-Content (Join-Path $outputPath 'acceptance.json')
    if (!$passed) { throw "Input response acceptance failed; inspect $outputPath/acceptance.json" }
}
Write-Output "Completed engine input probe: $outputPath/probe.json"
if ($Capture) { Write-Output 'Screenshot capture stalls frames. Encode using recorded frame timestamps; use a separate uncaptured run for timing.' }
