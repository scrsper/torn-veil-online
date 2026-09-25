<#
.SYNOPSIS
Runs a Python script inside the project's Unreal editor, headlessly, with no Remote Control and
no MCP involved.

.DESCRIPTION
The Remote Control / MCP channel is convenient but is a second thing that can be misconfigured
(see the note in Config/DefaultEngine.ini). Editor automation for this project should not depend
on it: `UnrealEditor-Cmd.exe -run=pythonscript` loads the same project, the same plugins and the
same `unreal` module, prints the script's stdout, and returns a real exit code - so a level build
either succeeded or it did not.

.EXAMPLE
./unreal/scripts/Run-EditorPython.ps1 -Script unreal/scripts/create_foundation_level.py
#>
param(
    [Parameter(Mandatory = $true)][string]$Script,
    [string]$Engine = 'C:\Program Files\Epic Games\UE_5.8',
    # Commandlets run on the null RHI, so anything that touches a skinned component's render
    # MeshObject dies on an assertion rather than failing (`SkinnedMeshComponent.cpp:4987` --
    # which is what FBX skeletal-mesh export does). Pass -Render for those scripts.
    [switch]$Render,
    [ValidateRange(1,7200)][int]$TimeoutSeconds = 300,
    [string]$LogPath = ''
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
if (Test-Path "$repo/.debug/AutoSDK") { $env:UE_SDKS_ROOT = "$repo/.debug/AutoSDK" }
$scriptPath = (Resolve-Path $Script).Path
$project = "$repo/unreal/TornVeilOnline/TornVeilOnline.uproject"
$cmd = "$Engine/Engine/Binaries/Win64/UnrealEditor-Cmd.exe"
if (!(Test-Path $cmd)) { throw "UnrealEditor-Cmd.exe not found at $cmd - pass -Engine <path to UE_5.8>." }
# [string[]] is load-bearing: an `if` returning a one-element array yields a bare string, and
# splatting a string passes it one character at a time.
if (!$LogPath) { $LogPath = Join-Path $repo ('.debug/unreal/' + [IO.Path]::GetFileNameWithoutExtension($scriptPath) + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log') }
$LogPath = [IO.Path]::GetFullPath($LogPath)
New-Item -ItemType Directory -Force ([IO.Path]::GetDirectoryName($LogPath)) | Out-Null
[string[]]$arguments = @('"'+$project+'"', '-run=pythonscript', '-script="'+$scriptPath+'"',
    '-unattended', '-nosplash', '-nosound', '-abslog="'+$LogPath+'"')
if ($Render) { $arguments += '-AllowCommandletRendering' }
$job = Start-Process -FilePath $cmd -ArgumentList $arguments -WindowStyle Hidden -PassThru
Write-Output "Editor Python PID=$($job.Id) log=$LogPath timeout=${TimeoutSeconds}s"
if (!$job.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-Process -Id $job.Id -ErrorAction SilentlyContinue
    throw "Editor Python timed out after ${TimeoutSeconds}s: $Script; inspect $LogPath"
}
if ($job.ExitCode -ne 0) { throw "Editor Python failed ($($job.ExitCode)): $Script; inspect $LogPath" }
Write-Output "Editor Python succeeded: $Script; log=$LogPath"
