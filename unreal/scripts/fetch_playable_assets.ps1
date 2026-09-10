param([string]$Archive = '.debug/quaternius-standard.zip')
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
$root = Join-Path $repo '.debug/playable-assets'
New-Item -ItemType Directory -Force "$root/Quaternius", "$root/PolyHaven" | Out-Null
# Official free Standard download. No purchase/account, paid Pro/Source content or executables.
if (!(Test-Path -LiteralPath $Archive)) {
    $download = Invoke-RestMethod 'https://quaternius.itch.io/medieval-village-megakit/file/12563480' -Method Post
    Invoke-WebRequest $download.url -OutFile $Archive
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Archive))
$names = @('Wall_Plaster_Straight','Wall_Plaster_WoodGrid','Wall_Plaster_Window_Wide_Flat','Wall_Plaster_Door_Flat','Door_1_Flat','DoorFrame_Flat_WoodDark','Floor_WoodDark','Floor_Brick','Roof_Modular_RoundTiles','Roof_Wooden_2x1','Roof_Front_Brick4','Roof_Support2','Stairs_Exterior_Straight','Balcony_Simple_Straight')
try {
    foreach ($entry in $zip.Entries) {
        if (($entry.FullName -match '/FBX/' -and $names -contains [IO.Path]::GetFileNameWithoutExtension($entry.Name)) -or ($entry.FullName -match '/Textures/T_(Plaster|WoodTrim|RoundTiles|Brick)_(BaseColor|Normal)\.png$') -or $entry.Name -eq 'License_Standard.txt') {
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,"$root/Quaternius/$($entry.Name)",$true)
        }
    }
} finally { $zip.Dispose() }
$headers = @{ 'User-Agent' = 'TornVeilPrototype/0.1' }
foreach ($id in @('brown_mud_leaves_01','rock_boulder_dry')) {
    $asset = Invoke-RestMethod "https://api.polyhaven.com/files/$id" -Headers $headers
    foreach ($map in @('Diffuse','nor_dx','Rough')) {
        $file = $asset.$map.'1k'.jpg
        if ($file) { Invoke-WebRequest $file.url -OutFile "$root/PolyHaven/$([IO.Path]::GetFileName($file.url))" }
    }
}
$grass = Invoke-RestMethod 'https://api.polyhaven.com/files/grass_medium_01' -Headers $headers
Invoke-WebRequest $grass.fbx.'1k'.fbx.url -OutFile "$root/PolyHaven/grass_medium_01_1k.fbx"
foreach ($map in @('Diffuse','Alpha','nor_dx')) { $file=$grass.$map.'1k'.png; Invoke-WebRequest $file.url -OutFile "$root/PolyHaven/$([IO.Path]::GetFileName($file.url))" }
$natureArchive=Join-Path $repo '.debug/quaternius-nature.zip'
if (!(Test-Path $natureArchive)) { Invoke-WebRequest 'https://opengameart.org/sites/default/files/ultimate_nature_pack_by_quaternius_1.zip' -OutFile $natureArchive }
New-Item -ItemType Directory -Force "$root/QuaterniusNature" | Out-Null
$natureZip=[IO.Compression.ZipFile]::OpenRead($natureArchive)
try { foreach($entry in $natureZip.Entries) { if($entry.FullName -match '/FBX/' -and $entry.Name -in @('CommonTree_1.fbx','BirchTree_1.fbx','PineTree_1.fbx','Rock_1.fbx','Bush_1.fbx')) { [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,"$root/QuaterniusNature/$($entry.Name)",$true) } } } finally { $natureZip.Dispose() }
Get-ChildItem "$root/Quaternius", "$root/PolyHaven", "$root/QuaterniusNature" -File | Get-FileHash -Algorithm SHA256 | Select-Object Hash,@{n='File';e={Split-Path $_.Path -Leaf}} | ConvertTo-Json | Set-Content "$repo/unreal/ASSET_HASHES.json"
Write-Host 'Selected CC0 sources ready for import_playable_assets.py.'
