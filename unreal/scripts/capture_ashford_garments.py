"""Photograph and measure what the Ashford wardrobe put on screen in a live PIE session.

Read-only with respect to simulation: it reads the bridge snapshot and the Unreal actors, and it
moves only the PIE camera.

    TV_CAPTURE_LABEL   evidence folder under docs/evidence/ashford-garments/
                       a `-group` suffix frames everyone nearby, `-face` a head-and-shoulders,
                       anything else one full figure; a `-male` / `-female` suffix picks by the
                       resident's own cut rather than by name.

Run through Invoke-EditorPython.ps1 while PIE is running.

What it measures, beyond taking a picture: for every visible resident, which of their parts come
from the Ashford set and which are still vendor content. That is the number this slice lives or
dies by, and a screenshot cannot be cross-examined about it.
"""
import collections
import json
import math
import os
import time

import unreal
import urllib.request

LABEL = globals().get('TV_CAPTURE_LABEL') or 'ashford'
SHOT = ('face' if LABEL.endswith('face') else
        'group' if LABEL.endswith('group') else 'closeup')
WANT_CUT = 'female' if 'female' in LABEL else 'male' if 'male' in LABEL else ''

ASHFORD = '/Game/TornVeil/Characters/Ashford/'
GARMENT_SLOTS = ('upperGarment', 'lowerGarment', 'footwear')

root = os.path.abspath(os.path.join(unreal.Paths.project_dir(), '../..'))
out = os.path.join(root, 'docs/evidence/ashford-garments', LABEL)
os.makedirs(out, exist_ok=True)

worlds = unreal.EditorLevelLibrary.get_pie_worlds(False)
assert worlds, 'PIE must be running'
world = worlds[0]

try:
    with urllib.request.urlopen('http://127.0.0.1:8787/snapshot', timeout=5) as response:
        snapshot = json.load(response)
except Exception as error:
    snapshot = {'error': str(error), 'bodies': []}
canonical = {body.get('bodyId'): body for body in snapshot.get('bodies', [])}


def piece_of(path):
    """`SKM_TV_Kosode_Work_female_nrw` -> `Kosode_Work`. The garment, not the fit variant."""
    name = path.rsplit('/', 1)[-1]
    if not name.startswith('SKM_TV_'):
        return None
    parts = name[len('SKM_TV_'):].rsplit('_', 2)
    return parts[0] if len(parts) == 3 else name[len('SKM_TV_'):]


rows = []
for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.TVCharacter):
    presentation = json.loads(actor.presentation_diagnostics())
    visible = actor.get_component_by_class(unreal.TVCharacterPresentation)
    embodiment = json.loads(visible.embodiment_diagnostics()) if visible else {}
    body = canonical.get(presentation.get('bodyId'), {})
    location = actor.get_actor_location()

    meshes, ashford, vendor = [], [], []
    if visible:
        asset = visible.get_skeletal_mesh_asset()
        if asset:
            meshes.append({'slot': 'body', 'mesh': asset.get_path_name().split('.')[0]})
        for child in visible.get_children_components(True):
            if isinstance(child, unreal.SkeletalMeshComponent):
                part = child.get_skeletal_mesh_asset()
                if part:
                    path = part.get_path_name().split('.')[0]
                    meshes.append({'slot': 'part', 'mesh': path})
                    (ashford if path.startswith(ASHFORD) else vendor).append(path)
            elif isinstance(child, unreal.GroomComponent):
                groom = child.get_editor_property('groom_asset')
                if groom:
                    meshes.append({'slot': 'groom', 'mesh': groom.get_path_name().split('.')[0]})

    # Clothing, as opposed to a head or a hand. Anything from a crowd pack that is not a face or a
    # body mesh is a garment this wardrobe has failed to replace, and saying so by name is the
    # point of the exercise.
    modern = [p for p in vendor
              if '/CitySampleCrowd/' in p and 'FaceMesh' not in p and not p.endswith('_body')]
    rotation = actor.get_actor_rotation()
    rows.append({
        'bodyId': presentation.get('bodyId'),
        'name': body.get('name') or presentation.get('bodyId'),
        'occupation': body.get('occupation'),
        'location': [location.x, location.y, location.z],
        'yaw': rotation.yaw,
        'posture': presentation.get('activityPosture'),
        'activity': presentation.get('activityFamily'),
        'embodiment': embodiment,
        'meshes': meshes,
        'ashfordPieces': sorted({piece_of(p) for p in ashford if piece_of(p)}),
        'ashfordParts': len(ashford),
        'modernGarments': sorted(p.rsplit('/', 1)[-1] for p in modern),
        'fit': next((p.rsplit('_', 2)[-2] + '_' + p.rsplit('_', 1)[-1]
                     for p in ashford), None),
    })

