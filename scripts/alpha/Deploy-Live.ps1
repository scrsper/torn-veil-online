param(
    [Parameter(Mandatory = $true)][string]$Release,           # an immutable bundle directory (build-release.mjs output)
    [string]$AlphaHome = $(if ($env:TORN_VEIL_ALPHA_HOME) { $env:TORN_VEIL_ALPHA_HOME } else { Join-Path $env:USERPROFILE 'TornVeilAlpha' }),
    [string]$Bind = '127.0.0.1',                               # add the Tailscale address explicitly; never 0.0.0.0
    [int]$Port = 7400,
    [string]$BackupRoot = 'D:\TornVeilAlpha\backups',
    [string]$Catalogue = '',
    [string[]]$Players = @(),                                  # account ids to create with a client profile each
    [switch]$CheckOnly
)
# First deployment of the Living Alpha live service and its staging environment.
# Refuses to touch an environment that already exists (use ops.mjs rehearse/update for updates).
$ErrorActionPreference = 'Stop'
$ops = Join-Path $Release 'ops.mjs'
if (!(Test-Path $ops)) { throw "$Release is not a release bundle (no ops.mjs)" }
$env:TORN_VEIL_ALPHA_HOME = $AlphaHome
$live = Join-Path $AlphaHome 'live'; $staging = Join-Path $AlphaHome 'staging'
$plan = [ordered]@{ release = $Release; live = $live; staging = $staging; bind = $Bind; port = $Port; backups = (Join-Path $BackupRoot 'live'); players = $Players
    liveExists = (Test-Path (Join-Path $live 'config.json')); stagingExists = (Test-Path (Join-Path $staging 'config.json')) }
if ($CheckOnly) { $plan | ConvertTo-Json; return }
if ($plan.liveExists) { throw "$live already has an environment; refusing to re-initialise a live world" }
$cat = @(); if ($Catalogue) { $cat = @('--catalogue', $Catalogue) }
node $ops init --env live --bind $Bind --port $Port --backup-dir (Join-Path $BackupRoot 'live') --backup-minutes 60 @cat
if ($LASTEXITCODE -ne 0) { throw 'live init failed' }
node $ops install --env live --release $Release
if (!$plan.stagingExists) {
    node $ops init --env staging --no-world --bind 127.0.0.1 --port ($Port + 10) --backup-dir (Join-Path $BackupRoot 'staging') @cat
    if ($LASTEXITCODE -ne 0) { throw 'staging init failed' }
}
node $ops start --env live
if ($LASTEXITCODE -ne 0) { throw 'live did not become ready' }
# One private client profile per player; the token is written only to that player's profile.
$profiles = Join-Path $env:LOCALAPPDATA 'TornVeil/Client'; New-Item -ItemType Directory -Force $profiles | Out-Null
foreach ($id in $Players) {
    $created = node $ops account add $id --name $id --env live | ConvertFrom-Json
    $server = "$(($Bind -split ',')[0]):$Port"
    @{ server = $server; account = $id; token = $created.token; character = 'new'; name = ''; sex = 'f' } | ConvertTo-Json |
        Set-Content -Encoding utf8 (Join-Path $profiles "$id.json")
    Write-Host "profile $id written to $profiles (token not printed)"
}
node $ops status --env live
