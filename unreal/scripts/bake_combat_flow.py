"""Owned chain variants and nonuniform round-kick timing. Run with Unreal Python.

Approved standalone jab/cross/front kick and revision-one round kick are read-only.
Active punch/front-kick samples are unchanged; only chain bookends are remapped.
"""
import unreal, json, os, math
root = os.path.abspath(os.path.join(unreal.Paths.project_dir(), '../..'))
folder = '/Game/TornVeil/Combat/Flow/Animations'
tools = unreal.AssetToolsHelpers.get_asset_tools()
opts = unreal.AnimPoseEvaluationOptions()
def load(path):
    a = unreal.load_asset(path)
    assert a, path
    return a
idle = load('/Game/Characters/Mannequins/Anims/Unarmed/MM_Idle')
bones = list(unreal.AnimationLibrary.get_animation_track_names(idle))
def pose(a, t):
    return unreal.AnimPoseExtensions.get_anim_pose_at_time(a, max(0, min(t, a.get_play_length())), opts)
def bone(p, b, space=unreal.AnimPoseSpaces.LOCAL):
    return unreal.AnimPoseExtensions.get_bone_pose(p, b, space)
def remap(t, knots):
    for (a,b),(c,d) in zip(knots, knots[1:]):
        if t <= c: return b+(d-b)*max(0,min(1,(t-a)/(c-a)))
    return knots[-1][1]
def bake(name, source, knots, heading=0):
    path = folder+'/A_TV_'+name
    a = load(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else tools.duplicate_asset('A_TV_'+name,folder,idle)
    a.set_editor_property('additive_anim_type',unreal.AdditiveAnimationType.AAT_NONE)
    a.set_editor_property('enable_root_motion',False)
    a.set_editor_property('force_root_lock',False)
    # Source compression samples at 30 Hz; keep an integral resampling interval.
    count=math.ceil(knots[-1][0]*30)*2
    c=a.controller;c.open_bracket('Continuous combat owned derivative',False)
    c.set_frame_rate(unreal.FrameRate(60,1),False);c.set_number_of_frames(unreal.FrameNumber(count),False)
    poses=[pose(source,remap(i/60,knots)) for i in range(count+1)]
    for b in bones:
        keys=[]
        for p in poses:
            t=bone(p,b)
            if str(b)=='root':
                t.translation=unreal.Vector(0,0,0)
                t.rotation=unreal.Rotator(yaw=heading).quaternion()*t.rotation
            keys.append(t)
        assert c.set_bone_track_keys(b,[t.translation for t in keys],[t.rotation for t in keys],[t.scale3d for t in keys],False)
    c.close_bracket(False)
    assert unreal.EditorAssetLibrary.save_loaded_asset(a)
    return a
jab=load('/Game/TornVeil/Combat/Refinement/Animations/A_TV_JabRefined')
cross=load('/Game/TornVeil/Combat/Repair/Animations/A_TV_Cross')
jabKnots=[(0,.14),(.30,.30),(.45,.45),(.75,.68)]
crossKnots=[(0,.12),(.30,.30),(.45,.45),(.75,.68)]
bake('JabChain',jab,jabKnots);bake('CrossChain',cross,crossKnots)
source=load('/Game/TornVeil/Combat/Refinement/Retargeted/RT_roundhouse_kick_left_Anim')
peak=bone(pose(source,1.65),'foot_r',unreal.AnimPoseSpaces.WORLD).translation
heading=math.degrees(math.atan2(peak.x,peak.y))
# Remove static lead-in; reserve real time for support pivot, chamber, follow-through and replant.
knots=[(0,.95),(.18,1.18),(.42,1.45),(.70,1.90),(.92,2.20),(1.20,2.90)]
kick=bake('RoundKick',source,knots,heading)
rows=[]
for i in range(35):
    t=.42+min(.28,i/120)
    v=bone(pose(kick,t),'foot_r',unreal.AnimPoseSpaces.WORLD).translation
    rows.append([round(t-.42,6),round(-v.x/100,5),round(v.z/100,5),round(v.y/100,5)])
with open(os.path.join(root,'src/sim/physical/combatRoundMotionV2.json'),'w') as f:
    json.dump({'revision':2,'effector':'foot_r','samples':rows},f,indent=2);f.write('\n')
with open(os.path.join(root,'.debug/flow-assets.json'),'w') as f:
    json.dump({'roundSource':source.get_path_name(),'actualFoot':'foot_r','heading':heading,'roundKnots':knots,'jabChainKnots':jabKnots,'crossChainKnots':crossKnots},f,indent=2)
print('COMBAT_FLOW_ASSETS_COMPLETE')
