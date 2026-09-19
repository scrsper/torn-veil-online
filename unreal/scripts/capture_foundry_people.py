"""Observe and photograph what the Character Foundry actually put on screen in a live PIE session.

Read-only with respect to simulation: it reads the bridge snapshot and Unreal actors, and it only
moves the PIE *camera*. Nothing canonical, and no actor state, is written.

    TV_CAPTURE_LABEL   evidence folder name under docs/evidence/foundry-real-people/
    TV_FOCUS           optional substring of a canonical name to frame close up
    TV_SHOT            'closeup' (default) | 'group' | 'face'

Run through Invoke-EditorPython.ps1 while PIE is running.
"""
import collections
import json
import math
import os
import time
import unreal
import urllib.request

LABEL = globals().get('TV_CAPTURE_LABEL') or 'foundry-people'
FOCUS = globals().get('TV_FOCUS') or ''
# Invoke-EditorPython only forwards a label, so the shot type is taken from the label's suffix:
# `...-face` frames a head-and-shoulders, `...-group` frames everyone, anything else a full figure.
SHOT = globals().get('TV_SHOT') or (
    'face' if LABEL.endswith('face') else 'group' if LABEL.endswith('group') else 'closeup')

root = os.path.abspath(os.path.join(unreal.Paths.project_dir(), '../..'))
out = os.path.join(root, 'docs/evidence/foundry-real-people', LABEL)
os.makedirs(out, exist_ok=True)

worlds = unreal.EditorLevelLibrary.get_pie_worlds(False)
assert worlds, 'PIE must be running'
world = worlds[0]

try:
    with urllib.request.urlopen('http://127.0.0.1:8787/snapshot', timeout=5) as response:
        snapshot = json.load(response)
except Exception as error:               # evidence is still worth capturing without the bridge
    snapshot = {'error': str(error), 'bodies': []}
canonical = {body.get('bodyId'): body for body in snapshot.get('bodies', [])}

rows = []
actors = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.TVCharacter)
for actor in actors:
    presentation = json.loads(actor.presentation_diagnostics())
    visible = actor.get_component_by_class(unreal.TVCharacterPresentation)
    embodiment = json.loads(visible.embodiment_diagnostics()) if visible else {}
    body = canonical.get(presentation.get('bodyId'), {})
    location = actor.get_actor_location()
    meshes = []
    if visible:
        asset = visible.get_skeletal_mesh_asset()
        if asset:
            meshes.append({'slot': 'body', 'mesh': asset.get_path_name().split('.')[0]})
        # Parts are runtime-created children; read them off the component tree rather than from
        # the profile, so what is reported is what is actually instantiated and rendering.
        for child in visible.get_children_components(True):
            if isinstance(child, unreal.SkeletalMeshComponent):
                part = child.get_skeletal_mesh_asset()
                if part:
                    meshes.append({'slot': 'part', 'mesh': part.get_path_name().split('.')[0]})
            elif isinstance(child, unreal.GroomComponent):
                groom = child.get_editor_property('groom_asset')
                if groom:
                    meshes.append({'slot': 'groom', 'mesh': groom.get_path_name().split('.')[0]})
    rotation = actor.get_actor_rotation()
    rows.append({
        'bodyId': presentation.get('bodyId'),
        'name': body.get('name') or presentation.get('bodyId'),
        'occupation': body.get('occupation'),
        'location': [location.x, location.y, location.z],
        'yaw': rotation.yaw,
        'presentation': presentation,
        'embodiment': embodiment,
        'meshes': meshes,
    })

rows.sort(key=lambda row: (row['name'] or ''))
report = {'label': LABEL, 'shot': SHOT, 'focus': FOCUS, 'actors': len(rows),
          'visibleCharacters': sum(1 for r in rows if r['embodiment'].get('visibleCharacter')),
          'retargeted': sum(1 for r in rows if r['embodiment'].get('retargeted')),
          'unresolvedSlots': sum(r['embodiment'].get('unresolvedSlots', 0) for r in rows),
          'people': rows}
# Which vendor family each visible person's body came from: the one number that says whether the
# population is drawing on everything installed or quietly collapsing onto a single pack.
families = collections.Counter()
for row in rows:
    body = next((m['mesh'] for m in row['meshes'] if m['slot'] == 'body'), None)
    if body:
        families[body.split('/')[2]] += 1
report['bodyFamilies'] = dict(families)
distinct = {kind: len({m['mesh'] for r in rows for m in r['meshes'] if m['slot'] == kind})
            for kind in ('body', 'part', 'groom')}
report['distinctMeshes'] = distinct
print('TV_FOUNDRY_FAMILIES %s distinct=%s' % (dict(families), distinct))
print('TV_FOUNDRY_PIE actors=%d visible=%d retargeted=%d unresolved=%d' % (
    report['actors'], report['visibleCharacters'], report['retargeted'], report['unresolvedSlots']))
