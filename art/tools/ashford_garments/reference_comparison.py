"""Put the Ashford garment set beside the reference sheets it was read from.

    blender --background --python art/tools/ashford_garments/reference_comparison.py

Writes `docs/evidence/ashford-garments/reference/<family>-vs-result.png`: a crop of the reference
sheet on the left, the generated garments on the right, rendered on the same City Sample bind pose
the engine uses, in that family's canonical palette.

## What this is and is not evidence of

It compares **costume**, because costume is what this slice built. It is a Blender render, not a
PIE screenshot, and that is deliberate: the reference figures stand still, front-on, fully lit,
and a settlement resident does none of those things on demand. The PIE evidence next door proves
these same meshes are on real animated residents in the engine; this proves what they look like
when you can actually see them.

The reference figures also have faces, hair, weapons, jewellery and tattoos. None of that is in
this slice, so the right-hand side has a bare stand-in body and no head. Judging the comparison
on anything but silhouette, layering, palette and footwear would be judging it on things nobody
claimed to have built.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ashford_lib as lib          # noqa: E402
import garments as g               # noqa: E402
import preview                     # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
IN = os.path.join(REPO, '.debug', 'ashford-garments')
SHEETS = os.path.join(REPO, 'art', 'reference', 'cultures', 'ashford', 'characters')
OUT = os.path.join(REPO, 'docs', 'evidence', 'ashford-garments', 'reference')

PANEL_W, PANEL_H = 620, 1020


def srgb(hex_value):
    """Canonical palette colours are sRGB bytes; Blender wants linear."""
    def channel(shift):
        v = ((hex_value >> shift) & 0xff) / 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return (channel(16), channel(8), channel(0))


# family -> (reference sheet, crop as fractions of the sheet (x0, y0, x1, y1) from top-left,
#            fit family, outfit, canonical palette id, primary/secondary/accent)
FAMILIES = [
    ('hana', 'hana.png', (0.00, 0.00, 0.35, 0.60), 'female_nrw',
     ['Kosode_Wide', 'MoSkirt', 'Obi', 'Geta'],
     'festival_crimson', (0x7a1a24, 0x1b1418, 0xc9a227)),
    ('kaito', 'kaito.png', (0.00, 0.00, 0.35, 0.70), 'male_nrw',
     ['Kosode_Work', 'Hakama', 'Obi', 'TabiBoot'],
     'ronin_charcoal', (0x22222a, 0x3a2a24, 0x8a2a2a)),
    ('ascetic', '-ren-ayami-shiro.png', (0.02, 0.02, 0.36, 0.34), 'male_nrw',
     ['Kosode_Wide', 'MoSkirt', 'Obi', 'Waraji'],
     'ascetic_bone', (0xe6dfcd, 0x2a2622, 0x8a2a24)),
]

# Which palette colour each region slot takes, matching what the engine's four material instances
# do with the Tint / Accent the presentation layer pushes.
UNDER_LAYER = (0.74, 0.71, 0.63)
LOWER_PIECES = {'Hakama', 'Hakama_Short', 'MoSkirt'}
ACCENT_PIECES = {'Obi', 'Maekake'}

# A mid-life resident. The canonical `wear` these reference families carry sits around here, and
# the comparison would be flattering itself if it rendered everything factory-fresh.
WEAR = 0.45


def region_materials(piece, primary, secondary, accent):
    base = accent if piece in ACCENT_PIECES else (secondary if piece in LOWER_PIECES else primary)

    def dull(colour, wear_strength):
        """Matches `M_TV_AshfordCloth`: wear darkens, it does not blend toward a dirt colour.
        Blending lifted a near-black kosode to mid grey, which is not what dirt does."""
        return tuple(c * (1.0 - wear_strength * 0.45 * WEAR) for c in colour)

    return [dull(base, 0.16), dull(base, 0.55), dull(accent, 0.10), dull(UNDER_LAYER, 0.12)]


def render_outfit(fit_name, pieces, palette, path):
    lib.reset()
    vendor, armature = {}, None
    for region in ('turtleneck', 'slacks', 'oxfords'):
        meshes, arm = lib.import_reference(os.path.join(IN, 'fit', '%s_%s.fbx' % (fit_name, region)))
        vendor[region] = meshes
        if armature is None:
            armature = arm
        else:
            bpy.data.objects.remove(arm, do_unlink=True)

    surface = lib.FitSurface([m for ms in vendor.values() for m in ms])
    fit = g.Fit(armature, surface, fit_name.split('_')[0])

    # The vendor clothing stands in for a body, in undyed cloth so it reads as a mannequin rather
    # than as part of the costume.
    stand_in = preview.material('standin', (0.30, 0.28, 0.26))
    for ms in vendor.values():
        for m in ms:
            m.data.materials.clear()
            m.data.materials.append(stand_in)

    primary, secondary, accent = (srgb(v) for v in palette)
    for piece in pieces:
        obj = lib.to_object(preview.MAKERS[piece](fit), piece)
        lib.smooth_and_finish(obj)
        for index, shade in enumerate(region_materials(piece, primary, secondary, accent)):
            if index < len(obj.data.materials):
                obj.data.materials[index] = preview.material('%s_%d' % (piece, index), shade)

    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.055, 0.052, 0.058, 1)
    scene.world = world
    # Standard, not the default filmic curve. These are canonical palette colours and the whole
    # point of the comparison is whether they read as the reference palette; a tone map that
    # lifts a 0x8a2a2a accent to pink is answering a different question.
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    key = bpy.data.lights.new('key', 'AREA')
    key.energy, key.size = 260, 3.2
    key_obj = bpy.data.objects.new('key', key)
    scene.collection.objects.link(key_obj)
    key_obj.location = Vector((2.2, -3.4, 3.1))
    key_obj.rotation_euler = (math.radians(48), 0, math.radians(34))
    fill = bpy.data.lights.new('fill', 'AREA')
    fill.energy, fill.size = 90, 3.0
    fill_obj = bpy.data.objects.new('fill', fill)
    scene.collection.objects.link(fill_obj)
    fill_obj.location = Vector((-2.8, -1.8, 2.0))
    fill_obj.rotation_euler = (math.radians(70), 0, math.radians(-52))

    cam_data = bpy.data.cameras.new('cam')
    cam_data.lens = 85
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    centre = Vector((0, -0.02, fit.pelvis_z * 0.86))
    cam.location = centre + Vector((0.0, -4.3, 0.18))
    cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()

    scene.render.resolution_x, scene.render.resolution_y = PANEL_W, PANEL_H
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def compose(sheet_path, crop, render_path, out_path):
    """Paste a crop of the reference sheet beside the render, at the same height."""
    sheet = bpy.data.images.load(sheet_path)
    render = bpy.data.images.load(render_path)
    sw, sh = sheet.size
    rw, rh = render.size
    x0, y0, x1, y1 = crop
    # Blender images are bottom-up; the crop is given top-down because that is how the sheets read.
    cx0, cx1 = int(x0 * sw), int(x1 * sw)
    cy0, cy1 = int((1.0 - y1) * sh), int((1.0 - y0) * sh)
    cw, ch = max(1, cx1 - cx0), max(1, cy1 - cy0)

    out = bpy.data.images.new('comparison', width=cw + rw, height=max(ch, rh), alpha=False)
    sheet_px, render_px, out_px = list(sheet.pixels), list(render.pixels), list(out.pixels)
    ow, oh = out.size

    for y in range(oh):
        # Reference on the left, scaled by nearest neighbour to the output height.
        sy = cy0 + int(y * ch / oh)
        for x in range(cw):
            si = ((sy * sw) + (cx0 + x)) * 4
            oi = ((y * ow) + x) * 4
            if 0 <= si < len(sheet_px) - 3:
                out_px[oi:oi + 3] = sheet_px[si:si + 3]
                out_px[oi + 3] = 1.0
        # Render on the right, at native size, vertically centred.
        ry = y - (oh - rh) // 2
        if 0 <= ry < rh:
            for x in range(rw):
                ri = ((ry * rw) + x) * 4
                oi = ((y * ow) + cw + x) * 4
                out_px[oi:oi + 3] = render_px[ri:ri + 3]
                out_px[oi + 3] = 1.0

    out.pixels = out_px
    out.filepath_raw = out_path
    out.file_format = 'PNG'
    out.save()
    return out_path


def main():
    os.makedirs(OUT, exist_ok=True)
    for family, sheet, crop, fit_name, pieces, palette_id, palette in FAMILIES:
        # An intermediate, not evidence: only the composed comparison beside the sheet is.
        render_path = os.path.join(OUT, '.%s-render.png' % family)
        render_outfit(fit_name, pieces, palette, render_path)
        out_path = os.path.join(OUT, '%s-vs-result.png' % family)
        compose(os.path.join(SHEETS, sheet), crop, render_path, out_path)
        print('TV_REFERENCE %s palette=%s outfit=%s -> %s'
              % (family, palette_id, '+'.join(pieces), out_path))
    print('TV_REFERENCE_DONE %d' % len(FAMILIES))



# Guarded so `role_lineup.py` can reuse the palette conversion and the region-material
# mapping without re-rendering three comparisons.
if __name__ == '__main__':
    main()
