"""Pose the Ashford garments and look at them, in Blender, before Unreal ever sees them.

    blender --background --python art/tools/ashford_garments/deform_test.py -- --fit female_nrw

Builds the outfit, transfers weights exactly as `build_garments.py` does, then puts the skeleton
through the poses the acceptance list names -- stride, deep stride, crouch, a guard stance and a
thrown punch -- and renders each one. The vendor garments are posed alongside, so a hakama that
has burst through the leg it is supposed to cover is obvious rather than inferred.

This is deliberately cheaper than the PIE test and earlier in the loop. A round trip through FBX
import, material assignment, a level and a bridge takes minutes; finding out here that a sleeve
inverts at 90 degrees of shoulder rotation takes one render.
"""
import math
import os
import sys

import bpy
from mathutils import Euler, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ashford_lib as lib          # noqa: E402
import garments as g               # noqa: E402
import preview                     # noqa: E402  (shares the lighting rig and shading)

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
IN = os.path.join(REPO, '.debug', 'ashford-garments')
OUT = os.path.join(IN, 'deform')

def d(x):
    return math.radians(x)


# Bone -> XYZ euler, in degrees. Chosen to exercise the joints that break cloth: the hip and knee
# for a hakama, the shoulder and elbow for a sleeve, the spine for a collar and an obi.
POSES = {
    # The baseline. Every number below is reported as a change from this, because the absolute
    # count is dominated by a constant: body that is simply near a garment without being wrapped
    # by it -- most of the torso is 'outside' an obi. What matters is whether a pose makes that
    # worse, which is what a garment failing under motion looks like.
    'rest': {},
    'stride': {
        'thigh_l': (-38, 0, 0), 'calf_l': (34, 0, 0), 'foot_l': (6, 0, 0),
        'thigh_r': (26, 0, 0), 'calf_r': (8, 0, 0),
        'upperarm_l': (22, 0, 0), 'upperarm_r': (-22, 0, 0),
        'lowerarm_l': (0, -28, 0), 'lowerarm_r': (0, -28, 0),
        'spine_03': (3, 0, 4),
    },
    'sprint': {
        'thigh_l': (-64, 0, 0), 'calf_l': (76, 0, 0), 'foot_l': (14, 0, 0),
        'thigh_r': (44, 0, 0), 'calf_r': (26, 0, 0),
        'upperarm_l': (56, 0, 0), 'upperarm_r': (-48, 0, 0),
        'lowerarm_l': (0, -76, 0), 'lowerarm_r': (0, -66, 0),
        'spine_03': (14, 0, 0), 'spine_04': (8, 0, 0),
    },
    'crouch': {
        'thigh_l': (-78, 0, 9), 'calf_l': (92, 0, 0), 'foot_l': (18, 0, 0),
        'thigh_r': (-78, 0, -9), 'calf_r': (92, 0, 0), 'foot_r': (18, 0, 0),
        'spine_03': (22, 0, 0), 'spine_04': (10, 0, 0),
        'upperarm_l': (34, 0, 0), 'upperarm_r': (-34, 0, 0),
    },
    'guard': {
        'upperarm_l': (0, 0, -52), 'lowerarm_l': (0, -92, 0),
        'upperarm_r': (0, 0, 46), 'lowerarm_r': (0, -88, 0),
        'thigh_l': (-18, 0, 12), 'thigh_r': (14, 0, -8), 'calf_l': (18, 0, 0),
        'spine_03': (0, 16, 0),
    },
    'punch': {
        'upperarm_r': (0, 0, 78), 'lowerarm_r': (0, -12, 0),
        'upperarm_l': (0, 0, -34), 'lowerarm_l': (0, -104, 0),
        'spine_03': (0, 26, 0), 'spine_04': (0, 12, 0),
        'thigh_r': (-24, 0, 0), 'calf_r': (22, 0, 0),
    },
}


def apply_pose(armature, pose):
    bpy.context.view_layer.objects.active = armature
    for bone in armature.pose.bones:
        bone.rotation_mode = 'XYZ'
        bone.rotation_euler = Euler((0, 0, 0), 'XYZ')
    for name, (x, y, z) in pose.items():
        bone = armature.pose.bones.get(name)
        if bone is None:
            print('TV_DEFORM missing bone %s' % name)
            continue
        bone.rotation_euler = Euler((d(x), d(y), d(z)), 'XYZ')
    bpy.context.view_layer.update()


def posed_bvh(obj):
    from mathutils.bvhtree import BVHTree
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    matrix = obj.matrix_world
    verts = [matrix @ v.co for v in mesh.vertices]
    faces = []
    for poly in mesh.polygons:
        idx = list(poly.vertices)
        for k in range(1, len(idx) - 1):
            faces.append((idx[0], idx[k], idx[k + 1]))
    evaluated.to_mesh_clear()
    return BVHTree.FromPolygons(verts, faces) if faces else None


