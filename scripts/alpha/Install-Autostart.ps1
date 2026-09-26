param(
    [Parameter(Mandatory=$true)][string]$AlphaRoot,
    [ValidateSet('dev','staging','live')][string]$Environment = 'live',
    [ValidateSet('Logon','Boot')][string]$Trigger = 'Logon',
    [string]$NodeRuntime = '',
    [switch]$CheckOnly
)
# Register only after choosing the deployment environment. CheckOnly performs no writes.
$ErrorActionPreference = 'Stop'
$alphaPath = (Resolve-Path -LiteralPath $AlphaRoot).Path
$environmentPath = Join-Path $alphaPath $Environment
$configFile = Join-Path $environmentPath 'config.json'
$releaseFile = Join-Path $environmentPath 'current-release.json'
if (!(Test-Path -LiteralPath $configFile) -or !(Test-Path -LiteralPath $releaseFile)) { throw 'Initialize and install the chosen environment first.' }
$config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
if ($config.env -ne $Environment) { throw 'Environment config does not match the requested environment.' }
$release = Get-Content -LiteralPath $releaseFile -Raw | ConvertFrom-Json
if (!(Test-Path -LiteralPath (Join-Path $release.dir 'ops.mjs'))) { throw 'Installed release has no operator entry point.' }
$sourceNode = if ($NodeRuntime) { (Resolve-Path -LiteralPath $NodeRuntime).Path } else { (Get-Command node -CommandType Application | Select-Object -First 1).Source }
& $sourceNode --version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Chosen Node runtime cannot execute.' }
$nodeHash = (Get-FileHash -LiteralPath $sourceNode -Algorithm SHA256).Hash
$nodeExe = Join-Path $alphaPath ('runtime/node-' + $nodeHash.Substring(0,12) + '.exe')
# The installed task must survive replacement of an agent's bundled shell/runtime.
$shellExe = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
if (!(Test-Path -LiteralPath $shellExe)) { throw 'Windows PowerShell task host not found.' }
$userName = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$elevated = ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($environmentPath))).Substring(0,10)
$taskName = "TornVeil-$Environment-$hash"
$runner = Join-Path $environmentPath 'start-installed-release.ps1'
if ($CheckOnly) {
    [ordered]@{ taskName=$taskName; environment=$environmentPath; trigger=$Trigger; user=$userName; requiresElevation=($Trigger -eq 'Boot' -and !$elevated); node=$nodeExe; runner=$runner; installedRelease=$release.version } | ConvertTo-Json
    return
}
if ($Trigger -eq 'Boot' -and !$elevated) { throw 'Boot startup requires an elevated PowerShell session to register an S4U task. No task was changed.' }
New-Item -ItemType Directory -Force -Path (Split-Path $nodeExe) | Out-Null
if (!(Test-Path -LiteralPath $nodeExe)) { Copy-Item -LiteralPath $sourceNode -Destination $nodeExe }
if ((Get-FileHash -LiteralPath $nodeExe -Algorithm SHA256).Hash -ne $nodeHash) { throw 'Installed task runtime hash mismatch.' }
$runnerText = @'
$ErrorActionPreference = 'Stop'
$env:TORN_VEIL_ALPHA_HOME = '__ROOT__'
$installed = Get-Content -LiteralPath (Join-Path $env:TORN_VEIL_ALPHA_HOME '__ENV__/current-release.json') -Raw | ConvertFrom-Json
& '__NODE__' (Join-Path $installed.dir 'ops.mjs') start --env __ENV__
exit $LASTEXITCODE
'@
$runnerText = $runnerText.Replace('__ROOT__', $alphaPath.Replace("'", "''")).Replace('__ENV__', $Environment).Replace('__NODE__', $nodeExe.Replace("'", "''"))
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $runner + '"'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and ($existing.Actions.Execute -ne $shellExe -or $existing.Actions.Arguments -ne $arguments)) { throw "Refusing to replace unrelated task $taskName" }
[IO.File]::WriteAllText($runner, $runnerText)
$action = New-ScheduledTaskAction -Execute $shellExe -Argument $arguments -WorkingDirectory $env:SystemRoot
if ($Trigger -eq 'Boot') {
    $when = New-ScheduledTaskTrigger -AtStartup
    $when.Delay = 'PT30S'
    $principal = New-ScheduledTaskPrincipal -UserId $userName -LogonType S4U -RunLevel Limited
} else {
    $when = New-ScheduledTaskTrigger -AtLogOn -User $userName
    $principal = New-ScheduledTaskPrincipal -UserId $userName -LogonType Interactive -RunLevel Limited
}
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $when -Principal $principal -Settings $settings -Description "Start the installed Torn Veil $Environment release; existing world only." -Force | Out-Null
Write-Output "Registered $taskName ($Trigger); no service was restarted. Inspect with Get-ScheduledTask -TaskName '$taskName'."
