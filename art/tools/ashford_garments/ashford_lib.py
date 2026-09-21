"""Primitives for building the Ashford garment set in Blender.

No garment shapes live here -- only the small vocabulary they are all written in: lofted tubes,
ribbons laid on a surface, frames along a bone chain, skin-weight transfer, and export. The
garments themselves are in `garments.py`, so that the *shapes* stay readable as art direction
rather than as mesh plumbing.

Conventions, all measured off the City Sample rig rather than assumed (see `measure_fit.py`):

* Metres, Z up. The figure faces **-Y**; +X is the figure's left.
* Ring angle `t` starts at the front (-Y) and runs anticlockwise seen from above, so `t=pi/2` is
  the figure's left side and `t=pi` is the back. Every garment describes itself in these terms.
* Two bind poses exist, female and male, and they differ by 11 cm of stature. Nothing here
  hard-codes a height; every dimension is derived from a bone or from a sampled vendor surface.
"""
import math
import os

import bpy
import bmesh
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

TAU = math.pi * 2


# --------------------------------------------------------------------------------------------
# Scene and vendor-reference handling
# --------------------------------------------------------------------------------------------

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_reference(path):
    """Import one vendor FBX and return (mesh objects, armature). The armature that comes with it
    carries *that build's* bind pose, which is the only correct one to bind new geometry to."""
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    fresh = [o for o in bpy.context.scene.objects if o not in before]
    meshes = [o for o in fresh if o.type == 'MESH']
    armatures = [o for o in fresh if o.type == 'ARMATURE']
    return meshes, (armatures[0] if armatures else None)


LIMB_PREFIXES = {
    'torso': ('pelvis', 'spine_', 'neck_', 'clavicle_'),
    'arm': ('upperarm', 'lowerarm', 'hand_', 'thumb', 'index', 'middle', 'ring', 'pinky'),
    'leg': ('thigh', 'calf', 'foot_', 'ball_'),
}


def _limb_of(bone):
    for limb, prefixes in LIMB_PREFIXES.items():
        if any(bone.startswith(p) for p in prefixes):
            return limb
    return None


class FitSurface:
    """The clothed vendor silhouette of one build, queryable as 'how wide is the body here'.

    A ray cast outward from the spine, and how far it travels before it hits cloth. That is a
    better sizing primitive than a table of measured bands, because a garment needs the body's
    width at the armpit, in the small of the back, and at the hem flare -- places no band scheme
    thinks to record.

    **It is partitioned by limb, and that is not an optimisation.** The first version was one
    tree over everything, and a sideways ray at chest height flew past the torso and hit the
    A-posed arm 45 cm out, so every kosode ring came back nearly half a metre wide and the
    garment rendered as a set of flat plates. Faces are assigned to a limb by majority vote of
    their vertices' heaviest bones.
    """

    def __init__(self, objects):
        self.trees = {}
        pools = {}
        for obj in objects:
            m = obj.matrix_world
            limb_of_vertex = {}
            for v in obj.data.vertices:
                best, weight = None, 0.0
                for group in v.groups:
                    if group.weight > weight:
                        best, weight = obj.vertex_groups[group.group].name, group.weight
                limb_of_vertex[v.index] = _limb_of(best) if best else None
            for poly in obj.data.polygons:
                votes = {}
                for i in poly.vertices:
                    limb = limb_of_vertex.get(i)
                    if limb:
                        side = 'l' if (m @ obj.data.vertices[i].co).x >= 0 else 'r'
                        key = limb if limb == 'torso' else '%s_%s' % (limb, side)
                        votes[key] = votes.get(key, 0) + 1
                if not votes:
                    continue
                key = max(votes, key=votes.get)
                pool = pools.setdefault(key, ([], []))
                offset = len(pool[0])
                pool[0].extend([m @ obj.data.vertices[i].co for i in poly.vertices])
                for k in range(1, len(poly.vertices) - 1):
                    pool[1].append((offset, offset + k, offset + k + 1))
        self.span = {}
        for key, (verts, faces) in pools.items():
            if faces:
                self.trees[key] = BVHTree.FromPolygons(verts, faces)
                self.span[key] = (min(v.z for v in verts), max(v.z for v in verts))
        self.counts = {k: len(v[1]) for k, v in pools.items()}

    def radius(self, centre, direction, limb='torso', limit=0.5, default=0.12):
        """Distance from `centre` to the vendor surface along `direction`, within one limb."""
        tree = self.trees.get(limb)
        if tree is None:
            return default
        hit = tree.ray_cast(centre + direction * 0.001, direction, limit)
        if hit[0] is None:
            return default
        return max(0.02, (hit[0] - centre).length)

    def section(self, z, cx, cy, samples=32, limb='torso', default=0.12):
        """Outward radius at `samples` angles around (cx, cy, z). The raw shape of the body at
        that height, before any garment ease is added."""
        centre = Vector((cx, cy, z))
        out = []
        for i in range(samples):
            t = TAU * i / samples
            d = Vector((math.sin(t), -math.cos(t), 0)).normalized()
            out.append(self.radius(centre, d, limb=limb, default=default))
        return out


