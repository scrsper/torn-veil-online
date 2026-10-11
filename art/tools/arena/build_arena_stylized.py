"""Stylised low-poly arena people (headless Blender + MPFB 2).

    blender -b --python art/tools/arena/build_arena_stylized.py -- <out_dir> [id ...]

Look target: the user's reference clip (realistic proportions, low-poly faceted surfaces, flat painted colour
blocks, an open long coat whose split tails swing). Each person is an MPFB low-poly proxy body with the
'game_engine' rig, CC0/CC-BY MakeHuman garments recoloured to flat palette colours and decimated, plus
optional authored pieces:
  coat:  an open long coat - torso shell copied from the body (inherits its weights) and four skirt
         tails, each skinned to its own 3-bone chain (coat_fl/fr/bl/br_1..3) for runtime spring physics.
  hairbones: a 2-bone chain behind the head (hair_1..2) weighted onto the back of the hair.
Exports <out_dir>/<id>.glb with flat shading (split normals).
"""
import bpy, bmesh, sys, os, math, json
from mathutils import Vector
from bl_ext.blender_org.mpfb.services import HumanService

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]; ONLY = set(argv[1:])
os.makedirs(OUT, exist_ok=True)


def body(gender, muscle=.5, weight=.5, height=.5, age=.5, race=(.33, .33, .33)):
    return {'gender': gender, 'age': age, 'muscle': muscle, 'weight': weight, 'height': height, 'proportions': .5, 'cupsize': .5, 'firmness': .5,
            'race': {'african': race[0], 'asian': race[1], 'caucasian': race[2]}}


a = lambda n, ext='mhclo': f'{n}/{n}.{ext}'
# MPFB shape targets (file stems in mpfb/data/targets) that push faces past human.
ORC_FACE = [('head-square', 1), ('chin-prognathism-incr', .9), ('chin-width-incr', .9), ('chin-bones-incr', .8), ('forehead-nubian-incr', .7),
            ('eyebrows-trans-down', .6), ('nose-flaring-incr', 1), ('nose-scale-horiz-incr', .8), ('nose-point-up', .6), ('nose-compression-compress', .5),
            ('mouth-scale-horiz-incr', .7), ('head-scale-horiz-incr', .4), ('neck-scale-horiz-incr', .8), ('l-ear-shape-pointed', 1), ('r-ear-shape-pointed', 1), ('l-ear-scale-incr', .6), ('r-ear-scale-incr', .6)]
GOBLIN_FACE = [('head-triangular', .8), ('chin-triangle', .8), ('chin-prominent-incr', .6), ('nose-scale-vert-incr', 1), ('nose-trans-forward', .9),
               ('nose-point-down', .7), ('nose-hump-incr', .6), ('eyebrows-angle-up', .7), ('mouth-scale-horiz-incr', .5), ('mouth-angles-up', .5),
               ('l-ear-shape-pointed', 1), ('r-ear-shape-pointed', 1), ('l-ear-wing-incr', 1), ('r-ear-wing-incr', 1)]