def worst_penetration(tree, samples, reach=0.09):
    """How far the body pokes out through the garment, in the posed state.

    For each sample on the body that the garment is *near enough to be covering*, a ray straight
    outward from the body's vertical axis: if it leaves without crossing cloth, that piece of body
    is outside its own garment, and how far it is from the cloth is the depth.

    Two earlier versions of this measured nothing. Nearest-vertex over the whole mesh compared
    foot vertices to the kosode and reported 1.45 m for every piece. Nearest-surface-plus-normal
    counted every sample past an open hem -- below a kosode, beyond a sleeve -- as a penetration,
    and saturated at the search radius. A garment is only answerable for what it wraps, and a
    ray that has to cross it is the test for that.
    """
    if tree is None:
        return 0.0, 0
    depth, count = 0.0, 0
    for sample in samples:
        location, _, _, distance = tree.find_nearest(sample, reach)
        if location is None:
            continue                      # not covered by this piece at all
        outward = Vector((sample.x, sample.y + 0.02, 0.0))
        if outward.length < 1e-4:
            continue
        hit = tree.ray_cast(sample + outward.normalized() * 0.0015,
                            outward.normalized(), 0.5)
        if hit[0] is None:
            count += 1
            depth = max(depth, distance)
    return depth, count


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

    def arg(flag, default):
        return argv[argv.index(flag) + 1] if flag in argv else default

    fit_name = arg('--fit', 'female_nrw')
    pieces = arg('--outfit', 'Kosode_Work,Hakama,Obi,Geta').split(',')

    lib.reset()
    vendor, armature = {}, None
    for region in ('turtleneck', 'slacks', 'oxfords'):
        meshes, arm = lib.import_reference(os.path.join(IN, 'fit', '%s_%s.fbx'
                                                        % (fit_name, region)))
        vendor[region] = meshes
        if armature is None:
            armature = arm
        else:
            # Retarget the modifier the importer already made, rather than adding a second one.
            # Adding one left the original pointing at an armature that was about to be deleted,
            # and the mesh simply stopped deforming -- which rendered as a figure whose top was
            # posed and whose legs were not.
            for mesh in meshes:
                mesh.parent = armature
                for modifier in mesh.modifiers:
                    if modifier.type == 'ARMATURE':
                        modifier.object = armature
            bpy.data.objects.remove(arm, do_unlink=True)

    surface = lib.FitSurface([m for ms in vendor.values() for m in ms])
    fit = g.Fit(armature, surface, fit_name.split('_')[0])

    built = []
    for piece in pieces:
        build = preview.MAKERS[piece](fit)
        obj = lib.to_object(build, piece)
        proxy = lib.bind_pose_object(build, '%s_proxy' % piece)
        sources = {'Kosode_Work': ['turtleneck'], 'Kosode_Wide': ['turtleneck'],
                   'Haori': ['turtleneck'], 'Hakama': ['slacks'], 'Hakama_Short': ['slacks'],
                   'MoSkirt': ['slacks'], 'Obi': ['turtleneck', 'slacks'], 'Maekake': ['slacks'],
                   'Geta': ['oxfords', 'slacks'], 'Waraji': ['oxfords', 'slacks'],
                   'TabiBoot': ['oxfords', 'slacks']}[piece]
        lib.transfer_weights(obj, proxy, [m for r in sources for m in vendor[r]])
        lib.normalise_weights(obj)
        lib.smooth_and_finish(obj)
        lib.attach(obj, armature)
        base = preview.SHADE.get(piece, (.3, .3, .3))
        for index, shade in enumerate((base, tuple(v * 0.72 for v in base),
                                       (0.52, 0.13, 0.12), (0.78, 0.75, 0.67))):
            if index < len(obj.data.materials):
                obj.data.materials[index] = preview.material('%s_%d' % (piece, index), shade)
        built.append(obj)

    for ms in vendor.values():
        for m in ms:
            m.data.materials.clear()
            m.data.materials.append(preview.material('vendor', (0.62, 0.52, 0.46)))

    scene = preview_scene(fit)
    os.makedirs(OUT, exist_ok=True)
    report = {}
    for name, pose in POSES.items():
        apply_pose(armature, pose)
        for view, angle in (('front', 12), ('side', 78)):
            place_camera(scene, fit, angle)
            scene.render.filepath = os.path.join(OUT, '%s-%s-%s.png' % (fit_name, name, view))
            bpy.ops.render.render(write_still=True)
            print('TV_DEFORM %s' % scene.render.filepath)
        depsgraph = bpy.context.evaluated_depsgraph_get()
        sample = []
        for m in vendor['slacks'] + vendor['turtleneck']:
            ev = m.evaluated_get(depsgraph)
            mesh = ev.to_mesh()
            sample.extend([m.matrix_world @ v.co for v in mesh.vertices][::12])
            ev.to_mesh_clear()
        worst = {}
        for o in built:
            depth, count = worst_penetration(posed_bvh(o), sample)
            worst[o.name] = {'mm': round(depth * 1000, 1), 'points': count}
        report[name] = worst
        if name == 'rest':
            print('TV_DEFORM_REST %s' % worst)
        else:
            delta = {k: {'mm': round(v['mm'] - report['rest'][k]['mm'], 1),
                         'points': v['points'] - report['rest'][k]['points']}
                     for k, v in worst.items()}
            print('TV_DEFORM_DELTA %s %s' % (name, delta))
    print('TV_DEFORM_SUMMARY %s' % report)


def preview_scene(fit):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
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
    cam_data = bpy.data.cameras.new('cam')
    cam_data.lens = 70
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = 620, 900
    return scene


def place_camera(scene, fit, angle):
    centre = Vector((0, -0.02, fit.pelvis_z * 0.88))
    a = math.radians(angle)
    scene.camera.location = centre + Vector((math.sin(a) * 4.0, -math.cos(a) * 4.0, 0.25))
    direction = centre - scene.camera.location
    scene.camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


main()