# --------------------------------------------------------------------------------------------
# Geometry construction
# --------------------------------------------------------------------------------------------

class Build:
    """Accumulates verts / faces / uvs / vertex-colour regions for one garment piece.

    Every vertex is added twice over: once at its real position, and once at a `bind` position
    that hugs the body. The bind copy is what skin weights are sampled at -- a sleeve that hangs
    30 cm off the arm has no sensible nearest-surface weight, but the point on the arm it hangs
    from does. This is the whole trick that keeps wide sleeves and a pleated hakama deforming
    like cloth instead of like a flag nailed to the nearest bone.
    """

    def __init__(self):
        self.verts = []
        self.bind = []
        self.faces = []
        self.uvs = []          # per loop, filled alongside faces
        self.regions = []      # per vertex (accent, under, wear)

    def add(self, position, bind, region=(0.0, 0.0, 0.0)):
        self.verts.append(Vector(position))
        self.bind.append(Vector(bind))
        self.regions.append(region)
        return len(self.verts) - 1

    def quad(self, a, b, c, d, uv):
        self.faces.append((a, b, c, d))
        self.uvs.append(uv)

    def tri(self, a, b, c, uv):
        self.faces.append((a, b, c))
        self.uvs.append(uv)


def ring_points(cx, cy, z, rx, ry, segments, power=2.4, modulate=None):
    """One horizontal cross-section. A superellipse rather than a circle: a wrapped robe has a
    flat front and flat back, and a plain ellipse reads as a dress form."""
    out = []
    for i in range(segments):
        t = TAU * i / segments
        s, c = math.sin(t), math.cos(t)
        sx = math.copysign(abs(s) ** (2.0 / power), s) if s else 0.0
        sy = math.copysign(abs(c) ** (2.0 / power), c) if c else 0.0
        scale = modulate(t) if modulate else 1.0
        out.append(Vector((cx + rx * scale * sx, cy - ry * scale * sy, z)))
    return out


def loft(build, rings, bind_rings, regions=None, close_bottom=False, close_top=False,
         v_scale=1.0, flip=False):
    """Stitch a stack of equal-length rings into a tube. `regions` is one (accent, under, wear)
    triple per ring, so a hem can be dirtier than a shoulder without a texture."""
    segments = len(rings[0])
    index = []
    run = 0.0
    for r, (real, bound) in enumerate(zip(rings, bind_rings)):
        if r:
            run += (real[0] - rings[r - 1][0]).length
        region = regions[r] if regions else (0.0, 0.0, 0.0)
        index.append([build.add(p, b, region) for p, b in zip(real, bound)])
    for r in range(len(rings) - 1):
        v0 = sum((rings[k][0] - rings[k - 1][0]).length for k in range(1, r + 1))
        v1 = v0 + (rings[r + 1][0] - rings[r][0]).length
        for s in range(segments):
            n = (s + 1) % segments
            a, b = index[r][s], index[r][n]
            c, d = index[r + 1][n], index[r + 1][s]
            u0, u1 = s / segments, (s + 1) / segments
            uv = [(u0, v0 * v_scale), (u1, v0 * v_scale), (u1, v1 * v_scale), (u0, v1 * v_scale)]
            build.quad(*((a, d, c, b) if flip else (a, b, c, d)),
                       uv=(uv if not flip else [uv[0], uv[3], uv[2], uv[1]]))
    if close_bottom:
        _cap(build, index[0], rings[0], flip=not flip)
    if close_top:
        _cap(build, index[-1], rings[-1], flip=flip)
    return index


