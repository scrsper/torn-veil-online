param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9_-]+$')][string]$Profile,
    [Parameter(Mandatory=$true)][string]$Out,
    [string]$Executable = 'C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe',
    [ValidateRange(1,5)][int]$Shots = 1,
    [ValidateRange(640,3840)][int]$Width = 1920,
    [ValidateRange(480,2160)][int]$Height = 1080,
    [ValidateRange(0,300)][int]$ObserveSeconds = 0,
    [ValidateRange(30,600)][int]$TimeoutSeconds = 150
)
# Engine-native rendering only. Credentials are in an isolated client profile, not the command line.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
$Out = [IO.Path]::GetFullPath($Out)
if (Test-Path -LiteralPath $Out) { throw "Refusing to reuse capture evidence: $Out" }
New-Item -ItemType Directory -Path $Out | Out-Null
$env:TV_ALPHA_CAPTURE_DIR = $Out
$env:TV_ALPHA_CAPTURE_SHOTS = "$Shots"
$env:TV_ALPHA_CAPTURE_TIMEOUT = "$([Math]::Max(15, $TimeoutSeconds - 30))"
$env:TV_ALPHA_CAPTURE_OBSERVE_SECONDS = "$ObserveSeconds"
$arguments = @()
if ([IO.Path]::GetFileName($Executable) -like 'UnrealEditor*') {
    $arguments += '"' + (Join-Path $repo 'unreal/TornVeilOnline/TornVeilOnline.uproject') + '"'
    $arguments += @('/Game/TornVeil/Maps/TornVeilWorld','-game')
}
$arguments += @('-RenderOffscreen','-unattended','-nosplash','-nosound','-windowed','-ForceRes', ('-ResX='+$Width), ('-ResY='+$Height),
    ('-TVProfile='+$Profile), ('-abslog="'+(Join-Path $Out 'unreal.log')+'"'),
    '-ExecCmds="t.MaxFPS 60,t.IdleWhenNotForeground 0,TV.AlphaCapture"')
$start = [DateTime]::UtcNow
$job = Start-Process -FilePath $Executable -ArgumentList $arguments -WorkingDirectory $repo -WindowStyle Hidden -PassThru
Write-Output "Capture PID=$($job.Id) output=$Out timeout=${TimeoutSeconds}s"
if (!$job.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-Process -Id $job.Id -ErrorAction SilentlyContinue
    throw "Capture timed out: $Out"
}
if ($job.ExitCode -ne 0) { throw "Capture process failed ($($job.ExitCode)): $Out" }
$report = Join-Path $Out 'capture.json'
if (!(Test-Path -LiteralPath $report) -or (Get-Item -LiteralPath $report).LastWriteTimeUtc -lt $start) { throw "No fresh capture report: $Out" }
$result = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
if ($result.status -ne 'captured' -or $result.captures.Count -ne $Shots) { throw "Capture incomplete: $($result.error); $report" }
foreach ($capture in $result.captures) {
    if (!$capture.passed -or !(Test-Path -LiteralPath $capture.file) -or (Get-Item -LiteralPath $capture.file).LastWriteTimeUtc -lt $start) { throw "Missing/stale/unreadable frame: $($capture.file)" }
    $png = [IO.File]::ReadAllBytes($capture.file)
    $actualWidth = $png[16]*16777216 + $png[17]*65536 + $png[18]*256 + $png[19]
    $actualHeight = $png[20]*16777216 + $png[21]*65536 + $png[22]*256 + $png[23]
    if ($actualWidth -ne $Width -or $actualHeight -ne $Height) { throw "Wrong rendered resolution: ${actualWidth}x${actualHeight}; requested ${Width}x${Height}" }
}
Write-Output "Fresh rendered capture complete (image review still required): $report"
