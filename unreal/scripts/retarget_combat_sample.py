"""Retarget ONLY the four named crouch/sprint references from GameAnimationSample.
Temporary source packages retain their original package paths during import; only
Manny animation derivatives are delivered. No reference package is saved.
"""
import unreal,os,json
folder='/Game/TornVeil/Combat/Repair'
tools=unreal.AssetToolsHelpers.get_asset_tools();registry=unreal.AssetRegistryHelpers.get_asset_registry()
source=unreal.load_asset('/Game/Characters/UEFN_Mannequin/Meshes/SKM_UEFN_Mannequin');target=unreal.load_asset('/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple')
assert source and target
sr=tools.duplicate_asset('IK_TV_ReferenceSample',folder,unreal.load_asset(folder+'/IK_TV_RepairManny')) if not unreal.EditorAssetLibrary.does_asset_exist(folder+'/IK_TV_ReferenceSample') else unreal.load_asset(folder+'/IK_TV_ReferenceSample')
unreal.IKRigController.get_controller(sr).set_skeletal_mesh(source)
rtg=tools.create_asset('RTG_TV_ReferenceSample',folder,unreal.IKRetargeter,unreal.IKRetargetFactory()) if not unreal.EditorAssetLibrary.does_asset_exist(folder+'/RTG_TV_ReferenceSample') else unreal.load_asset(folder+'/RTG_TV_ReferenceSample')
c=unreal.IKRetargeterController.get_controller(rtg)
c.set_ik_rig(unreal.RetargetSourceOrTarget.SOURCE,sr);c.set_ik_rig(unreal.RetargetSourceOrTarget.TARGET,unreal.load_asset(folder+'/IK_TV_RepairManny'))
c.set_preview_mesh(unreal.RetargetSourceOrTarget.SOURCE,source);c.set_preview_mesh(unreal.RetargetSourceOrTarget.TARGET,target)
c.remove_all_ops();c.add_default_ops()
for ch in unreal.IKRigController.get_controller(sr).get_retarget_chains():c.set_source_chain(ch.chain_name,ch.chain_name)
c.auto_align_all_bones(unreal.RetargetSourceOrTarget.TARGET)
paths=['Crouch/M_Neutral_Transition_Stand_to_Crouch','Crouch/M_Neutral_Transition_Crouch_to_Stand','Idle/M_Neutral_Crouch_Idle_Loop','Sprint/M_Neutral_Sprint_Loop_F']
assets=[unreal.load_asset('/Game/Characters/UEFN_Mannequin/Animations/'+p) for p in paths]
result=unreal.IKRetargetBatchOperation.duplicate_and_retarget([registry.get_asset_by_object_path(a.get_path_name()) for a in assets],source,target,rtg,prefix='RT_',target_path=folder+'/Retargeted',include_referenced_assets=False,overwrite_existing_files=True)
for a in result:assert unreal.EditorAssetLibrary.save_asset(str(a.package_name))
with open(os.path.abspath(os.path.join(unreal.Paths.project_dir(),'../../.debug/repair-sample-retarget.json')),'w') as f:json.dump([str(a.package_name) for a in result],f,indent=2)
