"""Interrogate the Ashford garments as PIE actually has them, not as the AssetRegistry lists them.

The registry in an editor that was already open when the import ran does not list the new folder,
and `load_asset` on it returns nothing -- while the same packages load perfectly by path at
runtime. So the reliable place to ask whether the vertex-colour region masks survived the import,
and what material each part is really drawing with, is the live component.
"""
import json

import unreal

worlds = unreal.EditorLevelLibrary.get_pie_worlds(False)
assert worlds, 'PIE must be running'
world = worlds[0]

seen = set()
for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.TVCharacter):
    visible = actor.get_component_by_class(unreal.TVCharacterPresentation)
    if not visible:
        continue
    for child in visible.get_children_components(True):
        if not isinstance(child, unreal.SkeletalMeshComponent):
            continue
        mesh = child.get_skeletal_mesh_asset()
        if not mesh:
            continue
        path = mesh.get_path_name().split('.')[0]
        if '/Characters/Ashford/' not in path or path in seen:
            continue
        seen.add(path)
        applied = child.get_material(0)
        parent = None
        if isinstance(applied, unreal.MaterialInstanceDynamic):
            parent = applied.get_editor_property('parent')
        tint = accent = wear = None
        if applied:
            found, value = applied.get_vector_parameter_value('Tint'), None
            tint = str(found)
            accent = str(applied.get_vector_parameter_value('Accent'))
            wear = applied.get_scalar_parameter_value('Wear')
        # Neither `has_vertex_colors` nor `skeletal_mesh_import_data` is Python-exposed on
        # SkeletalMesh in this engine version, so the mask cannot be read from the asset here.
        # The material parameters can, and they answer the more urgent question: whether the
        # per-person tint is reaching the shader at all.
        print('TV_RT %-44s mat=%s parent=%s'
              % (path.rsplit('/', 1)[-1],
                 applied.get_name() if applied else None,
                 parent.get_path_name() if parent else None))
        print('       tint=%s accent=%s wear=%s' % (tint, accent, wear))
        if len(seen) >= 5:
            break
    if len(seen) >= 5:
        break
print('TV_RT_DONE inspected=%d' % len(seen))