# A strong, handsome face: square jaw, defined chin and cheekbones, straight nose.
GOD_FACE = [('chin-width-incr', .45), ('chin-prominent-incr', .3), ('chin-bones-incr', .4), ('l-cheek-bones-incr', .4), ('r-cheek-bones-incr', .4), ('nose-hump-decr', .5), ('eyebrows-trans-down', .2)]
# Bone scales: orcs are top-heavy with small heads on huge shoulders, long thick arms and big hands; goblins
# have big heads, long arms, huge hands and feet on short legs.
ORC_BODY = {'spine_02': 1.06, 'spine_03': 1.12, 'neck_01': .74, 'head': .92, 'clavicle_l': 1.12, 'clavicle_r': 1.12, 'upperarm_l': 1.1, 'upperarm_r': 1.1, 'hand_l': 1.32, 'hand_r': 1.32, 'thigh_l': .94, 'thigh_r': .94, 'foot_l': 1.12, 'foot_r': 1.12}
GOBLIN_BODY = {'spine_03': .92, 'head': 2.0, 'neck_01': .78, 'upperarm_l': 1.08, 'upperarm_r': 1.08, 'lowerarm_l': 1.16, 'lowerarm_r': 1.16, 'hand_l': 1.42, 'hand_r': 1.42, 'thigh_l': .86, 'thigh_r': .86, 'calf_l': .92, 'calf_r': .92, 'foot_l': 1.38, 'foot_r': 1.38}
# Palette hex is sRGB (as picked by eye); Blender base colours are linear.
C = lambda h: tuple((((h >> s) & 255) / 255) ** 2.2 for s in (16, 8, 0))
# Palette per garment slot; clothes keys match MakeHuman asset names.
PEOPLE = {
    'ranger': dict(phenotype=body(1, .62, .42, .58, .42, (.05, .05, .9)), gender='male', hair='culturalibre_hair_06',
                   clothes={'rehmanpolanski_viking_tunic': C(0x8e2a1c), 'rehmanpolanski_viking_pants': C(0x20283a), 'rehmanpolanski_viking_boots': C(0x5a1f16), 'toigo_gloves_short': C(0x6a2a1a)},
                   skin=C(0xe8b89a), hair_color=C(0x8a2f1a), coat=C(0x24365c), hairbones=True),
    'raider': dict(phenotype=body(1, .6, .55, .5, .6, (.1, .1, .8)), gender='male', hair='short02',
                   clothes={'toigo_fisherman_sweater': C(0x7a3a28), 'toigo_wool_pants': C(0x3a3630), 'culturalibre_male_boots': C(0x3d2a1e), 'toigo_gloves_short': C(0x2c2420)},
                   skin=C(0xd9a585), hair_color=C(0x3a2a1c)),
    'raider_f': dict(phenotype=body(0, .55, .5, .5, .45, (.2, .6, .2)), gender='female', hair='braid01',
                     clothes={'elvs_ruffle_sleeve_peasant_blouse_1': C(0x4a5a3a), 'toigo_wool_pants': C(0x35302a), 'punkduck_medieval_boots': C(0x4a2c1c)},
                     skin=C(0xd8a888), hair_color=C(0x231a14)),
    'soldier': dict(phenotype=body(1, .7, .55, .55, .5, (.8, .1, .1)), gender='male', hair='short04',
                    clothes={'rehmanpolanski_viking_tunic': C(0x5c6470), 'rehmanpolanski_viking_pants': C(0x2a2a30), 'culturalibre_male_boots': C(0x2a1e18), 'toigo_gloves_short': C(0x2a2420), 'javherre_casco_caballero_templario_templar_knight_helmet': C(0x9aa0a8)},
                    skin=C(0x7a4e36), hair_color=C(0x111111), coat=C(0x6a1c1c)),
    'knight': dict(phenotype=body(1, .8, .6, .62, .5, (.1, .1, .8)), gender='male', hair='short02',
                   clothes={'rehmanpolanski_viking_tunic': C(0x4a4e58), 'rehmanpolanski_viking_pants': C(0x24242a), 'rehmanpolanski_viking_boots': C(0x2a1a14), 'toigo_gloves_short': C(0x1c1c20), 'culturalibre_warrior_helmet_02': C(0x2a2a30)},
                   skin=C(0xe0b090), hair_color=C(0x2a1a10), coat=C(0x1c1c24)),
    'archer': dict(phenotype=body(1, .55, .45, .52, .4, (.1, .7, .2)), gender='male', hair='short04',
                   clothes={'mindfront_lusekofta': C(0x2f4a3a), 'toigo_wool_pants': C(0x3a3a2e), 'punkduck_medieval_boots': C(0x4a2e1e), 'maciekg_leather_helmet': C(0x6a4a2a)},
                   skin=C(0xd6a27e), hair_color=C(0x1c140e)),
    'mystic': dict(phenotype=body(0, .4, .45, .5, .55, (.1, .1, .8)), gender='female', hair='long01',
                   clothes={'donitz_monk_robe': C(0x3a2a4a), 'culturalibre_male_boots': C(0x2a1e18)},
                   skin=C(0xe8c4aa), hair_color=C(0x1e1410)),
    'brann': dict(phenotype=body(1, .9, .65, .58, .55, (.05, .05, .9)), gender='male', hair='rehmanpolanski_hair_bun_brown',
                  clothes={'rehmanpolanski_viking_tunic': C(0x6a5440), 'rehmanpolanski_viking_pants': C(0x3a3228), 'rehmanpolanski_viking_boots': C(0x3a2618)},
                  skin=C(0xd9a07a), hair_color=C(0x5a3a1c), coat=C(0x4a3a22)),
    # Monsters: MPFB bodies pushed to non-human proportions, green skins, authored ears and tusks.
    # Creature proportions (pose-scaled, then applied as rest; scales inherit down the chain).
    'orc': dict(phenotype=body(1, 1, .78, .95, .5, (.4, .1, .5)), gender='male', hair=None, tusks=True, targets=ORC_FACE, proportions=ORC_BODY,
                clothes={'rehmanpolanski_viking_pants': C(0x3a2e22), 'rehmanpolanski_viking_boots': C(0x2a1c12), 'toigo_gloves_short': C(0x4a3020)},
                skin=C(0x6f8a45), hair_color=C(0x141410)),
    'orc_chief': dict(phenotype=body(1, 1, .85, 1, .62, (.4, .1, .5)), gender='male', hair=None, tusks=True, targets=ORC_FACE, proportions={**ORC_BODY, 'spine_03': 1.2},
                clothes={'rehmanpolanski_viking_pants': C(0x2a2018), 'rehmanpolanski_viking_boots': C(0x1c140e), 'toigo_gloves_short': C(0x2a1a10), 'culturalibre_warrior_helmet_02': C(0x3a2a20)},
                skin=C(0x5e7a3a), hair_color=C(0x141410), coat=C(0x5a2a18)),
    'goblin': dict(phenotype=body(1, .3, .25, 0, .2, (.2, .4, .4)), gender='male', hair=None, ears=.15, targets=GOBLIN_FACE, proportions=GOBLIN_BODY,
                clothes={'toigo_harem_pants': C(0x5a4a2a), 'culturalibre_male_boots': C(0x3a2a18)},
                skin=C(0x8fa847), hair_color=C(0x222222)),
    'goblin_archer': dict(phenotype=body(1, .35, .25, 0, .2, (.2, .4, .4)), gender='male', hair=None, ears=.15, targets=GOBLIN_FACE, proportions=GOBLIN_BODY,
                clothes={'toigo_harem_pants': C(0x3a4a2a), 'culturalibre_male_boots': C(0x2a2014), 'maciekg_leather_helmet': C(0x5a3a1e)},
                skin=C(0x7f9a3e), hair_color=C(0x222222)),
    # Skeletons: the human rig with every flesh mesh removed and a low-poly bone set rigidly skinned on it.
    'skeleton': dict(phenotype=body(1, .3, .15, .55, .5), gender='male', hair=None, skeleton=dict(bone=C(0xe4d9be), glow=(1.0, .35, .08), thick=1.0), clothes={}),
    'skeleton_mage': dict(phenotype=body(1, .3, .15, .55, .5), gender='male', hair=None, skeleton=dict(bone=C(0xd8d2c0), glow=(.3, .8, 1.0), thick=.9),
                          clothes={'donitz_monk_robe': C(0x241c30)}),
    'skeleton_brute': dict(phenotype=body(1, .9, .3, .9, .5), gender='male', hair=None, skeleton=dict(bone=C(0xcfc3a4), glow=(1.0, .15, .05), thick=1.55),
                           clothes={}, proportions={'spine_03': 1.12, 'head': 1.15, 'hand_l': 1.25, 'hand_r': 1.25}),
    # Chrysanthus, god of the tower (his avatar): tall, heroic build, long hair and a full beard, an ivory coat over a
    # royal-blue tunic, gold pauldrons and gloves. Floats; carries a sword, an orb and a staff on his back (runtime).
    'chrysanthus': dict(phenotype=body(1, 1, .5, 1, .4, (.15, .1, .75)), gender='male', hair='long01', targets=GOD_FACE,
                        clothes={'donitz_monk_robe': C(0xefe7d4), 'toigo_gloves_short': C(0xb8902c)},
                        skin=C(0xd9a27e), hair_color=C(0x4a2c18), hairbones=True, beard=C(0x4a2c18), pauldrons=C(0xc9a23a), sash=C(0x26346a),
                        proportions={'spine_03': 1.05, 'upperarm_l': 1.03, 'upperarm_r': 1.03}),
    'wren': dict(phenotype=body(0, .55, .45, .52, .4, (.1, .1, .8)), gender='female', hair='elvs_french_braid_variation',
                 clothes={'mindfront_lusekofta': C(0x2a3e5c), 'toigo_wool_pants': C(0x2c2a26), 'punkduck_medieval_boots': C(0x4a2a1a), 'toigo_gloves_short': C(0x3a2418)},
                 skin=C(0xf0c8ae), hair_color=C(0x1a120e)),
}


