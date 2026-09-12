"""Bounded owned refinement; keep the delivered cross/front kick and all vendors unchanged."""
import unreal,json,os,math
root=os.path.abspath(os.path.join(unreal.Paths.project_dir(),'../..'))
folder='/Game/TornVeil/Combat/Refinement';tools=unreal.AssetToolsHelpers.get_asset_tools();reg=unreal.AssetRegistryHelpers.get_asset_registry()
def load(p):
 a=unreal.load_asset(p);assert a,p;return a
def inv(q):return unreal.Quat(-q.x,-q.y,-q.z,q.w)
def save(a):assert unreal.EditorAssetLibrary.save_loaded_asset(a)
# The original approved assets are read only. New content is retargeted with the proven rig.
source=load('/Game/Fab/Motifect_Combat_Motion_Pack/front_kick');target=load('/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple')
a=load('/Game/Fab/Motifect_Combat_Motion_Pack/roundhouse_kick_left_Anim')
r=unreal.IKRetargetBatchOperation.duplicate_and_retarget([reg.get_asset_by_object_path(a.get_path_name())],source,target,load('/Game/TornVeil/Combat/Repair/RTG_TV_CombatRepair'),prefix='RT_',target_path=folder+'/Retargeted',include_referenced_assets=False,overwrite_existing_files=True)
for d in r:assert unreal.EditorAssetLibrary.save_asset(str(d.package_name))
# Four locomotion references only; source rigs stay transient.
sample=load('/Game/Characters/UEFN_Mannequin/Meshes/SKM_UEFN_Mannequin')
sr=tools.duplicate_asset('IK_RefinementSample',folder,load('/Game/TornVeil/Combat/Repair/IK_TV_RepairManny'))
unreal.IKRigController.get_controller(sr).set_skeletal_mesh(sample)
rtg=tools.create_asset('RTG_RefinementSample',folder,unreal.IKRetargeter,unreal.IKRetargetFactory());c=unreal.IKRetargeterController.get_controller(rtg)
c.set_ik_rig(unreal.RetargetSourceOrTarget.SOURCE,sr);c.set_ik_rig(unreal.RetargetSourceOrTarget.TARGET,load('/Game/TornVeil/Combat/Repair/IK_TV_RepairManny'))
c.set_preview_mesh(unreal.RetargetSourceOrTarget.SOURCE,sample);c.set_preview_mesh(unreal.RetargetSourceOrTarget.TARGET,target);c.add_default_ops()
for ch in unreal.IKRigController.get_controller(sr).get_retarget_chains():c.set_source_chain(ch.chain_name,ch.chain_name)
c.auto_align_all_bones(unreal.RetargetSourceOrTarget.TARGET)
refs=[load('/Game/Characters/UEFN_Mannequin/Animations/Crouch/M_Neutral_Crouch_Loop_'+n) for n in ['F','B','LL','RR']]
r=unreal.IKRetargetBatchOperation.duplicate_and_retarget([reg.get_asset_by_object_path(a.get_path_name())for a in refs],sample,target,rtg,prefix='RT_',target_path=folder+'/Retargeted',include_referenced_assets=False,overwrite_existing_files=True)
for d in r:assert unreal.EditorAssetLibrary.save_asset(str(d.package_name))
opts=unreal.AnimPoseEvaluationOptions();idle=load('/Game/Characters/Mannequins/Anims/Unarmed/MM_Idle');bones=list(unreal.AnimationLibrary.get_animation_track_names(idle))
def pose(a,t):return unreal.AnimPoseExtensions.get_anim_pose_at_time(a,max(0,min(t,a.get_play_length())),opts)
def bone(p,b,space=unreal.AnimPoseSpaces.LOCAL):return unreal.AnimPoseExtensions.get_bone_pose(p,b,space)
refFoot=bone(pose(idle,0),'foot_r',unreal.AnimPoseSpaces.WORLD).rotation
jabSource=load('/Game/Fab/Motifect_Combat_Motion_Pack/jab_left_Anim');sourceRest=bone(pose(jabSource,.12),'rightfoot',unreal.AnimPoseSpaces.WORLD).rotation
jab=load('/Game/TornVeil/Combat/Repair/Animations/A_TV_Jab')
def jabSourceTime(t):
 knots=[(0,.12),(.3,.27),(.45,.42),(.75,.85)]
 for (a,b),(c,d) in zip(knots,knots[1:]):
  if t<=c:return b+(d-b)*max(0,min(1,(t-a)/(c-a)))
 return .85