def _cap(build, ring_index, ring, flip):
    centre = sum(ring, Vector()) / len(ring)
    centre_bind = centre
    hub = build.add(centre, centre_bind, build.regions[ring_index[0]])
    for s in range(len(ring_index)):
        n = (s + 1) % len(ring_index)
        a, b = ring_index[s], ring_index[n]
        tri = (hub, b, a) if flip else (hub, a, b)
        build.tri(*tri, uv=[(0.5, 0.5), (0.0, 0.0), (1.0, 0.0)])


def frames_along(points, samples):
    """Resample a bone chain and give each sample a frame: tangent, plus a 'down' axis that is
    world-down projected perpendicular to the tangent. Sleeves hang by gravity, not by bone roll,
    so this is the axis a hanging sleeve is described in."""
    segs = []
    total = 0.0
    for a, b in zip(points, points[1:]):
        d = (b - a).length
        segs.append((a, b, d, total))
        total += d
    out = []
    for i in range(samples):
        s = total * i / (samples - 1)
        for a, b, d, start in segs:
            if s <= start + d or (a, b, d, start) == segs[-1]:
                t = min(1.0, max(0.0, (s - start) / d))
                origin = a.lerp(b, t)
                tangent = (b - a).normalized()
                break
        down = Vector((0, 0, -1))
        down = (down - tangent * down.dot(tangent))
        down = down.normalized() if down.length > 1e-5 else Vector((0, -1, 0))
        side = tangent.cross(down).normalized()
        out.append((origin, tangent, down, side, s / total))
    return out


def tube_along(build, frames, radius_of, regions_of=None, hang=None, bind_radius_of=None,
               segments=12, close_start=False, close_end=False):
    """A tube following a bone chain. `hang` scales the ring in the 'down' direction only, which
    is how a wide kimono sleeve is made: the same tube around the arm, pulled toward the floor."""
    rings, binds, regions = [], [], []
    for origin, tangent, down, side, s in frames:
        r = radius_of(s)
        br = bind_radius_of(s) if bind_radius_of else min(r, 0.075)
        h = hang(s) if hang else 1.0
        real, bound = [], []
        for i in range(segments):
            t = TAU * i / segments
            # t = 0 points 'down'; the hang factor therefore biases the bottom of the sleeve.
            scale = 1.0 + (h - 1.0) * max(0.0, math.cos(t))
            offset = down * (math.cos(t) * r * scale) + side * (math.sin(t) * r)
            real.append(origin + offset)
            bound.append(origin + (down * math.cos(t) + side * math.sin(t)) * br)
        rings.append(real)
        binds.append(bound)
        regions.append(regions_of(s) if regions_of else (0.0, 0.0, 0.0))
    return loft(build, rings, binds, regions, close_bottom=close_start, close_top=close_end)


