"""Bake presentation-only Manny clips; never save the immutable source packages.

Hit = original local additive delta accumulated onto unarmed idle. Down = the
existing death lead-in followed by a short keyframed prone settle, with no root drift.
"""
import unreal, os, json
assert not unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).is_in_play_in_editor()
folder='/Game/TornVeil/Characters/Animations'
idle=unreal.load_asset('/Game/Characters/Mannequins/Anims/Unarmed/MM_Idle')
hit=unreal.load_asset('/Game/Characters/Mannequins/Anims/Rifle/HitReact/MM_HitReact_Front_Lgt_01')
down=unreal.load_asset('/Game/Characters/Mannequins/Anims/Death/MM_Death_Front_01')
options=unreal.AnimPoseEvaluationOptions();options.set_editor_property('retrieve_additive_as_full_pose',False)
idle_pose=unreal.AnimPoseExtensions.get_anim_pose_at_time(idle,0,options)
bones=list(unreal.AnimationLibrary.get_animation_track_names(idle))
base={b:unreal.AnimPoseExtensions.get_bone_pose(idle_pose,b,unreal.AnimPoseSpaces.LOCAL) for b in bones}
def clip(name,frames,evaluate):
    path=folder+'/'+name
    asset=unreal.load_asset(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else unreal.AssetToolsHelpers.get_asset_tools().duplicate_asset(name,folder,idle)
    asset.set_editor_property('additive_anim_type',unreal.AdditiveAnimationType.AAT_NONE)
    asset.set_editor_property('enable_root_motion',False)
    asset.set_editor_property('force_root_lock',False)
    c=asset.controller;c.set_frame_rate(unreal.FrameRate(30,1),False);c.set_number_of_frames(unreal.FrameNumber(frames),False)
    poses=[evaluate(frame/30) for frame in range(frames+1)]
    for bone in bones:
        tracks=[p[bone] for p in poses]
        assert c.set_bone_track_keys(bone,[t.translation for t in tracks],[t.rotation for t in tracks],[t.scale3d for t in tracks],False)
    assert unreal.EditorAssetLibrary.save_loaded_asset(asset)
    return asset
def hit_pose(t):
    delta=unreal.AnimPoseExtensions.get_anim_pose_at_time(hit,min(t,hit.get_play_length()),options)
    result={}
    for bone in bones:
        b=base[bone];d=unreal.AnimPoseExtensions.get_bone_pose(delta,bone,unreal.AnimPoseSpaces.LOCAL)
        # UE FTransform::AccumulateWithAdditiveScale at full weight.
        r=unreal.Transform()
        r.set_editor_property('translation',b.translation+d.translation)
        r.set_editor_property('rotation',unreal.MathLibrary.quat_normalized(d.rotation*b.rotation))
        r.set_editor_property('scale3d',unreal.Vector(b.scale3d.x*(1+d.scale3d.x),b.scale3d.y*(1+d.scale3d.y),b.scale3d.z*(1+d.scale3d.z)))
        result[bone]=r
    return result
def down_pose(t):
    source=unreal.AnimPoseExtensions.get_anim_pose_at_time(down,min(t,down.get_play_length()),options)
    alpha=max(0,min(1,(t-1.1)/.6));alpha=alpha*alpha*(3-2*alpha)
    result={}
    for bone in bones:
        a=unreal.AnimPoseExtensions.get_bone_pose(source,bone,unreal.AnimPoseSpaces.LOCAL)
        b=unreal.AnimPoseExtensions.get_bone_pose(idle_pose,bone,unreal.AnimPoseSpaces.LOCAL)
        if str(bone)=='root':
            a.set_editor_property('translation',unreal.Vector(0,0,0))
            b.set_editor_property('translation',unreal.Vector(0,0,20))
            b.set_editor_property('rotation',unreal.Rotator(roll=90,pitch=0,yaw=0).quaternion())
        result[bone]=unreal.MathLibrary.t_lerp(a,b,alpha)
    return result
hit_result=clip('A_TV_HitReact_Front',21,hit_pose)
down_result=clip('A_TV_Downed',51,down_pose)
full=unreal.AnimPoseEvaluationOptions();full.set_editor_property('retrieve_additive_as_full_pose',True)
end=unreal.AnimPoseExtensions.get_anim_pose_at_time(down_result,down_result.get_play_length(),full)
heights={bone:unreal.AnimPoseExtensions.get_bone_pose(end,bone,unreal.AnimPoseSpaces.WORLD).translation.z for bone in ['pelvis','head']}
assert all(0<h<45 for h in heights.values()), str(heights)
assert hit_result.get_editor_property('additive_anim_type')==unreal.AdditiveAnimationType.AAT_NONE
report={'hit':hit_result.get_path_name(),'hitSeconds':hit_result.get_play_length(),'down':down_result.get_path_name(),
    'downSeconds':down_result.get_play_length(),'terminalBoneHeightsCm':heights,'tracks':len(bones),'vendorPackagesSaved':False}
path=os.path.abspath(os.path.join(unreal.Paths.project_dir(),'../../docs/evidence/humanoid/combat-animation-bake.json'))
with open(path,'w') as f:json.dump(report,f,indent=2)
print('HUMANOID_COMBAT_ANIMATIONS',report)
