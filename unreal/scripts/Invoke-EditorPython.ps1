param(
    [Parameter(Mandatory=$true)][string]$Script,
    [ValidatePattern('^[a-z0-9-]*$')][string]$CaptureLabel = ''
)
$ErrorActionPreference='Stop'
$path=(Resolve-Path -LiteralPath $Script).Path.Replace('\','/')
# Separate globals keep delayed Slate callbacks from observing a later script's variables.
$body=@{objectPath='/Script/Engine.Default__KismetSystemLibrary'; functionName='ExecuteConsoleCommand'; parameters=@{Command="py exec(open(r'$path', encoding='utf-8').read(), {'__name__':'__main__', 'TV_CAPTURE_LABEL':'$CaptureLabel'})"}} | ConvertTo-Json -Depth 4
Invoke-RestMethod 'http://127.0.0.1:30010/remote/object/call' -Method Put -ContentType 'application/json' -Body $body -TimeoutSec 30 | Out-Null