def ribbon(build, path, width_of, lift_of, normal_of, region, across_of=None, v_scale=6.0):
    """A flat band laid on a surface -- a collar, an obi tie, a hem trim.

    Built from a centreline rather than from a cut in the body tube. A kosode's collar is a
    separate strip of cloth sewn on top, and modelling it that way means the body tube stays a
    clean closed surface with no interior faces to catch the light wrong.

    `across_of` overrides the width direction, and a caller running a band down a surface that
    is *widening* should supply it. Deriving the width from the path tangent alone looks right
    until the path moves radially as fast as it moves along the body -- which is what a collar
    does between the neck and the chest, where the torso goes from 7 cm to 16 cm. There the
    tangent and the normal are nearly parallel, their cross product collapses, and normalising it
    turns a 6 cm collar into a sheet across the whole chest.
    """
    left, right = [], []
    for i, point in enumerate(path):
        nxt = path[min(i + 1, len(path) - 1)]
        prv = path[max(i - 1, 0)]
        tangent = (nxt - prv)
        tangent = tangent.normalized() if tangent.length > 1e-6 else Vector((0, 0, 1))
        normal = normal_of(i).normalized()
        if across_of is not None:
            across = across_of(i).normalized()
        else:
            across = tangent.cross(normal)
            across = across.normalized() if across.length > 1e-3 else Vector((0, 0, 1))
        w = width_of(i / (len(path) - 1))
        base = point + normal * lift_of(i / (len(path) - 1))
        left.append(base + across * w)
        right.append(base - across * w)
    # Backed by an *offset* copy, not by a second face on the same four vertices. Sharing the
    # vertices made every band two coplanar quads with opposite winding: they z-fight, their
    # normals cancel, and after a merge-by-distance pass the result renders as a scatter of
    # broken shards down the chest. Four millimetres of separation is invisible and makes each
    # band a solid with a consistent outside.
    inner = [p - normal_of(i).normalized() * 0.004 for i, p in enumerate(left)]
    inner_r = [p - normal_of(i).normalized() * 0.004 for i, p in enumerate(right)]
    li = [build.add(p, p, region) for p in left]
    ri = [build.add(p, p, region) for p in right]
    lb = [build.add(p, p, region) for p in inner]
    rb = [build.add(p, p, region) for p in inner_r]
    for i in range(len(path) - 1):
        v0, v1 = i / (len(path) - 1) * v_scale, (i + 1) / (len(path) - 1) * v_scale
        uv = [(0.0, v0), (1.0, v0), (1.0, v1), (0.0, v1)]
        build.quad(li[i], ri[i], ri[i + 1], li[i + 1], uv=uv)
        build.quad(lb[i + 1], rb[i + 1], rb[i], lb[i],
                   uv=[(0.0, v1), (1.0, v1), (1.0, v0), (0.0, v0)])
        # Edges, so the band has a visible thickness where it is seen side-on.
        build.quad(li[i + 1], lb[i + 1], lb[i], li[i], uv=uv)
        build.quad(rb[i], rb[i + 1], ri[i + 1], ri[i], uv=uv)
    return li, ri


# --------------------------------------------------------------------------------------------
# Turning a Build into a skinned Blender object
# --------------------------------------------------------------------------------------------

