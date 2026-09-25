param(
    [string]$Engine = 'C:\Program Files\Epic Games\UE_5.8',
    [ValidateSet('Development','Shipping')][string]$Configuration = 'Development',
    [string]$Out = '',
    [ValidateRange(1,14400)][int]$TimeoutSeconds = 7200,
    [string]$LogPath = ''
)
# Packages the Living Alpha Windows client (no editor required to run it).
# Output: <Out>\Windows\TornVeilOnline.exe plus a client-release.json naming the exact revision.
# The package contains licensed third-party content: distribute privately to alpha players only,
# never commit or publish it.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
$project = Join-Path $repo 'unreal/TornVeilOnline/TornVeilOnline.uproject'
$rev = (git -C $repo rev-parse --short=12 HEAD).Trim()
$dirty = [bool](git -C $repo status --porcelain -- unreal)
if (!$Out) { $Out = Join-Path ($env:TORN_VEIL_ALPHA_HOME ?? (Join-Path $env:USERPROFILE 'TornVeilAlpha')) "clients\client-$rev$(if($dirty){'-dirty'})" }
if (Test-Path $Out) { throw "$Out already exists; client packages are immutable" }
Push-Location $repo
try { & npx tsx scripts/generate-interaction-spec.ts; if ($LASTEXITCODE -ne 0) { throw 'interaction spec generation failed' } } finally { Pop-Location }
if (!$LogPath) { $LogPath = Join-Path $repo ('.debug/unreal/package-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log') }
& "$PSScriptRoot/Invoke-BoundedBuild.ps1" -BatchFile "$Engine/Engine/Build/BatchFiles/RunUAT.bat" -TimeoutSeconds $TimeoutSeconds -LogPath $LogPath `
    -Arguments @('BuildCookRun', ('-project="'+$project+'"'), '-noP4', '-platform=Win64', ('-clientconfig='+$Configuration),
    '-build','-cook','-stage','-pak','-iostore','-compressed','-prereqs','-archive', ('-archivedirectory="'+$Out+'"'),
    '-map=/Game/TornVeil/Maps/TornVeilWorld','-unattended','-utf8output','-nocompileeditor')
$alpha = [regex]::Match((Get-Content (Join-Path $repo 'src/server/protocol.ts') -Raw), 'ALPHA_PROTOCOL = (\d+)').Groups[1].Value
@{ revision = $rev; dirty = $dirty; configuration = $Configuration; alphaProtocol = [int]$alpha; builtAtIso = (Get-Date).ToUniversalTime().ToString('o') } |
    ConvertTo-Json | Set-Content (Join-Path $Out 'client-release.json')
Write-Host "Client packaged: $Out"
