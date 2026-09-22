"""Answer the City Sample runtime questions the catalogue cannot: which rigs the modular parts
actually share, how they differ from this project's Manny driver, and what each part costs.

Run headlessly (unreal/scripts/Run-EditorPython.ps1). Read-only; writes local evidence to
`.debug/character-foundry/city-compatibility.json`.

A shared bone NAME is not a shared rig. Leader Pose requires the identical USkeleton object; a
proportion-aware adapter requires comparable reference transforms. Both are measured here.
"""
import json
import os
import unreal

DRIVER = '/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple'
# One representative of every City Sample part kind, plus the two Polytope/Quantum anchors the
# hybrid combinations would need. Probing all 135 crowd meshes would dump 892-bone faces for no
# extra answer: parts within a folder share a rig by construction, so one sample settles it.
SAMPLES = [
    '/Game/CitySampleCrowd/Character/Female/NormalWeight/Meshes/f_tal_nrw_base',
    '/Game/CitySampleCrowd/Character/Female/NormalWeight/Meshes/f_tal_nrw_body',
    '/Game/CitySampleCrowd/Character/Female/NormalWeight/Meshes/f_tal_nrw_scoopneck',
    '/Game/CitySampleCrowd/Character/Female/NormalWeight/Meshes/f_tal_nrw_skirt',
    '/Game/CitySampleCrowd/Character/Female/NormalWeight/Meshes/f_tal_nrw_dressFlats',
    '/Game/CitySampleCrowd/Character/Female/f_001/Face/f_001_nrw_FaceMesh',
    '/Game/CitySampleCrowd/Character/Male/NormalWeight/Meshes/m_tal_nrw_body',
    '/Game/CitySampleCrowd/Character/Male/m_001/Face/m_001_nrw_FaceMesh',
    '/Game/Polytope_Studio/Modular_Armors/Meshes/Sets/SK_Male_Armor_cloth_00',
    '/Game/Polytope_Studio/Modular_Armors/Meshes/Sets/SK_Female_Armor_cloth_00',
    '/Game/Polytope_Studio/Modular_Armors/Meshes/Separate_Parts/SK_Female_Armor_head_01',
    '/Game/QuantumCharacter/Mesh/SKM_QuantumCharacter',
    '/Game/QuantumCharacter/Mesh/Modules/SKM_Head',
    DRIVER,
]


def rig(mesh):
    component = unreal.SkeletalMeshComponent()
    component.set_skeletal_mesh_asset(mesh)
    out = {}
    for index in range(component.get_num_bones()):
        name = str(component.get_bone_name(index))
        transform = component.get_ref_pose_transform(index)
        out[name] = {
            'parent': str(component.get_parent_bone(name)),
            'position': [transform.translation.x, transform.translation.y, transform.translation.z],
            'rotation': [transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w],
        }
    return out


def compare(actual, expected):
    """Shared-bone reference-pose delta. Rotation uses |dot| because q and -q are one rotation."""
    shared = sorted(actual.keys() & expected.keys())
    worst, differing, parent_mismatch = 0.0, 0, 0
    for name in shared:
        a, b = actual[name], expected[name]
        error = sum((x - y) ** 2 for x, y in zip(a['position'], b['position'])) ** .5
        dot = abs(sum(x * y for x, y in zip(a['rotation'], b['rotation'])))
        if a['parent'] != b['parent']:
            parent_mismatch += 1
        if error > .01 or dot < .99999 or a['parent'] != b['parent']:
            differing += 1
        worst = max(worst, error)
    return {'sharedBones': len(shared), 'differingBones': differing,
            'parentMismatches': parent_mismatch, 'worstPositionErrorCm': round(worst, 4)}


def main():
    driver_mesh = unreal.load_asset(DRIVER)
    driver = rig(driver_mesh)
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    rigs, rows = {}, []
    for path in SAMPLES:
        mesh = unreal.load_asset(path)
        if not mesh:
            rows.append({'package': path, 'error': 'missing'})
            continue
        bones = rig(mesh)
        skeleton = mesh.skeleton.get_path_name().split('.')[0]
        rigs.setdefault(skeleton, bones)
        data = registry.get_asset_by_object_path(path + '.' + path.rsplit('/', 1)[-1])
        bounds = mesh.get_imported_bounds()
        rows.append({
            'package': path,
            'skeleton': skeleton,
            'boneCount': len(bones),
            'triangles': data.get_tag_value('Triangles') if data else None,
            'lods': data.get_tag_value('LODs') if data else None,
            'materialSlots': [str(m.material_slot_name) for m in mesh.materials],
            'materials': [str(m.material_interface.get_path_name()) if m.material_interface else None for m in mesh.materials],
            'morphs': len(mesh.get_all_morph_target_names()),
            'heightCm': round(2 * bounds.box_extent.z, 1),
            'vsDriver': compare(bones, driver),
            'bonesNotInDriver': len(bones.keys() - driver.keys()),
        })
        unreal.SystemLibrary.collect_garbage()

    # Cross-rig comparison: the question "can one Leader Pose drive body + clothes + face" is
    # answered by whether those rigs are the same asset, and failing that how far apart they sit.
    names = sorted(rigs)
    cross = [{'a': a, 'b': b, **compare(rigs[a], rigs[b])}
             for i, a in enumerate(names) for b in names[i + 1:]]

    folder = os.path.abspath(os.path.join(unreal.Paths.project_dir(), '../../.debug/character-foundry'))
    with open(os.path.join(folder, 'city-compatibility.json'), 'w', encoding='utf-8') as stream:
        json.dump({'driver': DRIVER, 'meshes': rows, 'rigPairs': cross}, stream, indent=2)
    print('TV_CITY_PROBE meshes=%d rigs=%d' % (len(rows), len(rigs)))
    for row in rows:
        if 'error' in row:
            print('  MISSING', row['package'])
            continue
        print('  %-62s rig=%-28s bones=%-4d tris=%-8s h=%scm' % (
            row['package'].rsplit('/', 1)[-1], row['skeleton'].rsplit('/', 1)[-1],
            row['boneCount'], row['triangles'], row['heightCm']))
    for pair in cross:
        print('  PAIR %s <-> %s shared=%d differing=%d parentMismatch=%d worstCm=%s' % (
            pair['a'].rsplit('/', 1)[-1], pair['b'].rsplit('/', 1)[-1],
            pair['sharedBones'], pair['differingBones'], pair['parentMismatches'], pair['worstPositionErrorCm']))


if __name__ == '__main__':
    main()
