"""Build one character kit (armature + every part) and export it as a GLB.

    blender -b -P build_kit.py -- <f|m|c> <out.glb> [--only body,head,garments,hair,accessories,hero]

Every part carries custom properties the client reads: tv_part (body, head, eye, garment, hair, footwear, hat,
accessory, hero) and tv_garment / tv_style (the token it realises). Material names are the client's slot names.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from common import reset, Dims
import body as B
import head as Hd
import hair as Hr
import garments_web as G
import accessories as A
import export as X
import couture as C

# The component builders keep the established mesh tags and skeleton contract.
Hd.face_position = C.face_position
Hr.face_position = C.face_position
Hd.eye_meshes = C.eye_meshes
B.hand_parts = C.hand_parts

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
sex = argv[0] if argv else 'f'
out = argv[1] if len(argv) > 1 else os.path.join(os.getcwd(), f'kit_{sex}.glb')
only = set(argv[argv.index('--only') + 1].split(',')) if '--only' in argv else None
want = lambda k: only is None or k in only

reset()
dims = Dims(sex)
extra = Hr.hair_bones(dims) + A.hero_ear_bones(dims) + A.hero_tail_bones(dims)
d, arm, body = B.build_body(sex, extra_bones=extra)


def material(name, color, rough=0.6, metal=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    return m


# Slot materials the client re-skins; the colours here are only fallbacks.
PALETTE = {
    'TV_SkinBody': ((0.86, 0.68, 0.56, 1), 0.55, 0.0), 'TV_SkinHead': ((0.86, 0.68, 0.56, 1), 0.5, 0.0), 'TV_Eye': ((0.95, 0.95, 0.97, 1), 0.12, 0.0),
    'TV_Hair': ((0.3, 0.2, 0.14, 1), 0.45, 0.0), 'TV_Cloth': ((0.7, 0.72, 0.8, 1), 0.85, 0.0), 'TV_Under': ((0.2, 0.25, 0.4, 1), 0.85, 0.0), 'TV_Accent': ((0.7, 0.55, 0.25, 1), 0.7, 0.0),
    'TV_Metal': ((0.85, 0.72, 0.35, 1), 0.35, 1.0), 'TV_Leather': ((0.32, 0.2, 0.13, 1), 0.7, 0.0), 'TV_Fur': ((0.95, 0.93, 0.88, 1), 0.9, 0.0), 'TV_Hem': ((0.55, 0.58, 0.68, 1), 0.9, 0.0),
    'TV_Straw': ((0.8, 0.68, 0.38, 1), 0.9, 0.0), 'TV_Lacquer': ((0.12, 0.1, 0.12, 1), 0.3, 0.0), 'TV_Crystal': ((0.7, 0.85, 1.0, 1), 0.1, 0.0),
    'TV_Lash': ((0.045, 0.023, 0.031, 1), 0.55, 0.0),
}
for name, (col, r, m) in PALETTE.items():
    material(name, col, r, m)

parts = []
if want('body'):
    body.data.materials.clear()
    body.data.materials.append(bpy.data.materials['TV_SkinBody'])
    body['tv_part'] = 'body'
    parts.append(body)
if want('head'):
    # Keep the head on the same analytic surface as hair, eyes and garments.  The
    # VRoid beta face was useful as a reference, but its baked eye regions were
    # part of the imported Face mesh; they occluded the canonical EyeL/EyeR
    # meshes and made the browser characters read as blank-eyed mannequins.
    head = Hd.build_head(d, arm)
    Hd.weight_all(head)
    Hd.bind(head, arm)
    # The analytic head has no imported material slots.  Give it the same
    # canonical slot as the body so CharacterMaterials can paint the procedural
    # complexion, brows, lips, and age detail at runtime.
    head.data.materials.clear()
    head.data.materials.append(bpy.data.materials['TV_SkinHead'])
    parts.append(head)
    for eye in Hd.eye_meshes(d, arm):
        Hd.weight_all(eye)
        Hd.bind(eye, arm)
        eye['tv_part'] = 'eye'
        parts.append(eye)
fit = G.Fit(d)
if want('garments'):
    for kind in G.REGISTRY:
        parts.append(C.couture_garment(d, body, arm) if kind == 'furisode_hero' else G.make_garment(kind, fit, body, arm))
    for style in ('zori', 'geta', 'boots'):
        parts.append(A.footwear(d, style, body, arm))
if want('hair'):
    for style in Hr.HAIR_STYLES:
        if style == 'hero_long':
            parts.append(C.couture_hair(d, arm))
            continue
        h = Hr.build_hair(d, style)
        Hr.weight_hair(h, arm, d)
        h.data.materials[0] = bpy.data.materials['TV_Hair']
        parts.append(h)
if want('accessories'):
    for kind in ('wide', 'hood', 'cap', 'helm'):
        parts.append(A.hat(d, kind, arm))
    parts.append(A.hair_ornament(d, arm))
    parts.append(A.ear_drops(d, arm))
    parts.append(A.arm_wrap(d, body, arm))
    parts.append(A.prayer_beads(d, arm))
    parts.append(A.travel_pack(d, arm))
if want('hero') and sex == 'f':
    parts.append(A.hero_ears(d, arm))
    parts.append(A.hero_tail(d, arm))
    parts.append(C.couture_stole(d, arm))
    parts.append(A.hero_ornaments(d, arm))
    parts.append(A.hero_bow(d, arm))
    parts.append(A.hero_flower(d, arm))
    parts.extend(C.couture_jewels(d, arm))

tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in parts if o.type == 'MESH')
print('KIT', sex, 'parts', len(parts), 'tris', tris)
X.export_glb(out, parts, arm)
print('exported', out, os.path.getsize(out))
