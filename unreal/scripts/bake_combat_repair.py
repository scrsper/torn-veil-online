"""Owned full-body derivatives. No vendor writes. Bake canonical-time clips, then sample
contact centers from the final Manny poses. This is authoring data, not renderer authority.
"""
import unreal,json,os,math
root=os.path.abspath(os.path.join(unreal.Paths.project_dir(),'../..'))
tools=unreal.AssetToolsHelpers.get_asset_tools();folder='/Game/TornVeil/Combat/Repair/Animations'
opts=unreal.AnimPoseEvaluationOptions();idle=unreal.load_asset('/Game/Characters/Mannequins/Anims/Unarmed/MM_Idle')
bones=list(unreal.AnimationLibrary.get_animation_track_names(idle));ret='/Game/TornVeil/Combat/Repair/Retargeted/RT_'
def pose(a,t):return unreal.AnimPoseExtensions.get_anim_pose_at_time(a,t,opts)
def bone(p,b,space=unreal.AnimPoseSpaces.LOCAL):return unreal.AnimPoseExtensions.get_bone_pose(p,b,space)
def load(p):
 a=unreal.load_asset(p);assert a,p;return a
def bake(name,length,sample,remove_hip=None,heading=0):
 path=folder+'/A_TV_'+name
 a=load(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else tools.duplicate_asset('A_TV_'+name,folder,idle)
 a.set_editor_property('additive_anim_type',unreal.AdditiveAnimationType.AAT_NONE);a.set_editor_property('enable_root_motion',False);a.set_editor_property('force_root_lock',False)
 c=a.controller;c.open_bracket("Bake full-body repair",False);c.set_frame_rate(unreal.FrameRate(60,1),False);n=math.ceil(length*30)*2;c.set_number_of_frames(unreal.FrameNumber(n),False)
 samples=[sample(i/60) for i in range(n+1)]
 for b in bones:
  keys=[]
  for i,p in enumerate(samples):
   t=bone(p,b)
   if str(b)=='root':
    t.translation=unreal.Vector(0,0,0);t.rotation=unreal.Rotator(yaw=heading).quaternion()*t.rotation
   elif str(b)=='pelvis' and remove_hip:
    off=remove_hip(i/60);t.translation=t.translation-unreal.Vector(off.x,off.y,0)
   keys.append(t)
  assert c.set_bone_track_keys(b,[t.translation for t in keys],[t.rotation for t in keys],[t.scale3d for t in keys],False),b
 c.close_bracket(False);assert unreal.EditorAssetLibrary.save_loaded_asset(a)
 return a

def time_map(t,knots):
 for (t0,s0),(t1,s1) in zip(knots,knots[1:]):
  if t<=t1:return s0+(s1-s0)*max(0,min(1,(t-t0)/(t1-t0)))
 return knots[-1][1]
manifest=[];contact={}
for name,variant,source,effector,knots in [
 ('Jab','direct','jab_left_Anim','middle_01_l',[(0,.12),(.3,.27),(.45,.42),(.75,.85)]),
 ('Cross','hook','cross_right_Anim','middle_01_r',[(0,.36),(.3,.68),(.45,.84),(.75,1.32)]),
 ('Kick','kick','front_kick_Anim','foot_r',[(0,.55),(.3,1.0),(.45,1.22),(.75,1.88)])]:
 src=load(ret+source)
 # A fixed authoring facing, never a target-dependent warp: put the selected
 # clip's attack axis in actor-forward coordinates before sampling its geometry.
 peak=bone(pose(src,knots[2][1]),effector,unreal.AnimPoseSpaces.WORLD).translation
 heading=math.degrees(math.atan2(peak.x,peak.y)) if variant!='kick' else 0
 a=bake(name,.75,lambda t,src=src,k=knots:pose(src,time_map(t,k)),heading=heading)
 points=[]
 for i in range(19):
  t=.3+i/120;v=bone(pose(a,t),effector,unreal.AnimPoseSpaces.WORLD).translation
  points.append([round(t-.3,6),round(-v.x/100,5),round(v.z/100,5),round(v.y/100,5)])
 contact[variant]={'effector':effector,'samples':points}
 manifest.append({'clip':name,'source':src.get_path_name(),'headingDegrees':round(heading,3),'knots':knots,'effector':effector})

for name,source,start,end in [('StepLeft','dodge_left_Anim',.58,1.55),('StepRight','dodge_right_Anim',.44,1.43)]:
 src=load(ret+source);first=bone(pose(src,start),'pelvis').translation
 def sample(t,src=src,start=start,end=end):return pose(src,time_map(t,[(0,start),(.24,end-.18),(.36,end)]))
 def remove(t,sample=sample,first=first):
  p=bone(sample(t),'pelvis').translation;return unreal.Vector(p.x-first.x,p.y-first.y,0)
 bake(name,.36,sample,remove);manifest.append({'clip':name,'source':src.get_path_name(),'trim':[start,end],'root':'horizontal hip travel removed; canonical collision owns displacement'})
for name,direction in [('StepBack','Bwd'),('StepForward','Fwd')]:
 src=load('/Game/Characters/Mannequins/Anims/Unarmed/Walk/MF_Unarmed_Walk_'+direction)
 bake(name,.36,lambda t,src=src:pose(src,t/.36*.53));manifest.append({'clip':name,'source':src.get_path_name(),'trim':[0,.53],'root':'root travel removed'})
din=load(ret+'M_Neutral_Transition_Stand_to_Crouch');dout=load(ret+'M_Neutral_Transition_Crouch_to_Stand');hold=load(ret+'M_Neutral_Crouch_Idle_Loop')
def duck_sample(t):
 if t<.18:return pose(din,t/.18*.65)
 if t<.38:return pose(hold,t-.18)
 return pose(dout,(t-.38)/.2*1.0)
duck=bake('Duck',.5833333333333334,duck_sample)
# Sample posture from the final head displacement, matching visible entry/recovery.
standing=bone(pose(duck,0),'head',unreal.AnimPoseSpaces.WORLD).translation.z
duck_curve=[]
for i in range(36):
 t=i/60;h=bone(pose(duck,t),'head',unreal.AnimPoseSpaces.WORLD).translation.z
 duck_curve.append([round(t,6),round(max(0,min(1,(standing-h)/50)),5)])
src=load(ret+'M_Neutral_Sprint_Loop_F');bake('Sprint',2,lambda t:pose(src,t))
manifest.extend([{'clip':'Duck','source':[din.get_path_name(),hold.get_path_name(),dout.get_path_name()],'entry':.18,'hold':.2,'recovery':.2},{'clip':'Sprint','source':src.get_path_name(),'sourceSpeedCmPerSecond':700,'root':'removed; movement speed unchanged'}])
with open(os.path.join(root,'src/sim/physical/combatMotion.json'),'w') as f:json.dump({'revision':1,'attacks':contact,'duck':duck_curve},f,indent=2);f.write('\n')
with open(os.path.join(root,'.debug/repair-animation-manifest.json'),'w') as f:json.dump(manifest,f,indent=2)
print('REPAIR_BAKED',len(manifest))
