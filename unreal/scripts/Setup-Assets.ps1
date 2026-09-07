param([string]$Engine = 'C:\Program Files\Epic Games\UE_5.8')
$ErrorActionPreference = 'Stop'
$projectDir = Join-Path $PSScriptRoot '../TornVeilOnline'
$source = Join-Path $Engine 'Templates/TemplateResources/High/Characters/Content'
if (!(Test-Path $source)) { throw 'Install UE 5.8 Templates and Feature Packs through Epic Launcher.' }
New-Item -ItemType Directory -Force "$projectDir/Content" | Out-Null
if (!(Test-Path "$projectDir/Content/Characters/Mannequins/Meshes/SKM_Manny_Simple.uasset")) {
    Copy-Item -Recurse $source "$projectDir/Content/Characters"
}
Write-Host 'Epic template humanoid and animation assets ready (local UE license required).'
