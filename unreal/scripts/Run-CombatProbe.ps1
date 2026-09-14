param(
    [ValidateSet('timely','late','repeat','duck-high','duck-low','blocked')][string]$Mode = 'timely',
    [int]$Port = 8789,
    [string]$Engine = 'C:/Program Files/Epic Games/UE_5.8',
    [string]$OutputPrefix = '',
    [switch]$Capture,
    [int]$Repetitions = 60
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
Set-Location -LiteralPath $repo
$arena = "http://127.0.0.1:$Port"
$scene = Invoke-RestMethod "$arena/scene"
if (!$scene.arena) { throw 'This probe requires the isolated unsaved combat arena.' }
Invoke-RestMethod -Method Post "$arena/arena/idle" | Out-Null
if (!$OutputPrefix) { $OutputPrefix = 'native-combat-' + $Mode + $(if($Capture){'-rendered'}else{'-measured'}) }
if ($OutputPrefix -notmatch '^[a-zA-Z0-9_-]+$') { throw 'OutputPrefix must be a filename stem.' }
$run = Join-Path $repo ('.debug/' + $OutputPrefix + '-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $run -Force | Out-Null
$log = Join-Path $run 'unreal.log'
$env:TORN_VEIL_PORT = "$Port"
$env:TV_LIVE_COMBAT_CAPTURE = $(if($Capture){'1'}else{'0'})
$env:TV_LIVE_COMBAT_CAPTURE_DIR = Join-Path $run 'frames'
$env:TV_LIVE_COMBAT_DEFENSE_ONLY = $(if($Mode -eq 'repeat'){'0'}else{'1'})
$env:TV_LIVE_COMBAT_REPETITIONS = $(if($Mode -eq 'repeat'){"$Repetitions"}else{'0'})
$env:TV_LIVE_COMBAT_DODGE_DELAY = $(if($Mode -eq 'late'){'.32'}else{'.05'})
$env:TV_LIVE_COMBAT_DEFENSE_KIND = $(if($Mode -like 'duck-*'){'duck'}elseif($Mode -eq 'blocked'){'backstep'}else{'sidestep'})
$project = Join-Path $repo 'unreal/TornVeilOnline/TornVeilOnline.uproject'
$arguments = @('"'+$project+'"','/Game/TornVeil/Maps/TornVeilWorld','-game','-windowed','-ResX=1280','-ResY=720',
    '-abslog="'+$log+'"','-ExecCmds="t.MaxFPS 60,t.IdleWhenNotForeground 0,TV.LiveCombatProbe"','-TVLiveCombatProbeExit')
$process = Start-Process -FilePath "$Engine/Engine/Binaries/Win64/UnrealEditor.exe" -ArgumentList $arguments -PassThru
$deadline = (Get-Date).AddSeconds(45 + $Repetitions * 1.1)
$triggered = $false; $atInput = $null
while (!$process.HasExited -and (Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $log) {
        if (!$triggered -and (Select-String -LiteralPath $log -Pattern 'TV_BRIDGE canonical LIVE' -Quiet)) {
            if ($Mode -ne 'repeat') {
                $scenario = if($Mode -eq 'duck-low'){'incoming_low'}elseif($Mode -eq 'blocked'){'blocked'}else{'incoming'}
                Invoke-RestMethod -Method Post "$arena/arena/$scenario" | Out-Null
            }
            $triggered = $true
        }
        if (!$atInput -and (Select-String -LiteralPath $log -Pattern 'TV_LIVE_COMBAT_INPUT' -Quiet)) {
            $atInput = Invoke-RestMethod "$arena/debug/snapshot"
        }
    }
    Start-Sleep -Milliseconds 30
}
if (!$process.HasExited) { Stop-Process -Id $process.Id; throw "Probe timed out; inspect $log" }
if ($process.ExitCode -ne 0) { throw "Native process failed ($($process.ExitCode)); inspect $log" }
$source = Join-Path $repo 'docs/evidence/realtime/native-live-combat-standalone.json'
if (!(Test-Path -LiteralPath $source) -or (Get-Item $source).LastWriteTime -lt (Get-Item $run).CreationTime) {
    throw 'No fresh native probe result was written.'
}
$result = Get-Content -LiteralPath $source -Raw | ConvertFrom-Json
if ($result.status -ne 'complete') { throw "Probe failed: $($result.error)" }
$result | Add-Member -NotePropertyName run -NotePropertyValue ([ordered]@{mode=$Mode;capture=[bool]$Capture;log=$log;frames=$env:TV_LIVE_COMBAT_CAPTURE_DIR})
$result | ConvertTo-Json -Depth 40 | Set-Content -LiteralPath "docs/evidence/realtime/$OutputPrefix.json"
[ordered]@{atInput=$atInput;after=(Invoke-RestMethod "$arena/debug/snapshot")} | ConvertTo-Json -Depth 40 |
    Set-Content -LiteralPath "docs/evidence/realtime/$OutputPrefix-server.json"
Write-Output "Probe complete: docs/evidence/realtime/$OutputPrefix.json"
Write-Output "Renderer frames and native log: $run"
