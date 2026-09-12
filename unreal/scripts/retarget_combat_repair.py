"""Selective owned derivatives. Source combat pack, rigs and vendor skeletons are never saved."""
import unreal, json, os
folder='/Game/TornVeil/Combat/Repair'
tools=unreal.AssetToolsHelpers.get_asset_tools()
target=unreal.load_asset('/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple')
source=unreal.load_asset('/Game/Fab/Motifect_Combat_Motion_Pack/front_kick')
assert target and source
def rig(name,mesh,root,chains):
 path=folder+'/'+name
 asset=unreal.load_asset(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else tools.create_asset(name,folder,unreal.IKRigDefinition,unreal.IKRigDefinitionFactory())
 c=unreal.IKRigController.get_controller(asset)
 c.set_skeletal_mesh(mesh);c.set_retarget_root(root)
 for name,start,end in chains:
  if str(c.get_retarget_chain_start_bone(name))=='None':c.add_retarget_chain(name,start,end,'None')
  assert str(c.get_retarget_chain_start_bone(name))==start, (name,start)
  assert str(c.get_retarget_chain_end_bone(name))==end, (name,end)
 unreal.EditorAssetLibrary.save_loaded_asset(asset)
 return asset
schains=[('Spine','spine1','chest'),('Head','neck1','head'),('LeftClavicle','leftshoulder','leftshoulder'),('RightClavicle','rightshoulder','rightshoulder'),('LeftArm','leftarm','lefthand'),('RightArm','rightarm','righthand'),('LeftLeg','leftleg','leftfoot'),('RightLeg','rightleg','rightfoot')]
tchains=[('Spine','spine_01','spine_05'),('Head','neck_01','head'),('LeftClavicle','clavicle_l','clavicle_l'),('RightClavicle','clavicle_r','clavicle_r'),('LeftArm','upperarm_l','hand_l'),('RightArm','upperarm_r','hand_r'),('LeftLeg','thigh_l','foot_l'),('RightLeg','thigh_r','foot_r')]
for side,short in [('left','l'),('right','r')]:
 for finger in ['thumb','index','middle','ring','pinky']:
  schains.append((side+finger,side+'hand'+finger+'1',side+'hand'+finger+'3'))
  tchains.append((side+finger,finger+'_01_'+short,finger+'_03_'+short))
sr=rig('IK_TV_RepairSource',source,'hips',schains);tr=rig('IK_TV_RepairManny',target,'pelvis',tchains)
path=folder+'/RTG_TV_CombatRepair'
rtg=unreal.load_asset(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else tools.create_asset('RTG_TV_CombatRepair',folder,unreal.IKRetargeter,unreal.IKRetargetFactory())
c=unreal.IKRetargeterController.get_controller(rtg)
c.set_ik_rig(unreal.RetargetSourceOrTarget.SOURCE,sr);c.set_ik_rig(unreal.RetargetSourceOrTarget.TARGET,tr)
c.set_preview_mesh(unreal.RetargetSourceOrTarget.SOURCE,source);c.set_preview_mesh(unreal.RetargetSourceOrTarget.TARGET,target)
c.remove_all_ops();c.add_default_ops()
# Motifect's top bone is hips, not a locomotion root. Copying it into Manny's
# root applies the hip rotation a second time and lifts the planted leg.
for i in range(c.get_num_retarget_ops()):
 if isinstance(c.get_op_controller(i),unreal.IKRetargetRootMotionController):c.set_retarget_op_enabled(i,False)
for name,_,_ in tchains:c.set_source_chain(name,name)
c.auto_align_all_bones(unreal.RetargetSourceOrTarget.TARGET)
unreal.EditorAssetLibrary.save_loaded_asset(rtg)
names=['jab_left','cross_right','front_kick','dodge_left','dodge_right']
assets=[unreal.load_asset('/Game/Fab/Motifect_Combat_Motion_Pack/'+n+'_Anim') for n in names]
registry=unreal.AssetRegistryHelpers.get_asset_registry()
data=[registry.get_asset_by_object_path(a.get_path_name()) for a in assets]
result=unreal.IKRetargetBatchOperation.duplicate_and_retarget(data,source,target,rtg,prefix='RT_',target_path=folder+'/Retargeted',include_referenced_assets=False,overwrite_existing_files=True)
for a in result:assert unreal.EditorAssetLibrary.save_asset(str(a.package_name))
root=os.path.abspath(os.path.join(unreal.Paths.project_dir(),'../..'))
with open(os.path.join(root,'.debug/repair-retarget-result.json'),'w') as f:json.dump({'assets':[str(a.package_name) for a in result],'rig':path,'sources':names},f,indent=2)
print('REPAIR_RETARGET',len(result))