rows.sort(key=lambda row: (row['name'] or ''))
visible_rows = [r for r in rows if r['embodiment'].get('visibleCharacter')]
dressed = [r for r in visible_rows if r['ashfordPieces']]
outfits = collections.Counter(tuple(r['ashfordPieces']) for r in dressed)

report = {
    'label': LABEL, 'shot': SHOT,
    'actors': len(rows),
    'visibleCharacters': len(visible_rows),
    'retargeted': sum(1 for r in rows if r['embodiment'].get('retargeted')),
    'unresolvedSlots': sum(r['embodiment'].get('unresolvedSlots', 0) for r in rows),
    'wearingAshford': len(dressed),
    'stillWearingModern': sum(1 for r in visible_rows if r['modernGarments']),
    'modernGarmentsByPerson': {r['name']: r['modernGarments']
                               for r in visible_rows if r['modernGarments']},
    'distinctAshfordOutfits': len(outfits),
    'outfitCounts': {'+'.join(k): v for k, v in outfits.most_common()},
    'largestIdenticalGroup': max(outfits.values()) if outfits else 0,
    'fitsUsed': dict(collections.Counter(r['fit'] for r in dressed if r['fit'])),
    'pieceUsage': dict(collections.Counter(p for r in dressed for p in r['ashfordPieces'])),
    'people': rows,
}
print('TV_ASHFORD_PIE actors=%d visible=%d dressedAshford=%d stillModern=%d '
      'distinctOutfits=%d largestIdentical=%d unresolved=%d'
      % (report['actors'], report['visibleCharacters'], report['wearingAshford'],
         report['stillWearingModern'], report['distinctAshfordOutfits'],
         report['largestIdenticalGroup'], report['unresolvedSlots']))
print('TV_ASHFORD_PIECES %s' % report['pieceUsage'])
print('TV_ASHFORD_FITS %s' % report['fitsUsed'])
for row in visible_rows:
    print('  %-22s %-12s ashford=%-2d %s%s'
          % ((row['name'] or '')[:22], (row['occupation'] or '-')[:12], row['ashfordParts'],
             '+'.join(row['ashfordPieces']) or '-',
             ('  MODERN:' + ','.join(row['modernGarments'])) if row['modernGarments'] else ''))

# --- camera ------------------------------------------------------------------------------------
targets = visible_rows or rows
if WANT_CUT:
    matching = [r for r in targets if r['fit'] and r['fit'].startswith(WANT_CUT)]
    if matching:
        targets = matching
    else:
        print('TV_ASHFORD_CUT_ABSENT no visible %s resident in Ashford dress' % WANT_CUT)
# Prefer somebody actually wearing the new clothes, and among those the one wearing the most of
# them: a photograph of a resident whose silhouette happens to want no sash is not the clearest
# evidence about a wardrobe whose sash is the point.
targets = [r for r in targets if r['ashfordPieces']] or targets
# Standing first. The framing below places the camera at a standing figure's chest height, and a
# resident caught mid-kneel at a workbench is both badly framed and the worst possible pose for
# judging how a hakama hangs. Posture is canonical state the presentation layer already reports.
targets.sort(key=lambda r: (0 if (r['posture'] or 'stand') == 'stand' else 1,
                            -len(r['ashfordPieces']), r['name'] or ''))