def flat_material(name, rgb, rough=.85):
    m = bpy.data.materials.new(name); m.use_nodes = True
    p = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    p.inputs['Base Color'].default_value = (*rgb, 1); p.inputs['Roughness'].default_value = rough
    return m


def set_material(o, m):
    o.data.materials.clear(); o.data.materials.append(m)
    for p in o.data.polygons: p.material_index = 0


def decimate(o, ratio):
    if ratio >= 1 or len(o.data.polygons) < 200: return
    d = o.modifiers.new('LowPoly', 'DECIMATE'); d.ratio = ratio; d.use_collapse_triangulate = True
    # Keep it ahead of the armature so the decimated mesh is what gets skinned.
    while o.modifiers[0] != d: bpy.ops.object.modifier_move_up({'object': o}, modifier=d.name) if False else o.modifiers.move(o.modifiers.find(d.name), 0)


def flat(o):
    for p in o.data.polygons: p.use_smooth = False


def weight_copy(src, dst):
    """Give dst each vertex's weights from the nearest src vertex (fast KD lookup)."""
    from mathutils.kdtree import KDTree
    kd = KDTree(len(src.data.vertices))
    for v in src.data.vertices: kd.insert(src.matrix_world @ v.co, v.index)
    kd.balance()
    names = {g.index: g.name for g in src.vertex_groups}
    for v in dst.data.vertices:
        _, i, _ = kd.find(dst.matrix_world @ v.co)
        for g in src.data.vertices[i].groups:
            n = names[g.group]
            vg = dst.vertex_groups.get(n) or dst.vertex_groups.new(name=n)
            vg.add([v.index], g.weight, 'REPLACE')