def to_object(build, name, collection=None):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in build.verts], [], [tuple(f) for f in build.faces])
    mesh.validate(verbose=False)
    mesh.update()

    uv = mesh.uv_layers.new(name='UVMap')
    loop = 0
    for face, coords in zip(build.faces, build.uvs):
        for k in range(len(face)):
            if loop < len(uv.data):
                uv.data[loop].uv = coords[k] if k < len(coords) else (0.0, 0.0)
            loop += 1

    colour = mesh.color_attributes.new(name='Region', type='BYTE_COLOR', domain='CORNER')
    loop = 0
    for face in build.faces:
        for vi in face:
            if loop < len(colour.data):
                r, g, b = build.regions[vi]
                colour.data[loop].color = (r, g, b, 1.0)
            loop += 1

    obj = bpy.data.objects.new(name, mesh)
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def bind_pose_object(build, name):
    """A throwaway object at the *bind* positions, used only as a weight-sampling proxy."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in build.bind], [], [tuple(f) for f in build.faces])
    mesh.validate(verbose=False)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def transfer_weights(target, proxy, sources):
    """Copy skin weights from the vendor garments onto `target`, sampled at `proxy`'s positions.

    Nearest-polygon interpolation against content that is already correctly weighted to this
    build's bind pose. Authoring weights by hand for twenty-eight meshes was never an option, and
    an automatic bone-heat bind would have to guess at the 170-bone twist and correction chains
    that City Sample's deformation actually relies on.
    """
    for source in sources:
        modifier = proxy.modifiers.new(name='xfer_%s' % source.name, type='DATA_TRANSFER')
        modifier.object = source
        modifier.use_vert_data = True
        modifier.data_types_verts = {'VGROUP_WEIGHTS'}
        modifier.vert_mapping = 'POLYINTERP_NEAREST'
        modifier.layers_vgroup_select_src = 'ALL'
        modifier.layers_vgroup_select_dst = 'NAME'
        bpy.context.view_layer.objects.active = proxy
        bpy.ops.object.datalayout_transfer(modifier=modifier.name)
        bpy.ops.object.modifier_apply(modifier=modifier.name)

    # Move the sampled groups onto the real geometry, vertex index for vertex index -- the proxy
    # is the same topology, only pulled in against the body.
    for group in proxy.vertex_groups:
        target.vertex_groups.new(name=group.name)
    lookup = {g.name: g.index for g in target.vertex_groups}
    for v in proxy.data.vertices:
        for g in v.groups:
            name = proxy.vertex_groups[g.group].name
            if g.weight > 0.0005:
                target.vertex_groups[lookup[name]].add([v.index], g.weight, 'REPLACE')
    bpy.data.objects.remove(proxy, do_unlink=True)


def normalise_weights(obj, limit=8):
    """Cap influences per vertex and renormalise. Unreal imports at most 12 and City Sample's rig
    is wide enough that nearest-polygon sampling routinely produces more."""
    stripped = 0
    for v in obj.data.vertices:
        pairs = sorted(((g.group, g.weight) for g in v.groups), key=lambda kv: -kv[1])
        keep = pairs[:limit]
        drop = pairs[limit:]
        total = sum(w for _, w in keep)
        if total <= 0:
            continue
        for group, _ in drop:
            obj.vertex_groups[group].remove([v.index])
            stripped += 1
        for group, weight in keep:
            obj.vertex_groups[group].add([v.index], weight / total, 'REPLACE')
    return stripped


def attach(obj, armature):
    """Parent a garment to the rig the way the vendor meshes are parented to it.

    The armature arrives from FBX under an empty with a 0.01 scale, so its world matrix is in
    centimetres while these garments are authored in metres with an identity transform. Parenting
    without accounting for that multiplies the garment by 0.01 and it vanishes to a speck at the
    character's feet -- which is exactly what the first deformation test rendered. Baking the
    inverse into the mesh data puts the new geometry in the same local space as the vendor's,
    which is also the space the FBX exporter expects to write.
    """
    inverse = armature.matrix_world.inverted()
    obj.data.transform(inverse)
    obj.parent = armature
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_basis = Matrix.Identity(4)
    modifier = obj.modifiers.new(name='Armature', type='ARMATURE')
    modifier.object = armature
    modifier.use_vertex_groups = True


def smooth_and_finish(obj, angle=math.radians(50)):
    mesh = obj.data
    for poly in mesh.polygons:
        poly.use_smooth = True
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0008)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def stats(obj):
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    return {'verts': len(obj.data.vertices), 'tris': tris,
            'groups': len(obj.vertex_groups),
            'materials': [s.name for s in obj.material_slots]}


def export_fbx(objects, armature, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.export_scene.fbx(
        filepath=path, use_selection=True, add_leaf_bones=False,
        bake_anim=False, mesh_smooth_type='FACE', use_mesh_modifiers=False,
        primary_bone_axis='Y', secondary_bone_axis='X',
        apply_scale_options='FBX_SCALE_NONE', global_scale=1.0,
        colors_type='SRGB', object_types={'ARMATURE', 'MESH'},
    )
    return path
