param([string]$Sample='C:\Users\green\Desktop\projects\GameAnimationSample',[string]$Engine='C:\Program Files\Epic Games\UE_5.8')
$ErrorActionPreference='Stop'
$repo=(Resolve-Path "$PSScriptRoot/../..").Path
$sampleProject=Join-Path $Sample 'GameAnimationSample.uproject'
if(!(Test-Path -LiteralPath $sampleProject)){throw 'Install the licensed Epic Game Animation Sample first. No download or purchase is performed.'}
if(Get-Process UnrealEditor -ErrorAction SilentlyContinue){throw 'Close Unreal Editor before installing local animation dependencies.'}
$env:TV_PRESENTATION_PROJECT="$repo/unreal/TornVeilOnline"
& "$Engine/Engine/Binaries/Win64/UnrealEditor-Cmd.exe" $sampleProject -run=pythonscript "-script=$PSScriptRoot/migrate_locomotion_reference.py" -unattended -nosound -NullRHI -stdout
if($LASTEXITCODE -ne 0){throw 'Selective reference migration failed; see engine output.'}
& "$PSScriptRoot/Run-EditorPython.ps1" -Script "$PSScriptRoot/create_directional_locomotion.py" -Engine $Engine
