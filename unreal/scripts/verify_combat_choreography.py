"""Timed live PIE observation of the shared combat substrate. Run against the disposable
combatChoreographyFixtureServer.ts only. HTTP stage calls are explicit canonical test setup;
all observations come from actual native actors. Does not block the editor thread.
"""
import unreal, os, json, time, urllib.request, traceback

_cc_root=os.path.abspath(os.path.join(unreal.Paths.project_dir(),'../..'))
_cc_out=os.path.join(_cc_root,'docs/evidence/combat-choreography')
os.makedirs(_cc_out,exist_ok=True)
_cc_worlds=unreal.EditorLevelLibrary.get_pie_worlds(False)
assert len(_cc_worlds)==1,'Start exactly one PIE session'
_cc_world=_cc_worlds[0]
_cc_map_path=_cc_world.get_path_name()
_cc_camera=next(a for a in unreal.GameplayStatics.get_all_actors_of_class(_cc_world,unreal.CameraActor) if 'TV.CombatShowcase.Camera' in [str(t) for t in a.tags])
_cc_pc=unreal.GameplayStatics.get_player_controller(_cc_world,0)
_cc_pc.get_hud().set_editor_property('show_hud',False)
_cc_pc.set_view_target_with_blend(_cc_camera,0)
_cc_stages=[('near','strike'),('far','strike'),('left','strike'),('right','strike'),('low','strike'),('capable','strike'),
    ('force','strike'),('precision','strike'),('signature','signature'),('signature','signature'),('burst','burst'),('npc_duel','npc_duel'),('magic','magic'),('lod2','strike')]
_cc_reports=[];_cc_index=-1;_cc_begin=0;_cc_fired=False;_cc_before={};_cc_frames=[];_cc_shot=False
_cc_checks=[];_cc_maxoffset=0;_cc_handle=None;_cc_done=False
_cc_extra=set()
_cc_frame_fields=['bodyId','position','choreographySeq','choreographyAge','presentationHoldSeconds','presentationOffsetCm',
    'maxChoreographyActorDriftCm','alignmentYaw','leanDegrees','plannedContactErrorCm','measuredContactErrorCm',
    'complexity','control','force','signatureSeed','primitive','magicFixture','choreographyLOD']

def _cc_http(path,post=False):
    req=urllib.request.Request('http://127.0.0.1:8787/'+path,method='POST' if post else 'GET')
    with urllib.request.urlopen(req,timeout=3) as r:return json.load(r)
def _cc_read():
    return [json.loads(a.presentation_diagnostics()) for a in unreal.GameplayStatics.get_all_actors_of_class(_cc_world,unreal.TVCharacter)]
def _cc_next():
    global _cc_index,_cc_begin,_cc_fired,_cc_before,_cc_frames,_cc_shot,_cc_extra
    _cc_index+=1
    if _cc_index>=len(_cc_stages):return False
    name,action=_cc_stages[_cc_index]
    _cc_http('fixture/stage/arrange_'+('near' if name=='lod2' else name),True)
    _cc_begin=unreal.GameplayStatics.get_time_seconds(_cc_world);_cc_fired=False;_cc_before={r['bodyId']:r for r in _cc_read()};_cc_frames=[];_cc_shot=False;_cc_extra=set()
    return True
def _cc_finish(error=None):
    global _cc_done
    _cc_done=True
    if _cc_handle:unreal.unregister_slate_post_tick_callback(_cc_handle)
    _cc_checks.append({'check':'presentation offset <=22 cm','passed':_cc_maxoffset<=22.01})
    if not error and len(_cc_reports)==len(_cc_stages):
        def fighter(stage):
            s=_cc_reports[stage];return next(r for r in s['after'] if r['bodyId']==s['canonicalAction']['actorBodyId'])
        low,capable=fighter(4),fighter(5)
        _cc_checks.append({'check':'capability unlocks pivot/stepping complexity','passed':low['complexity']<capable['complexity']})
        for i,limit in [(0,2),(1,18),(2,2),(3,2)]:
            alignment_error=fighter(i)['measuredContactErrorCm']
            _cc_checks.append({'check':f'{_cc_reports[i]["name"]}: measured recorded-target alignment','passed':alignment_error<=limit,'errorCm':alignment_error,'limitCm':limit})
        a,b=fighter(8),fighter(9)
        _cc_checks.append({'check':'repeated technique keeps signature and primary gesture','passed':a['signatureSeed']==b['signatureSeed'] and a['primitive']==b['primitive']})
        _cc_checks.append({'check':'fixture composes body motion and magic cue','passed':fighter(12)['magicFixture']})
        far=fighter(13)
        _cc_checks.append({'check':'far presentation uses LOD2','passed':far['choreographyLOD']==2})
    summary={'passed':not error and all(c['passed'] for c in _cc_checks),'error':error,'checks':_cc_checks,'stages':_cc_reports,
        'maxOffsetCm':_cc_maxoffset,'map':_cc_map_path,'fixtureOnly':True}
    with open(os.path.join(_cc_out,'native-acceptance.json'),'w') as f:json.dump(summary,f,indent=2)
    print('COMBAT_ACCEPTANCE_COMPLETE',summary['passed'],len(_cc_checks),error)