def add_chain(rig, prefix, points, parent):
    """Edit-mode bones along `points` (armature space), parented to `parent`; returns bone names."""
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    eb = rig.data.edit_bones; prev = eb[parent]; names = []
    for i in range(len(points) - 1):
        b = eb.new(f'{prefix}_{i + 1}'); b.head = points[i]; b.tail = points[i + 1]; b.parent = prev; b.use_connect = i > 0
        b.roll = 0; prev = b; names.append(b.name)
    bpy.ops.object.mode_set(mode='OBJECT')
    return names


def build_coat(rig, base, H, color):
    """Open long coat: torso shell from the body + four skirt tails skinned to their own bone chains."""
    mw = rig.matrix_world.inverted()
    hip = .53 * H; hem = .17 * H
    coat_mat = flat_material('coat', color, .9)
    # Torso shell (shoulders to hip, sleeves to the elbow), open at the front.
    src = base.data
    def keep(c):
        z = c.z / H
        if not (.5 < z < .82): return False
        if c.y < 0 and abs(c.x) < .028 * H and z < .78: return False   # open front
        if abs(c.x) > .22 * H: return False                               # sleeves stop at the elbow
        return True
    bm = bmesh.new(); bm.from_mesh(src)
    bm.verts.ensure_lookup_table()
    gone = [f for f in bm.faces if not keep(f.calc_center_median())]
    bmesh.ops.delete(bm, geom=gone, context='FACES')
    for v in bm.verts: v.co += v.normal * (.034 * H / 1.75)
    me = bpy.data.meshes.new('CoatTorso'); bm.to_mesh(me); bm.free()
    torso = bpy.data.objects.new('CoatTorso', me); bpy.context.collection.objects.link(torso)
    torso.matrix_world = base.matrix_world.copy()
    weight_copy(base, torso)
    # Skirt tails.
    tails = {'fl': (18, 82), 'bl': (98, 168), 'br': (192, 262), 'fr': (278, 342)}
    verts, faces, weights = [], [], []
    ROWS, COLS = 7, 6
    chains = {}
    for key, (a0, a1) in tails.items():
        mid = math.radians((a0 + a1) / 2)
        pts = []
        for k in range(4):
            t = k / 3; z = hip - (hip - hem) * t
            rx, ry = H * (.135 + .07 * t), H * (.1 + .06 * t)
            pts.append(mw @ Vector((rx * .9 * math.sin(mid), -ry * .9 * math.cos(mid), z)))
        chains[key] = add_chain(rig, f'coat_{key}', pts, 'pelvis')
        base_i = len(verts)
        for r in range(ROWS + 1):
            t = r / ROWS; z = hip - (hip - hem) * t + (.012 * H * math.sin(t * 9) if key[0] == 'b' else 0)
            rx, ry = H * (.138 + .075 * t), H * (.102 + .065 * t)
            for c in range(COLS + 1):
                ang = math.radians(a0 + (a1 - a0) * c / COLS)
                verts.append((rx * math.sin(ang), -ry * math.cos(ang), z))
                s = t * 3; k = min(2, int(s)); f = s - k
                w = {chains[key][k]: 1 - f * .5, chains[key][min(2, k + 1)]: f * .5}
                if t < .12: w = {'pelvis': 1 - t / .12, chains[key][0]: t / .12}
                weights.append(w)
        for r in range(ROWS):
            for c in range(COLS):
                i = base_i + r * (COLS + 1) + c; faces.append((i, i + 1, i + COLS + 2, i + COLS + 1))
    me = bpy.data.meshes.new('CoatTails'); me.from_pydata(verts, [], faces); me.update()
    skirt = bpy.data.objects.new('CoatTails', me); bpy.context.collection.objects.link(skirt)
    for i, w in enumerate(weights):
        for n, val in w.items():
            if val <= 0: continue
            vg = skirt.vertex_groups.get(n) or skirt.vertex_groups.new(name=n); vg.add([i], val, 'REPLACE')
    for o in (torso, skirt):
        set_material(o, coat_mat); flat(o)
        s = o.modifiers.new('Cloth', 'SOLIDIFY'); s.thickness = .008; s.offset = 1
        arm = o.modifiers.new('Skin', 'ARMATURE'); arm.object = rig
        o.parent = rig; o.matrix_parent_inverse = rig.matrix_world.inverted()
    decimate(torso, .35)
    return [torso, skirt]


