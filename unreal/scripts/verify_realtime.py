"""Native realtime movement acceptance for a live PIE session.

Run from the Unreal editor's Python console while exactly one PIE world is active
and the canonical bridge is LIVE. The harness uses the same native console input
path as a keyboard and the reflected hand interaction; it never edits transforms,
canonical state, or the fixture server.
"""
import json, os, time, traceback
import unreal

_root = os.path.abspath(os.path.join(unreal.Paths.project_dir(), '../..'))
_worlds = unreal.EditorLevelLibrary.get_pie_worlds(False)
assert len(_worlds) == 1, 'Start exactly one PIE session'
_world = _worlds[0]
_bridge = next((b for b in unreal.ObjectIterator(unreal.TVBridgeSubsystem) if b.get_outer() == _world), None)
assert _bridge and _bridge.is_live(), 'Canonical bridge is not LIVE'
_player = unreal.GameplayStatics.get_player_character(_world, 0)
assert _player, 'No possessed native pawn'

_samples = []
_dispatches = []
_errors = []
_started = time.monotonic()
_last = _started
_phase = 0
_busy = False
_interaction_sent = False

# Ten short movement bursts exercise prediction/reconciliation repeatedly while
# keeping the acceptance short enough for editor use. Each key command releases
# through TVStartupAutomation's timer, so this remains the real native binding.
_steps = []
for _ in range(10):
    _steps.append(('walk', 'TV.TestMoveKey W 0.18', 0.25))
    _steps.append(('sprint', 'TV.TestMoveKey LeftShift 0.20', 0.08))
    _steps.append(('sprint-walk', 'TV.TestMoveKey W 0.18', 0.25))
    # No key command here: the prior W timer has released, and this dwell samples
    # the stopped state without injecting another movement press.
    _steps.append(('stop', None, 0.30))
_steps.append(('hand-interaction', None, 1.0))

_schedule = []
_cursor = 0.0
for _name, _command_text, _duration in _steps:
    _schedule.append(_cursor)
    _cursor += _duration
_total_duration = _cursor

def _command(text):
    unreal.SystemLibrary.execute_console_command(_world, text)

def _diag():
    try:
        raw = _bridge.realtime_diagnostics()
        return json.loads(raw) if isinstance(raw, str) else raw
    except Exception as exc:
        _errors.append('realtime_diagnostics: ' + str(exc))
        return {}

def _sample(now):
    global _last
    p = _player.get_actor_location()
    v = _player.get_velocity()
    _samples.append({
        'wallSeconds': now - _started,
        'frameDt': now - _last,
        'fps': 1.0 / max(now - _last, 1e-6),
        'positionCm': {'x': p.x, 'y': p.y, 'z': p.z},
        'velocityCmPerSecond': {'x': v.x, 'y': v.y, 'z': v.z},
        'bridge': _diag(),
    })
    _last = now

def _finish(error=None):
    try:
        unreal.unregister_slate_post_tick_callback(_handle)
    except Exception:
        pass
    distances = []
    for a, b in zip(_samples, _samples[1:]):
        ap, bp = a['positionCm'], b['positionCm']
        distances.append(((bp['x'] - ap['x']) ** 2 + (bp['y'] - ap['y']) ** 2 + (bp['z'] - ap['z']) ** 2) ** .5)
    result = {
        'passed': error is None and bool(_samples),
        'world': _world.get_path_name(),
        'durationSeconds': time.monotonic() - _started,
        'steps': [name for name, _, _ in _steps],
        'dispatches': _dispatches,
        'samples': _samples,
        'maxFrameDisplacementCm': max(distances or [0]),
        'interactionSent': _interaction_sent,
        'errors': _errors,
        'error': error,
        'note': 'Native key dispatch through TV.TestMoveKey; no relocation or canonical fixture edits.',
    }
    if error is None:
        travelled = sum(((b['positionCm']['x'] - a['positionCm']['x']) ** 2 + (b['positionCm']['y'] - a['positionCm']['y']) ** 2 + (b['positionCm']['z'] - a['positionCm']['z']) ** 2) ** .5 for a, b in zip(_samples, _samples[1:]))
        tail = distances[-max(1, min(8, len(distances))):]
        prediction_ready = any(bool(s.get('bridge', {}).get('predictionReady')) for s in _samples)
        prediction_count = max([s.get('bridge', {}).get('predictionCount', 0) for s in _samples] or [0])
        result['movementAssertions'] = {
            'travelledCm': travelled,
            'moved': travelled > 1.0,
            # Engine-state proxy: canonical prediction/reconciliation telemetry is
            # authoritative for this check; pawn velocity is presentation-owned.
            'predictionReady': prediction_ready and prediction_count > 0,
            'stoppedTail': max(tail or [0]) < 5.0,
            'handInteractionDispatched': _interaction_sent,
        }
        result['passed'] = all(result['movementAssertions'].values())
    folder = os.environ.get('TV_EVIDENCE_FOLDER', os.path.join(_root, 'docs/evidence/realtime'))
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, 'native-pie.json'), 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2)
    print('REALTIME_NATIVE_PIE_RESULT', json.dumps({'passed': result['passed'], 'samples': len(_samples), 'dispatches': len(_dispatches), 'error': error}))

def _tick(delta):
    global _phase, _busy, _interaction_sent
    now = time.monotonic()
    _sample(now)
    if _busy:
        return
    elapsed = now - _started
    if _phase >= len(_steps):
        if elapsed >= _total_duration:
            _finish()
        return
    if elapsed < _schedule[_phase]:
        return
    _busy = True
    try:
        name, command, _ = _steps[_phase]
        if command:
            _command(command)
            _dispatches.append({'phase': _phase, 'name': name, 'command': command, 'wallSeconds': now - _started})
        elif name == 'hand-interaction':
            _player.interact()
            _interaction_sent = True
            _dispatches.append({'phase': _phase, 'name': name, 'wallSeconds': now - _started})
        _phase += 1
    except Exception:
        _finish(traceback.format_exc())
        return
    finally:
        _busy = False

_handle = unreal.register_slate_post_tick_callback(_tick)
print('REALTIME_NATIVE_PIE_RUNNING', len(_steps), 'steps')
