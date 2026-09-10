"""A single generic presentation level. No seed, settlement footprint or NPC is baked in."""
import unreal
path = '/Game/TornVeil/Maps/TornVeilWorld'
sub = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
if unreal.EditorAssetLibrary.does_asset_exist(path):
    sub.load_level(path)
    # Rebuild only this generic level's global infrastructure; repeat runs cannot double lights.
    for actor in actors.get_all_level_actors():
        if isinstance(actor,(unreal.DirectionalLight,unreal.SkyLight,unreal.SkyAtmosphere,unreal.ExponentialHeightFog,unreal.PlayerStart,unreal.PostProcessVolume)):
            actors.destroy_actor(actor)
else:
    sub.new_level(path)
sun = actors.spawn_actor_from_class(unreal.DirectionalLight, unreal.Vector(0,0,1000), unreal.Rotator(pitch=-45,yaw=-35,roll=0))
sun.light_component.set_editor_property('intensity', 12000.)
sun.light_component.set_editor_property('mobility', unreal.ComponentMobility.MOVABLE)
sun.light_component.set_editor_property('atmosphere_sun_light', True)
sky = actors.spawn_actor_from_class(unreal.SkyLight, unreal.Vector(0,0,1000))
sky.light_component.set_editor_property('mobility', unreal.ComponentMobility.MOVABLE)
sky.light_component.set_editor_property('real_time_capture', True)
actors.spawn_actor_from_class(unreal.SkyAtmosphere, unreal.Vector())
fog = actors.spawn_actor_from_class(unreal.ExponentialHeightFog, unreal.Vector(0,0,-1000))
fog.component.set_editor_property('fog_density', .008)
actors.spawn_actor_from_class(unreal.PlayerStart, unreal.Vector(0,0,2000))
pp = actors.spawn_actor_from_class(unreal.PostProcessVolume, unreal.Vector())
pp.set_editor_property('unbound', True)
settings = pp.settings
settings.set_editor_property('override_auto_exposure_min_brightness', True)
settings.set_editor_property('override_auto_exposure_max_brightness', True)
settings.set_editor_property('auto_exposure_min_brightness', 12.)
settings.set_editor_property('auto_exposure_max_brightness', 12.)
pp.settings = settings
sub.save_current_level()
print('PLAYABLE_WORLD_LEVEL_READY', path)