def _cc_tick(dt):
    global _cc_fired,_cc_maxoffset,_cc_shot,TV_COMBAT_CAPTURE
    try:
        elapsed=unreal.GameplayStatics.get_time_seconds(_cc_world)-_cc_begin
        name,action=_cc_stages[_cc_index]
        if not _cc_fired and elapsed>=.7:
            actor_id='b_1' if name=='npc_duel' else 'b_42'
            body=next(a for a in unreal.GameplayStatics.get_all_actors_of_class(_cc_world,unreal.TVCharacter) if json.loads(a.presentation_diagnostics())['bodyId']==actor_id)
            focus=body.get_actor_location()+unreal.Vector(65,0,0)
            location=focus+unreal.Vector(0,-3000 if name=='lod2' else -520,110)
            _cc_camera.set_actor_location(location,False,False)
            _cc_camera.set_actor_rotation(unreal.MathLibrary.find_look_at_rotation(location,focus),False)
            _cc_http('fixture/stage/'+action,True);_cc_fired=True
        if not _cc_fired:return
        rows=_cc_read()
        for r in rows:_cc_maxoffset=max(_cc_maxoffset,r['presentationOffsetCm'])
        active=[r for r in rows if r['choreographyActive']]
        if active:
            _cc_frames.append({'elapsed':round(elapsed,4),'actors':[{k:r[k] for k in _cc_frame_fields} for r in active]})
            if not _cc_shot and any(r['presentationHoldSeconds']>0 for r in active):
                TV_COMBAT_CAPTURE=unreal.AutomationLibrary.take_high_res_screenshot(1280,720,os.path.join(_cc_out,f'{_cc_index:02d}-{name}.png'))
                _cc_shot=True
            elif name in ['low','capable']:
                actor=next((r for r in active if r['bodyId']=='b_42'),None)
                if actor:
                    phase='anticipation' if .075<actor['choreographyAge']<.15 else 'recovery' if actor['choreographyAge']>.46 else None
                    if phase and phase not in _cc_extra:
                        _cc_extra.add(phase)
                        TV_COMBAT_CAPTURE=unreal.AutomationLibrary.take_high_res_screenshot(1280,720,os.path.join(_cc_out,f'{_cc_index:02d}-{name}-{phase}.png'))
        if elapsed < (4.2 if action=='burst' else 2.25):return
        fixture=_cc_http('fixture');after={r['bodyId']:r for r in rows};last=fixture['actions'][-1]
        actor=last['actorBodyId'];target=last['targetBodyId'];expected=last['canonicalHits']
        attacked=after[actor]['playedAttacks']-_cc_before[actor]['playedAttacks'];hit=after[target]['playedHits']-_cc_before[target]['playedHits']
        _cc_checks.append({'check':f'{_cc_index}:{name} distinct attacks/reactions','passed':attacked==expected and hit==expected,'attacks':attacked,'reactions':hit,'expected':expected})
        _cc_checks.append({'check':f'{_cc_index}:{name} movement authority disabled','passed':all(r['movementMode']==0 for r in rows)})
        _cc_checks.append({'check':f'{_cc_index}:{name} returns to zero offset','passed':all(r['presentationOffsetCm']<.01 for r in rows)})
        _cc_checks.append({'check':f'{_cc_index}:{name} choreography cannot move actor root','passed':all(r['maxChoreographyActorDriftCm']<.001 for r in rows)})
        holds=[r for f in _cc_frames for r in f['actors'] if r['presentationHoldSeconds']>0]
        _cc_checks.append({'check':f'{_cc_index}:{name} local pose hold with unchanged world dilation','passed':(not holds if name=='lod2' else bool(holds)) and unreal.GameplayStatics.get_global_time_dilation(_cc_world)==1})
        played=after[actor]['playedChoreographySequences']
        _cc_checks.append({'check':f'{_cc_index}:{name} semantic event sequences replay in order','passed':played[-len(last['seqs']):]==last['seqs']})
        _cc_reports.append({'name':name,'action':action,'canonicalAction':last,'frames':_cc_frames,'after':rows,'snapshotTick':fixture['snapshot']['tick']})
        if not _cc_next():_cc_finish()
    except Exception:_cc_finish(traceback.format_exc())

_cc_next()
_cc_handle=unreal.register_slate_post_tick_callback(_cc_tick)
print('COMBAT_ACCEPTANCE_STARTED',len(_cc_stages))
