"""Measure what the Character Foundry actually put on screen, per visible body.

Read-only PIE telemetry for Stage C/D acceptance. Spawns nothing, moves nothing, possesses nothing
and writes no canonical state -- it reads `ATVCharacter::PresentationDiagnostics` and the
presentation component, both of which are themselves read-only.

The diversity numbers here deliberately count what a *viewer* can tell apart -- mesh, tint, scale --
rather than what the resolver believed it chose. A population can resolve ten distinct
configurations and still look like ten identical people if every difference lands in a slot that no
installed asset fills, and that difference is the whole question this slice has to answer honestly.

    Run-EditorPython.ps1 -Script unreal/scripts/probe_foundry_population.py
"""
import json
import os

import unreal

CAMERA_KEY = 'TV_FRAME'


def diagnostics(actor):
    try:
        return json.loads(actor.presentation_diagnostics())
    except Exception:
        return {}


def main():
    worlds = unreal.EditorLevelLibrary.get_pie_worlds(False)
    out = {'pie': bool(worlds), 'bodies': []}
    if not worlds:
        out['error'] = 'no PIE world; Play in Editor is not running'
    else:
        world = worlds[0]
        for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.TVCharacter):
            diag = diagnostics(actor)
            location = actor.get_actor_location()
            row = {
                'actor': actor.get_name(),
                'bodyId': diag.get('bodyId'),
                'entityId': diag.get('entityId'),
                'possessed': diag.get('possessed'),
                'activityFamily': diag.get('activityFamily'),
                'activityDetail': diag.get('activityDetail'),
                'activityPosture': diag.get('activityPosture'),
                'stationKind': diag.get('stationKind'),
                'occupancyOffsetCm': diag.get('occupancyOffsetCm'),
                'appearanceSignature': diag.get('appearanceSignature'),
                'pose': diag.get('pose'),
                'animation': diag.get('animation'),
                'x': location.x, 'y': location.y, 'z': location.z,
                'visibleCharacter': False,
            }
            for component in actor.get_components_by_class(unreal.TVCharacterPresentation):
                row['visibleCharacter'] = bool(component.has_visible_character())
                try:
                    row['embodiment'] = json.loads(component.embodiment_diagnostics())
                except Exception:
                    row['embodiment'] = {}
                mesh = component.get_skeletal_mesh_asset()
                row['mesh'] = mesh.get_path_name() if mesh else None
                try:
                    scale = component.get_editor_property('relative_scale3d')
                    row['scale'] = [round(scale.x, 4), round(scale.y, 4), round(scale.z, 4)]
                except Exception:
                    row['scale'] = None
                # The tint is the only individuality channel a machine without garment content has,
                # so it is measured from the live material instance rather than trusted from the
                # profile that requested it.
                tints = []
                for index in range(component.get_num_materials()):
                    material = component.get_material(index)
                    if isinstance(material, unreal.MaterialInstanceDynamic):
                        try:
                            colour = material.get_vector_parameter_value('Tint')
                            tints.append([round(colour.r, 4), round(colour.g, 4), round(colour.b, 4)])
                        except Exception:
                            pass
                row['tints'] = tints
                row['materialName'] = (component.get_material(0).get_name()
                                       if component.get_num_materials() else None)
            out['bodies'].append(row)

    visible = [b for b in out['bodies'] if b['visibleCharacter']]
    signature = lambda b: '%s|%s|%s' % (b.get('mesh'), b.get('scale'), b.get('tints'))
    out['metrics'] = {
        'actors': len(out['bodies']),
        'visible': len(visible),
        'unembodied': len(out['bodies']) - len(visible),
        'distinctMeshes': len({b.get('mesh') for b in visible}),
        'distinctScales': len({str(b.get('scale')) for b in visible}),
        'distinctTints': len({str(b.get('tints')) for b in visible}),
        'distinctVisibleConfigurations': len({signature(b) for b in visible}),
        'distinctAppearanceSignatures': len({b.get('appearanceSignature') for b in visible}),
        'activities': sorted({b.get('activityFamily') for b in out['bodies'] if b.get('activityFamily')}),
        'foundryIncomplete': sum(1 for b in visible if not (b.get('embodiment') or {}).get('foundryComplete')),
        'retargeted': sum(1 for b in visible if (b.get('embodiment') or {}).get('retargeted')),
    }

    root = os.path.abspath(os.path.join(unreal.Paths.project_dir(), '../..'))
    folder = os.path.join(root, '.debug', 'foundry-real-people')
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, 'population.json'), 'w', encoding='utf-8') as stream:
        json.dump(out, stream, indent=2)
    print('TV_POPULATION', json.dumps(out['metrics']))


main()
