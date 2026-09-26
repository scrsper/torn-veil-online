param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9_-]+$')][string]$Profile,
    [Parameter(Mandatory=$true)][string]$Executable,
    [Parameter(Mandatory=$true)][string]$Out,
    [ValidateRange(45,60)][int]$Minutes = 50
)
# Visible packaged game for an actual human session. This script sends no gameplay input.
$ErrorActionPreference = 'Stop'
$gamePath = (Resolve-Path -LiteralPath $Executable).Path
if ([IO.Path]::GetFileName($gamePath) -like 'UnrealEditor*') { throw 'Use the final packaged client.' }
$evidencePath = [IO.Path]::GetFullPath($Out)
if (Test-Path -LiteralPath $evidencePath) { throw 'Choose a new evidence directory.' }
New-Item -ItemType Directory -Path $evidencePath | Out-Null
$env:TV_PLAY_SESSION_OUTPUT = $evidencePath
$arguments = @('-windowed','-ResX=1920','-ResY=1080', ('-TVProfile='+$Profile),
    ('-abslog="'+(Join-Path $evidencePath 'unreal.log')+'"'),
    ('-ExecCmds="t.MaxFPS 60,t.IdleWhenNotForeground 0,TV.PlaySession.Start '+($Minutes*60)+'"'))
$process = Start-Process -FilePath $gamePath -ArgumentList $arguments -WorkingDirectory (Split-Path $gamePath) -PassThru
@{pid=$process.Id; executable=$gamePath; requestedMinutes=$Minutes; startedAt=(Get-Date).ToUniversalTime().ToString('o'); scope='Human controls; observer only'} | ConvertTo-Json | Set-Content (Join-Path $evidencePath 'launch.json')
Write-Output "Human play session launched. Telemetry: $evidencePath\play-session.json"
