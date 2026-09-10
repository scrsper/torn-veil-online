"""Read-only real-PIE acceptance. No relocation, body edits or input substitution.
Run after keyboard input with Invoke-EditorPython.ps1. Captures the current pawn/HUD.
Set TV_CAPTURE_LABEL in the invoking console for before/after/restart observations.
"""
import unreal, os, json, urllib.request, math
root=os.path.abspath(os.path.join(unreal.Paths.project_dir(),'../..'))
worlds=unreal.EditorLevelLibrary.get_pie_worlds(False)
assert worlds, 'Press Play first'
world=worlds[0]
bridge=next(b for b in unreal.ObjectIterator(unreal.TVBridgeSubsystem) if b.get_outer()==world)
assert bridge and bridge.is_live(), 'Canonical snapshot session is not LIVE'
assert bridge.get_editor_property('controls'), 'PIE has no controller ownership'
player=unreal.GameplayStatics.get_player_character(world,0)
assert player, 'No player pawn'
with urllib.request.urlopen('http://127.0.0.1:8787/snapshot',timeout=3) as response:
    snapshot=json.load(response)
body=next(b for b in snapshot['bodies'] if b['bodyId']==snapshot['controlledBodyId'])
regions=unreal.GameplayStatics.get_all_actors_of_class(world,unreal.TVRegionProjection)
center_id=bridge.get_editor_property('center_region')
center=next(r for r in regions if r.get_editor_property('region_id')==center_id)
base=center.get_editor_property('canonical_base')
terrain=center.get_component_by_class(unreal.ProceduralMeshComponent)
assert terrain and terrain.get_num_sections()>0, 'Center canonical terrain is missing'
p=body['pos']; actual=player.get_actor_location()
expected=unreal.Vector((p['x']-base.x)*100,(p['z']-base.y)*100,p['y']*100+90)
error=math.sqrt((actual.x-expected.x)**2+(actual.y-expected.y)**2+(actual.z-expected.z)**2)
assert error<250, 'Pawn is not reconciled near canonical position: '+str(error)
assert len(regions)<=9, 'Unbounded regional actors'
label=globals().get('TV_CAPTURE_LABEL','startup-pie')
report={'map':world.get_path_name(),'status':bridge.connection_status(),'live':bridge.is_live(),
        'controls':bridge.get_editor_property('controls'),'snapshotAge':bridge.get_editor_property('since_snapshot'),
        'snapshots':bridge.get_editor_property('snapshot_count'),'regions':len(regions),'center':center_id,
        'playerId':snapshot['playerId'],'controlledBodyId':snapshot['controlledBodyId'],'canonicalPosition':p,
        'worldTick':snapshot['tick'],'ack':snapshot['ack'],'pawn':player.get_name(),
        'unrealPosition':{'x':actual.x,'y':actual.y,'z':actual.z},'reconciliationErrorCm':error,
        'movementMode':str(player.character_movement.movement_mode),'centerTerrainSections':terrain.get_num_sections()}
folder=os.path.join(root,'docs/evidence/startup');os.makedirs(folder,exist_ok=True)
with open(os.path.join(folder,label+'.json'),'w') as f:json.dump(report,f,indent=2)
globals()['STARTUP_CAPTURE']=unreal.AutomationLibrary.take_high_res_screenshot(1280,720,os.path.join(folder,label+'.png').replace('\\','/'))
print('STARTUP_PIE_VERIFIED',json.dumps(report))
