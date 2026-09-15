"""Retarget inspected GASP clips to the existing Manny skeleton; build ONE standard engine
direction/speed BlendSpace plus short transition clips. Local licensed dependency only.
Root motion metadata is retained for inspection; extracted displacement is discarded in runtime.
"""
import unreal,os,json,math
root=os.path.abspath(os.path.join(unreal.Paths.project_dir(),'../..'))
folder='/Game/Characters/TornVeilLocomotion'
tools=unreal.AssetToolsHelpers.get_asset_tools();registry=unreal.AssetRegistryHelpers.get_asset_registry()
def load(path):
    asset=unreal.load_asset(path);assert asset,path;return asset
source=load('/Game/Characters/UEFN_Mannequin/Meshes/SKM_UEFN_Mannequin')
target=load('/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple')
def make_rig(name,mesh):
    path=folder+'/'+name
    a=load(path)if unreal.EditorAssetLibrary.does_asset_exist(path)else tools.create_asset(name,folder,unreal.IKRigDefinition,unreal.IKRigDefinitionFactory())
    controller=unreal.IKRigController.get_controller(a);controller.set_skeletal_mesh(mesh);controller.set_retarget_root('pelvis')
    chains=[('Spine','spine_01','spine_05'),('Head','neck_01','head'),('LeftArm','upperarm_l','hand_l'),('RightArm','upperarm_r','hand_r'),('LeftLeg','thigh_l','foot_l'),('RightLeg','thigh_r','foot_r')]
    for name,start,end in chains:
        if str(controller.get_retarget_chain_start_bone(name))=='None':controller.add_retarget_chain(name,start,end,'None')
    unreal.EditorAssetLibrary.save_loaded_asset(a);return a
source_rig=make_rig('IK_TV_LocomotionSource',source);target_rig=make_rig('IK_TV_LocomotionManny',target)
rig_path=folder+'/RTG_TV_Locomotion'
rig=load(rig_path)if unreal.EditorAssetLibrary.does_asset_exist(rig_path)else tools.create_asset('RTG_TV_Locomotion',folder,unreal.IKRetargeter,unreal.IKRetargetFactory())
c=unreal.IKRetargeterController.get_controller(rig)
c.set_ik_rig(unreal.RetargetSourceOrTarget.SOURCE,source_rig);c.set_ik_rig(unreal.RetargetSourceOrTarget.TARGET,target_rig)
c.set_preview_mesh(unreal.RetargetSourceOrTarget.SOURCE,source);c.set_preview_mesh(unreal.RetargetSourceOrTarget.TARGET,target)
c.remove_all_ops();c.add_default_ops()
for chain in unreal.IKRigController.get_controller(source_rig).get_retarget_chains():c.set_source_chain(chain.chain_name,chain.chain_name)
c.auto_align_all_bones(unreal.RetargetSourceOrTarget.TARGET)
unreal.EditorAssetLibrary.save_loaded_asset(rig)
with open(os.path.join(root,'.debug/locomotion-migration.json'))as f:manifest=json.load(f)
paths=[p for p in manifest['packages'] if '/Animations/' in p]
assets=[load(p)for p in paths]
result=unreal.IKRetargetBatchOperation.duplicate_and_retarget([registry.get_asset_by_object_path(a.get_path_name())for a in assets],source,target,rig,prefix='RT_',target_path=folder,include_referenced_assets=False,overwrite_existing_files=True)
assert len(result)==len(paths),(len(result),len(paths))
clips={};details=[]
opts=unreal.AnimPoseEvaluationOptions();opts.extract_root_motion=False
for data in result:
    a=load(str(data.package_name));name=a.get_name().removeprefix('RT_');clips[name]=a
    length=a.get_play_length()
    start=unreal.AnimPoseExtensions.get_bone_pose(unreal.AnimPoseExtensions.get_anim_pose_at_time(a,0,opts),'root',unreal.AnimPoseSpaces.LOCAL).translation
    end=unreal.AnimPoseExtensions.get_bone_pose(unreal.AnimPoseExtensions.get_anim_pose_at_time(a,length,opts),'root',unreal.AnimPoseSpaces.LOCAL).translation
    speed=math.hypot(end.x-start.x,end.y-start.y)/max(.001,length)
    details.append({'asset':a.get_path_name(),'length':length,'rootSpeedCmPerSecond':speed,'skeleton':a.get_editor_property('skeleton').get_path_name()})
    a.set_editor_property('enable_root_motion',True);a.set_editor_property('force_root_lock',True)
    unreal.EditorAssetLibrary.save_loaded_asset(a)
idle=load('/Game/Characters/Mannequins/Anims/Unarmed/MM_Idle')
samples=[];positions=[];rates=[]
directions=[(-180,'B'),(-135,'BL'),(-90,'LL'),(-45,'FL'),(0,'F'),(45,'FR'),(90,'RR'),(135,'BR'),(180,'B')]
for angle,d in directions:
    samples.append(idle);positions.append(unreal.Vector(angle,0,0));rates.append(1)
    for speed,gait in [(200,'Walk'),(450,'Run'),(700,'Sprint')]:
        # Sample has sprint forward/diagonal clips, not a backward sprint. Fast backward/side
        # travel therefore uses the verified directional run clip with measured time scaling.
        source_gait=gait if gait!='Sprint' or d in ['F','FL','FR'] else 'Run'
        a=clips['M_Neutral_'+source_gait+'_Loop_'+d]
        measured=next(row['rootSpeedCmPerSecond']for row in details if row['asset']==a.get_path_name())
        samples.append(a);positions.append(unreal.Vector(angle,speed,0));rates.append(speed/measured if measured>25 else 1)
factory=unreal.BlendSpaceFactoryNew();factory.target_skeleton=idle.get_editor_property('skeleton')
path=folder+'/BS_TV_Directional'
blend=load(path)if unreal.EditorAssetLibrary.does_asset_exist(path)else tools.create_asset('BS_TV_Directional',folder,unreal.BlendSpace,factory)
assert unreal.TVLocomotionAuthoring.configure_samples(blend,samples,positions,rates)
unreal.EditorAssetLibrary.save_loaded_asset(blend)
with open(os.path.join(root,'docs/evidence/foundational-gameplay/retrofit/locomotion-assets.json'),'w')as f:json.dump({'source':'Epic Game Animation Sample','publicRawAssets':False,'blendSpace':path,'clips':details,'sampleCount':len(samples),'rootAuthority':'discarded; canonical body/prediction only'},f,indent=2)
print('DIRECTIONAL_LOCOMOTION_READY',len(details),len(samples))
