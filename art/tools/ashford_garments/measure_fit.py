"""Measure the City Sample fit targets in Blender, so the Ashford garments are built to numbers.

Run headless:
    blender --background --python art/tools/ashford_garments/measure_fit.py

Reads the machine-local vendor exports under `.debug/ashford-garments/` and writes
`.debug/ashford-garments/fit-measurements.json`.

## What the first run of this script established, and why it changed the design

The plan was to shape garments against the nude body meshes. There are none. Measured here:
`f_tal_nrw_body` is 10,942 vertices spanning z 0.84-1.02 m, and every one of its top-weighted
bones is a finger -- **the City Sample `*_body` mesh is two hands.** (`docs/evidence/foundry-real-people/REAL_ASSET_VALIDATION.md` §2
states these are complete nude bodies; that is wrong, and the correction matters because it
decides what each new garment has to contain.)

The real modular contract, read off the vendor meshes' own material sections:

| mesh | geometry | skin it carries |
| --- | --- | --- |
| `*_body` | two hands | hands |
| `*_FaceMesh` | head | head, neck, upper chest |
| `*_turtleneck` etc. | torso + arms | none |
| `*_slacks` / `*_skirt` | legs | **bare feet**, as a second `M_BodySynthesized` section |
| `*_oxfords` etc. | shoe shell over those feet | none |

So the fit surface to build against is the vendor *clothing*, not a body; a hakama has to bring
feet with it or the resident has none; and an open collar is trusting the face mesh, whose reach
is measured here as the lowest point of the vendor's own open necklines.
"""
import json
import os

import bpy
from mathutils import Vector

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
IN = os.path.join(REPO, '.debug', 'ashford-garments')
OUT = os.path.join(IN, 'fit-measurements.json')

BUILDS = ['female_nrw', 'female_ovw', 'female_unw', 'male_nrw', 'male_ovw', 'male_unw']
REGIONS = ['turtleneck', 'slacks', 'oxfords']

# Heights to take a horizontal width reading at, named for what they constrain on the garment.
# Absolute metres in the bind pose: every build shares one skeleton, so the anatomy is at the same
# height on all six and a fraction-of-height scheme would only add noise.
BANDS = {
    'collar': 1.44, 'shoulder': 1.38, 'chest': 1.26, 'underbust': 1.18, 'waist': 1.05,
    'hip': 0.94, 'thigh': 0.80, 'knee': 0.47, 'calf': 0.33, 'ankle': 0.12,
}

