"""Import the selected CC0 sources; wrapper materials preserve third-party source assets.
Run after fetch_playable_assets.ps1. No settlement placement is authored here.
"""
import unreal, os, json, hashlib
ROOT = os.path.abspath(os.path.join(unreal.Paths.project_dir(), '../..'))
SOURCE = os.path.join(ROOT, '.debug/playable-assets')
tools = unreal.AssetToolsHelpers.get_asset_tools()
library = unreal.EditorAssetLibrary

def load(path):
    return unreal.load_asset(path)

def import_one(filename, destination, mesh=False):
    task = unreal.AssetImportTask()
    task.filename = filename
    task.destination_path = destination
    task.automated = True
    task.save = True
    task.replace_existing = True
    if mesh:
        options = unreal.FbxImportUI()
        options.import_mesh = True
        options.import_as_skeletal = False
        options.import_materials = False
        options.import_textures = False
        options.mesh_type_to_import = unreal.FBXImportType.FBXIT_STATIC_MESH
        options.static_mesh_import_data.combine_meshes = True
        options.static_mesh_import_data.auto_generate_collision = False
        task.options = options
    tools.import_asset_tasks([task])
    if not task.imported_object_paths:
        raise RuntimeError('Import failed: ' + filename)
    return load(task.imported_object_paths[0])

for source, destination in [('Quaternius', '/Game/ThirdParty/Quaternius'), ('PolyHaven', '/Game/ThirdParty/PolyHaven')]:
    for filename in sorted(os.listdir(os.path.join(SOURCE, source))):
        ext = os.path.splitext(filename)[1].lower()
        if ext not in ['.fbx', '.png', '.jpg']:
            continue
        obj = import_one(os.path.join(SOURCE, source, filename), destination + ('/Meshes' if ext == '.fbx' else '/Textures'), ext == '.fbx')
        if isinstance(obj, unreal.Texture):
            obj.set_editor_property('max_texture_size', 1024)
            if 'Normal' in filename or 'nor_dx' in filename:
                obj.set_editor_property('srgb', False)
                obj.set_editor_property('compression_settings', unreal.TextureCompressionSettings.TC_NORMALMAP)
            library.save_loaded_asset(obj)

def material(name, diffuse, normal=None):
    folder = '/Game/TornVeil/Materials'
    m = load(folder + '/' + name) if library.does_asset_exist(folder + '/' + name) else tools.create_asset(name, folder, unreal.Material, unreal.MaterialFactoryNew())
    m.set_editor_property('used_with_instanced_static_meshes',True)
    unreal.MaterialEditingLibrary.delete_all_material_expressions(m)
    for tex, prop, normal_map in [(diffuse, unreal.MaterialProperty.MP_BASE_COLOR, False), (normal, unreal.MaterialProperty.MP_NORMAL, True)]:
        if not tex:
            continue
        node = unreal.MaterialEditingLibrary.create_material_expression(m, unreal.MaterialExpressionTextureSample)
        node.texture = load(tex)
        if not node.texture:
            raise RuntimeError('Missing texture: ' + tex)
        if normal_map:
            node.sampler_type = unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL
        unreal.MaterialEditingLibrary.connect_material_property(node, 'RGB', prop)
    rough = unreal.MaterialEditingLibrary.create_material_expression(m, unreal.MaterialExpressionConstant)
    rough.r = .85
    unreal.MaterialEditingLibrary.connect_material_property(rough, '', unreal.MaterialProperty.MP_ROUGHNESS)
    unreal.MaterialEditingLibrary.recompile_material(m)
    library.save_loaded_asset(m)
    return m

qt = '/Game/ThirdParty/Quaternius/Textures/'
mats = {family: material('M_TV_Q_' + family, qt + 'T_' + family + '_BaseColor', qt + 'T_' + family + '_Normal') for family in ['Plaster', 'WoodTrim', 'RoundTiles', 'Brick']}
ph = '/Game/ThirdParty/PolyHaven/Textures/'
material('M_TV_PH_Soil', ph + 'brown_mud_leaves_01_diff_1k', ph + 'brown_mud_leaves_01_nor_dx_1k')
material('M_TV_PH_Stone', ph + 'rock_boulder_dry_diff_1k', ph + 'rock_boulder_dry_nor_dx_1k')

# Material slots are wrappers over original kit meshes; no mesh vertex/UV edits.
manifest = []
for path in library.list_assets('/Game/ThirdParty/Quaternius/Meshes', recursive=True):
    mesh = load(path)
    if not isinstance(mesh, unreal.StaticMesh):
        continue
    slots = mesh.get_editor_property('static_materials')
    for i, slot in enumerate(slots):
        name = str(slot.material_slot_name).lower()
        family = 'RoundTiles' if 'tile' in name else 'Plaster' if 'plaster' in name else 'Brick' if 'brick' in name else 'WoodTrim'
        mesh.set_material(i, mats[family])
    library.save_loaded_asset(mesh)
    box = mesh.get_bounding_box()
    manifest.append({'asset': path, 'min': [box.min.x, box.min.y, box.min.z], 'max': [box.max.x, box.max.y, box.max.z], 'slots': [str(s.material_slot_name) for s in slots]})
out = os.path.join(ROOT, 'unreal/TornVeilOnline/Content/TornVeil/Presentation/PlayableAssets.json')
with open(out, 'w') as f:
    json.dump({'version': 1, 'culture': 'regional-prototype', 'source': 'Quaternius Medieval Village MegaKit Standard', 'license': 'CC0-1.0', 'meshes': manifest}, f, indent=2)
print('PLAYABLE_ASSETS_READY', len(manifest))
