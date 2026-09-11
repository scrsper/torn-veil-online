param(
    [Parameter(Mandatory)][string]$Probe,
    [Parameter(Mandatory)][string]$Output,
    [string]$FFmpeg = 'ffmpeg',
    [double]$LeadSeconds = .25,
    [double]$DurationSeconds = 2.0
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
Set-Location -LiteralPath $repo
$data = Get-Content -LiteralPath $Probe -Raw | ConvertFrom-Json
$preparation = @($data.samples | Where-Object event -EQ 'remote_preparation_observed')[0]
if (!$preparation) { throw 'Probe contains no observed preparation.' }
$first = $preparation.atMs - 1000 * $LeadSeconds
$last = $preparation.atMs + 1000 * $DurationSeconds
$frames = @($data.samples | Where-Object {
    $_.event -eq 'renderer_screenshot' -and $_.atMs -ge $first -and $_.atMs -le $last -and (Test-Path -LiteralPath $_.path)
})
if ($frames.Count -lt 2) { throw 'At least two captured renderer frames are required.' }
$folder = Join-Path $repo ('.debug/combat-video-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$lines = @('ffconcat version 1.0')
for ($i=0; $i -lt $frames.Count; $i++) {
    $name = 'frame-{0:D4}.png' -f $i
    Copy-Item -LiteralPath $frames[$i].path -Destination (Join-Path $folder $name)
    $lines += "file '$name'"
    if ($i -lt $frames.Count-1) {
        $duration = ($frames[$i+1].atMs-$frames[$i].atMs)/1000
        $lines += 'duration ' + $duration.ToString('F6',[Globalization.CultureInfo]::InvariantCulture)
    }
}
$lines += "file '$name'"
$concat = Join-Path $folder 'frames.ffconcat'
$lines | Set-Content -LiteralPath $concat
& $FFmpeg -y -safe 0 -f concat -i $concat -fps_mode vfr -c:v libx264 -pix_fmt yuv420p $Output
if ($LASTEXITCODE -ne 0) { throw 'Video encoding failed.' }
Write-Output "Encoded $($frames.Count) renderer frames with their recorded intervals to $Output."
Write-Output 'Renderer readback slows this capture; use a separate run for latency measurements.'
