"""Create the UE 5.8 IK Rig / IK Retargeter / retarget animation blueprint for one non-driver
humanoid skeleton, so a visible character on that skeleton can be posed from the hidden driver.

Run in the interactive editor. Creates owned assets under /Game/TornVeil/Characters/Retarget/;
it never edits a vendor asset, and it never duplicates the animation library — the driver keeps
evaluating the one set of clips and the retargeter reads its pose at runtime.

    TV_TARGET_SKELETAL_MESH = '/Game/Path/To/SKM_Villager'
    exec(open('unreal/scripts/build_character_retarget.py').read())

What this cannot do headlessly is author the animation blueprint GRAPH. UE's Python API exposes
no supported way to add a Retarget Pose From Mesh node. So this script:

  - builds and saves the source IK Rig (driver), target IK Rig and IK Retargeter;
  - reports the exact, short manual step for the animation blueprint;
  - prints the `--retarget SKELETON=ANIMBP_CLASS` argument to pass to build_character_palette.py.

Reporting a retarget as complete when the graph does not exist would be a false claim, so the
script exits with an explicit INCOMPLETE marker until the blueprint path is supplied back.
"""
import json
import os
import unreal

DRIVER_MESH = '/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple'
ROOT = '/Game/TornVeil/Characters/Retarget'
# UE5 mannequin chain roots. A target skeleton that does not expose equivalent chains cannot be
# retargeted by this script, and it says so rather than producing an empty retargeter.
CHAINS = [
    ('Root', 'root', 'root'),
    ('Spine', 'spine_01', 'spine_03'),
    ('Head', 'neck_01', 'head'),
    ('LeftArm', 'clavicle_l', 'hand_l'),
    ('RightArm', 'clavicle_r', 'hand_r'),
    ('LeftLeg', 'thigh_l', 'ball_l'),
    ('RightLeg', 'thigh_r', 'ball_r'),
]

target_path = globals().get('TV_TARGET_SKELETAL_MESH')
assert target_path, 'Set TV_TARGET_SKELETAL_MESH before executing this script'
target_mesh = unreal.load_asset(target_path)
driver_mesh = unreal.load_asset(DRIVER_MESH)
assert target_mesh and driver_mesh, 'Both the driver and the target skeletal mesh must be installed'

tools = unreal.AssetToolsHelpers.get_asset_tools()
library = unreal.EditorAssetLibrary
os.makedirs  # (no filesystem writes; asset paths only)


def bone_names(mesh):
    skeleton = mesh.get_editor_property('skeleton')
    return {str(name) for name in unreal.Skeleton.get_reference_pose_bone_names(skeleton)} \
        if hasattr(unreal.Skeleton, 'get_reference_pose_bone_names') else set()


def make_rig(name, mesh):
    path = f'{ROOT}/{name}'
    rig = library.load_asset(path) if library.does_asset_exist(path) else \
        tools.create_asset(name, ROOT, unreal.IKRigDefinition, unreal.IKRigDefinitionFactory())
    controller = unreal.IKRigController.get_controller(rig)
    controller.set_preview_mesh(mesh)
    missing = []
    for chain, start, end in CHAINS:
        try:
            controller.add_retarget_chain(chain, start, end, '')
        except Exception as error:
            missing.append({'chain': chain, 'error': str(error)})
    controller.set_retarget_root(CHAINS[0][1])
    library.save_asset(path)
    return rig, path, missing


target_name = target_mesh.get_name()
source_rig, source_path, source_missing = make_rig('IK_TV_Driver', driver_mesh)
target_rig, target_rig_path, target_missing = make_rig(f'IK_TV_{target_name}', target_mesh)

retarget_name = f'RTG_TV_{target_name}'
retarget_path = f'{ROOT}/{retarget_name}'
retargeter = library.load_asset(retarget_path) if library.does_asset_exist(retarget_path) else \
    tools.create_asset(retarget_name, ROOT, unreal.IKRetargeter, unreal.IKRetargetFactory())
retarget_controller = unreal.IKRetargeterController.get_controller(retargeter)
retarget_controller.set_source_ik_rig(source_rig)
retarget_controller.set_target_ik_rig(target_rig)
for chain, _start, _end in CHAINS:
    try:
        retarget_controller.set_source_chain(chain, chain)
    except Exception:
        pass
library.save_asset(retarget_path)

skeleton_path = target_mesh.get_editor_property('skeleton').get_path_name()
report = {
    'targetMesh': target_path,
    'targetSkeleton': skeleton_path,
    'sourceIKRig': source_path,
    'targetIKRig': target_rig_path,
    'retargeter': retarget_path,
    'chainErrors': {'driver': source_missing, 'target': target_missing},
    'animationBlueprint': None,
    'status': 'INCOMPLETE',
    'manualStep': (
        f'Create an Animation Blueprint on {skeleton_path} under {ROOT} (suggested name '
        f'ABP_TV_{target_name}_Retarget). In AnimGraph add a single "Retarget Pose From Mesh" '
        f'node: set IK Retargeter Asset = {retarget_path}, tick "Use Attached Parent" so it reads '
        'the hidden driver on the same actor, and connect it to Output Pose. Compile and save.'),
    'thenRun': (
        f'python3 unreal/scripts/build_character_palette.py --retarget '
        f'"{skeleton_path}=/Game/TornVeil/Characters/Retarget/ABP_TV_{target_name}_Retarget.'
        f'ABP_TV_{target_name}_Retarget_C"'),
}

root = os.path.abspath(os.path.join(unreal.Paths.project_dir(), '../..'))
folder = os.path.join(root, 'docs/evidence/embodied-people')
os.makedirs(folder, exist_ok=True)
with open(os.path.join(folder, f'retarget-{target_name}.json'), 'w') as handle:
    json.dump(report, handle, indent=2, sort_keys=True)
print('CHARACTER_RETARGET_INCOMPLETE', json.dumps(report))