def reproportion(rig, scales):
    """Scale pose bones, bake the deformation into every skinned mesh, then make the pose the new rest."""
    vl = bpy.context.view_layer
    vl.objects.active = rig; bpy.ops.object.mode_set(mode='POSE')
    for n, k in scales.items():
        pb = rig.pose.bones.get(n)
        if pb: pb.scale = (k, k, k)
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        mods = [m for m in o.modifiers if m.type == 'ARMATURE' and m.object == rig]
        if not mods: continue
        vl.objects.active = o
        if o.data.shape_keys: bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
        for m in mods:
            name = m.name; bpy.ops.object.modifier_apply(modifier=name)
            nm = o.modifiers.new(name, 'ARMATURE'); nm.object = rig
            bpy.ops.object.modifier_move_to_index(modifier=name, index=0)
    vl.objects.active = rig; bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT'); bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def rigid_parts(rig, name, parts, mat):
    """Join (bmesh, bone) parts into one mesh, each part fully weighted to its bone."""
    bm = bmesh.new(); groups = []
    for pbm, bone in parts:
        start = len(bm.verts)
        me = bpy.data.meshes.new('tmp'); pbm.to_mesh(me); pbm.free(); bm.from_mesh(me); bpy.data.meshes.remove(me)
        bm.verts.ensure_lookup_table(); groups.append((bone, list(range(start, len(bm.verts)))))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o)
    for bone, idx in groups:
        vg = o.vertex_groups.get(bone) or o.vertex_groups.new(name=bone); vg.add(idx, 1.0, 'REPLACE')
    set_material(o, mat); flat(o)
    arm = o.modifiers.new('Skin', 'ARMATURE'); arm.object = rig
    o.parent = rig; o.matrix_parent_inverse = rig.matrix_world.inverted()
    return o


def build_skeleton(rig, H, spec):
    """A low-poly skeleton on the game_engine rig: limb bones with joint knobs, spine, ribcage, pelvis, skull and jaw."""
    from mathutils import Matrix as M
    S = H / 1.75 * spec.get('thick', 1); W = rig.matrix_world
    B = lambda n: (W @ rig.data.bones[n].head_local, W @ rig.data.bones[n].tail_local)
    def rod(a, b, r0, r1, seg=6):
        bm = bmesh.new(); d = b - a
        bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r0, radius2=r1, depth=d.length)
        rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=M.Translation((a + b) / 2) @ rot, verts=bm.verts); return bm
    def ball(c, r, sx=1, sy=1, sz=1, sub=1):
        bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
        bmesh.ops.transform(bm, matrix=M.Translation(c) @ M.Diagonal((sx, sy, sz, 1)), verts=bm.verts); return bm
    def ring(c, rx, ry, t, seg=10, open_front=True):
        bm = bmesh.new(); pts = []
        for i in range(seg + 1):
            a = (i / seg) * (math.pi * 1.7 if open_front else math.pi * 2) + (math.pi * .15 if open_front else 0) - math.pi / 2
            pts.append(c + Vector((math.cos(a) * rx, -math.sin(a) * ry * -1, 0)))
        for p, q in zip(pts, pts[1:]):
            r = rod(p, q, t, t, 4); me = bpy.data.meshes.new('t'); r.to_mesh(me); r.free(); bm.from_mesh(me); bpy.data.meshes.remove(me)
        return bm
    parts = []
    for side in ('l', 'r'):
        for n, r0, r1 in (('upperarm', .038, .028), ('lowerarm', .03, .024), ('thigh', .052, .036), ('calf', .04, .03), ('clavicle', .02, .018)):
            a, b = B(f'{n}_{side}'); parts.append((rod(a, b, r0 * S, r1 * S), f'{n}_{side}'))
            parts.append((ball(b, r1 * S * 1.5), f'{n}_{side}')); parts.append((ball(a, r0 * S * 1.25), f'{n}_{side}'))
        a, b = B(f'hand_{side}'); m0, m1 = B(f'middle_01_{side}'); parts.append((rod(a, m1, .03 * S, .02 * S, 5), f'hand_{side}'))
        for f in ('index', 'middle', 'ring', 'pinky', 'thumb'):
            if f'{f}_01_{side}' in rig.data.bones:
                a1, _ = B(f'{f}_01_{side}'); _, b3 = B(f'{f}_03_{side}'); parts.append((rod(a1, b3, .009 * S, .006 * S, 4), f'{f}_01_{side}'))
        a, b = B(f'foot_{side}'); _, t = B(f'ball_{side}'); parts.append((rod(a, t, .036 * S, .024 * S, 5), f'foot_{side}'))
    # Spine: vertebra knobs from pelvis to neck.
    for n in ('spine_01', 'spine_02', 'spine_03', 'neck_01'):
        a, b = B(n)
        for k in range(3): parts.append((ball(a.lerp(b, k / 3) + Vector((0, .01 * S, 0)), .026 * S, 1.4, 1, .75, 0), n))
        parts.append((rod(a, b, .016 * S, .016 * S, 5), n))
    # Ribcage: rings around spine_02 / spine_03, widest in the middle; sternum down the front.
    s2a, s2b = B('spine_02'); s3a, s3b = B('spine_03')
    for k, (bn, t) in enumerate((('spine_02', .3), ('spine_02', .75), ('spine_03', .1), ('spine_03', .45), ('spine_03', .8))):
        a, b = (s2a, s2b) if bn == 'spine_02' else (s3a, s3b)
        w = (.105, .12, .125, .12, .1)[k] * S
        parts.append((ring(a.lerp(b, t) + Vector((0, -.03 * S, 0)), w * 1.08, w * .82, .014 * S), bn))
    parts.append((rod(s2b + Vector((0, -.115 * S, -.02 * S)), s3a.lerp(s3b, .9) + Vector((0, -.1 * S, 0)), .012 * S, .01 * S, 4), 'spine_03'))
    # Pelvis: a basin.
    pa, pb = B('pelvis'); parts.append((ring(pa + Vector((0, 0, .03 * S)), .11 * S, .075 * S, .024 * S, 10, False), 'pelvis'))
    parts.append((rod(pa, B('spine_01')[0] + Vector((0, 0, .01 * S)), .02 * S, .018 * S, 5), 'pelvis'))
    parts.append((ball(pa + Vector((0, .02 * S, -.01 * S)), .05 * S, 1.6, .9, .9), 'pelvis'))
    # Skull, jaw, cheekbones; dark sockets with glowing points.
    ha, hb = B('head'); hh = (hb - ha).length
    c = ha + (hb - ha) * .55
    parts.append((ball(c + Vector((0, .005 * S, .01 * S)), hh * .72, .82, .98, .92, 2), 'head'))
    parts.append((ball(c + Vector((0, -hh * .32, -hh * .42)), hh * .3, 1.0, .7, .45, 1), 'head'))   # jaw
    for side in (1, -1): parts.append((ball(c + Vector((side * hh * .27, -hh * .36, -hh * .12)), hh * .1, 1, .8, .7, 0), 'head'))
    rigid_parts(rig, 'skeleton_bones', parts, flat_material('bone', spec['bone'], .75))
    sockets = [(ball(c + Vector((side * hh * .17, -hh * .43, 0)), hh * .12, 1, .45, 1, 1), 'head') for side in (1, -1)]
    rigid_parts(rig, 'skeleton_sockets', sockets, flat_material('socket', C(0x120d0a), .9))
    m = flat_material('glow', spec['glow'], .5)
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    for k in ('Emission Color', 'Emission'):
        if k in bsdf.inputs: bsdf.inputs[k].default_value = (*spec['glow'], 1); break
    if 'Emission Strength' in bsdf.inputs: bsdf.inputs['Emission Strength'].default_value = 4
    rigid_parts(rig, 'skeleton_eyes', [(ball(c + Vector((side * hh * .17, -hh * .5, 0)), hh * .045, 1, 1, 1, 1), 'head') for side in (1, -1)], m)


