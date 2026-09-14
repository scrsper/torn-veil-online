param([ValidatePattern('^[a-z0-9-]+$')][string]$CaptureLabel='playable-lit')
$ErrorActionPreference='Stop'
$repo=(Resolve-Path "$PSScriptRoot/../..").Path
$report="$repo/docs/evidence/foundational-gameplay/$CaptureLabel.json"
$started=[DateTime]::UtcNow
& "$PSScriptRoot/Invoke-EditorPython.ps1" -Script "$PSScriptRoot/verify_playable_pie.py" -CaptureLabel $CaptureLabel
# HTTP success does not prove remote Python succeeded. Demand fresh, completed evidence.
$deadline=$started.AddSeconds(55)
while([DateTime]::UtcNow -lt $deadline) {
    if((Test-Path -LiteralPath $report) -and (Get-Item -LiteralPath $report).LastWriteTimeUtc -ge $started) {
        $result=Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
        if($result.status -eq 'failed') { throw "PIE failed: $($result.error)" }
        if($result.status -eq 'passed') {
            if(!$result.renderedFrame.passed -or !$result.lighting.valid -or $result.lighting.viewMode -ne 'Lit') { throw 'Incomplete PIE evidence' }
            Write-Host "Lit PIE verified: $report"
            return
        }
    }
    Start-Sleep -Milliseconds 500
}
throw 'No fresh passing PIE capture. Start Play, wait for 9/9 regions, and inspect Saved/Logs/TornVeilOnline.log for the failed assertion.'
