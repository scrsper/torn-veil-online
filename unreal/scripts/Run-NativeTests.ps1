param(
    [string]$Tests = 'TornVeil.Embodiment',
    [string]$Engine = 'C:\Program Files\Epic Games\UE_5.8',
    [string]$Out = '',
    [ValidateRange(1,3600)][int]$TimeoutSeconds = 180
)
# Native non-visual regression only. This deliberately does not claim rendered acceptance.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
if ($Tests -notmatch '^[A-Za-z0-9_.+]+$') { throw 'Tests must be a native automation filter.' }
if (!$Out) { $Out = Join-Path $repo ('.debug/unreal/native-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) }
$Out = [IO.Path]::GetFullPath($Out)
if (Test-Path -LiteralPath $Out) { throw "Refusing to reuse test evidence directory: $Out" }
New-Item -ItemType Directory -Path $Out | Out-Null
$project = Join-Path $repo 'unreal/TornVeilOnline/TornVeilOnline.uproject'
$arguments = @('"'+$project+'"', '-unattended', '-nullrhi', '-nosplash', '-nosound',
    '-ExecCmds="Automation RunTests '+$Tests+'"', '-TestExit="Automation Test Queue Empty"',
    '-ReportExportPath="'+$Out+'"', '-abslog="'+(Join-Path $Out 'unreal.log')+'"')
$job = Start-Process -FilePath "$Engine/Engine/Binaries/Win64/UnrealEditor-Cmd.exe" -ArgumentList $arguments -WindowStyle Hidden -PassThru
Write-Output "Native tests PID=$($job.Id) output=$Out timeout=${TimeoutSeconds}s"
if (!$job.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-Process -Id $job.Id -ErrorAction SilentlyContinue
    throw "Native tests timed out: $Out"
}
if ($job.ExitCode -ne 0) { throw "Native process failed ($($job.ExitCode)): $Out" }
$report = Join-Path $Out 'index.json'
if (!(Test-Path -LiteralPath $report)) { throw "No native test report: $Out" }
$result = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
if ($result.failed -gt 0 -or $result.notRun -gt 0 -or ($result.succeeded + $result.succeededWithWarnings) -lt 1) {
    throw "Native tests failed or did not run: $report"
}
[ordered]@{ passed=$result.succeeded; warnings=$result.succeededWithWarnings; failed=$result.failed; report=$report } | ConvertTo-Json
