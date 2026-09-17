"""Observe the actual PIE projection and request an in-engine image. Run in interactive editor."""
import unreal, json, os, math, time
root=os.path.abspath(os.path.join(unreal.Paths.project_dir(),'../..'))
label=globals().get('TV_CAPTURE_LABEL','playable-shell')
evidence=os.path.join(root,'docs','evidence','foundational-gameplay')
os.makedirs(evidence,exist_ok=True)
def reject(message):
    with open(os.path.join(evidence,label+'.json'),'w') as f:
        json.dump({'status':'failed','error':message},f,indent=2)
    raise RuntimeError(message)
worlds=unreal.EditorLevelLibrary.get_pie_worlds(False)
if not worlds:
    reject('PIE must be running')
world=worlds[0]
if not world.get_name().endswith('TornVeilWorld'):
    reject('Wrong PIE map: '+world.get_path_name())
lighting_error=unreal.TVPlayableLighting.validate_daylight(world, True)
if lighting_error:
    reject('PIE lighting validation: '+lighting_error)
regions=unreal.GameplayStatics.get_all_actors_of_class(world,unreal.TVRegionProjection)
if not regions: reject('No canonical regions have reached the client')
if len(regions) != 9:
    reject('Wait for all 9 resident regions before capturing; got '+str(len(regions)))
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
terrain_sections=sum(c.get_num_sections() for r in regions for c in r.get_components_by_class(unreal.ProceduralMeshComponent))
if not all(r['pcg_generated'] for r in counts) or sum(r['instances'] for r in counts)<100 or terrain_sections<9:
    reject('Region presentation/PCG is not ready')
sun=unreal.GameplayStatics.get_all_actors_of_class(world,unreal.DirectionalLight)[0]
sky=unreal.GameplayStatics.get_all_actors_of_class(world,unreal.SkyLight)[0]
post=unreal.GameplayStatics.get_all_actors_of_class(world,unreal.PostProcessVolume)[0]
lighting={'valid':True,'viewMode':'Lit', 'sunLux':sun.light_component.get_editor_property('intensity'),
          'sunPitch':sun.get_actor_rotation().pitch,'sunYaw':sun.get_actor_rotation().yaw,
          'sunMobility':str(sun.light_component.get_editor_property('mobility')),
          'skyIntensity':sky.light_component.get_editor_property('intensity'),
          'skyRealtimeCapture':sky.light_component.get_editor_property('real_time_capture'),
          'skyAtmospheres':len(unreal.GameplayStatics.get_all_actors_of_class(world,unreal.SkyAtmosphere)),
          'exposureMinEV100':post.settings.get_editor_property('auto_exposure_min_brightness'),
          'exposureMaxEV100':post.settings.get_editor_property('auto_exposure_max_brightness'),
          'exposureCompensation':post.settings.get_editor_property('auto_exposure_bias'),
          'lumenGIMethod':unreal.SystemLibrary.get_console_variable_int_value('r.DynamicGlobalIlluminationMethod')}
report={'status':'capturing','map':world.get_path_name(),'regions':counts,'terrainSections':terrain_sections,'characterActors':len(characters),'wildlifeActors':len(wildlife),'wildlifeDiagnostics':wildlife_diagnostics,'allActors':len(unreal.GameplayStatics.get_all_actors_of_class(world,unreal.Actor)), 'lighting':lighting}
with open(os.path.join(evidence,label+'.json'),'w') as f: json.dump(report,f,indent=2)
player=unreal.GameplayStatics.get_player_character(world,0)
if not player: reject('Run Play, not Simulate: no player manifestation exists')
pos=player.get_actor_location()
camera_yaw=globals().get('TV_CAMERA_YAW',135)
if wildlife:
    target=wildlife[0].get_actor_location();delta=target-pos
    camera_yaw=math.degrees(math.atan2(delta.y,delta.x))
unreal.GameplayStatics.get_player_controller(world,0).set_control_rotation(unreal.Rotator(pitch=-20,yaw=camera_yaw,roll=0))
output=os.path.join(evidence,label+'.png').replace('\\','/')
# Allow real-frame camera settling; success requires the completed GPU capture's pixels.
def begin_checked_capture(world, report, output, report_path):
    state={'started':time.monotonic(), 'requested':False}
    def finish(status, error=''):
        unreal.unregister_slate_post_tick_callback(state['handle'])
        report['status']=status
        if error: report['error']=error
        with open(report_path,'w') as f: json.dump(report,f,indent=2)
        if status=='passed': print('PLAYABLE_PIE_VERIFIED',output)
        else: unreal.log_error('PLAYABLE_PIE_FAILED: '+error)
    def tick(_delta):
        try:
            elapsed=time.monotonic()-state['started']
            if elapsed>45:
                finish('failed','Timed out waiting for a completed rendered screenshot'); return
            if not state['requested'] and elapsed>=1:
                state['request_time']=time.time()
                state['task']=unreal.AutomationLibrary.take_high_res_screenshot(1280,720,output)
                state['requested']=True
            elif state['requested'] and os.path.isfile(output) and os.path.getmtime(output)>=state['request_time']:
                error=unreal.TVPlayableLighting.validate_daylight(world, True)
                if error: finish('failed',error); return
                metrics=json.loads(unreal.TVPlayableLighting.rendered_frame_diagnostics(output))
                report['renderedFrame']=metrics
                finish('passed' if metrics['passed'] else 'failed',metrics['error'])
        except Exception as error:
            finish('failed',str(error))
    state['handle']=unreal.register_slate_post_tick_callback(tick)
begin_checked_capture(world,report,output,os.path.join(evidence,label+'.json'))
