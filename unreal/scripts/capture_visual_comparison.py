"""Capture the four fixed, projector-authored v0.4 comparison cameras."""
import os
import unreal

LEVEL = '/Game/TornVeil/Maps/Ashford'
CAMERAS = {
    'TV_Camera_Overview': 'village-overview.png',
    'TV_Camera_Street': 'street-ground.png',
    'TV_Camera_Market': 'market.png',
    'TV_Camera_Edge': 'village-edge.png',
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
    task = unreal.AutomationLibrary.take_high_res_screenshot(1280, 720, os.path.join(output, filename), camera=camera)
    if task is None:
        raise RuntimeError('Screenshot request failed for %s' % label)
    print('CAPTURE_REQUESTED %s' % filename)
