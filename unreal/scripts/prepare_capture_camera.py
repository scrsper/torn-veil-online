"""Place the Foundry capture camera in the EDITOR world, then (re)start PIE.

Unreal's Python surface can only spawn actors into the editor world, and the PIE viewport is what
`take_high_res_screenshot` photographs. PIE duplicates the editor world at Play, so an actor placed
here exists in PIE and can then be moved freely by the capture script — which is the only way to
frame a shot without touching the possessed pawn, whose transform is canonical body state.

The camera is presentation-only and the level is never saved, so nothing is added to the project.
"""
import unreal

LABEL = 'TV_FoundryCapture'
levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

assert not levels.is_in_play_in_editor(), (
    'End PIE first (unreal/scripts/end_pie.py). editor_request_end_play only takes effect after '
    'the calling script returns, so ending and spawning cannot happen in one invocation.')

existing = [a for a in actors.get_all_level_actors()
            if isinstance(a, unreal.CameraActor) and a.get_actor_label().startswith(LABEL)]
if existing:
    camera = existing[0]
    print('TV_CAPTURE_CAMERA reused', camera.get_actor_label())
else:
    camera = actors.spawn_actor_from_class(unreal.CameraActor, unreal.Vector(0, 0, 3000))
    camera.set_actor_label(LABEL)
    camera.tags = ['TV.PresentationOnly', LABEL]
    print('TV_CAPTURE_CAMERA spawned', camera.get_actor_label())

levels.editor_request_begin_play()
print('TV_CAPTURE_CAMERA pie-restarted')