# Bones every Ashford garment is described in terms of. Read from the rig rather than assumed.
KEY_BONES = [
    'root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'spine_04', 'spine_05',
    'neck_01', 'head', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
    'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r',
]


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load(path):
    bpy.ops.import_scene.fbx(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    armatures = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    return meshes, armatures


def world_verts(obj):
    m = obj.matrix_world
    return [m @ v.co for v in obj.data.vertices]


def section_bounds(obj):
    """Per-material-section extents. This is the measurement that exposed what each vendor mesh
    actually contains -- a whole-mesh bounding box hides a 3,000-triangle patch of bare feet."""
    m = obj.matrix_world
    per = {}
    for poly in obj.data.polygons:
        name = obj.material_slots[poly.material_index].name if obj.material_slots else 'none'
        entry = per.setdefault(name, {'tris': 0, 'vi': set()})
        entry['tris'] += len(poly.vertices) - 2
        entry['vi'].update(poly.vertices)
    out = {}
    for name, entry in per.items():
        pts = [m @ obj.data.vertices[i].co for i in entry['vi']]
        out[name] = {
            'tris': entry['tris'], 'verts': len(entry['vi']),
            'x': [round(min(p.x for p in pts), 3), round(max(p.x for p in pts), 3)],
            'y': [round(min(p.y for p in pts), 3), round(max(p.y for p in pts), 3)],
            'z': [round(min(p.z for p in pts), 3), round(max(p.z for p in pts), 3)],
        }
    return out


def dominant_bones(obj, limit=8):
    counts = {}
    for v in obj.data.vertices:
        for g in v.groups:
            if g.weight > 0.3:
                name = obj.vertex_groups[g.group].name
                counts[name] = counts.get(name, 0) + 1
    return sorted(counts.items(), key=lambda kv: -kv[1])[:limit]


# A horizontal slab of a standing figure is a bad measurement: at chest height it contains the
# A-posed arms, and at knee height it contains *two* legs, so "width" comes out as a stance. Every
# vertex already knows which bone drives it, so the limb is the reliable partition.
LIMB_PREFIXES = {
    'torso': ('pelvis', 'spine_', 'neck_', 'clavicle_'),
    'arm': ('upperarm', 'lowerarm', 'hand_', 'thumb', 'index', 'middle', 'ring', 'pinky'),
    'leg': ('thigh', 'calf', 'foot_', 'ball_'),
}


def limb_of(name):
    for limb, prefixes in LIMB_PREFIXES.items():
        if any(name.startswith(p) for p in prefixes):
            return limb
    return None


def tagged_points(obj):
    """(world position, limb, side) per vertex, limb taken from its heaviest bone."""
    m = obj.matrix_world
    out = []
    for v in obj.data.vertices:
        best, weight = None, 0.0
        for g in v.groups:
            if g.weight > weight:
                best, weight = obj.vertex_groups[g.group].name, g.weight
        if best is None:
            continue
        limb = limb_of(best)
        if limb is None:
            continue
        p = m @ v.co
        out.append((p, limb, 'l' if p.x >= 0 else 'r'))
    return out


def section_at(points, z, tol, limb, side=None):
    """The enclosing radius of one limb at one height: centre, and half-extents about it."""
    slab = [p for p, lb, sd in points
            if lb == limb and abs(p.z - z) <= tol and (side is None or sd == side)]
    if len(slab) < 8:
        return None
    xs = [p.x for p in slab]
    ys = [p.y for p in slab]
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    return {'cx': round(cx, 4), 'cy': round(cy, 4),
            'rx': round((max(xs) - min(xs)) / 2, 4), 'ry': round((max(ys) - min(ys)) / 2, 4),
            'n': len(slab)}


def measure_build(name):
    """The clothed fit surface of one build: what a new garment has to enclose."""
    out = {'regions': {}, 'torso': {}, 'leg': {}, 'arm': {}}
    points = []
    for region in REGIONS:
        clear()
        meshes, _ = load(os.path.join(IN, 'fit', '%s_%s.fbx' % (name, region)))
        for m in meshes:
            points.extend(tagged_points(m))
            out['regions'][region] = {
                'mesh': m.name, 'verts': len(m.data.vertices),
                'tris': sum(len(p.vertices) - 2 for p in m.data.polygons),
                'sections': section_bounds(m), 'bones': dominant_bones(m),
                'uv_layers': [l.name for l in m.data.uv_layers],
            }
    for band, z in BANDS.items():
        torso = section_at(points, z, 0.015, 'torso')
        if torso:
            out['torso'][band] = torso
        leg = section_at(points, z, 0.015, 'leg', side='l')
        if leg:
            out['leg'][band] = leg
    return out


def measure_arm(name, chain):
    """Arm radius along the arm's own axis. Height bands are useless here: the arm is A-posed, so
    a horizontal slab through it cuts a long diagonal ellipse rather than a sleeve cross-section."""
    clear()
    meshes, _ = load(os.path.join(IN, 'fit', '%s_turtleneck.fbx' % name))
    pts = [p for p, limb, side in tagged_points(meshes[0]) if limb == 'arm' and side == 'l']
    segs = []
    total = 0.0
    for a, b in zip(chain, chain[1:]):
        d = (b - a).length
        segs.append((a, b, d, total))
        total += d
    bins = {}
    for p in pts:
        best = None
        for a, b, d, start in segs:
            axis = (b - a) / d
            t = max(0.0, min(d, (p - a).dot(axis)))
            radial = (p - (a + axis * t)).length
            s = (start + t) / total
            if best is None or radial < best[1]:
                best = (s, radial)
        key = round(best[0] * 10) / 10
        bins.setdefault(key, []).append(best[1])

    # A percentile, not the maximum. Vertices near the armpit are weighted to `upperarm` but sit
    # on the chest, so they project onto the shoulder end of the chain at a radius that describes
    # the torso rather than the sleeve; one of them is enough to poison a max.
    def p90(values):
        ordered = sorted(values)
        return ordered[min(len(ordered) - 1, int(len(ordered) * 0.90))]

    return {str(k): {'r': round(p90(v), 4), 'rmax': round(max(v), 4), 'n': len(v)}
            for k, v in sorted(bins.items())}


def measure_rig(name):
    clear()
    meshes, armatures = load(os.path.join(IN, 'fit', '%s_turtleneck.fbx' % name))
    if not armatures:
        return None
    arm = armatures[0]
    bones = {}
    for b in arm.data.bones:
        bones[b.name] = {
            'head': [round(c, 4) for c in (arm.matrix_world @ b.head_local)],
            'tail': [round(c, 4) for c in (arm.matrix_world @ b.tail_local)],
            'parent': b.parent.name if b.parent else None,
        }
    return {
        'armature': arm.name, 'boneCount': len(bones),
        'key': {k: bones[k] for k in KEY_BONES if k in bones},
        'missingKey': [k for k in KEY_BONES if k not in bones],
        'allBones': sorted(bones),
    }


def measure_seams():
    """Where bare skin starts and stops on the vendor's own garments."""
    out = {}
    for label in ('scoopneck_f', 'skirt_f', 'crewneck_m'):
        path = os.path.join(IN, 'seams', '%s.fbx' % label)
        if not os.path.exists(path):
            continue
        clear()
        meshes, _ = load(path)
        for m in meshes:
            out[label] = {'sections': section_bounds(m), 'bones': dominant_bones(m),
                          'tris': sum(len(p.vertices) - 2 for p in m.data.polygons)}
    return out


def main():
    result = {'builds': {}, 'rig': None, 'seams': {}, 'spread': {}, 'bodyMeshIsHandsOnly': None}

    # Restate the finding as a measurement rather than a comment, so a future pack swap re-tests it.
    clear()
    meshes, _ = load(os.path.join(IN, 'bodies', 'female_nrw_body.fbx'))
    hand_bones = [b for b, _ in dominant_bones(meshes[0], limit=6)]
    result['bodyMeshIsHandsOnly'] = {
        'mesh': meshes[0].name, 'verts': len(meshes[0].data.vertices),
        'sections': section_bounds(meshes[0]), 'dominantBones': dominant_bones(meshes[0]),
        'allHandBones': all(('hand' in b or 'finger' in b or 'thumb' in b or 'metacarpal' in b
                             or 'arm_twist' in b) for b in hand_bones),
    }
    print('TV_FIT body-mesh-is-hands=%s' % result['bodyMeshIsHandsOnly']['allHandBones'])

    # Per build, not once. A USkeleton is a bone *hierarchy*; each skeletal mesh carries its own
    # reference pose. All six City Sample builds bind to `SK_Base`, and their bind poses differ --
    # the male arm sits 6 cm higher and 9 cm further out than the female one. Measuring the rig
    # from one build and applying it to another put every male sleeve reading at a flat 12 cm.
    result['rigs'] = {}
    for name in BUILDS:
        result['rigs'][name] = measure_rig(name)
    result['rig'] = result['rigs']['female_nrw']

    for name in BUILDS:
        key = result['rigs'][name]['key']
        chain = [Vector(key[b]['head']) for b in ('upperarm_l', 'lowerarm_l', 'hand_l')]
        result['builds'][name] = measure_build(name)
        result['builds'][name]['arm'] = measure_arm(name, chain)
        torso = result['builds'][name]['torso']
        print('TV_FIT %s chest=%s waist=%s hip=%s legKnee=%s arm=%s'
              % (name, torso.get('chest'), torso.get('waist'), torso.get('hip'),
                 result['builds'][name]['leg'].get('knee'),
                 {k: v['r'] for k, v in result['builds'][name]['arm'].items()}))

    for sex in ('female', 'male'):
        names = ['%s_%s' % (sex, w) for w in ('nrw', 'ovw', 'unw')]
        spread = {}
        for band in BANDS:
            vals = [result['builds'][n]['torso'].get(band) for n in names]
            if any(v is None for v in vals):
                continue
            rx = [v['rx'] for v in vals]
            ry = [v['ry'] for v in vals]
            spread[band] = {'rx': [min(rx), max(rx), round(max(rx) - min(rx), 4)],
                            'ry': [min(ry), max(ry), round(max(ry) - min(ry), 4)]}
        result['spread'][sex] = spread
        print('TV_FIT spread %s waist=%s hip=%s chest=%s'
              % (sex, spread.get('waist'), spread.get('hip'), spread.get('chest')))

    result['seams'] = measure_seams()
    print('TV_FIT rig bones=%s missing=%s'
          % (result['rig']['boneCount'], result['rig']['missingKey']))
    for label, data in result['seams'].items():
        print('TV_FIT seam %s %s' % (label, {k: v['z'] for k, v in data['sections'].items()}))

    with open(OUT, 'w') as f:
        json.dump(result, f, indent=1)
    print('TV_FIT_WROTE %s' % OUT)


main()