for row in rows:
    print('  %-22s %-12s visible=%-5s retargeted=%-5s parts=%-2s unresolved=%s' % (
        (row['name'] or '')[:22], (row['occupation'] or '-')[:12],
        row['embodiment'].get('visibleCharacter'), row['embodiment'].get('retargeted'),
        row['embodiment'].get('parts'), row['embodiment'].get('unresolvedSlots')))
    for mesh in row['meshes']:
        print('      %-6s %s' % (mesh['slot'], mesh['mesh']))

# --- camera ------------------------------------------------------------------------------------
# Screenshots come from the PIE viewport, so framing is done by placing the player camera manager's
# view target. Only the camera moves.
# A label may also name a vendor family (`...-polytope-face`), which selects by the body mesh's
# content root rather than by person name: the proof that a family's pose adapter works has to be a
# photograph of somebody actually on that rig, and canonical names say nothing about which pack.
FAMILY_ROOTS = {'polytope': '/Game/Polytope_Studio/', 'quantum': '/Game/QuantumCharacter/',
                'city': '/Game/CitySampleCrowd/'}
family = next((root for key, root in FAMILY_ROOTS.items() if key in LABEL.lower()), None)
if family:
    targets = [r for r in rows if any(m['slot'] == 'body' and m['mesh'].startswith(family) for m in r['meshes'])]
    if not targets:
        print('TV_FOUNDRY_FAMILY_ABSENT no visible body from', family)
        targets = rows
elif FOCUS:
    targets = [r for r in rows if FOCUS.lower() in (r['name'] or '').lower()]
else:
    targets = rows
targets = [r for r in targets if r['embodiment'].get('visibleCharacter')] or targets
if targets:
    if SHOT == 'group':
        # Frame the densest neighbourhood, not the centroid of everyone. Residents are spread over
        # a whole settlement, and averaging across a couple of outliers aims the camera at empty
        # ground between clusters -- which is exactly what the first attempt photographed. Pick the
        # person with the most company inside one screen's worth of ground and frame their group.
        RADIUS = 900.0

        def near(anchor, rows):
            return [r for r in rows
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
        print('TV_FOUNDRY_GROUP members=%d reach=%.0f distance=%.0f centre=%.0f,%.0f'
              % (len(targets), reach, distance, cx, cy))
    else:
        # Stand in front of the person, not at a fixed world angle: a character facing away is a
        # photograph of a haircut. The offset is three-quarter rather than dead-on so the
        # silhouette still reads, which is what a face or costume judgement actually needs.
        target = targets[0]
        base = unreal.Vector(*target['location'])
        height, distance = (152, 95) if SHOT == 'face' else (100, 240)
        centre = unreal.Vector(base.x, base.y, base.z - 88 + height)
        facing = math.radians(target.get('yaw', 0.0) + 28)
        eye = unreal.Vector(centre.x + distance * math.cos(facing),
                            centre.y + distance * math.sin(facing),
                            centre.z + (6 if SHOT == 'face' else 18))
        print('TV_FOUNDRY_SUBJECT %s' % (target['name'],))
    forward = unreal.Vector(centre.x - eye.x, centre.y - eye.y, centre.z - eye.z)
    yaw = math.degrees(math.atan2(forward.y, forward.x))
    flat = math.hypot(forward.x, forward.y)
    pitch = math.degrees(math.atan2(forward.z, flat))
    # The camera manager cannot simply be teleported: the possessed pawn's spring arm rewrites its
    # transform every frame, so the shot came out as whatever the gameplay camera was already
    # showing. Giving the controller a standalone CameraActor as its view target is the only
    # framing that survives the next tick. The pawn itself is untouched.
    controller = unreal.GameplayStatics.get_player_controller(world, 0)
    rotator = unreal.Rotator(0, pitch, yaw)
    # Python cannot spawn into the PIE world, so the capture camera is placed in the editor world
    # by prepare_capture_camera.py and arrives here as PIE's duplicate of it. Without it the shot
    # is still taken, from the gameplay camera, and the report says the framing was not applied.
    cameras = [a for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.CameraActor)
               if a.tags and 'TV_FoundryCapture' in [str(t) for t in a.tags]]
    if cameras:
        cameras[0].set_actor_location_and_rotation(eye, rotator, False, False)
        controller.set_view_target_with_blend(cameras[0], 0.0)
        report['framed'] = True
    else:
        report['framed'] = False
        print('TV_FOUNDRY_CAMERA_MISSING run prepare_capture_camera.py first; using gameplay camera')
    print('TV_FOUNDRY_CAMERA eye=%.0f,%.0f,%.0f yaw=%.1f pitch=%.1f framing=%s' % (
        eye.x, eye.y, eye.z, yaw, pitch, targets[0]['name']))

shot = os.path.join(out, '%s-%s.png' % (LABEL, SHOT))
# One tick has to elapse between the view-target swap and the grab, or the screenshot
# still contains the previous camera's frame.
unreal.SystemLibrary.delay(world, 0.35, unreal.LatentActionInfo())
unreal.AutomationLibrary.take_high_res_screenshot(1920, 1080, shot)
print('TV_FOUNDRY_SHOT', shot)
report['screenshot'] = shot
with open(os.path.join(out, 'embodiment.json'), 'w', encoding='utf-8') as stream:
    json.dump(report, stream, indent=2)
