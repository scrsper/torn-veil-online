"""Capture a live PIE humanoid acceptance stage.

Run while PIE is active and the canonical bridge is connected. The optional
TV_CAPTURE_LABEL identifies a stage such as idle, walk, run, combat, downed, or
manifestation-removal. This script only observes Unreal actors and the bridge
snapshot; it never edits actor or simulation state.
"""
import unreal, os, json, urllib.request

root = os.path.abspath(os.path.join(unreal.Paths.project_dir(), '../..'))
worlds = unreal.EditorLevelLibrary.get_pie_worlds(False)
if not worlds: raise RuntimeError('PIE must be running')
world = worlds[0]
with urllib.request.urlopen('http://127.0.0.1:8787/snapshot', timeout=3) as response: snap = json.load(response)
actors = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.TVCharacter)
native = [json.loads(a.presentation_diagnostics()) for a in actors]
by_body = {r['bodyId']: r for r in native}
player = unreal.GameplayStatics.get_player_character(world, 0)
assert player and json.loads(player.presentation_diagnostics())['bodyId'] == snap['controlledBodyId'], 'Wrong possessed manifestation'
rows = []
for body in snap.get('bodies', []):
    actor = by_body.get(body.get('bodyId'))
    row = {'bodyId': body.get('bodyId'), 'entityId': body.get('entityId'), 'canonical': body,
           'actorPresent': actor is not None}
    if actor:
        row.update(actor)
    rows.append(row)
label = globals().get('TV_CAPTURE_LABEL', 'humanoid-stage')
report = {'label': label, 'map': world.get_path_name(), 'playerId': snap.get('playerId'),
          'controlledBodyId': snap.get('controlledBodyId'), 'snapshotTick': snap.get('tick'),
          'nativeActors': native, 'actors': rows, 'pawn': player.get_name(),
          'actorCount': len(actors), 'bodyCount': len(snap.get('bodies', []))}
folder = os.environ.get('TV_EVIDENCE_FOLDER', os.path.join(root, 'docs/evidence/humanoid')); os.makedirs(folder, exist_ok=True)
with open(os.path.join(folder, label + '.json'), 'w') as f: json.dump(report, f, indent=2)
path = os.path.join(folder, label + '.png').replace('\\', '/')
globals()['HUMANOID_CAPTURE'] = unreal.AutomationLibrary.take_high_res_screenshot(1280, 720, path)
globals()['HUMANOID_REPORT'] = report
print('HUMANOID_PIE_CAPTURE', label, [(r['bodyId'], r['animation'].split('/')[-1], r['playedAttacks'], r['playedHits']) for r in native])
