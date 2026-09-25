param(
    [Parameter(Mandatory=$true)][string]$Package,
    [Parameter(Mandatory=$true)][string]$AlphaRoot,
    [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9_-]+$')][string]$ProfileA,
    [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9_-]+$')][string]$ProfileB,
    [Parameter(Mandatory=$true)][string]$Out,
    [ValidateSet('dev','staging')][string]$Environment = 'staging'
)
# Two independent native observers. No player input or canonical state mutation.
$ErrorActionPreference = 'Stop'
if ($ProfileA -eq $ProfileB) { throw 'Independent profiles required' }
$Out = [IO.Path]::GetFullPath($Out)
if (Test-Path -LiteralPath $Out) { throw 'New evidence directory required' }
$exe = Join-Path $Package 'Windows/TornVeilOnline/Binaries/Win64/TornVeilOnline.exe'
if (!(Test-Path -LiteralPath $exe)) { throw 'Packaged client binary missing' }
$installed = Get-Content (Join-Path $AlphaRoot "$Environment/current-release.json") -Raw | ConvertFrom-Json
$ops = Join-Path $installed.dir 'ops.mjs'
$env:TORN_VEIL_ALPHA_HOME = $AlphaRoot
$shellExe = (Get-Command pwsh -CommandType Application | Select-Object -First 1).Source
New-Item -ItemType Directory -Path $Out | Out-Null
$jobs = @(); $samples = @(); $started = [datetime]::UtcNow
$report = [ordered]@{ kind='two independent packaged observers; no physical-input/gameplay acceptance'; startedAt=$started.ToString('o'); passed=$false; profiles=@($ProfileA,$ProfileB) }
try {
    foreach ($entry in @(@('a',$ProfileA),@('b',$ProfileB))) {
        $key=$entry[0]; $profile=$entry[1]
        $arguments=@('-NoProfile','-File',('"'+$PSScriptRoot+'/Capture-Alpha.ps1"'),'-Profile',$profile,
            '-Out',('"'+$Out+'/'+$key+'"'),'-Executable',('"'+$exe+'"'),'-Width','1280','-Height','720',
            '-ObserveSeconds','60','-TimeoutSeconds','300')
        $jobs += Start-Process -FilePath $shellExe -ArgumentList $arguments -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $Out "$key.stdout.log") -RedirectStandardError (Join-Path $Out "$key.stderr.log")
    }
    Write-Output "Native pair wrappers: $($jobs.Id -join ', '); evidence=$Out"
    while (@($jobs | Where-Object { !$_.HasExited }).Count) {
        if (([datetime]::UtcNow-$started).TotalSeconds -gt 330) { throw 'Native pair timed out' }
        $envelope = node $ops status --env $Environment | ConvertFrom-Json
        if ($LASTEXITCODE) { throw 'Service status failed' }
        $status = $envelope.service
        if (!$status.worldId) { throw 'Service status has no live world' }
        $sample = @{ at=[datetime]::UtcNow.ToString('o'); worldId=$status.worldId; connections=$status.connections }
        $samples += $sample
        $sample | ConvertTo-Json -Compress -Depth 5 | Add-Content (Join-Path $Out 'overlap.jsonl')
        Start-Sleep -Seconds 5
    }
    foreach ($job in $jobs) { $job.WaitForExit(); if ($job.ExitCode -ne 0) { throw "Capture wrapper $($job.Id) failed ($($job.ExitCode))" } }
    $a=Get-Content (Join-Path $Out 'a/capture.json') -Raw | ConvertFrom-Json
    $b=Get-Content (Join-Path $Out 'b/capture.json') -Raw | ConvertFrom-Json
    $pa=@($a.people | Where-Object possessed); $pb=@($b.people | Where-Object possessed)
    if ($pa.Count -ne 1 -or $pb.Count -ne 1) { throw 'Each independent client must possess one observed body' }
    $checks=[ordered]@{
        freshReadableFrames=($a.status -eq 'captured' -and $b.status -eq 'captured')
        sameWorld=($a.worldId -and $a.worldId -eq $b.worldId)
        separatePeople=($pa[0].entityId -ne $pb[0].entityId)
        separateBodies=($pa[0].bodyId -ne $pb[0].bodyId)
        overlappingConnections=(@($samples | Where-Object { @($_.connections).Count -ge 2 }).Count -gt 0)
        aSeesB=($a.people.entityId -contains $pb[0].entityId)
        bSeesA=($b.people.entityId -contains $pa[0].entityId)
    }
    $report.checks=$checks; $report.worldId=$a.worldId; $report.people=@($pa[0].entityId,$pb[0].entityId)
    $report.passed=@($checks.Values | Where-Object { !$_ }).Count -eq 0
    if (!$report.passed) { throw 'Native pair checks failed; see report' }
} catch { $report.error=$_.ToString(); throw }
finally {
    foreach ($job in $jobs) { if (!$job.HasExited) { & taskkill /PID $job.Id /T /F | Out-Null } }
    $report.completedAt=[datetime]::UtcNow.ToString('o')
    $report | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $Out 'pair.json')
}
Write-Output "Native pair observation passed; images still require review: $Out"
