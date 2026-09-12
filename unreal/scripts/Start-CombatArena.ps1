param(
    [string]$Engine = 'C:\Program Files\Epic Games\UE_5.8',
    [int]$Port = 8789,
    [switch]$ServerOnly,
    [string]$Save
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
Set-Location -LiteralPath $repo
$env:TORN_VEIL_PORT = "$Port"
$env:TORN_VEIL_WORLD = 'arena'
if ($Save) { $env:TORN_VEIL_SAVE = [IO.Path]::GetFullPath($(if ([IO.Path]::IsPathRooted($Save)) { $Save } else { Join-Path $repo $Save })) }
else { Remove-Item Env:TORN_VEIL_SAVE -ErrorAction SilentlyContinue }
if ($ServerOnly) { & npx tsx src/bridge/server.ts; exit $LASTEXITCODE }
$url = "http://127.0.0.1:$Port"
$health = $null
try { $health = Invoke-RestMethod "$url/health" -TimeoutSec 2 } catch { }
if (!$health) {
    New-Item -ItemType Directory -Path "$repo/.debug" -Force | Out-Null
    $serverArgs = @('-NoProfile', '-File', ('"' + $PSCommandPath + '"'), '-ServerOnly', '-Port', "$Port")
    if ($Save) { $serverArgs += @('-Save', ('"' + $env:TORN_VEIL_SAVE + '"')) }
    $server = Start-Process pwsh -WindowStyle Hidden -PassThru -ArgumentList $serverArgs -RedirectStandardOutput "$repo/.debug/combat-arena.stdout.log" -RedirectStandardError "$repo/.debug/combat-arena.stderr.log"
    $deadline = (Get-Date).AddSeconds(20)
    while (!$health -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 200
        try { $health = Invoke-RestMethod "$url/health" -TimeoutSec 1 } catch { }
    }
    if (!$health) { throw "Arena did not start; inspect .debug/combat-arena.stderr.log (process $($server.Id))." }
}
if ($health.projectRoot -ne $repo) { throw "Port $Port belongs to another checkout. Choose an unused port." }
$scene = Invoke-RestMethod "$url/scene"
if (!$scene.arena) { throw "Port $Port belongs to another world. Choose an unused port." }
if (!$Save -or !(Test-Path -LiteralPath $env:TORN_VEIL_SAVE)) { Invoke-RestMethod -Method Post "$url/arena/idle" | Out-Null }
$exe = "$Engine/Engine/Binaries/Win64/UnrealEditor.exe"
$project = "$repo/unreal/TornVeilOnline/TornVeilOnline.uproject"
Start-Process -FilePath $exe -ArgumentList @(
    ('"' + $project + '"'), '/Game/TornVeil/Maps/TornVeilWorld', '-game', '-windowed',
    '-ResX=1280', '-ResY=720', '-ExecCmds="t.MaxFPS 60,t.IdleWhenNotForeground 0"'
) | Out-Null
Write-Output "Arena: $url. WASD move; Shift sprint; mouse camera; LMB punch; RMB kick; Space + direction dodge (neutral backstep); Left Ctrl duck. F1 passive, F2 repeated attacks, F3 reset/recover, F4 cycle untrained/partial/trained. R cover; V shove; F5 save (when -Save is supplied)."
Write-Output "Controller: left stick move, right stick camera, RB punch, RT kick, B dodge, LB duck, L-stick click sprint; D-pad left/right passive/repeat; Menu reset."
Write-Output "Other reset scenarios: idle, incoming_low, blocked, npc_defense. Return focus to the game before reacting."
