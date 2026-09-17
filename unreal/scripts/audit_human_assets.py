"""Focused human/animation inventory for Slice 3. NOT the full environment audit.

Reads the editor asset registry for humanoid characters, modular parts and the activity
animations the embodiment layer needs, records the SKELETON each one belongs to, and writes
`docs/evidence/embodied-people/human-asset-inventory.json`.

Run in the interactive editor (Run-EditorPython.ps1 / MCP execute_python). Read-only: it
imports nothing, saves nothing and modifies no package.

The skeleton is the point. A filename containing "shirt" tells you nothing about whether the
mesh can be worn by the driver character; the skeleton tells you whether it can share the
driver pose, needs an IK Retargeter, or cannot be used at all.
"""
import json
import os
import unreal

DRIVER_SKELETON = '/Game/Characters/Mannequins/Meshes/SK_Mannequin'

# Slot vocabulary the bridge emits (src/bridge/appearanceProfile.ts). Filename hints only
# propose a slot; the human running this decides, and the palette records the decision.
SLOT_HINTS = {
    'hair': ('hair', 'ponytail', 'braid', 'topknot'),
    'facialHair': ('beard', 'moustache', 'mustache', 'stubble'),
    'headwear': ('hat', 'hood', 'helm', 'cap', 'coif'),
    'torso': ('shirt', 'tunic', 'apron', 'vest', 'jerkin', 'gambeson', 'robe', 'coat', 'top', 'chest'),
    'legs': ('pants', 'trousers', 'legs', 'skirt', 'hose'),
    'feet': ('boot', 'shoe', 'sandal', 'feet'),
    'outerwear': ('cloak', 'cape', 'mantle', 'armor', 'armour', 'pauldron'),
    'accessory': ('bag', 'satchel', 'pack', 'belt', 'pouch', 'necklace'),
    'body': ('body', 'base', 'naked', 'skin', 'male', 'female', 'man', 'woman'),
    'head': ('head', 'face'),
}
# Activity families the presentation layer asks for (src/bridge/activityPresentation.ts).
ACTIVITY_HINTS = {
    'work': ('work', 'craft', 'forge', 'hammer', 'smith', 'saw', 'mine', 'chop', 'axe', 'dig', 'bake', 'knead'),
    'eat': ('eat', 'eating', 'meal', 'food'),
    'drink': ('drink', 'drinking', 'mug', 'tankard', 'sip'),
    'rest': ('sit', 'sitting', 'chair', 'sleep', 'lie', 'lying', 'rest', 'idle_relax', 'kneel', 'pray'),
    'socialize': ('talk', 'speak', 'converse', 'gesture', 'wave', 'greet', 'bow', 'laugh', 'shrug', 'explain', 'think', 'clap', 'point'),
    'trade': ('trade', 'barter', 'give', 'offer', 'hand'),
    'carry': ('carry', 'carrying', 'haul', 'lift', 'pickup', 'crate', 'sack'),
    'travel': ('walk', 'jog', 'run', 'sprint', 'stride'),
    'flee': ('flee', 'panic', 'scared', 'afraid', 'shrink'),
    'injured': ('injured', 'limp', 'wounded', 'hurt', 'death', 'die', 'downed', 'slump'),
}


def classify(name, hints):
    lowered = name.lower()
    for slot, needles in hints.items():
        if any(needle in lowered for needle in needles):
            return slot
    return None


def skeleton_of(asset_data):
    try:
        asset = asset_data.get_asset()
    except Exception:
        return None
    for attribute in ('skeleton',):
        try:
            value = asset.get_editor_property(attribute)
            if value:
                return value.get_path_name()
        except Exception:
            continue
    return None


registry = unreal.AssetRegistryHelpers.get_asset_registry()
registry.wait_for_completion()

report = {
    'driverSkeleton': DRIVER_SKELETON,
    'skeletalMeshes': [],
    'animations': [],
    'skeletons': {},
    'unclassified': {'meshes': 0, 'animations': 0},
}

for asset_data in registry.get_assets_by_class(unreal.TopLevelAssetPath('/Script/Engine', 'SkeletalMesh'), True):
    path = str(asset_data.package_name)
    name = str(asset_data.asset_name)
    skeleton = skeleton_of(asset_data)
    slot = classify(name, SLOT_HINTS)
    if slot is None:
        report['unclassified']['meshes'] += 1
    report['skeletalMeshes'].append({
        'name': name, 'path': path, 'skeleton': skeleton, 'proposedSlot': slot,
        'sharesDriverSkeleton': bool(skeleton and skeleton.startswith(DRIVER_SKELETON)),
    })
    if skeleton:
        report['skeletons'].setdefault(skeleton, {'meshes': 0, 'animations': 0})['meshes'] += 1

for class_name in ('AnimSequence', 'BlendSpace', 'BlendSpace1D'):
    for asset_data in registry.get_assets_by_class(unreal.TopLevelAssetPath('/Script/Engine', class_name), True):
        path = str(asset_data.package_name)
        name = str(asset_data.asset_name)
        skeleton = skeleton_of(asset_data)
        family = classify(name, ACTIVITY_HINTS)
        if family is None:
            report['unclassified']['animations'] += 1
        report['animations'].append({
            'name': name, 'path': path, 'class': class_name, 'skeleton': skeleton, 'proposedFamily': family,
            'sharesDriverSkeleton': bool(skeleton and skeleton.startswith(DRIVER_SKELETON)),
        })
        if skeleton:
            report['skeletons'].setdefault(skeleton, {'meshes': 0, 'animations': 0})['animations'] += 1

report['summary'] = {
    'skeletalMeshes': len(report['skeletalMeshes']),
    'animations': len(report['animations']),
    'skeletons': len(report['skeletons']),
    'meshesOnDriverSkeleton': sum(1 for m in report['skeletalMeshes'] if m['sharesDriverSkeleton']),
    'animationsOnDriverSkeleton': sum(1 for a in report['animations'] if a['sharesDriverSkeleton']),
    'familiesCovered': sorted({a['proposedFamily'] for a in report['animations'] if a['proposedFamily']}),
    'slotsCovered': sorted({m['proposedSlot'] for m in report['skeletalMeshes'] if m['proposedSlot']}),
}

root = os.path.abspath(os.path.join(unreal.Paths.project_dir(), '../..'))
folder = os.path.join(root, 'docs/evidence/embodied-people')
os.makedirs(folder, exist_ok=True)
destination = os.path.join(folder, 'human-asset-inventory.json')
with open(destination, 'w') as handle:
    json.dump(report, handle, indent=2, sort_keys=True)
print('HUMAN_ASSET_INVENTORY', json.dumps(report['summary']))
