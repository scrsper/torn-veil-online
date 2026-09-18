"""Author every pose adapter this machine's installed character families need, in one editor run.

Each family's mode is chosen from measured reference-pose distance, not from bone-name overlap
(see `.debug/character-foundry/city-compatibility.json`, produced by probe_city_compatibility.py):

  Polytope  SK_Mannequin            84/87 shared bones differ, worst 9.7cm  -> IK retarget
  City body metahuman_base_skel     79/80 differ, worst 6.6cm               -> IK retarget
  City cloth SK_Base                38/150 differ vs the body, worst 1.3cm  -> Copy Pose from body
  City face Face_Archetype_Skeleton  5/32 differ vs the body, worst 5.9cm   -> Copy Pose from body
  Quantum   SK_Military_Character   3/89 differ vs the driver, worst 1.3cm  -> Copy Pose from driver

Copy Pose and IK both read the ATTACHED PARENT component, so which one is correct depends on what
a part hangs off: the visible body hangs off the hidden Manny driver, and every other part hangs
off the visible body. A rig that is close to its own parent copies; one that is far retargets.

Run headlessly: unreal/scripts/Run-EditorPython.ps1 -Script unreal/scripts/build_all_pose_adapters.py
"""
import json
import os
import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
BUILDER = os.path.join(HERE, 'build_character_retarget.py')

# (representative mesh, pose mode, adapter name). The mesh only names the rig; the adapter is
# registered against that mesh's skeleton, so any mesh on the rig would do.
FAMILIES = [
    ('/Game/Polytope_Studio/Modular_Armors/Meshes/Sets/SK_Male_Armor_cloth_00', 'ik', 'ABP_TV_Polytope_Retarget'),
    ('/Game/CitySampleCrowd/Character/Female/NormalWeight/Meshes/f_tal_nrw_body', 'ik', 'ABP_TV_CityBody_Retarget'),
    ('/Game/CitySampleCrowd/Character/Female/NormalWeight/Meshes/f_tal_nrw_scoopneck', 'copy', 'ABP_TV_CityCloth_CopyPose'),
    ('/Game/CitySampleCrowd/Character/Female/f_001/Face/f_001_nrw_FaceMesh', 'copy', 'ABP_TV_CityFace_CopyPose'),
    ('/Game/QuantumCharacter/Mesh/SKM_QuantumCharacter', 'copy', 'ABP_TV_Quantum_CopyPose'),
]


def main():
    source = open(BUILDER, encoding='utf-8').read()
    results = []
    for mesh, mode, adapter in FAMILIES:
        scope = {
            '__name__': 'tv_retarget_batch',
            'TV_TARGET_SKELETAL_MESH': mesh,
            'TV_POSE_MODE': mode,
            'TV_ANIMATION_BLUEPRINT': '/Game/TornVeil/Characters/Retarget/' + adapter,
        }
        try:
            exec(compile(source, BUILDER, 'exec'), scope)
            skeleton = scope['skeleton_path'].split('.')[0]
            results.append({'mesh': mesh, 'mode': mode, 'adapter': adapter, 'skeleton': skeleton,
                            'status': 'CONFIGURED',
                            'paletteArg': '%s=%s' % (skeleton, scope['blueprint'].get_path_name() + '_C')})
            print('TV_ADAPTER_OK %s %s <- %s' % (adapter, mode, skeleton))
        except Exception as error:  # a family that cannot be adapted must not stop the others
            results.append({'mesh': mesh, 'mode': mode, 'adapter': adapter, 'status': 'FAILED',
                            'error': '%s: %s' % (type(error).__name__, error)})
            print('TV_ADAPTER_FAIL %s %s: %s' % (adapter, type(error).__name__, error))
        unreal.SystemLibrary.collect_garbage()

    folder = os.path.abspath(os.path.join(unreal.Paths.project_dir(), '../../.debug/character-foundry'))
    with open(os.path.join(folder, 'pose-adapters.json'), 'w', encoding='utf-8') as stream:
        json.dump({'adapters': results}, stream, indent=2)
    ok = [r for r in results if r['status'] == 'CONFIGURED']
    print('TV_ADAPTERS %d/%d configured' % (len(ok), len(results)))
    for row in ok:
        print('  --retarget "%s"' % row['paletteArg'])


if __name__ == '__main__':
    main()
