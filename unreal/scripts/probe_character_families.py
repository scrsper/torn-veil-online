"""Read installed character mesh costs and reference-pose compatibility; save local evidence.

Bone-name overlap alone is not an animation compatibility certificate. This report compares
parents and local reference transforms to the actual Manny driver and records every exception.
"""
import json
import os
import unreal

ROOTS = ['/Game/Polytope_Studio', '/Game/QuantumCharacter']
DRIVER = '/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple'


def rig(mesh):
    component = unreal.SkeletalMeshComponent()
    component.set_skeletal_mesh_asset(mesh)
    result = {}
    for index in range(component.get_num_bones()):
        name = component.get_bone_name(index)
        transform = component.get_ref_pose_transform(index)
        result[str(name)] = {
            'parent': str(component.get_parent_bone(name)),
            'position': [transform.translation.x, transform.translation.y, transform.translation.z],
            'rotation': [transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w],
            'scale': [transform.scale3d.x, transform.scale3d.y, transform.scale3d.z],
        }
    return result


def main():
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    driver = rig(unreal.load_asset(DRIVER))
    rows = []
    for root in ROOTS:
        for asset in registry.get_assets_by_path(root, True):
            if str(asset.asset_class_path.asset_name) != 'SkeletalMesh':
                continue
            mesh = asset.get_asset()
            bones = rig(mesh)
            differences = []
            for name in sorted(bones.keys() & driver.keys()):
                actual, expected = bones[name], driver[name]
                position_error = sum((a-b)**2 for a,b in zip(actual['position'], expected['position']))**.5
                # q and -q describe the same rotation.
                dot = abs(sum(a*b for a,b in zip(actual['rotation'], expected['rotation'])))
                if actual['parent'] != expected['parent'] or position_error > .01 or dot < .99999:
                    differences.append({'bone': name, 'parentMatches': actual['parent'] == expected['parent'],
                                        'positionErrorCm': round(position_error, 5), 'rotationDot': round(dot, 7)})
            bounds = mesh.get_imported_bounds()
            rows.append({'package': str(asset.package_name), 'skeleton': mesh.skeleton.get_path_name().split('.')[0],
                         'triangles': asset.get_tag_value('Triangles'), 'vertices': asset.get_tag_value('Vertices'),
                         'lods': asset.get_tag_value('LODs'),
                         'materials': [str(m.material_interface.get_path_name()) if m.material_interface else None for m in mesh.materials],
                         'materialSlots': [str(m.material_slot_name) for m in mesh.materials],
                         'morphs': [str(n) for n in mesh.get_all_morph_target_names()],
                         'bounds': {'minZ': bounds.origin.z-bounds.box_extent.z, 'maxZ': bounds.origin.z+bounds.box_extent.z},
                         'boneCount': len(bones), 'bonesMissingFromDriver': sorted(bones.keys()-driver.keys()),
                         'sharedBoneDifferences': differences})
    folder = os.path.abspath(os.path.join(unreal.Paths.project_dir(), '../../.debug/character-foundry'))
    with open(os.path.join(folder, 'installed-families.json'), 'w', encoding='utf-8') as stream:
        json.dump({'driver': DRIVER, 'meshes': rows}, stream, indent=2)
    print('TV_FAMILY_PROBE', len(rows), 'meshes')


if __name__ == '__main__':
    main()
