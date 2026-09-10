"""Import one CC0 Poly Haven grass cluster for non-authoritative PCG instancing."""
import unreal, os
root=os.path.abspath(os.path.join(unreal.Paths.project_dir(),'../..','.debug/playable-assets/PolyHaven'))
tools=unreal.AssetToolsHelpers.get_asset_tools()
for file in ['grass_medium_01_1k.fbx','grass_medium_01_diff_1k.png','grass_medium_01_alpha_1k.png','grass_medium_01_nor_dx_1k.png']:
    task=unreal.AssetImportTask(); task.filename=os.path.join(root,file); task.destination_path='/Game/ThirdParty/PolyHaven/'+('Meshes' if file.endswith('fbx') else 'Textures'); task.automated=True; task.save=True; task.replace_existing=True
    if file.endswith('fbx'):
        options=unreal.FbxImportUI(); options.import_mesh=True; options.import_as_skeletal=False; options.import_materials=False; options.import_textures=False; options.static_mesh_import_data.combine_meshes=True; options.static_mesh_import_data.auto_generate_collision=False; task.options=options
    tools.import_asset_tasks([task])
    if not task.imported_object_paths: raise RuntimeError(file)
folder='/Game/TornVeil/Materials'; name='M_TV_PH_Grass'; path=folder+'/'+name
m=unreal.load_asset(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else tools.create_asset(name,folder,unreal.Material,unreal.MaterialFactoryNew())
m.set_editor_property('blend_mode',unreal.BlendMode.BLEND_MASKED); m.set_editor_property('two_sided',True)
m.set_editor_property('used_with_instanced_static_meshes',True)
unreal.MaterialEditingLibrary.delete_all_material_expressions(m)
for suffix,prop in [('diff',unreal.MaterialProperty.MP_BASE_COLOR),('alpha',unreal.MaterialProperty.MP_OPACITY_MASK),('nor_dx',unreal.MaterialProperty.MP_NORMAL)]:
    tex=unreal.load_asset('/Game/ThirdParty/PolyHaven/Textures/grass_medium_01_'+suffix+'_1k'); tex.set_editor_property('max_texture_size',1024)
    if suffix=='nor_dx': tex.set_editor_property('srgb',False); tex.set_editor_property('compression_settings',unreal.TextureCompressionSettings.TC_NORMALMAP)
    unreal.EditorAssetLibrary.save_loaded_asset(tex)
    node=unreal.MaterialEditingLibrary.create_material_expression(m,unreal.MaterialExpressionTextureSample); node.texture=tex
    if suffix=='nor_dx': node.sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL
    unreal.MaterialEditingLibrary.connect_material_property(node,'R' if suffix=='alpha' else 'RGB',prop)
unreal.MaterialEditingLibrary.recompile_material(m); unreal.EditorAssetLibrary.save_loaded_asset(m)
mesh=unreal.load_asset('/Game/ThirdParty/PolyHaven/Meshes/grass_medium_01_1k')
for i in range(len(mesh.get_editor_property('static_materials'))): mesh.set_material(i,m)
unreal.EditorAssetLibrary.save_loaded_asset(mesh)
print('PLAYABLE_GRASS_READY',mesh.get_bounding_box())
