"""Run a timed live PIE acceptance against humanoidFixtureServer.ts on loopback.
Uses native key bindings for locomotion/attack, and explicit canonical fixture stages.
Never waits on the editor thread. Results include assertions and actual playback counts.
"""
import unreal, json, os, time, urllib.request, traceback

_ha_root = os.path.abspath(os.path.join(unreal.Paths.project_dir(), '../..'))
_ha_capture = os.path.join(_ha_root, 'unreal/scripts/capture_humanoid_acceptance.py')
_ha_worlds = unreal.EditorLevelLibrary.get_pie_worlds(False)
assert len(_ha_worlds) == 1, 'Start exactly one PIE session first'
_ha_world = _ha_worlds[0]
# Frame the canonical fixture along +X so knockback does not put the target behind
# the starting camera. This changes only the viewer, never a canonical transform.
unreal.GameplayStatics.get_player_controller(_ha_world,0).set_control_rotation(unreal.Rotator(pitch=-18,yaw=0,roll=0))
_ha_checks = []
_ha_reports = {}

def _ha_stage(name):
    request = urllib.request.Request('http://127.0.0.1:8787/fixture/stage/' + name, method='POST')
    with urllib.request.urlopen(request, timeout=3) as response: return json.load(response)

def _ha_command(text):
    unreal.SystemLibrary.execute_console_command(_ha_world, text)

def _ha_capture_stage(label):
    global TV_CAPTURE_LABEL
    TV_CAPTURE_LABEL = label
    exec(compile(open(_ha_capture, encoding='utf-8').read(), _ha_capture, 'exec'), globals())
    _ha_reports[label] = HUMANOID_REPORT
    return HUMANOID_REPORT

def _ha_player(report):
    return next(r for r in report['nativeActors'] if r['bodyId'] == report['controlledBodyId'])

def _ha_require(condition, label):
    assert condition, label
    _ha_checks.append(label)

def _ha_idle():
    r = _ha_capture_stage('idle')
    p = _ha_player(r)
    _ha_require(p['possessed'] and p['movementMode'] == 0, 'ordinary canonical body is possessed with local movement disabled')
    _ha_require('BS_Idle_Walk_Run' in p['animation'] and p['speedCmPerSecond'] == 0, 'idle locomotion asset active')
    _ha_require(len(r['nativeActors']) >= 3, 'NPC and its second manifestation use the same native substrate')

def _ha_walk():
    current=json.loads(unreal.GameplayStatics.get_player_character(_ha_world,0).presentation_diagnostics())
    if current['pose']!='walk' or current['filteredBlendSpeed']<=20:return False
    p = _ha_player(_ha_capture_stage('walk'))
    _ha_require(p['pose'] == 'walk' and p['speedCmPerSecond'] > 20, 'native held W produces canonical walk')
    _ha_require(p['blendDirection'] == 0 and p['blendSpeed'] > 20 and p['filteredBlendSpeed'] > 20, 'walk drives the actual Blend Space speed axis')

def _ha_run():
    current=json.loads(unreal.GameplayStatics.get_player_character(_ha_world,0).presentation_diagnostics())
    if current['pose']!='run' or current['filteredBlendSpeed']<=_ha_player(_ha_reports['walk'])['filteredBlendSpeed']:return False
    p = _ha_player(_ha_capture_stage('run'))
    _ha_require(p['pose'] == 'run' and p['speedCmPerSecond'] > _ha_player(_ha_reports['walk'])['speedCmPerSecond'], 'native W plus Shift produces canonical run')
    _ha_require(p['filteredBlendSpeed'] > _ha_player(_ha_reports['walk'])['filteredBlendSpeed'], 'run drives the jog samples of the actual Blend Space')

def _ha_stop():
    p = _ha_player(_ha_capture_stage('stop'))
    _ha_require(p['speedCmPerSecond'] == 0, 'native release returns to idle')
    _ha_require(p['blendSpeed'] == 0, 'stop returns the actual Blend Space to idle samples')

def _ha_npc_walk():
    r = _ha_capture_stage('npc-walk')
    _ha_require(any(not b['possessed'] and b['pose'] == 'walk' and b['filteredBlendSpeed'] > 20 for b in r['nativeActors']), 'canonical NPC path following drives the same locomotion Blend Space')

def _ha_native_attack():
    player = unreal.GameplayStatics.get_player_character(_ha_world, 0)
    player.select_target(); player.attack()

def _ha_combat():
    r = _ha_capture_stage('native-attack')
    _ha_require(any('MM_Attack_01' in b['animation'] for b in r['nativeActors']), 'canonical native attack input plays attack animation')
    _ha_require(any('A_TV_HitReact_Front' in b['animation'] for b in r['nativeActors']), 'canonical hit plays the full-pose target reaction')

