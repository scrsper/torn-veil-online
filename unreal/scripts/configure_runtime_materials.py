"""Shared wrapper materials must compile their ISM shader permutations before PIE/cook."""
import unreal
lib=unreal.EditorAssetLibrary
count=0
for path in lib.list_assets('/Game/TornVeil/Materials',recursive=True):
    m=unreal.load_asset(path)
    if isinstance(m,unreal.Material) and not m.get_editor_property('used_with_instanced_static_meshes'):
        m.set_editor_property('used_with_instanced_static_meshes',True)
        unreal.MaterialEditingLibrary.recompile_material(m); lib.save_loaded_asset(m); count+=1
print('RUNTIME_MATERIALS_READY',count)
