"""Make the TornVeil character materials usable on skeletal meshes, and prove they take a Tint.

`UTVCharacterPresentation` pushes canonical skin/garment colour into a `Tint` parameter. Two things
have to be true for that to be visible, and neither is checked anywhere else:

  * the material must declare `Tint` -- a parameter a material does not declare is a silent no-op,
    which is how canonical colour can be computed, sent over the bridge and then quietly dropped;
  * the material must have `bUsedWithSkeletalMesh`, or Unreal swaps in the default material at
    runtime and every character renders identically regardless of what the Foundry chose.

Run in the editor. Read-mostly: it only sets the usage flag when it is missing, and reports.

    Run-EditorPython.ps1 -Script unreal/scripts/configure_character_materials.py
"""
import json
import os

import unreal

MATERIALS = ['M_TV_CharacterSkin', 'M_TV_CharacterCloth', 'M_TV_CharacterHair', 'M_TV_CharacterProp']

library = unreal.EditorAssetLibrary
report = {'materials': {}, 'changed': 0, 'missingTint': []}

for name in MATERIALS:
    path = '/Game/TornVeil/Materials/%s.%s' % (name, name)
    material = unreal.load_asset(path)
    if not material:
        report['materials'][name] = {'error': 'not found'}
        continue
    row = {'path': path}
    try:
        row['vector'] = [str(p) for p in unreal.MaterialEditingLibrary.get_vector_parameter_names(material)]
    except Exception as exc:
        row['vector'], row['vectorError'] = [], str(exc)
    if 'Tint' not in row['vector']:
        report['missingTint'].append(name)
    if not material.get_editor_property('used_with_skeletal_mesh'):
        material.set_editor_property('used_with_skeletal_mesh', True)
        unreal.MaterialEditingLibrary.recompile_material(material)
        library.save_loaded_asset(material)
        row['setUsedWithSkeletalMesh'] = True
        report['changed'] += 1
    else:
        row['setUsedWithSkeletalMesh'] = False
    row['usedWithSkeletalMesh'] = bool(material.get_editor_property('used_with_skeletal_mesh'))
    report['materials'][name] = row

root = os.path.abspath(os.path.join(unreal.Paths.project_dir(), '../..'))
folder = os.path.join(root, '.debug', 'foundry-real-people')
os.makedirs(folder, exist_ok=True)
with open(os.path.join(folder, 'character-materials.json'), 'w', encoding='utf-8') as stream:
    json.dump(report, stream, indent=2)
print('TV_CHARACTER_MATERIALS', json.dumps({'changed': report['changed'], 'missingTint': report['missingTint']}))