heading=unreal.Rotator(yaw=32.421).quaternion()
def bake(name,length,sourceAt,headingDegrees=0,repairFoot=False,guard=False):
 path=folder+'/Animations/A_TV_'+name
 a=load(path)if unreal.EditorAssetLibrary.does_asset_exist(path)else tools.duplicate_asset('A_TV_'+name,folder+'/Animations',idle)
 a.set_editor_property('additive_anim_type',unreal.AdditiveAnimationType.AAT_NONE);a.set_editor_property('enable_root_motion',False);a.set_editor_property('force_root_lock',False)
 count=math.ceil(length*30)*2;c=a.controller;c.open_bracket('Owned repertoire refinement',False);c.set_frame_rate(unreal.FrameRate(60,1),False);c.set_number_of_frames(unreal.FrameNumber(count),False)
 poses=[sourceAt(i/60)for i in range(count+1)];guardPose=pose(load('/Game/TornVeil/Combat/Repair/Animations/A_TV_Cross'),.03)
 for b in bones:
  keys=[]
  for i,p in enumerate(poses):
   t=bone(p,b)
   if str(b)=='root':t.translation=unreal.Vector(0,0,0);t.rotation=unreal.Rotator(yaw=headingDegrees).quaternion()*t.rotation
   if repairFoot and str(b)=='foot_r':
    current=bone(pose(jabSource,jabSourceTime(i/60)),'rightfoot',unreal.AnimPoseSpaces.WORLD).rotation
    desired=heading*(current*inv(sourceRest))*refFoot
    t.rotation=inv(bone(p,'calf_r',unreal.AnimPoseSpaces.WORLD).rotation)*desired
   if guard and (str(b).startswith(('upperarm_','lowerarm_','hand_','clavicle_'))):
    # Owned guard overlay retains source spine, hips and knees; no procedural pelvis lowering.
    t.rotation=bone(guardPose,b).rotation
   keys.append(t)
  assert c.set_bone_track_keys(b,[t.translation for t in keys],[t.rotation for t in keys],[t.scale3d for t in keys],False)
 c.close_bracket(False);save(a);return a
newJab=bake('JabRefined',.75,lambda t:pose(jab,t),repairFoot=True)
roundSrc=load(folder+'/Retargeted/RT_roundhouse_kick_left_Anim')
# Real right-foot body round kick; no mirroring. Recover and replant before following up.
knots=[(0,.78),(.32,1.28),(.52,1.88),(.80,2.65)]
def roundTime(t):
 for (a,b),(c,d) in zip(knots,knots[1:]):
  if t<=c:return b+(d-b)*max(0,min(1,(t-a)/(c-a)))
 return 2.65
peak=bone(pose(roundSrc,1.65),'foot_r',unreal.AnimPoseSpaces.WORLD).translation
roundHeading=math.degrees(math.atan2(peak.x,peak.y))
roundKick=bake('RoundKick',.8,lambda t:pose(roundSrc,roundTime(t)),roundHeading)
entry=load('/Game/TornVeil/Combat/Repair/Retargeted/RT_M_Neutral_Transition_Stand_to_Crouch')
crouchIdle=load('/Game/TornVeil/Combat/Repair/Retargeted/RT_M_Neutral_Crouch_Idle_Loop')
bake('CrouchEnter',.2,lambda t:pose(entry,t/.2*.65),guard=True)
bake('CrouchIdle',1,lambda t:pose(crouchIdle,t),guard=True)
for short,source in [('F','F'),('B','B'),('L','LL'),('R','RR')]:
 clip=load(folder+'/Retargeted/RT_M_Neutral_Crouch_Loop_'+source)
 bake('CrouchMove'+short,clip.get_play_length(),lambda t,a=clip:pose(a,t),guard=True)
rows=[]
for i in range(25):
 t=.32+i/120;v=bone(pose(roundKick,t),'foot_r',unreal.AnimPoseSpaces.WORLD).translation;rows.append([round(t-.32,6),round(-v.x/100,5),round(v.z/100,5),round(v.y/100,5)])
with open(os.path.join(root,'src/sim/physical/combatRoundMotion.json'),'w')as f:json.dump({'revision':1,'effector':'foot_r','samples':rows},f,indent=2);f.write('\n')
with open(os.path.join(root,'.debug/refinement-assets.json'),'w')as f:json.dump({'roundSource':'roundhouse_kick_left_Anim','actualFoot':'foot_r','heading':roundHeading,'knots':knots,'jabRepair':'Source foot orientation delta applied to neutral Manny rear foot; right heel/pivot free. Left foot unchanged.'},f,indent=2)
print('REFINEMENT_ASSETS_COMPLETE')