def add_beard(rig, proxy, color, H):
    """A full beard shell: the proxy's lower-face and jaw faces, lifted off the skin and drawn down into a beard."""
    eyes = next((o for o in bpy.data.objects if o.type == 'MESH' and 'low-poly' in o.name.lower()), None)
    if eyes is None or proxy is None: return
    S = H / 1.75
    pts = [eyes.matrix_world @ v.co for v in eyes.data.vertices]
    c = sum(pts, Vector()) / len(pts); front = min(p.y for p in pts)
    hg = proxy.vertex_groups.get('head')
    if hg is None: return
    M = proxy.matrix_world; me = proxy.data
    wh = {v.index: next((g.weight for g in v.groups if g.group == hg.index), 0.0) for v in me.vertices}
    top, bottom = c.z - .068 * S, c.z - .19 * S
    def inside(p): return bottom < p.z < top and p.y < c.y + .035 * S and abs(p.x - c.x) < .066 * S
    faces = [f for f in me.polygons if all(inside(M @ me.vertices[i].co) and (wh[i] > .25 or (M @ me.vertices[i].co).z > c.z - .13 * S) for i in f.vertices)]
    if not faces: return
    bm = bmesh.new(); vmap = {}
    for f in faces:
        vs = []
        for i in f.vertices:
            if i not in vmap:
                v = me.vertices[i]; p = M @ v.co; n = (M.to_3x3() @ v.normal).normalized()
                p = p + n * .009 * S
                # Grow downward and forward below the mouth: a beard, not stubble.
                mouth = c.z - .088 * S
                if p.z < mouth:
                    k = (mouth - p.z) / (.1 * S)
                    p.z -= k * .045 * S; p.y -= k * .018 * S
                vmap[i] = bm.verts.new(p)
            vs.append(vmap[i])
        try: bm.faces.new(vs)
        except ValueError: pass
    # Thickness: extrude the shell back toward the face so it reads from the side.
    geom = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    for v in [e for e in geom['geom'] if isinstance(e, bmesh.types.BMVert)]: v.co.y += .01 * S
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    skinned_part(rig, 'beard', bm, color)


