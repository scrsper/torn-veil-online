"""Small readable activity loops on the installed Epic mannequin skeleton. Local generated
assets inherit the template license and are rebuilt, not redistributed in git."""
import unreal, math
tools=unreal.AssetToolsHelpers.get_asset_tools()
lib=unreal.EditorAssetLibrary
source=unreal.load_asset('/Game/Characters/Mannequins/Anims/Unarmed/MM_Idle')
bones=['pelvis','spine_01','spine_02','spine_03','upperarm_l','upperarm_r','lowerarm_l','lowerarm_r','hand_l','hand_r','neck_01','head']
base={b:unreal.AnimationLibrary.get_bone_pose_for_time(source,b,0,False) for b in bones}
profiles={
 'talk':{'upperarm_r':(0,0,25,18),'head':(8,0,0,5)},
 'eat':{'upperarm_r':(0,0,48,8),'lowerarm_r':(0,0,90,12),'head':(10,0,0,4)},
 'drink':{'upperarm_r':(0,0,65,4),'lowerarm_r':(0,0,100,8),'head':(-16,0,0,4)},
 'inspect':{'spine_02':(16,0,0,3),'head':(18,0,0,6),'upperarm_r':(0,0,25,5)},
 'repair':{'spine_02':(22,0,0,4),'upperarm_l':(0,0,-42,8),'upperarm_r':(0,0,52,16),'lowerarm_r':(0,0,48,28)},
 'operate':{'upperarm_l':(0,0,-58,18),'upperarm_r':(0,0,58,18),'spine_02':(12,0,0,5)},
 'work':{'upperarm_l':(0,0,-30,12),'upperarm_r':(0,0,30,12),'spine_02':(9,0,0,5)},
 'chop':{'upperarm_l':(0,0,-50,48),'upperarm_r':(0,0,50,48),'spine_02':(15,0,0,18)},
 'haul':{'upperarm_l':(0,0,-38,3),'upperarm_r':(0,0,38,3),'lowerarm_l':(0,0,-65,2),'lowerarm_r':(0,0,65,2)},
 'rest':{'spine_02':(25,0,0,2),'head':(20,0,0,2)},
}
for activity,offsets in profiles.items():
    path='/Game/Characters/TornVeilActivities/A_TV_'+activity
    anim=lib.load_asset(path) if lib.does_asset_exist(path) else tools.duplicate_asset('A_TV_'+activity,'/Game/Characters/TornVeilActivities',source)
    controller=anim.controller
    controller.set_frame_rate(unreal.FrameRate(30,1),False)
    controller.set_number_of_frames(unreal.FrameNumber(60),False)
    for bone,values in offsets.items():
        t=base[bone]; positions=[]; rotations=[]; scales=[]
        for frame in range(61):
            phase=math.sin(frame/60*math.tau)
            pitch,yaw,roll,amplitude=values
            delta=unreal.Rotator(pitch=pitch+phase*amplitude if pitch else 0,yaw=yaw,roll=roll+phase*amplitude if roll else 0).quaternion()
            q=t.rotation*delta
            positions.append(unreal.Vector(t.translation.x,t.translation.y,t.translation.z))
            rotation=unreal.Quat()
            rotation.set_editor_property("x",q.x); rotation.set_editor_property("y",q.y); rotation.set_editor_property("z",q.z); rotation.set_editor_property("w",q.w)
            rotations.append(rotation)
            scales.append(unreal.Vector(t.scale3d.x,t.scale3d.y,t.scale3d.z))
        controller.set_bone_track_keys(bone,positions,rotations,scales,False)
    lib.save_loaded_asset(anim)
print('ACTIVITY_ANIMATIONS_READY',len(profiles))
