param(
    [Parameter(Mandatory=$true)][string]$BatchFile,
    [Parameter(Mandatory=$true)][string[]]$Arguments,
    [Parameter(Mandatory=$true)][string]$LogPath,
    [ValidateRange(1,14400)][int]$TimeoutSeconds = 3600
)
# Build.bat/RunUAT.bat spawn tool chains. A timeout terminates only this invocation's tree.
$ErrorActionPreference = 'Stop'
$LogPath = [IO.Path]::GetFullPath($LogPath)
if (Test-Path -LiteralPath $LogPath) { throw "Refusing to overwrite build evidence: $LogPath" }
New-Item -ItemType Directory -Force ([IO.Path]::GetDirectoryName($LogPath)) | Out-Null
$started = [DateTime]::UtcNow
$job = Start-Process -FilePath $env:ComSpec -ArgumentList ('/d /s /c ""'+$BatchFile+'" '+($Arguments -join ' ')+'"') `
    -RedirectStandardOutput $LogPath -RedirectStandardError ($LogPath+'.stderr') -WindowStyle Hidden -PassThru
Write-Output "Build PID=$($job.Id) log=$LogPath timeout=${TimeoutSeconds}s"
$completed = $job.WaitForExit($TimeoutSeconds * 1000)
if (!$completed) {
    # taskkill /T follows the known build PID; no name-wide process termination.
    $cleanup = Start-Process -FilePath "$env:SystemRoot/System32/taskkill.exe" -ArgumentList @('/PID',"$($job.Id)",'/T','/F') -WindowStyle Hidden -Wait -PassThru
}
$result = @{ pid=$job.Id; startedAt=$started.ToString('o'); finishedAt=[DateTime]::UtcNow.ToString('o'); timedOut=!$completed; exitCode=if($completed){$job.ExitCode}else{$null}; log=$LogPath }
$result | ConvertTo-Json | Set-Content -LiteralPath ($LogPath+'.result.json')
if (!$completed) { throw "Build timed out after ${TimeoutSeconds}s: $LogPath" }
if ($job.ExitCode -ne 0) { throw "Build failed ($($job.ExitCode)): $LogPath" }
Write-Output "Build succeeded: $LogPath"
