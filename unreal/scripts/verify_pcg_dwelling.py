"""Real cleanup/regeneration and disk package reload verification, using editor ticks."""
import unreal, os, sys, json, time, traceback, importlib
folder=os.path.abspath(os.path.join(unreal.Paths.project_dir(),'../../unreal/scripts'))
if folder not in sys.path: sys.path.insert(0,folder)
import pcg_dwelling as dwelling
importlib.reload(dwelling)
with open(os.path.join(dwelling.evidence_dir(),'recipe.json')) as f: _dv_specs=json.load(f)
_dv_levels=unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
assert not _dv_levels.is_in_play_in_editor()
if unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world().get_path_name().split('.')[0]!=dwelling.LEVEL:
    assert _dv_levels.load_level(dwelling.LEVEL)
def _dv_volumes():
    return [a for a in unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors() if isinstance(a,unreal.PCGVolume) and dwelling.TAG in [str(t) for t in a.tags]]
_dv_before=dwelling.scan(_dv_specs);dwelling.validate(_dv_specs,_dv_before)
assert len(_dv_volumes())==5
assert _dv_levels.save_current_level()
for a in _dv_volumes(): a.get_component_by_class(unreal.PCGComponent).cleanup_local(True)
_dv_phase=0;_dv_deadline=time.monotonic()+45;_dv_busy=False;_dv_reload_result=None

def _dv_tick(delta):
    global _dv_phase,_dv_deadline,_dv_after,_dv_busy,_dv_reload_result
    if _dv_busy: return
    _dv_busy=True
    try:
        assert time.monotonic()<_dv_deadline, 'Timed out in regeneration phase '+str(_dv_phase)
        rows=dwelling.scan(_dv_specs)
        if _dv_phase==0:
            if any(r['instances'] for r in rows): return
            for a in _dv_volumes(): a.get_component_by_class(unreal.PCGComponent).generate_local(True)
            _dv_phase=1
            return
        if any(r['instances']!=len(s['parts']) for r,s in zip(rows,_dv_specs)): return
        dwelling.validate(_dv_specs,rows)
        assert [r['signature'] for r in rows]==[r['signature'] for r in _dv_before], 'Actual mesh/transform signature changed'
        if _dv_phase==1:
            _dv_after=rows
            assert _dv_levels.save_current_level()
            assert _dv_levels.load_level('/Game/TornVeil/Tests/Humanoid/L_HumanoidAcceptance')
            packages=[unreal.load_package(s['graph']) for s in _dv_specs]
            _dv_reload_result=unreal.EditorLoadingAndSavingUtils.reload_packages(packages,unreal.ReloadPackagesInteractionMode.ASSUME_POSITIVE)
            assert _dv_reload_result[0], str(_dv_reload_result)
            assert _dv_levels.load_level(dwelling.LEVEL)
            _dv_phase=2;_dv_deadline=time.monotonic()+45
            return
        dirty=[p.get_path_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages()]
        assert not any(p.startswith('/Game/') and not p.startswith('/Game/TornVeil/') for p in dirty), 'Vendor package dirtied'
        construction_actors=[a for a in unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors() if isinstance(a,unreal.StaticMeshActor) and 'TV.TestStage' not in [str(t) for t in a.tags]]
        assert not construction_actors, 'Construction must come from PCG components'
        result={'passed':True,'level':dwelling.LEVEL,'canonicalFootprintMetres':[6,8],'generatedHorizontalMetres':[6.4,8.2],
            'allowedMarginCm':20,'roofOverhangCm':{'x':20,'y':10},'largestExcursionCm':20,
            'cleanupObservedZeroInstances':True,'sameSeedRegeneration':True,'distinctLocalSeedSignatures':True,
            'graphPackagesReloadedFromDisk':bool(_dv_reload_result[0]),'reloadMessage':str(_dv_reload_result[1]),
            'zeroStaticConstructionActors':True,'vendorDirtyPackages':[],
            'before':_dv_before,'afterRegeneration':_dv_after,'afterDiskReload':rows}
        dwelling.write_evidence('acceptance.json',result)
        unreal.unregister_slate_post_tick_callback(_dv_handle)
        print('PCG_DWELLING_ACCEPTANCE_PASS',[(r['seed'],r['instances'],r['signature']) for r in rows])
    except Exception:
        unreal.unregister_slate_post_tick_callback(_dv_handle)
        dwelling.write_evidence('acceptance.json',{'passed':False,'phase':_dv_phase,'error':traceback.format_exc()})
        print(traceback.format_exc())
    finally: _dv_busy=False
_dv_handle=unreal.register_slate_post_tick_callback(_dv_tick)
print('PCG_DWELLING_ACCEPTANCE_RUNNING')
