"""Five CC0 nature meshes; shared presentation materials, no canonical content creation."""
import unreal, os
root=os.path.abspath(os.path.join(unreal.Paths.project_dir(),'../..','.debug/playable-assets/QuaterniusNature'))
tools=unreal.AssetToolsHelpers.get_asset_tools(); lib=unreal.EditorAssetLibrary
for name,color in [('Foliage',unreal.LinearColor(.09,.22,.045,1)),('Bark',unreal.LinearColor(.12,.065,.025,1))]:
    path='/Game/TornVeil/Materials/M_TV_Nature'+name
    m=unreal.load_asset(path) if lib.does_asset_exist(path) else tools.create_asset('M_TV_Nature'+name,'/Game/TornVeil/Materials',unreal.Material,unreal.MaterialFactoryNew())
    m.set_editor_property('used_with_instanced_static_meshes',True)
    unreal.MaterialEditingLibrary.delete_all_material_expressions(m)
    node=unreal.MaterialEditingLibrary.create_material_expression(m,unreal.MaterialExpressionConstant3Vector); node.constant=color
    unreal.MaterialEditingLibrary.connect_material_property(node,'',unreal.MaterialProperty.MP_BASE_COLOR)
    unreal.MaterialEditingLibrary.recompile_material(m); lib.save_loaded_asset(m)
for file in sorted(os.listdir(root)):
    task=unreal.AssetImportTask(); task.filename=os.path.join(root,file); task.destination_path='/Game/ThirdParty/Quaternius/Nature'; task.automated=True; task.save=True; task.replace_existing=True
    options=unreal.FbxImportUI(); options.import_mesh=True; options.import_as_skeletal=False; options.import_materials=False; options.import_textures=False; options.static_mesh_import_data.combine_meshes=True; options.static_mesh_import_data.auto_generate_collision=False; task.options=options
    tools.import_asset_tasks([task]); mesh=unreal.load_asset(task.imported_object_paths[0])
    for i,slot in enumerate(mesh.get_editor_property('static_materials')):
        label=str(slot.material_slot_name).lower()
        material='M_TV_PH_Stone' if 'rock' in file.lower() else 'M_TV_NatureBark' if any(k in label for k in ['trunk','bark','wood','brown']) else 'M_TV_NatureFoliage'
        mesh.set_material(i,unreal.load_asset('/Game/TornVeil/Materials/'+material))
    lib.save_loaded_asset(mesh)
    print('NATURE_MESH_READY',file,[str(s.material_slot_name) for s in mesh.get_editor_property('static_materials')],mesh.get_bounding_box())
