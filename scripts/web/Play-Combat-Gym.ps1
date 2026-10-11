param([switch]$NoBrowser, [switch]$Build, [switch]$Arena, [switch]$Tower, [switch]$Hall)
if ($Hall) { $Tower = $true }
if ($Tower) { $Arena = $true }
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$state = Join-Path $repo '.debug\combat-gym'
New-Item -ItemType Directory -Force -Path $state | Out-Null
Push-Location $repo
try {
    if ($Build -or -not (Test-Path 'dist-web\index.html') -or ($Arena -and -not (Test-Path 'dist-web\arena\props.glb')) -or ($Arena -and -not (Test-Path 'dist-web\arena\creator\creator.json'))) { npm run web:build; if ($LASTEXITCODE -ne 0) { throw 'Client build failed.' } }
    $health = $null
    try { $health = Invoke-RestMethod 'http://127.0.0.1:7505/api/health' -TimeoutSec 2 } catch {}
    if ($health -and $health.projectRoot -ne $repo) { throw 'Port 7505 belongs to another checkout. Close that Combat Gym first.' }
    if (-not $health) {
        $node = (Get-Command node).Source
        Start-Process -FilePath $node -ArgumentList @('--import', 'tsx', 'scripts/web/combat-gym-server.ts') -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $state 'server.log') -RedirectStandardError (Join-Path $state 'server.err.log') | Out-Null
        $deadline = (Get-Date).AddSeconds(45)
        do { Start-Sleep -Milliseconds 300; try { $health = Invoke-RestMethod 'http://127.0.0.1:7505/api/health' -TimeoutSec 2 } catch {} } while (-not $health -and (Get-Date) -lt $deadline)
        if (-not $health) { throw 'Combat Gym did not become ready. See .debug\combat-gym\server.err.log.' }
    }
    $url = if ($Hall) { 'http://127.0.0.1:7505/?arena=1&tower=1&hall=1' } elseif ($Tower) { 'http://127.0.0.1:7505/?arena=1&tower=1' } elseif ($Arena) { 'http://127.0.0.1:7505/?arena=1' } else { 'http://127.0.0.1:7505/?gym=1&autoplay=1&view=orbit' }
    Write-Host "Disposable Combat Gym: $url"
    if (-not $NoBrowser) { Start-Process $url }
} finally { Pop-Location }
