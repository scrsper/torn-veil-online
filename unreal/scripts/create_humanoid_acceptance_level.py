"""Create the isolated presentation of humanoidFixtureServer's canonical stone patch."""
import unreal
LEVEL = '/Game/TornVeil/Tests/Humanoid/L_HumanoidAcceptance'
levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
assert not levels.is_in_play_in_editor(), 'End PIE before creating the test level'
assert levels.new_level_from_template(LEVEL, '/Game/TornVeil/Maps/TornVeilWorld')
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
floor = actors.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(450, 450, 50))
floor.set_actor_label('CanonicalFixture_StonePatch_8to36')
floor.static_mesh_component.set_static_mesh(unreal.load_asset('/Engine/BasicShapes/Cube'))
floor.set_actor_scale3d(unreal.Vector(29, 29, 1))
floor.static_mesh_component.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
floor.tags = ['TV.PresentationOnly', 'TV.HumanoidAcceptance.CanonicalStonePatch']
assert levels.save_current_level()
print('HUMANOID_TEST_LEVEL', LEVEL)
