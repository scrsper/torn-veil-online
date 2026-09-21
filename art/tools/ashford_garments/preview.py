"""Render the Ashford garments in Blender, for judging shape before anything reaches Unreal.

    blender --background --python art/tools/ashford_garments/preview.py -- --fit female_nrw \
        --outfit Kosode_Work,Hakama,Obi,Geta --name stage-a

Writes to `.debug/ashford-garments/preview/`. Four orthographic-ish views on one sheet, matte
shading, no textures -- silhouette and layering are what this is for, and a lit render with
material guesses would only hide problems.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ashford_lib as lib          # noqa: E402
import garments as g               # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
IN = os.path.join(REPO, '.debug', 'ashford-garments')
OUT = os.path.join(IN, 'preview')

MAKERS = {
    'Kosode_Work': lambda fit: g.kosode(fit, wide_sleeve=False),
    'Kosode_Wide': lambda fit: g.kosode(fit, wide_sleeve=True),
    'Haori': lambda fit: g.haori(fit),
    'Hakama': lambda fit: g.hakama(fit),
    'Hakama_Short': lambda fit: g.hakama(fit, short=True),
    'MoSkirt': lambda fit: g.wrapped_skirt(fit),
    'Obi': lambda fit: g.obi(fit),
    'Maekake': lambda fit: g.maekake(fit),
    'Geta': lambda fit: g.geta(fit),
    'Waraji': lambda fit: g.waraji(fit),
    'TabiBoot': lambda fit: g.tabi_boot(fit),
}

# Flat matte colours, only so the pieces can be told apart in a grey render.
SHADE = {
    'Kosode_Work': (0.16, 0.19, 0.30), 'Kosode_Wide': (0.16, 0.19, 0.30),
    'Haori': (0.10, 0.10, 0.13), 'Hakama': (0.12, 0.12, 0.14),
    'Hakama_Short': (0.12, 0.12, 0.14), 'MoSkirt': (0.13, 0.11, 0.16),
    'Obi': (0.55, 0.13, 0.12), 'Maekake': (0.40, 0.33, 0.20),
    'Geta': (0.30, 0.20, 0.11), 'Waraji': (0.45, 0.38, 0.24), 'TabiBoot': (0.15, 0.14, 0.13),
}


def material(name, rgb):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*rgb, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.72
    return mat


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

    def arg(flag, default):
        return argv[argv.index(flag) + 1] if flag in argv else default

    fit_name = arg('--fit', 'female_nrw')
    pieces = arg('--outfit', 'Kosode_Work,Hakama,Obi,Geta').split(',')
    label = arg('--name', 'preview')
    show_vendor = '--with-vendor' in argv
    raw = '--raw' in argv

    lib.reset()
    vendor = {}
    armature = None
    for region in ('turtleneck', 'slacks', 'oxfords'):
        meshes, arm = lib.import_reference(os.path.join(IN, 'fit', '%s_%s.fbx'
                                                        % (fit_name, region)))
        vendor[region] = meshes
        if armature is None:
            armature = arm
        else:
            bpy.data.objects.remove(arm, do_unlink=True)

    surface = lib.FitSurface([m for ms in vendor.values() for m in ms])
    fit = g.Fit(armature, surface, fit_name.split('_')[0])

    # The vendor clothing is the stand-in for the body underneath. Kept visible only when asked
    # for, because what matters most is whether the Ashford silhouette closes on its own.
    for ms in vendor.values():
        for m in ms:
            m.hide_render = not show_vendor
            if show_vendor:
                m.data.materials.clear()
                m.data.materials.append(material('vendor', (0.62, 0.52, 0.46)))

    built = []
    for piece in pieces:
        obj = lib.to_object(MAKERS[piece](fit), piece)
        if not raw:
            lib.smooth_and_finish(obj)
        obj.data.materials.append(material(piece, SHADE.get(piece, (0.3, 0.3, 0.3))))
        built.append(obj)

    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.film_transparent = False
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.05, 0.05, 0.06, 1)
    scene.world = world

    key = bpy.data.lights.new('key', 'AREA')
    key.energy, key.size = 900, 3.0
    key_obj = bpy.data.objects.new('key', key)
    scene.collection.objects.link(key_obj)
    key_obj.location = Vector((2.4, -3.2, 3.0))
    key_obj.rotation_euler = (math.radians(50), 0, math.radians(38))
    rim = bpy.data.lights.new('rim', 'AREA')
    rim.energy, rim.size = 420, 2.5
    rim_obj = bpy.data.objects.new('rim', rim)
    scene.collection.objects.link(rim_obj)
    rim_obj.location = Vector((-2.6, 2.4, 2.2))
    rim_obj.rotation_euler = (math.radians(62), 0, math.radians(-135))

    cam_data = bpy.data.cameras.new('cam')
    cam_data.lens = 85
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    centre = Vector((0, -0.02, fit.pelvis_z * 0.92))
    scene.render.resolution_x, scene.render.resolution_y = 640, 1100
    os.makedirs(OUT, exist_ok=True)
    frames = []
    for angle, view in ((0, 'front'), (90, 'left'), (180, 'back'), (35, 'three-quarter')):
        radius = 3.9
        a = math.radians(angle)
        cam.location = centre + Vector((math.sin(a) * radius, -math.cos(a) * radius, 0.30))
        direction = centre - cam.location
        cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        path = os.path.join(OUT, '%s-%s.png' % (label, view))
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        frames.append(path)
        print('TV_PREVIEW %s' % path)

    total = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in built)
    print('TV_PREVIEW_SUMMARY fit=%s pieces=%s tris=%d' % (fit_name, ','.join(pieces), total))



# Guarded so `deform_test.py` can reuse the shading and the piece table without rendering.
if __name__ == '__main__':
    main()
