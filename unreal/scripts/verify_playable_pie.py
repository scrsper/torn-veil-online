"""Observe the actual PIE projection and request an in-engine image. Run in interactive editor."""
import unreal, json, os, math
root=os.path.abspath(os.path.join(unreal.Paths.project_dir(),'../..'))
worlds=unreal.EditorLevelLibrary.get_pie_worlds(False)
if not worlds:
    raise RuntimeError('PIE must be running')
world=worlds[0]
regions=unreal.GameplayStatics.get_all_actors_of_class(world,unreal.TVRegionProjection)
if not regions: raise RuntimeError('No canonical regions have reached the client')
counts=[]
for region in regions:
    components=region.get_components_by_class(unreal.InstancedStaticMeshComponent)
    counts.append({'actor':region.get_name(),'location':str(region.get_actor_location()),'instances':sum(c.get_instance_count() for c in components),'components':len(components),
                   'collision':[str(c.get_collision_enabled()) for c in components], 'pcg_generated':region.get_component_by_class(unreal.PCGComponent).get_editor_property('generated'), 'pcg_ms':region.get_editor_property('pcg_milliseconds'), 'meshes':{c.get_editor_property('static_mesh').get_name():c.get_instance_count() for c in components if c.get_editor_property('static_mesh')}})
characters=unreal.GameplayStatics.get_all_actors_of_class(world,unreal.TVCharacter)
wildlife=unreal.GameplayStatics.get_all_actors_of_class(world,unreal.TVWildlifePresentation)
wildlife_diagnostics=[]
for animal in wildlife:
    try: wildlife_diagnostics.append(json.loads(animal.presentation_diagnostics()))
    except Exception as error: wildlife_diagnostics.append({'actor':animal.get_name(),'diagnosticsError':str(error)})
report={'map':world.get_path_name(),'regions':counts,'characterActors':len(characters),'wildlifeActors':len(wildlife),'wildlifeDiagnostics':wildlife_diagnostics,'allActors':len(unreal.GameplayStatics.get_all_actors_of_class(world,unreal.Actor))}
label=globals().get('TV_CAPTURE_LABEL','playable-shell')
evidence=os.path.join(root,'docs','evidence','foundational-gameplay')
os.makedirs(evidence,exist_ok=True)
with open(os.path.join(evidence,label+'.json'),'w') as f: json.dump(report,f,indent=2)
player=unreal.GameplayStatics.get_player_character(world,0)
if not player: raise RuntimeError('Run Play, not Simulate: no player manifestation exists')
pos=player.get_actor_location()
camera_yaw=globals().get('TV_CAMERA_YAW',135)
if wildlife:
    target=wildlife[0].get_actor_location();delta=target-pos
    camera_yaw=math.degrees(math.atan2(delta.y,delta.x))
unreal.GameplayStatics.get_player_controller(world,0).set_control_rotation(unreal.Rotator(pitch=-20,yaw=camera_yaw,roll=0))
output=os.path.join(evidence,label+'.png').replace('\\','/')
globals()['TV_CAPTURE']=unreal.AutomationLibrary.take_high_res_screenshot(1280,720,output)
print('PLAYABLE_PIE_VERIFIED',len(regions),len(characters),output)
