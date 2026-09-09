"""Capture fixed projector-authored comparison cameras in an interactive editor.

UE 5.8's AutomationEditorTask can stall on a HISM-authored editor world. For reproducible
evidence, regenerate once with TV_CAPTURE_UNBATCHED=1, capture the identical transforms and
materials, then regenerate normally so the committed map retains HISM performance.
"""
import os
import unreal

LEVEL = '/Game/TornVeil/Maps/Ashford'
CAMERAS = {
    'TV_Camera_Overview': 'village-overview.png',
    'TV_Camera_Street': 'street-ground.png',
    'TV_Camera_Market': 'market.png',
    'TV_Camera_Edge': 'village-edge.png',
    'TV_Camera_CloseDwelling': 'close-dwelling.png',
    'TV_Camera_CloseWorkshop': 'close-workshop.png',
}

levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
levels.load_level(LEVEL)
repo = os.path.abspath(os.path.join(unreal.Paths.project_dir(), '..', '..'))
capture_set = globals().get('CAPTURE_SET', 'unreal-v0-5/after')
output = os.path.join(repo, 'docs', 'screenshots', *capture_set.split('/'))
os.makedirs(output, exist_ok=True)
by_label = {actor.get_actor_label(): actor for actor in actors.get_all_level_actors()}
capture_only = globals().get('CAPTURE_ONLY')
for label, filename in CAMERAS.items():
    if capture_only and label != capture_only:
        continue
    camera = by_label.get(label)
    if camera is None:
        raise RuntimeError('Missing fixed comparison camera %s; regenerate the settlement first.' % label)
    target = os.path.join(output, filename).replace('\\', '/')
    # Retain the asynchronous task across remote-Python command completion. Running this helper
    # in a commandlet is unsupported by UE 5.8; use the interactive editor capture path.
    globals()['TV_SCREENSHOT_TASK'] = unreal.AutomationLibrary.take_high_res_screenshot(1280, 720, target, camera=camera)
    print('CAPTURE_REQUESTED %s' % filename)
