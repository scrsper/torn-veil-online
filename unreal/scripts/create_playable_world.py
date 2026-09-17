"""Idempotent generic level setup; shares the ordinary PIE startup daylight contract."""
import unreal
path = '/Game/TornVeil/Maps/TornVeilWorld'
sub = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
if unreal.EditorAssetLibrary.does_asset_exist(path):
    if not sub.load_level(path):
        raise RuntimeError('Could not load ' + path)
else:
    if not sub.new_level(path):
        raise RuntimeError('Could not create ' + path)
world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
error = unreal.TVPlayableLighting.ensure_daylight(world)
if error:
    raise RuntimeError(error)
if not unreal.GameplayStatics.get_all_actors_of_class(world, unreal.PlayerStart):
    unreal.get_editor_subsystem(unreal.EditorActorSubsystem).spawn_actor_from_class(
        unreal.PlayerStart, unreal.Vector(0, 0, 2000))
if not sub.save_current_level():
    raise RuntimeError('Could not save ' + path)
print('PLAYABLE_WORLD_LEVEL_READY', path)