def add_pauldrons(rig, color, H):
    """Gold shoulder plates: domed shells over each upper arm, rigid to the arm."""
    from mathutils import Matrix as Mx
    S = H / 1.75; W = rig.matrix_world
    parts = []
    for side in ('l', 'r'):
        b = rig.data.bones[f'upperarm_{side}']
        a = W @ b.head_local; t = W @ b.tail_local; d = (t - a).normalized()
        bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=.125 * S)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -.01 * S], context='VERTS')
        rot = Vector((0, 0, 1)).rotation_difference(Vector((d.x * .5, d.y * .5, .85)).normalized()).to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=Mx.Translation(a + d * .07 * S + Vector((0, 0, .07 * S))) @ rot @ Mx.Diagonal((1.1, 1.25, .7, 1)), verts=bm.verts)
        parts.append((bm, f'upperarm_{side}'))
    rigid_parts(rig, 'pauldrons', parts, flat_material('gold', color, .35))


def add_sash(rig, color, H):
    """A royal-blue sash at the waist of the robe, and a gold clasp."""
    from mathutils import Matrix as Mx
    S = H / 1.75; W = rig.matrix_world
    p = W @ rig.data.bones['spine_01'].head_local
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=False, segments=14, radius1=.205 * S, radius2=.2 * S, depth=.08 * S)
    bmesh.ops.transform(bm, matrix=Mx.Translation(p + Vector((0, -.005 * S, .03 * S))) @ Mx.Diagonal((1, .78, 1, 1)), verts=bm.verts)
    rigid_parts(rig, 'sash', [(bm, 'spine_01')], flat_material('sash', color, .8))
    cl = bmesh.new(); bmesh.ops.create_icosphere(cl, subdivisions=1, radius=.03 * S)
    bmesh.ops.transform(cl, matrix=Mx.Translation(p + Vector((0, -.165 * S, .03 * S))) @ Mx.Diagonal((1.3, .5, 1, 1)), verts=cl.verts)
    rigid_parts(rig, 'clasp', [(cl, 'spine_01')], flat_material('clasp', C(0xd6ae44), .3))


def head_frame(rig):
    hb = rig.data.bones['head']
    h0 = rig.matrix_world @ hb.head_local; h1 = rig.matrix_world @ hb.tail_local
    return h0, h1


def skinned_part(rig, name, bm, color):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o)
    vg = o.vertex_groups.new(name='head'); vg.add(list(range(len(me.vertices))), 1.0, 'REPLACE')
    set_material(o, flat_material(name, color, .7)); flat(o)
    arm = o.modifiers.new('Skin', 'ARMATURE'); arm.object = rig
    o.parent = rig; o.matrix_parent_inverse = rig.matrix_world.inverted()
    return o


def add_ears(rig, length, color):
    """Pointed ears: flattened cones at the sides of the head, swept up and back."""
    h0, h1 = head_frame(rig); hh = (h1 - h0).length
    mid = h0 + (h1 - h0) * .42
    for side in (1, -1):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=length * .32, radius2=0, depth=length)
        for v in bm.verts: v.co.y *= .35                         # flatten into a blade
        # Cone points along +Z: tip out to the side, up and back (+Y is behind the figure).
        from mathutils import Matrix as M
        dirv = Vector((side * 1.0, .55, .7)).normalized()
        rot = Vector((0, 0, 1)).rotation_difference(dirv).to_matrix().to_4x4()
        base = mid + Vector((side * hh * .42, hh * .05, 0))
        bmesh.ops.transform(bm, matrix=M.Translation(base + dirv * length * .5) @ rot, verts=bm.verts)
        skinned_part(rig, f'ear_{"l" if side > 0 else "r"}', bm, color)


def add_tusks(rig, H):
    """Lower-jaw tusks, anchored to the eyes' real position (mouth sits ~9% of head height below them)."""
    eyes = next((o for o in bpy.data.objects if o.type == 'MESH' and 'low-poly' in o.name.lower()), None)
    if eyes is None: return
    pts = [eyes.matrix_world @ v.co for v in eyes.data.vertices]
    c = sum(pts, Vector()) / len(pts); front = min(p.y for p in pts)     # -Y is the face
    S = H / 1.75
    from mathutils import Matrix as M
    for side in (1, -1):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=5, radius1=.017 * S, radius2=0, depth=.075 * S)
        rot = Vector((0, 0, 1)).rotation_difference(Vector((side * .35, -.45, 1)).normalized()).to_matrix().to_4x4()
        base = Vector((c.x + side * .022 * S, front - .004 * S, c.z - .085 * S))
        bmesh.ops.transform(bm, matrix=M.Translation(base + Vector((0, 0, .02 * S))) @ rot, verts=bm.verts)
        skinned_part(rig, f'tusk_{"l" if side > 0 else "r"}', bm, C(0xece4cc))


