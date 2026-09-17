"""Ordinary-PIE evidence recorder for Slice 3 acceptance.

Read-only per-render-frame telemetry over the ordinary playable map, paired with an external
60 fps screen recording. It spawns nothing, moves nothing, possesses nothing and mutates no
canonical state — it reads ATVCharacter::PresentationDiagnostics, which is itself read-only.

    TV_CAPTURE_LABEL = 'player-locomotion'
    TV_CAPTURE_SECONDS = 20
    exec(open('unreal/scripts/capture_life_slice3.py').read())

It records, per frame and per visible body: canonical identity, appearance signature, whether a
REAL character mesh is being drawn (visibleCharacter), activity family/detail/posture, the
occupied station kind and the applied occupancy offset. At the end it writes a summary that
names, explicitly, which of the nine Slice 3 acceptance items this take actually evidenced and
which it did not — a take that shows no NPC working says so rather than being filed as proof.

`visibleCharacter: false` for every body means the character palette resolved nothing on this
machine and the driver mannequin is what is on screen. That is recorded as a FAILED take.
"""
import json
import os
import time
import unreal

FIELDS = ('bodyId', 'entityId', 'pose', 'animation', 'activityFamily', 'activityDetail',
          'activityPosture', 'stationKind', 'appearanceSignature', 'visibleCharacter',
          'occupancyOffsetCm', 'possessed', 'incapacitated', 'dead')

# The nine acceptance items from the Slice 3 work order, expressed as things a frame can show.
ACCEPTANCE = {
    'customPlayerCharacter': lambda rows: any(r['possessed'] and r['visibleCharacter'] for r in rows),
    'distinctNpcs': lambda rows: len({r['appearanceSignature'] for r in rows
                                      if not r['possessed'] and r['visibleCharacter'] and r['appearanceSignature']}) >= 3,
    'playerLocomotion': lambda rows: any(r['possessed'] and r['activityFamily'] in ('travel', 'carry', 'flee') for r in rows),
    'npcLocomotion': lambda rows: any(not r['possessed'] and r['activityFamily'] in ('travel', 'carry') for r in rows),
    'npcWorking': lambda rows: any(not r['possessed'] and r['activityFamily'] == 'work' for r in rows),
    'lifeActivity': lambda rows: any(r['activityFamily'] in ('eat', 'drink', 'rest', 'socialize', 'trade') for r in rows),
    'dialogueWithModelledNpc': lambda rows: any(not r['possessed'] and r['visibleCharacter']
                                                and r['activityFamily'] == 'socialize' for r in rows),
    'returnToMovement': lambda rows: False,  # decided across the whole take below, not per frame
}

worlds = unreal.EditorLevelLibrary.get_pie_worlds(False)
assert len(worlds) == 1, 'Run ordinary Play in Editor first'
world = worlds[0]
assert world.get_name().endswith('TornVeilWorld'), 'Ordinary playable map required'

root = os.path.abspath(os.path.join(unreal.Paths.project_dir(), '../..'))
folder = os.path.join(root, '.debug/embodied-people-slice3')
os.makedirs(folder, exist_ok=True)
label = globals().get('TV_CAPTURE_LABEL', 'life-slice')
duration = min(120, max(1, globals().get('TV_CAPTURE_SECONDS', 20)))
started = time.perf_counter()
frames = []


def sample(_dt):
    age = time.perf_counter() - started
    rows = []
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.TVCharacter):
        try:
            state = json.loads(actor.presentation_diagnostics())
        except Exception:
            continue
        rows.append({key: state.get(key) for key in FIELDS})
    frames.append({'t': round(age, 4), 'bodies': rows})
    if age >= duration:
        unreal.unregister_slate_post_tick_callback(handle)
        finish()


def finish():
    flat = [row for frame in frames for row in frame['bodies']]
    # "Returned to movement" is a property of the take, not of one frame: the same possessed body
    # must be seen moving, then not moving, then moving again.
    player_families = [row['activityFamily'] for frame in frames for row in frame['bodies'] if row['possessed']]
    moving = [f in ('travel', 'carry', 'flee') for f in player_families]
    transitions = sum(1 for i in range(1, len(moving)) if moving[i] != moving[i - 1])
    evidenced = {name: bool(check(flat)) for name, check in ACCEPTANCE.items()}
    evidenced['returnToMovement'] = transitions >= 2

    modelled = sum(1 for row in flat if row['visibleCharacter'])
    summary = {
        'label': label,
        'seconds': round(time.perf_counter() - started, 3),
        'frames': len(frames),
        'bodiesSeen': len({row['bodyId'] for row in flat if row['bodyId']}),
        'distinctAppearances': len({row['appearanceSignature'] for row in flat if row['appearanceSignature']}),
        'framesDrawingRealCharacters': modelled,
        'activityFamilies': sorted({row['activityFamily'] for row in flat if row['activityFamily']}),
        'stationKinds': sorted({row['stationKind'] for row in flat if row['stationKind']}),
        'evidenced': evidenced,
        'notEvidencedByThisTake': sorted(name for name, ok in evidenced.items() if not ok),
        # A take drawing only the driver mannequin is not Slice 3 evidence, whatever else it shows.
        'status': 'FAILED_NO_VISIBLE_CHARACTERS' if modelled == 0 else
                  'PARTIAL' if any(not ok for ok in evidenced.values()) else 'COMPLETE',
    }
    with open(os.path.join(folder, f'{label}.json'), 'w') as handle:
        json.dump({'summary': summary, 'frames': frames}, handle, indent=2)
    print('LIFE_SLICE3_CAPTURE', json.dumps(summary))


handle = unreal.register_slate_post_tick_callback(sample)
print('LIFE_SLICE3_RECORDING', label, duration)
