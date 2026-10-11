param([int]$Port = 7510, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$nodePath = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path (Join-Path $repoRoot 'node_modules\tsx'))) { throw 'Run npm ci in this checkout first.' }
if ($CheckOnly) { Write-Host "Connected realms available in $repoRoot; port $Port. No server started."; exit 0 }
$commit = (& git -C $repoRoot rev-parse HEAD).Trim()
if ((& git -C $repoRoot status --porcelain --untracked-files=no)) { throw 'Tracked source changes are pending. Commit them before launching the current build; use web:dev while developing.' }
$buildRoot = Join-Path $repoRoot 'dist-web'
$manifestPath = Join-Path $buildRoot 'current-build.json'
$manifest = if (Test-Path $manifestPath) { Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } else { $null }
if (-not $manifest -or $manifest.commit -ne $commit) {
  & $nodePath (Join-Path $repoRoot 'scripts\web\build-current.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Current build failed. No older build was launched.' }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
}
if ($manifest.commit -ne $commit -or (Get-FileHash -LiteralPath (Join-Path $buildRoot 'index.html') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.indexSha256) { throw 'Build identity does not match source. Run npm run play:build.' }
Write-Host "Torn Veil current build: $commit; canonical connected world and Tower."
$running = $false
$health = $null
try { $health = Invoke-RestMethod "http://127.0.0.1:$Port/realms/health" -TimeoutSec 2 } catch { }
if ($health -and $health.kind -eq 'torn-veil-realms') {
  if ($health.root -ne $repoRoot) { throw "Port $Port belongs to a different checkout. Choose a free port with -Port." }
  if ($health.clientBuild.commit -ne $commit -or $health.buildRoot -ne $buildRoot) { throw "Port $Port hosts an older/different build. Stop its owner or choose a free port. No historical preview was replaced." }
  if (-not $health.ready) { throw 'This host is paused. Stop and restart its process to restore the last good save.' }
  $running = $true
}
if (-not $running) {
  & $nodePath (Join-Path $repoRoot 'scripts\web\arena\stage-creator.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Registered creator assets could not be staged. Inspect their provenance and source paths.' }
  $env:TV_REALMS_PORT = "$Port"
  $env:TV_REALMS_STATIC = $buildRoot
  if (-not $env:TV_REALMS_ASSETS) {
    $common = (& git -C $repoRoot rev-parse --path-format=absolute --git-common-dir).Trim()
    $assets = Join-Path (Split-Path $common -Parent) 'web\public'
    if (Test-Path (Join-Path $assets 'models\kit_f.glb')) { $env:TV_REALMS_ASSETS = $assets }
  }
  $logs = Join-Path $repoRoot '.debug\realms'
  New-Item -ItemType Directory -Force -Path $logs | Out-Null
  Start-Process -WindowStyle Hidden -FilePath $nodePath -ArgumentList @('--import','tsx','src/server/realms.ts') -WorkingDirectory $repoRoot -RedirectStandardOutput (Join-Path $logs 'host.log') -RedirectStandardError (Join-Path $logs 'host-error.log')
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try { $health = Invoke-RestMethod "http://127.0.0.1:$Port/realms/health" -TimeoutSec 1; if ($health.kind -eq 'torn-veil-realms' -and $health.root -eq $repoRoot -and $health.ready) { $running = $true; break } } catch { }
  }
}
if (-not $running) { throw 'Connected realms did not start. Inspect .debug/realms/host-error.log.' }
Start-Process "http://127.0.0.1:$Port/?realms"
