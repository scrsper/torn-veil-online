"""Read-only, per-render-frame ordinary PIE telemetry; pair with external 60 fps video.

No input, relocation, spawning, screenshot readbacks, or canonical mutations. Set
TV_CAPTURE_LABEL / TV_CAPTURE_SECONDS before executing in the interactive editor.
"""
import json
import os
import time
import unreal

worlds = unreal.EditorLevelLibrary.get_pie_worlds(False)
assert len(worlds) == 1, 'Run ordinary Play in Editor first'
world = worlds[0]
assert world.get_name().endswith('TornVeilWorld'), 'Ordinary playable map required'
root = os.path.abspath(os.path.join(unreal.Paths.project_dir(), '../..'))
folder = os.path.join(root, '.debug/playable-life-slice1')
os.makedirs(folder, exist_ok=True)
label = globals().get('TV_CAPTURE_LABEL', 'ordinary-motion')
duration = min(60, max(1, globals().get('TV_CAPTURE_SECONDS', 16)))
started = time.perf_counter()
samples = []


def sample_life_frame(dt):
    age = time.perf_counter() - started
    characters = []
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.TVCharacter):
        state = json.loads(actor.presentation_diagnostics())
        mesh = actor.get_component_by_class(unreal.SkeletalMeshComponent)
        row = {key: state.get(key) for key in (
            'bodyId', 'entityId', 'possessed', 'position', 'pose', 'animation',
            'animationTime', 'speedCmPerSecond', 'blendSpeed', 'blendDirection',
            'presentationTransition', 'usingLocomotion', 'movementMode',
            'maxChoreographyActorDriftCm')}
        row['feetCm'] = []
        for bone in ('foot_l', 'foot_r'):
            point = mesh.get_socket_transform(bone, unreal.RelativeTransformSpace.RTS_COMPONENT).translation
            row['feetCm'].append([point.x, point.y, point.z])
        characters.append(row)
    samples.append({'seconds': age, 'frameSeconds': dt, 'characters': characters})
    if age >= duration:
        unreal.unregister_slate_post_tick_callback(life_capture_handle)
        output = os.path.join(folder, label + '.json')
        with open(output, 'w') as stream:
            json.dump({'map': world.get_path_name(), 'checkout': root,
                       'mode': 'ordinary PIE, read-only per-render-frame samples',
                       'samples': samples}, stream)
        print('LIFE_CAPTURE_COMPLETE', output, len(samples))


life_capture_handle = unreal.register_slate_post_tick_callback(sample_life_frame)
print('LIFE_CAPTURE_STARTED', label, duration)