def _ha_burst_finished():
    r = _ha_capture_stage('burst-replayed')
    p = _ha_player(r)
    _ha_require(p['playedAttacks'] >= 4 and p['pendingAttacks'] == 0, 'initial attack plus all three batched attacks played')
    _ha_require(any(b['playedHits'] >= 4 for b in r['nativeActors']), 'all batched hit reactions played')
    _ha_require(all(b['skippedAttacks'] == 0 and b['skippedHits'] == 0 for b in r['nativeActors']), 'tested combat burst was not coalesced')

def _ha_removed():
    r = _ha_capture_stage('manifestation-removal')
    ids = {b['bodyId'] for b in r['nativeActors']}
    _ha_require('b_43' not in ids and 'b_1' in ids, 'one removed manifestation does not remove its sibling')

def _ha_downed():
    r = _ha_capture_stage('downed')
    _ha_require(any(b['incapacitated'] and 'A_TV_Downed' in b['animation'] for b in r['nativeActors']), 'canonical downing overrides ordinary locomotion with collapse animation')

def _ha_downed_held():
    actors=unreal.GameplayStatics.get_all_actors_of_class(_ha_world,unreal.TVCharacter)
    current=[json.loads(a.presentation_diagnostics()) for a in actors]
    target=next(b for b in current if b['bodyId']=='b_1')
    if target['animationTime']<1.6 or target['headHeightCm']>=45 or target['pelvisHeightCm']>=45:return False
    r=_ha_capture_stage('downed-held')
    target=next(b for b in r['nativeActors'] if b['bodyId']=='b_1')
    _ha_require(target['incapacitated'] and target['animationTime']>=1.6 and 0<target['headHeightCm']<45 and 0<target['pelvisHeightCm']<45, 'incapacitated body reaches and holds a measured prone pose')

def _ha_death():
    r = _ha_capture_stage('death-withdrawal')
    _ha_require(not any(b['bodyId'] in ('b_1', 'b_43') for b in r['nativeActors']), 'canonical death withdrawal removes native manifestations')

_ha_steps = [(.5, _ha_idle), (.3, lambda: _ha_command('TV.TestMoveKey W 1.8')), (.7, _ha_walk),
    (1.6, lambda: (_ha_command('TV.TestMoveKey LeftShift 2'), _ha_command('TV.TestMoveKey W 1.8'))),
    (.7, _ha_run), (1.6, _ha_stop), (.2, lambda: _ha_stage('arrange_combat')),
    (.4, lambda: _ha_stage('npc_walk')), (.7, _ha_npc_walk), (.2, lambda: _ha_stage('arrange_combat')),
    (.5, _ha_native_attack), (.25, _ha_combat), (1.0, lambda: _ha_stage('burst')),
    (.25, lambda: _ha_capture_stage('burst-queued')), (3.5, _ha_burst_finished),
    (.2, lambda: _ha_stage('npc_attack')), (.25, lambda: _ha_capture_stage('npc-attack')),
    (1.0, lambda: _ha_stage('remove_twin')), (.4, _ha_removed), (.2, lambda: _ha_stage('down')),
    (1.4, _ha_downed), (1.2, _ha_downed_held), (.2, lambda: _ha_stage('death')), (.8, _ha_death)]
_ha_stage('arrange_combat')
_ha_index = 0
_ha_busy = False
_ha_deadline = time.monotonic() + _ha_steps[0][0]
_ha_observation_timeout = _ha_deadline + 8

def _ha_finish(error=None):
    unreal.unregister_slate_post_tick_callback(_ha_handle)
    result = {'passed': error is None, 'checks': _ha_checks, 'captures': list(_ha_reports), 'error': error,
        'note': 'Native input and actual canonical fixture; NPC goto is fixture-seeded, death withdraws rather than leaving a corpse.'}
    path = os.path.join(_ha_root, 'docs/evidence/humanoid/native-acceptance.json')
    with open(path, 'w') as f: json.dump(result, f, indent=2)
    print('HUMANOID_ACCEPTANCE_RESULT', json.dumps(result))

def _ha_tick(delta):
    global _ha_index, _ha_deadline, _ha_busy, _ha_observation_timeout
    if _ha_busy or time.monotonic() < _ha_deadline: return
    _ha_busy = True
    try:
        # A screenshot can delay a game tick; wait for an observed native state instead
        # of asserting against a snapshot received before the injected key was processed.
        if _ha_steps[_ha_index][1]() is False:
            assert time.monotonic()<_ha_observation_timeout, 'Timed out waiting for native stage '+str(_ha_index)
            _ha_deadline=time.monotonic()+.1
            return
        _ha_index += 1
        if _ha_index == len(_ha_steps): _ha_finish(); return
        _ha_deadline = time.monotonic() + _ha_steps[_ha_index][0]
        _ha_observation_timeout = _ha_deadline + 8
    except Exception:
        _ha_finish(traceback.format_exc())
    finally:
        _ha_busy = False

_ha_handle = unreal.register_slate_post_tick_callback(_ha_tick)
print('HUMANOID_ACCEPTANCE_RUNNING')
