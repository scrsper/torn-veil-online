"""Reimport GLBs and inspect garment fit in deep poses, not just their bind pose.

blender -b --python art/tools/arena/validate_people_fit.py -- <people_dir> <out_dir> [id ...]
Optionally place pre-change GLBs in <out_dir>/before for matching comparisons.
"""
import bpy, json, math, os, sys
from mathutils import Vector, Quaternion, Euler
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index('--') + 1:]
source, out = [os.path.abspath(p) for p in args[:2]]
people = args[2:] or ['wren', 'brann']
os.makedirs(out, exist_ok=True)
# Rotations around character-space X: positive bends a knee backward.
POSES = {
    'walk': {'thigh_l': -30, 'thigh_r': 25, 'calf_l': 15, 'calf_r': 35},
    'run': {'thigh_l': -65, 'thigh_r': 38, 'calf_l': 30, 'calf_r': 100, 'spine_01': 12},
    'punch': {'thigh_l': (-55, -25, 20), 'thigh_r': (25, 20, -15), 'calf_l': 65, 'calf_r': 30,
              'spine_01': (15, 0, 35), 'upperarm_l': -85, 'lowerarm_l': -25},
    'crouch': {'thigh_l': -90, 'thigh_r': -90, 'calf_l': 115, 'calf_r': 115, 'spine_01': 30},
}


def triangles(obj, graph):
    evaluated = obj.evaluated_get(graph)
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    vertices = [obj.matrix_world @ v.co for v in mesh.vertices]
    faces = [tuple(t.vertices) for t in mesh.loop_triangles]
    evaluated.to_mesh_clear()
    return vertices, faces


report = {}
for pid in people:
    for variant, directory in [('before', os.path.join(out, 'before')), ('after', source)]:
        path = os.path.join(directory, pid + '.glb')
        if not os.path.exists(path): continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=path)
        rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
        pants = next(o for o in bpy.data.objects if o.type == 'MESH' and 'pants' in o.name)
        skin = next(o for o in bpy.data.objects if o.type == 'MESH' and o.name == 'Human')
        sc = bpy.context.scene
        sc.render.engine = 'BLENDER_EEVEE'
        sc.render.resolution_x, sc.render.resolution_y = 540, 700
        sc.render.resolution_percentage = 100
        sc.world = bpy.data.worlds.new('Fit validation world')
        sc.world.use_nodes = True
        bg = sc.world.node_tree.nodes.get('Background')
        bg.inputs[0].default_value = (.24, .26, .29, 1)
        bg.inputs[1].default_value = .8
        sun = bpy.data.objects.new('Fit light', bpy.data.lights.new('Fit light', 'SUN'))
        sc.collection.objects.link(sun)
        sun.data.energy = 3
        sun.rotation_euler = (.4, -.5, -.4)
        camera = bpy.data.objects.new('Fit camera', bpy.data.cameras.new('Fit camera'))
        sc.collection.objects.link(camera)
        sc.camera = camera
        camera.data.type = 'ORTHO'
        camera.data.ortho_scale = 1.9
        camera.location = (2.6, 3.4, 1.9)
        camera.rotation_euler = (Vector((0, 0, .85)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        record = {'bones': sorted(b.name for b in rig.data.bones), 'poses': {}}
        rest_v, rest_f = triangles(pants, bpy.context.evaluated_depsgraph_get())
        rest_degenerate = sum((rest_v[b] - rest_v[a]).cross(rest_v[c] - rest_v[a]).length < 1e-10 for a, b, c in rest_f)
        record['rest_degenerate_trouser_triangles'] = rest_degenerate
        for name, angles in POSES.items():
            for bone in rig.pose.bones:
                bone.rotation_mode = 'QUATERNION'
                bone.rotation_quaternion.identity()
            for name_bone, degrees in angles.items():
                bone = rig.pose.bones[name_bone]
                orientation = bone.bone.matrix_local.to_quaternion()
                turn = (Euler(tuple(math.radians(v) for v in degrees)).to_quaternion()
                        if isinstance(degrees, tuple) else Quaternion((1, 0, 0), math.radians(degrees)))
                bone.rotation_quaternion = orientation.inverted() @ turn @ orientation
            bpy.context.view_layer.update()
            graph = bpy.context.evaluated_depsgraph_get()
            pv, pf = triangles(pants, graph)
            sv, sf = triangles(skin, graph)
            intersections = len(BVHTree.FromPolygons(pv, pf).overlap(BVHTree.FromPolygons(sv, sf)))
            degenerate = sum((pv[b] - pv[a]).cross(pv[c] - pv[a]).length < 1e-10 for a, b, c in pf)
            assert degenerate <= rest_degenerate, f'{pid} {name}: newly collapsed trouser triangles'
            record['poses'][name] = {'skin_trouser_triangle_contacts': intersections,
                                     'trouser_triangles': len(pf), 'skin_triangles': len(sf),
                                     'degenerate_trouser_triangles': degenerate}
            sc.render.filepath = os.path.join(out, f'{pid}-{variant}-{name}.png')
            bpy.ops.render.render(write_still=True)
            camera.location = (2.6, -3.4, 1.9)
            camera.rotation_euler = (Vector((0, 0, .85)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = os.path.join(out, f'{pid}-{variant}-{name}-front.png')
            bpy.ops.render.render(write_still=True)
            camera.location = (2.6, 3.4, 1.9)
            camera.rotation_euler = (Vector((0, 0, .85)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        report[f'{pid}-{variant}'] = record
    if f'{pid}-before' in report:
        before, after = report[f'{pid}-before'], report[f'{pid}-after']
        assert before['bones'] == after['bones'], f'{pid}: rig changed'
        for pose in POSES:
            old, new = before['poses'][pose], after['poses'][pose]
            assert old['trouser_triangles'] == new['trouser_triangles'], f'{pid}: garment topology changed'
            assert new['skin_trouser_triangle_contacts'] <= old['skin_trouser_triangle_contacts'], f'{pid} {pose}: fit regressed'
        assert sum(p['skin_trouser_triangle_contacts'] for p in after['poses'].values()) < sum(p['skin_trouser_triangle_contacts'] for p in before['poses'].values()), f'{pid}: no measured fit improvement'
with open(os.path.join(out, 'fit-validation.json'), 'w') as receipt:
    json.dump(report, receipt, indent=2)
print('FIT_VALIDATION', json.dumps({k: v['poses'] for k, v in report.items()}))
