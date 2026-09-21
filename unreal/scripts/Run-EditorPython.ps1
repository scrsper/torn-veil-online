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
    [switch]$Render
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
[string[]]$extra = if ($Render) { '-AllowCommandletRendering' } else { @() }
& $cmd "$project" -run=pythonscript -script="$scriptPath" -unattended -nosplash -nosound -stdout -FullStdOutLogOutput @extra
if ($LASTEXITCODE -ne 0) { throw "Editor python script failed ($LASTEXITCODE): $Script" }