if targets:
    if SHOT == 'group':
        RADIUS = 900.0

        def near(anchor, pool):
            return [r for r in pool
                    if math.hypot(r['location'][0] - anchor['location'][0],
                                  r['location'][1] - anchor['location'][1]) <= RADIUS]

        anchor = max(targets, key=lambda r: len(near(r, targets)))
        targets = near(anchor, targets)
        cx = sum(r['location'][0] for r in targets) / len(targets)
        cy = sum(r['location'][1] for r in targets) / len(targets)
        cz = sum(r['location'][2] for r in targets) / len(targets)
        reach = max(math.hypot(r['location'][0] - cx, r['location'][1] - cy) for r in targets)
        distance = max(330.0, min(1.5 * reach + 260.0, 1300.0))
        centre = unreal.Vector(cx, cy, cz + 10)
        eye = unreal.Vector(cx - distance * .93, cy - distance * .36, cz + distance * .22 + 70)
        print('TV_ASHFORD_GROUP members=%d distance=%.0f' % (len(targets), distance))
    else:
        target = targets[0]
        base = unreal.Vector(*target['location'])
        height, distance = (152, 95) if SHOT == 'face' else (100, 185)
        centre = unreal.Vector(base.x, base.y, base.z - 88 + height)
        facing = math.radians(target.get('yaw', 0.0) + 28)
        eye = unreal.Vector(centre.x + distance * math.cos(facing),
                            centre.y + distance * math.sin(facing),
                            centre.z + (6 if SHOT == 'face' else 16))
        print('TV_ASHFORD_SUBJECT %s (%s) wearing %s'
              % (target['name'], target['occupation'], '+'.join(target['ashfordPieces'])))
        report['subject'] = {'name': target['name'], 'occupation': target['occupation'],
                             'pieces': target['ashfordPieces'], 'fit': target['fit'],
                             'meshes': target['meshes']}

    forward = unreal.Vector(centre.x - eye.x, centre.y - eye.y, centre.z - eye.z)
    yaw = math.degrees(math.atan2(forward.y, forward.x))
    pitch = math.degrees(math.atan2(forward.z, math.hypot(forward.x, forward.y)))
    # The camera manager cannot be teleported -- the possessed pawn's spring arm rewrites its
    # transform every frame. A standalone CameraActor made the view target is the only framing
    # that survives the next tick, and Python cannot spawn into the PIE world, so the actor is
    # placed in the editor world by `prepare_capture_camera.py` and arrives here as PIE's
    # duplicate of it. (Established by capture_foundry_people.py; same mechanism, same tag.)
    controller = unreal.GameplayStatics.get_player_controller(world, 0)
    cameras = [a for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.CameraActor)
               if a.tags and 'TV_FoundryCapture' in [str(t) for t in a.tags]]
    if cameras and controller:
        cameras[0].set_actor_location_and_rotation(eye, unreal.Rotator(0, pitch, yaw), False, False)
        controller.set_view_target_with_blend(cameras[0], 0.0)
        report['framed'] = True
    else:
        report['framed'] = False
        print('TV_ASHFORD_CAMERA_MISSING run prepare_capture_camera.py first; using gameplay camera')
    print('TV_ASHFORD_CAMERA eye=%.0f,%.0f,%.0f yaw=%.1f pitch=%.1f' % (eye.x, eye.y, eye.z, yaw, pitch))

shot = os.path.join(out, '%s.png' % LABEL)
# A tick has to elapse between the view-target swap and the grab, or the screenshot still
# contains the previous camera's frame.
unreal.SystemLibrary.delay(world, 0.35, unreal.LatentActionInfo())
unreal.AutomationLibrary.take_high_res_screenshot(1920, 1080, shot)
report['screenshot'] = shot
print('TV_ASHFORD_SHOT %s' % shot)

with open(os.path.join(out, 'garments.json'), 'w', encoding='utf-8') as handle:
    json.dump(report, handle, indent=1)
print('TV_ASHFORD_REPORT %s' % os.path.join(out, 'garments.json'))
