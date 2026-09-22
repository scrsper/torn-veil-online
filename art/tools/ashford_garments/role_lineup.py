"""Stand the settlement's trades side by side, in the clothes the resolver actually gave them.

    npm run ashford:wardrobe -- 1337 0
    blender --background --python art/tools/ashford_garments/role_lineup.py

Writes `docs/evidence/ashford-garments/roles/role-lineup.png`.

The question this answers is the one a small wardrobe has to answer: can eleven pieces tell a
farmer from a merchant from a guard from an elder? If they all resolve to the same silhouette in
the same colour, the set is one costume with eleven parts rather than a grammar.

**Nothing here is dressed by hand.** Every figure's pieces, fit family, palette and wear are read
out of `roleLineup` in `.debug/character-foundry/ashford-wardrobe-33.json`, which is the Character
Foundry's own output for the canonical Ashford population at seed 1337. If the resolver put a
smith in a wide-sleeved kosode, that is what stands here.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ashford_lib as lib                 # noqa: E402
import garments as g                      # noqa: E402
import preview                            # noqa: E402
import reference_comparison as ref        # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
IN = os.path.join(REPO, '.debug', 'ashford-garments')
REPORT = os.path.join(REPO, '.debug', 'character-foundry', 'ashford-wardrobe-33.json')
OUT = os.path.join(REPO, 'docs', 'evidence', 'ashford-garments', 'roles')

SPACING = 1.25          # metres between figures; a wide sleeve is ~1.1 m across
LABEL_HEIGHT = -0.10


def build_figure(entry, index, cache):
    """One dressed figure, offset along +X. Returns its objects and the fit it was built on."""
    fit_name = entry['fit'].replace('city:', '').replace(':', '_')
    if fit_name not in cache:
        vendor, armature = {}, None
        for region in ('turtleneck', 'slacks', 'oxfords'):
            meshes, arm = lib.import_reference(
                os.path.join(IN, 'fit', '%s_%s.fbx' % (fit_name, region)))
            vendor[region] = meshes
            if armature is None:
                armature = arm
            else:
                bpy.data.objects.remove(arm, do_unlink=True)
        surface = lib.FitSurface([m for ms in vendor.values() for m in ms])
        cache[fit_name] = (g.Fit(armature, surface, fit_name.split('_')[0]), vendor, armature)
    fit, vendor, armature = cache[fit_name]

    offset = Vector((index * SPACING, 0.0, 0.0))
    # The vendor clothing is the body stand-in, in undyed cloth. Each figure needs its own copy,
    # since the same fit family serves more than one role in this lineup.
    stand_in = preview.material('standin_%d' % index, (0.29, 0.27, 0.25))
    built = []
    for ms in vendor.values():
        for mesh in ms:
            copy = mesh.copy()
            copy.data = mesh.data.copy()
            copy.data.materials.clear()
            copy.data.materials.append(stand_in)
            copy.parent = None
            copy.matrix_world = mesh.matrix_world.copy()
            copy.location = copy.location + offset
            bpy.context.scene.collection.objects.link(copy)
            built.append(copy)

    primary = ref.srgb(entry['primary'])
    secondary = ref.srgb(entry['secondary'])
    accent = ref.srgb(entry['accent'])
    ref.WEAR = entry.get('wear', 0.45)
    for piece in entry['pieces']:
        maker = preview.MAKERS.get(piece)
        if maker is None:
            print('TV_ROLE_UNKNOWN_PIECE %s' % piece)
            continue
        obj = lib.to_object(maker(fit), '%s_%d' % (piece, index))
        lib.smooth_and_finish(obj)
        for slot, shade in enumerate(ref.region_materials(piece, primary, secondary, accent)):
            if slot < len(obj.data.materials):
                obj.data.materials[slot] = preview.material('%s_%d_%d' % (piece, index, slot), shade)
        obj.location = obj.location + offset
        built.append(obj)

    label = bpy.data.curves.new('label_%d' % index, type='FONT')
    label.body = entry['role'].upper()
    label.align_x = 'CENTER'
    label.size = 0.085
    label_obj = bpy.data.objects.new('label_%d' % index, label)
    bpy.context.scene.collection.objects.link(label_obj)
    label_obj.location = Vector((index * SPACING, -0.62, LABEL_HEIGHT))
    label_obj.rotation_euler = (math.radians(90), 0, 0)
    ink = preview.material('ink_%d' % index, (0.80, 0.78, 0.73))
    label_obj.data.materials.append(ink)
    built.append(label_obj)
    return built, fit


def main():
    if not os.path.exists(REPORT):
        raise SystemExit('run `npm run ashford:wardrobe -- 1337 0` first: %s' % REPORT)
    report = json.load(open(REPORT))
    roles = [r for r in report['roleLineup'] if r.get('present')]
    missing = [r['role'] for r in report['roleLineup'] if not r.get('present')]
    if missing:
        print('TV_ROLE_ABSENT %s' % missing)

    lib.reset()
    cache = {}
    tallest = 1.6
    for index, entry in enumerate(roles):
        _, fit = build_figure(entry, index, cache)
        tallest = max(tallest, fit.neck_z + 0.2)
        print('TV_ROLE %-9s %-16s %-16s wear=%.2f %s'
              % (entry['role'], entry['fit'], entry['palette'], entry.get('wear', 0),
                 '+'.join(entry['pieces'])))

    # The armatures the fits arrived on are only needed for their bind pose; hide them so they do
    # not draw a stick figure through the middle of the lineup.
    for obj in list(bpy.context.scene.objects):
        if obj.type == 'ARMATURE' or (obj.type == 'EMPTY' and obj.parent is None):
            obj.hide_render = True
        if obj.type == 'MESH' and obj.parent is not None:
            obj.hide_render = True          # the originals; every figure uses its own copy

    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.055, 0.052, 0.058, 1)
    scene.world = world
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'

    span = (len(roles) - 1) * SPACING
    centre = Vector((span / 2, -0.02, tallest * 0.46))

    key = bpy.data.lights.new('key', 'AREA')
    key.energy, key.size = 1400, 6.0
    key_obj = bpy.data.objects.new('key', key)
    scene.collection.objects.link(key_obj)
    key_obj.location = centre + Vector((2.6, -5.0, 3.4))
    key_obj.rotation_euler = (math.radians(44), 0, math.radians(30))
    fill = bpy.data.lights.new('fill', 'AREA')
    fill.energy, fill.size = 520, 6.0
    fill_obj = bpy.data.objects.new('fill', fill)
    scene.collection.objects.link(fill_obj)
    fill_obj.location = centre + Vector((-4.0, -3.2, 2.0))
    fill_obj.rotation_euler = (math.radians(68), 0, math.radians(-50))

    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    # Orthographic, so the figure at the end of the row is not smaller or turned away from the
    # camera than the one in the middle. A lineup is a comparison; perspective would bias it.
    cam_data.ortho_scale = span + 1.5
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = centre + Vector((0.0, -8.0, 0.0))
    cam.rotation_euler = (math.radians(90), 0, 0)

    width = 260 * len(roles)
    scene.render.resolution_x = width
    scene.render.resolution_y = int(width * (tallest + 0.5) / (span + 1.5))
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'role-lineup.png')
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('TV_ROLE_LINEUP %d roles -> %s' % (len(roles), path))


main()