def hair_bones(rig, hair, head_bone='head'):
    hb = rig.data.bones[head_bone]
    top = rig.matrix_world @ hb.tail_local; neck = rig.matrix_world @ hb.head_local
    back = Vector((0, .07, 0))   # +Y is behind the figure in MPFB's Blender frame
    pts = [rig.matrix_world.inverted() @ p for p in (top * .55 + neck * .45 + back * .7, neck + back + Vector((0, .02, -.02)), neck + back * 1.2 + Vector((0, .03, -.12)))]
    names = add_chain(rig, 'hair', pts, head_bone)
    hw = hair.matrix_world
    zt, zn = (top * .55 + neck * .45).z, neck.z - .12
    g1 = hair.vertex_groups.get(names[0]) or hair.vertex_groups.new(name=names[0])
    g2 = hair.vertex_groups.get(names[1]) or hair.vertex_groups.new(name=names[1])
    gh = hair.vertex_groups.get(head_bone)
    for v in hair.data.vertices:
        p = hw @ v.co
        if p.y < neck.y + .01 or p.z > zt: continue
        t = min(1, max(0, (zt - p.z) / max(1e-3, zt - zn)))
        g1.add([v.index], (1 - t) * .9, 'REPLACE'); g2.add([v.index], t * .9, 'REPLACE')
        if gh: gh.add([v.index], .1, 'REPLACE')


report = {}
for pid, spec in PEOPLE.items():
    if ONLY and pid not in ONLY: continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    info = HumanService._create_default_human_info_dict()
    info.update({
        'phenotype': spec['phenotype'], 'rig': 'game_engine', 'proxy': a(f"{spec['gender']}_generic", 'proxy'),
        'skin_material_type': 'NONE', 'clothes_material_type': 'GAMEENGINE',
        'eyes': 'low-poly/low-poly.mhclo', 'hair': a(spec['hair']) if spec.get('hair') else '', 'clothes': [a(c) for c in spec['clothes']],
        'alternative_materials': {}, 'color_adjustments': {},
        'targets': [{'target': t, 'value': v} for t, v in spec.get('targets', [])],
    })
    settings = HumanService.get_default_deserialization_settings(); settings['subdiv_levels'] = 0
    base = HumanService.deserialize_from_dict(info, settings)
    rig = base.parent if base.parent and base.parent.type == 'ARMATURE' else next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    rig.name = 'Armature'
    H = base.dimensions.z
    if spec.get('proportions'): reproportion(rig, spec['proportions'])
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    proxy = next((o for o in meshes if o is not base and 'generic' in o.name.lower()), None)
    skin = flat_material('skin', spec.get('skin', (.5, .5, .5)), .7)
    for o in meshes:
        n = o.name.lower()
        for m in o.modifiers:
            if m.type == 'SUBSURF': m.levels = 0; m.render_levels = 0
        if o is base or o is proxy: set_material(o, skin); flat(o); continue
        if 'low-poly' in n or 'eye' in n: continue          # eyes keep their small texture
        key = next((k for k in spec['clothes'] if k.split('_')[-1] in n or k in n), None)
        if (spec.get('hair') and spec['hair'].split('_')[-1] in n) or 'hair' in n or n.startswith('short') or n.startswith('long') or 'braid' in n or 'bun' in n:
            set_material(o, flat_material('hair', spec['hair_color'], .6)); decimate(o, .4); flat(o)
            if spec.get('hairbones'): hair_bones(rig, o)
            continue
        col = spec['clothes'].get(key) if key else None
        if col is None:
            # Match by MakeHuman asset source when the object name is the obj name.
            src = (o.get('asset_source') or '')
            col = next((c for k, c in spec['clothes'].items() if k in str(src)), (.4, .4, .4))
        set_material(o, flat_material(o.name, col)); decimate(o, .35); flat(o)
    if spec.get('skeleton'):
        for o in [o for o in bpy.data.objects if o.type == 'MESH' and (o is proxy or 'low-poly' in o.name.lower())]: bpy.data.objects.remove(o)
        proxy = True   # base stays out of the export
        build_skeleton(rig, H, spec['skeleton'])
    extra = build_coat(rig, base, H, spec['coat']) if spec.get('coat') else []
    if spec.get('ears'): add_ears(rig, spec['ears'] * H / 1.75, spec['skin'])
    if spec.get('tusks'): add_tusks(rig, H)
    if spec.get('beard'): add_beard(rig, proxy, spec['beard'], H)
    if spec.get('pauldrons'): add_pauldrons(rig, spec['pauldrons'], H)
    if spec.get('sash'): add_sash(rig, spec['sash'], H)
    # Export: proxy body (base hidden by MPFB's mask), garments, hair, eyes, coat.
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.data.objects:
        if o.type == 'ARMATURE' or (o.type == 'MESH' and o is not base): o.select_set(True)
    if proxy is None: base.select_set(True)
    bpy.context.view_layer.objects.active = rig
    path = os.path.join(OUT, f'{pid}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_animations=False, export_influence_nb=4, export_image_format='AUTO')
    tris = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH' and o.select_get())
    report[pid] = {'bytes': os.path.getsize(path), 'bones': len(rig.data.bones), 'faces_pre_decimate': tris, 'height_m': round(H, 3)}
    print(f'[stylized] {pid}: {len(rig.data.bones)} bones, {os.path.getsize(path) / 1e6:.2f} MB')
json.dump(report, open(os.path.join(OUT, 'stylized.json'), 'w'), indent=1)
