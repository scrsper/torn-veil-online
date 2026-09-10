param([Parameter(Mandatory=$true)][string]$Script)
$ErrorActionPreference='Stop'
$path=(Resolve-Path -LiteralPath $Script).Path.Replace('\','/')
$body=@{objectPath='/Script/Engine.Default__KismetSystemLibrary'; functionName='ExecuteConsoleCommand'; parameters=@{Command="py exec(open(r'$path', encoding='utf-8').read())"}} | ConvertTo-Json -Depth 4
Invoke-RestMethod 'http://127.0.0.1:30010/remote/object/call' -Method Put -ContentType 'application/json' -Body $body | Out-Null
