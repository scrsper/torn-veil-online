"""Create the UE 5.8 IK Rig / IK Retargeter / retarget animation blueprint for one non-driver
humanoid skeleton, so a visible character on that skeleton can be posed from the hidden driver.

Run in the interactive editor. Creates owned assets under /Game/TornVeil/Characters/Retarget/;
it never edits a vendor asset, and it never duplicates the animation library — the driver keeps
evaluating the one set of clips and the retargeter reads its pose at runtime.

    TV_TARGET_SKELETAL_MESH = '/Game/Path/To/SKM_Villager'
    exec(open('unreal/scripts/build_character_retarget.py').read())

The editor-only TV.BuildPoseAdapter command authors the graph through Unreal's C++ graph API.
Set TV_POSE_MODE='copy' only after inspecting reference-pose compatibility. Defaults to IK.
CONFIGURED means the graph compiled, not that motion/appearance passed visual acceptance.
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


def bone_names(mesh):
    component = unreal.SkeletalMeshComponent()
    component.set_skeletal_mesh_asset(mesh)
    return {str(component.get_bone_name(i)) for i in range(component.get_num_bones())}


def make_rig(name, mesh):
    path = f'{ROOT}/{name}'
    rig = library.load_asset(path) if library.does_asset_exist(path) else \
        tools.create_asset(name, ROOT, unreal.IKRigDefinition, unreal.IKRigDefinitionFactory())
    controller = unreal.IKRigController.get_controller(rig)
    controller.set_skeletal_mesh(mesh)
    missing = []
    if not controller.apply_auto_generated_retarget_definition():
        names = bone_names(mesh)
        for chain, start, end in CHAINS:
            if chain == 'Spine' and 'spine_05' in names:
                end = 'spine_05'
            if start not in names or end not in names:
                missing.append({'chain': chain, 'error': 'missing endpoint'})
                continue
            controller.add_retarget_chain(chain, start, end, '')
        controller.set_retarget_root('pelvis')
    library.save_asset(path)
    return rig, path, missing


target_name = target_mesh.get_name()
copy_mode = globals().get('TV_POSE_MODE', 'ik') == 'copy'
source_path = target_rig_path = retarget_path = None
source_missing, target_missing = [], []
if not copy_mode:
    source_rig, source_path, source_missing = make_rig('IK_TV_Driver', driver_mesh)
    target_rig, target_rig_path, target_missing = make_rig(f'IK_TV_{target_name}', target_mesh)
    retarget_name = f'RTG_TV_{target_name}'
    retarget_path = f'{ROOT}/{retarget_name}'
    retargeter = library.load_asset(retarget_path) if library.does_asset_exist(retarget_path) else \
        tools.create_asset(retarget_name, ROOT, unreal.IKRetargeter, unreal.IKRetargetFactory())
    retarget_controller = unreal.IKRetargeterController.get_controller(retargeter)
    retarget_controller.set_ik_rig(unreal.RetargetSourceOrTarget.SOURCE, source_rig)
    retarget_controller.set_ik_rig(unreal.RetargetSourceOrTarget.TARGET, target_rig)
    retarget_controller.remove_all_ops()
    retarget_controller.add_default_ops()
    retarget_controller.auto_map_chains(unreal.AutoMapChainType.EXACT, True)
    retarget_controller.auto_align_all_bones(unreal.RetargetSourceOrTarget.TARGET)
    library.save_asset(retarget_path)

blueprint_name = f'ABP_TV_{target_name}_' + ('CopyPose' if copy_mode else 'Retarget')
blueprint_path = globals().get('TV_ANIMATION_BLUEPRINT', f'{ROOT}/{blueprint_name}')
assert blueprint_path.startswith(ROOT + '/'), 'Only owned Foundry adapters may be authored'
if not library.does_asset_exist(blueprint_path):
    factory = unreal.AnimBlueprintFactory()
    factory.set_editor_property('target_skeleton', target_mesh.skeleton)
    factory.set_editor_property('parent_class', unreal.AnimInstance)
    tools.create_asset(blueprint_path.rsplit('/', 1)[1], blueprint_path.rsplit('/', 1)[0], unreal.AnimBlueprint, factory)
blueprint = library.load_asset(blueprint_path)
node_class = unreal.AnimGraphNode_CopyPoseFromMesh if copy_mode else unreal.AnimGraphNode_RetargetPoseFromMesh
def adapter_nodes():
    return [node for node in unreal.ObjectIterator(node_class)
            if node.get_outer().get_outer() == blueprint]
if not adapter_nodes():
    unreal.SystemLibrary.execute_console_command(None,
        f'TV.BuildPoseAdapter {blueprint_path} ' + ('CopyPose' if copy_mode else retarget_path))
assert len(adapter_nodes()) == 1, 'Pose adapter graph was not authored; build the editor module first'
assert blueprint.get_editor_property('status') == unreal.BlueprintStatus.BS_UP_TO_DATE, 'Pose graph did not compile cleanly'
library.save_loaded_asset(blueprint)

skeleton_path = target_mesh.get_editor_property('skeleton').get_path_name()
report = {
    'targetMesh': target_path,
    'targetSkeleton': skeleton_path,
    'sourceIKRig': source_path,
    'targetIKRig': target_rig_path,
    'retargeter': retarget_path,
    'chainErrors': {'driver': source_missing, 'target': target_missing},
    'animationBlueprint': blueprint_path,
    'mode': 'copy' if copy_mode else 'ik',
    'status': 'CONFIGURED',
    'visualAcceptance': 'pending PIE',
    'thenRun': (
        f'python3 unreal/scripts/build_character_palette.py --retarget '
        f'"{skeleton_path}={blueprint.get_path_name()}_C"'),
}

root = os.path.abspath(os.path.join(unreal.Paths.project_dir(), '../..'))
folder = os.path.join(root, '.debug/character-foundry')
os.makedirs(folder, exist_ok=True)
with open(os.path.join(folder, f'retarget-{target_name}.json'), 'w') as handle:
    json.dump(report, handle, indent=2, sort_keys=True)
print('CHARACTER_RETARGET_CONFIGURED', json.dumps(report))
