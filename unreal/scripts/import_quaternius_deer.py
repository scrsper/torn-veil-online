"""Import the verified Quaternius CC0 deer as presentation-only assets.

This script intentionally imports no Blueprint, controller, navigation or gameplay asset. It is
reproducible from the ignored .debug download and writes a small provenance manifest beside the
project assets. Run only in the Unreal Editor after the lead grants exclusive asset-writer access.
"""
import hashlib, json, os
import unreal

ROOT = os.path.abspath(os.path.join(unreal.Paths.project_dir(), '../..'))
SOURCE = os.path.join(ROOT, '.debug', 'ultimate-animated-animals', 'Deer.fbx')
LICENSE = os.path.join(ROOT, '.debug', 'ultimate-animated-animals', 'License.txt')
DEST = '/Game/TornVeil/Wildlife/Deer'
EXPECTED = {
    'Deer.fbx': 'B79F07AC3FD702AB98F5D1B606168618A318F10F57028AAAEFD420C468BE2618',
    'License.txt': '83D8959F9FC56353ED571FBE2DC52E4BCD64508E2399501CD45AC2CE3DF0BF8C',
}

def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest().upper()

assert os.path.isfile(SOURCE), 'Missing .debug/ultimate-animated-animals/Deer.fbx'
assert os.path.isfile(LICENSE), 'Missing .debug/ultimate-animated-animals/License.txt'
assert sha256(SOURCE) == EXPECTED['Deer.fbx'], 'Deer source hash changed; refuse import'
assert sha256(LICENSE) == EXPECTED['License.txt'], 'License source hash changed; refuse import'
assert 'CC0 1.0' in open(LICENSE, encoding='utf-8').read(), 'Expected CC0 license text not found'

tools = unreal.AssetToolsHelpers.get_asset_tools()
task = unreal.AssetImportTask()
task.filename = SOURCE
task.destination_path = DEST
task.automated = True
task.save = True
task.replace_existing = True
options = unreal.FbxImportUI()
options.import_mesh = True
options.import_as_skeletal = True
options.import_animations = True
options.import_materials = True
options.import_textures = True
options.mesh_type_to_import = unreal.FBXImportType.FBXIT_SKELETAL_MESH
options.skeletal_mesh_import_data.import_morph_targets = False
options.skeletal_mesh_import_data.update_skeleton_reference_pose = False
options.animation_length = unreal.FBXAnimationLengthImportType.FBXALIT_EXPORTED_TIME
task.options = options
tools.import_asset_tasks([task])

# Keep source-driven imports reproducible while giving the runtime stable, semantic names.
# The FBX importer derives names from the vendor armature; no gameplay asset is created here.
rename_pairs = {
    'Deer': 'SKM_Deer',
    'DeerAnimalArmature_Idle': 'AN_Deer_Idle',
    'DeerAnimalArmature_Idle_2': 'AN_Deer_Idle_2',
    'DeerAnimalArmature_Idle_Headlow': 'AN_Deer_Idle_Headlow',
    'DeerAnimalArmature_Walk': 'AN_Deer_Walk',
    'DeerAnimalArmature_Gallop': 'AN_Deer_Gallop',
    'DeerAnimalArmature_Eating': 'AN_Deer_Eating',
    'DeerAnimalArmature_Death': 'AN_Deer_Death',
    'DeerAnimalArmature_Idle_HitReact_Left': 'AN_Deer_Idle_HitReact1',
}
for source_name, destination_name in rename_pairs.items():
    source_path = DEST + '/' + source_name
    destination_path = DEST + '/' + destination_name
    if unreal.EditorAssetLibrary.does_asset_exist(source_path):
        unreal.EditorAssetLibrary.rename_asset(source_path, destination_path)

paths = [DEST + '/' + name + '.' + name for name in ['SKM_Deer', 'AN_Deer_Idle', 'AN_Deer_Idle_2',
    'AN_Deer_Idle_Headlow', 'AN_Deer_Walk', 'AN_Deer_Gallop', 'AN_Deer_Eating', 'AN_Deer_Death',
    'AN_Deer_Idle_HitReact1'] if unreal.EditorAssetLibrary.does_asset_exist(DEST + '/' + name)]
manifest = {
    'source': 'Quaternius Ultimate Animated Animal Pack / Deer.fbx',
    'sourceUrl': 'https://drive.google.com/drive/folders/1uJ3N5HfB7jKTseJUNQr3N4YaN0UuEtHk',
    'license': 'CC0-1.0',
    'licenseUrl': 'https://creativecommons.org/publicdomain/zero/1.0/',
    'sourceSha256': EXPECTED['Deer.fbx'],
    'licenseSha256': EXPECTED['License.txt'],
    'importedObjectPaths': paths,
    'canonicalSpecies': 'roe_deer',
    'speciesFit': 'Stylized deer approximation; not zoologically exact roe deer.',
    'authority': 'TypeScript canonical wildlife body; Unreal presentation only.',
    'vendorAIImported': False,
    'clipFallbacks': {'drink': 'Idle_Headlow', 'rest': 'Idle_Headlow', 'sleep': 'Idle_Headlow'},
}
out = os.path.join(ROOT, 'unreal', 'TornVeilOnline', 'Content', 'TornVeil', 'Wildlife', 'DeerProvenance.json')
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, 'w', encoding='utf-8') as stream:
    json.dump(manifest, stream, indent=2)
print('TV_DEER_IMPORT', json.dumps(manifest, sort_keys=True))
