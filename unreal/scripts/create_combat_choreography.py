"""Owned, grounded single-strike primitives and isolated showcase. No vendor writes.

The sample attacks contain 0.9--1.5 m of root travel. Reuse their articulated
upper-body performance over the clip's planted guard base, then blend in runtime.
No arbitrary skeleton retarget or sample movement architecture is imported.
"""
import unreal, os, json

levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
assert not levels.is_in_play_in_editor()
folder = '/Game/TornVeil/Combat/Animations'
tools = unreal.AssetToolsHelpers.get_asset_tools()
idle = unreal.load_asset('/Game/Characters/Mannequins/Anims/Unarmed/MM_Idle')
source_root = '/Game/Characters/Mannequins/Anims/Unarmed/Attack/'
guard = unreal.load_asset(source_root + 'MM_Attack_01')
options = unreal.AnimPoseEvaluationOptions()
options.set_editor_property('retrieve_additive_as_full_pose', True)
bones = list(unreal.AnimationLibrary.get_animation_track_names(idle))
guard_pose = unreal.AnimPoseExtensions.get_anim_pose_at_time(guard, .10, options)
base = {str(b): unreal.AnimPoseExtensions.get_bone_pose(guard_pose, b, unreal.AnimPoseSpaces.LOCAL) for b in bones}
upper = ('spine', 'clavicle', 'upperarm', 'lowerarm', 'hand', 'neck', 'head', 'thumb', 'index', 'middle', 'ring', 'pinky')
catalog = []
for name, source, contact, effector in [
    ('Direct', 'MM_Attack_01', .49, 'hand_r'),
    ('Hook', 'MM_Attack_02', .47, 'hand_l'),
]:
    src = unreal.load_asset(source_root + source)
    path = folder + '/A_TV_' + name
    asset = unreal.load_asset(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else tools.duplicate_asset('A_TV_' + name, folder, idle)
    asset.set_editor_property('additive_anim_type', unreal.AdditiveAnimationType.AAT_NONE)
    asset.set_editor_property('enable_root_motion', False)
    asset.set_editor_property('force_root_lock', True)
    c = asset.controller
    c.set_frame_rate(unreal.FrameRate(60,1),False)
    c.set_number_of_frames(unreal.FrameNumber(54),False)
    poses = [unreal.AnimPoseExtensions.get_anim_pose_at_time(src, f/60, options) for f in range(55)]
    for bone in bones:
        key = str(bone)
        tracks=[]
        for pose in poses:
            t = unreal.AnimPoseExtensions.get_bone_pose(pose, bone, unreal.AnimPoseSpaces.LOCAL) if key.startswith(upper) else base[key]
            if key == 'root':
                t = unreal.Transform()
                t.set_editor_property('rotation',base['root'].rotation)
                t.set_editor_property('translation',unreal.Vector(0,0,0))
            tracks.append(t)
        assert c.set_bone_track_keys(bone,[t.translation for t in tracks],[t.rotation for t in tracks],[t.scale3d for t in tracks],False)
    assert unreal.EditorAssetLibrary.save_loaded_asset(asset)
    pose = unreal.AnimPoseExtensions.get_anim_pose_at_time(asset,contact,options)
    hand = unreal.AnimPoseExtensions.get_bone_pose(pose,effector,unreal.AnimPoseSpaces.WORLD).translation
    catalog.append(dict(id=name.lower(),family='unarmed',asset=path,effector=effector,
        contactTime=contact,length=.9,reachCm=hand.y,lateralCm=-hand.x,minControl=0,maxControl=1))

catalog.append(dict(id='recoil',family='reaction',asset='/Game/TornVeil/Characters/Animations/A_TV_HitReact_Front',
    effector='spine_03',contactTime=.1,length=.7,reachCm=0,lateralCm=0,minControl=0,maxControl=1))
root=os.path.abspath(os.path.join(unreal.Paths.project_dir(),'../..'))
data=os.path.join(root,'unreal/TornVeilOnline/Content/TornVeil/Combat/Data')
os.makedirs(data,exist_ok=True)
with open(os.path.join(data,'MotionPrimitives.json'),'w') as f: json.dump(dict(version=1,primitives=catalog),f,indent=2)

matpath='/Game/TornVeil/Combat/Effects/M_TV_CombatLight'
mat=unreal.load_asset(matpath) if unreal.EditorAssetLibrary.does_asset_exist(matpath) else tools.create_asset('M_TV_CombatLight','/Game/TornVeil/Combat/Effects',unreal.Material,unreal.MaterialFactoryNew())
unreal.MaterialEditingLibrary.delete_all_material_expressions(mat)
mat.set_editor_property('two_sided',True)
mat.set_editor_property('shading_model',unreal.MaterialShadingModel.MSM_UNLIT)
colour=unreal.MaterialEditingLibrary.create_material_expression(mat,unreal.MaterialExpressionVectorParameter,0,0)
colour.set_editor_property('parameter_name','Colour')
colour.set_editor_property('default_value',unreal.LinearColor(.6,.75,1,1))
mat.set_editor_property('blend_mode',unreal.BlendMode.BLEND_ADDITIVE)
mult=unreal.MaterialEditingLibrary.create_material_expression(mat,unreal.MaterialExpressionMultiply,180,0)
mult.set_editor_property('const_b',8.0)
unreal.MaterialEditingLibrary.connect_material_expressions(colour,'RGB',mult,'A')
inverse=unreal.MaterialEditingLibrary.create_material_expression(mat,unreal.MaterialExpressionEyeAdaptationInverse,300,0)
assert unreal.MaterialEditingLibrary.connect_material_expressions(mult,'',inverse,'LightValueInput')
assert unreal.MaterialEditingLibrary.connect_material_property(inverse,'',unreal.MaterialProperty.MP_EMISSIVE_COLOR)
unreal.MaterialEditingLibrary.recompile_material(mat)
assert unreal.EditorAssetLibrary.save_loaded_asset(mat)

level='/Game/TornVeil/Combat/Tests/L_TV_CombatChoreography_Showcase'
if unreal.EditorAssetLibrary.does_asset_exist(level):
    assert levels.load_level(level)
else:
    assert levels.new_level_from_template(level,'/Game/TornVeil/Maps/TornVeilWorld')
    actors=unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    floor=actors.spawn_actor_from_class(unreal.StaticMeshActor,unreal.Vector(0,0,50))
    floor.set_actor_label('CombatShowcase_CanonicalStonePatch')
    floor.static_mesh_component.set_static_mesh(unreal.load_asset('/Engine/BasicShapes/Cube'))
    floor.set_actor_scale3d(unreal.Vector(30,30,1))
    floor.static_mesh_component.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
    floor.tags=['TV.PresentationOnly','TV.CombatShowcase']
    text=actors.spawn_actor_from_class(unreal.TextRenderActor,unreal.Vector(0,-250,110))
    text.set_actor_label('FixtureDisclosure')
    text.text_render.set_text('TORN VEIL / COMBAT LAB\nIsolated canonical combat + labeled technique fixtures')
    text.text_render.set_world_size(16)
    text.set_actor_rotation(unreal.Rotator(pitch=0,yaw=90,roll=0),False)
    assert levels.save_current_level()
actors=unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
if not any('TV.CombatShowcase.Camera' in [str(t) for t in a.tags] for a in actors.get_all_level_actors()):
    camera=actors.spawn_actor_from_class(unreal.CameraActor,unreal.Vector(65,-520,300),unreal.Rotator(pitch=-12,yaw=90,roll=0))
    camera.set_actor_label('CombatShowcase_Camera');camera.tags=['TV.CombatShowcase.Camera']
    camera.camera_component.set_field_of_view(50)
    assert levels.save_current_level()
unreal.EditorLevelLibrary.set_level_viewport_camera_info(unreal.Vector(530,-740,360),unreal.Rotator(pitch=-15,yaw=130,roll=0))
evidence=os.path.join(root,'docs/evidence/combat-choreography');os.makedirs(evidence,exist_ok=True)
with open(os.path.join(evidence,'asset-bake.json'),'w') as f:json.dump(dict(level=level,primitives=catalog,rootMotion=False,vendorSaved=False),f,indent=2)
print('COMBAT_ASSETS',json.dumps(catalog))
