"""Measure actual imported mesh bounds and animation poses, not filename assumptions."""
import unreal,json,os
root=os.path.abspath(os.path.join(unreal.Paths.project_dir(),'../..'))
mesh=unreal.load_asset('/Game/TornVeil/Wildlife/Deer/SKM_Deer');assert mesh
report={'mesh':mesh.get_path_name(),'clips':[]}
try:report['importedBounds']=str(mesh.get_editor_property('imported_bounds'))
except Exception as e:report['boundsError']=str(e)
opts=unreal.AnimPoseEvaluationOptions()
for name in ['Idle','Walk','Gallop','Eating','Death','Idle_Headlow']:
    a=unreal.load_asset('/Game/TornVeil/Wildlife/Deer/AN_Deer_'+name);assert a
    pose=unreal.AnimPoseExtensions.get_anim_pose_at_time(a,0,opts)
    bones=unreal.AnimationLibrary.get_animation_track_names(a)
    coords={str(b):str(unreal.AnimPoseExtensions.get_bone_pose(pose,b,unreal.AnimPoseSpaces.WORLD).translation)for b in bones}
    report['clips'].append({'name':name,'length':a.get_play_length(),'skeleton':a.get_editor_property('skeleton').get_path_name(),'bones':coords})
with open(os.path.join(root,'docs/evidence/foundational-gameplay/retrofit/deer-import-inspection.json'),'w')as f:json.dump(report,f,indent=2)
print('DEER_INSPECTED',json.dumps(report)[:180])
