"""Set the skeletal-mesh usage flag on `M_TV_AshfordCloth` in a running editor, and save.

`import_ashford_garments.py` now sets this at build time. This exists so an editor that already
has the material loaded can be corrected without a full re-import, and so the flag can be
asserted rather than assumed: a material without it is assigned, compiles, reports nothing, and
silently renders as Epic's grey default on every skinned mesh.
"""
import unreal

PATH = '/Game/TornVeil/Materials/M_TV_AshfordCloth'

material = unreal.EditorAssetLibrary.load_asset(PATH)
if material is None:
    raise RuntimeError('missing %s' % PATH)
before = material.get_editor_property('used_with_skeletal_mesh')
material.set_editor_property('used_with_skeletal_mesh', True)
unreal.MaterialEditingLibrary.recompile_material(material)
unreal.EditorAssetLibrary.save_asset(PATH)
after = unreal.EditorAssetLibrary.load_asset(PATH).get_editor_property('used_with_skeletal_mesh')
print('TV_ASHFORD_USAGE before=%s after=%s' % (before, after))
if not after:
    raise RuntimeError('usage flag did not stick on %s' % PATH)
