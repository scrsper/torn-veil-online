"""
One settlement corner, built on canonical ground.

Scope, deliberately: the north-west approach to Ashford's square — the bakery, the bread stall
and the well. Not the village. The rest of the map stays the integration floor it has been, and
`create_foundation_level.py` still owns it.

Everything here is placement and dressing. The footprints, heights, doorways and names all come
from the running bridge's `/scene`, which reports the canonical places TypeScript already
generated, so this corner sits exactly where the simulation says those buildings are rather than
inventing a second geography. Nothing in this file decides where anything in the world is.

The look is grounded Japanese vernacular rather than European half-timber: dark charcoal tile
over deep eaves, dark timber post-and-beam with cream plaster infill between the posts, a raised
engawa under the overhang, and warm paper lanterns at the doors. It is built from engine
primitives and generated materials on purpose — no asset pack is downloaded, nothing is
redistributed, and it runs on a bare UE 5.8 install. Swapping any of these boxes for real
modular meshes later is a per-actor change, not a rewrite.

Run it (with `npm run bridge` up in another terminal):

    ./unreal/scripts/Run-EditorPython.ps1 -Script unreal/scripts/create_settlement_corner.py

Re-running is safe: every actor it makes is tagged, and the tagged ones are cleared first.
"""
import json
import math
import urllib.request

import unreal

LEVEL = '/Game/TornVeil/Maps/Ashford'
MATERIAL_DIR = '/Game/TornVeil/Materials'
TAG = 'TornVeilCorner'
BRIDGE = 'http://127.0.0.1:8787/scene'

# The corner. Named by canonical place name so a regenerated world with shifted ids still works.
CORNER = ["Bramble's Bakery", 'the bread stall', 'the village well']

# --- proportions, in centimetres. Japanese vernacular: low eaves, deep overhang, heavy roof.
KEN = 182.0             # one bay; post spacing
POST = 20.0             # timber post, square section
WALL_H = 250.0          # eave height above the floor -- deliberately low
EAVE = 165.0            # how far the roof reaches past the wall. The whole silhouette.
PITCH = 32.0            # roof pitch, degrees
TILE_T = 22.0           # roof slab thickness, read as a course of tile
ENGAWA_W = 110.0        # the veranda under the eaves
ENGAWA_H = 42.0

actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
CUBE = unreal.load_asset('/Engine/BasicShapes/Cube')
CYLINDER = unreal.load_asset('/Engine/BasicShapes/Cylinder')


# ------------------------------------------------------------------ canonical scene
def canonical_scene():
    try:
        with urllib.request.urlopen(BRIDGE, timeout=5) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as error:
        raise RuntimeError(
            'Could not read the canonical scene from %s (%s). Start the simulation first: '
            '`npm run bridge`. This script will not invent building footprints.' % (BRIDGE, error))


class Projection:
    """Canonical metres -> Unreal centimetres, using the origin the bridge reports."""

    def __init__(self, scene):
        self.origin = scene['origin']
        self.units = float(scene['unitsPerMetre'])

    def xy(self, x, z):
        return ((x - self.origin['x']) * self.units, (z - self.origin['z']) * self.units)

    def z(self, y):
        return (y - self.origin['y']) * self.units

    def size(self, metres):
        return metres * self.units


# ------------------------------------------------------------------ materials
def make_material(name, colour, roughness, metallic=0.0, emissive=None):
    path = '%s/%s' % (MATERIAL_DIR, name)
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        return unreal.load_asset(path)
    unreal.EditorAssetLibrary.make_directory(MATERIAL_DIR)
    material = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        name, MATERIAL_DIR, unreal.Material, unreal.MaterialFactoryNew())

    def constant(value, x, y):
        node = unreal.MaterialEditingLibrary.create_material_expression(
            material, unreal.MaterialExpressionConstant, x, y)
        node.set_editor_property('r', value)
        return node

    base = unreal.MaterialEditingLibrary.create_material_expression(
        material, unreal.MaterialExpressionConstant3Vector, -400, 0)
    base.set_editor_property('constant', unreal.LinearColor(colour[0], colour[1], colour[2], 1.0))
    unreal.MaterialEditingLibrary.connect_material_property(base, '', unreal.MaterialProperty.MP_BASE_COLOR)
    unreal.MaterialEditingLibrary.connect_material_property(constant(roughness, -400, 200), '', unreal.MaterialProperty.MP_ROUGHNESS)
    unreal.MaterialEditingLibrary.connect_material_property(constant(metallic, -400, 320), '', unreal.MaterialProperty.MP_METALLIC)
    if emissive:
        glow = unreal.MaterialEditingLibrary.create_material_expression(
            material, unreal.MaterialExpressionConstant3Vector, -400, 440)
        glow.set_editor_property('constant', unreal.LinearColor(emissive[0], emissive[1], emissive[2], 1.0))
        unreal.MaterialEditingLibrary.connect_material_property(glow, '', unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    unreal.MaterialEditingLibrary.recompile_material(material)
    unreal.EditorAssetLibrary.save_asset(path)
    return material


def palette():
    return {
        # Charcoal kawara: near-black, and glossier than anything else on the building, which is
        # what makes a tiled roof read as tile in overcast light rather than as a dark plane.
        'tile': make_material('M_TV_RoofTile', (0.022, 0.024, 0.030), 0.34),
        'timber': make_material('M_TV_DarkTimber', (0.042, 0.030, 0.022), 0.72),
        'plaster': make_material('M_TV_Plaster', (0.560, 0.520, 0.440), 0.88),
        'stone': make_material('M_TV_Stone', (0.180, 0.178, 0.168), 0.82),
        'earth': make_material('M_TV_PackedEarth', (0.105, 0.088, 0.068), 0.95),
        'paper': make_material('M_TV_LanternPaper', (0.90, 0.62, 0.30), 0.55, emissive=(6.0, 3.1, 1.1)),
    }


# ------------------------------------------------------------------ primitives
def box(label, centre, size, material, rotation=None, mesh=None):
    actor = actors.spawn_actor_from_class(
        unreal.StaticMeshActor, unreal.Vector(*centre), rotation or unreal.Rotator(0, 0, 0))
    actor.set_actor_label(label)
    actor.tags = [TAG]
    component = actor.static_mesh_component
    component.set_static_mesh(mesh or CUBE)
    component.set_material(0, material)
    # The basic shapes are 100 cm across, so scale is size in metres.
    actor.set_actor_scale3d(unreal.Vector(size[0] / 100.0, size[1] / 100.0, size[2] / 100.0))
    return actor


def lantern(label, position, material):
    box(label, (position[0], position[1], position[2]), (26, 26, 38), material, mesh=CYLINDER)
    light = actors.spawn_actor_from_class(unreal.PointLight, unreal.Vector(*position))
    light.set_actor_label(label + ' light')
    light.tags = [TAG]
    component = light.light_component
    component.set_editor_property('intensity', 1400.0)
    component.set_editor_property('attenuation_radius', 900.0)
    component.set_editor_property('light_color', unreal.Color(255, 176, 96))
    component.set_editor_property('source_radius', 12.0)
    component.set_editor_property('cast_shadows', True)
    component.set_editor_property('volumetric_scattering_intensity', 2.4)


# ------------------------------------------------------------------ a building
def timber_frame(name, cx, cy, floor, width, depth, materials, walls=True):
    """Post-and-beam with plaster infill. Posts on a ken grid, a sill and a head beam."""
    half_w, half_d = width / 2.0, depth / 2.0
    if walls:
        box(name + ' plaster', (cx, cy, floor + WALL_H / 2.0),
            (width - POST, depth - POST, WALL_H), materials['plaster'])
    for sx in (-1, 1):
        for offset in frange(-half_d, half_d, KEN):
            box(name + ' post', (cx + sx * half_w, cy + offset, floor + WALL_H / 2.0),
                (POST, POST, WALL_H), materials['timber'])
    for sy in (-1, 1):
        for offset in frange(-half_w, half_w, KEN):
            box(name + ' post', (cx + offset, cy + sy * half_d, floor + WALL_H / 2.0),
                (POST, POST, WALL_H), materials['timber'])
    for sy in (-1, 1):
        box(name + ' head beam', (cx, cy + sy * half_d, floor + WALL_H - POST / 2.0),
            (width + POST, POST, POST), materials['timber'])
        box(name + ' sill', (cx, cy + sy * half_d, floor + POST / 2.0),
            (width + POST, POST, POST), materials['timber'])


def deep_eaved_roof(name, cx, cy, floor, width, depth, materials):
    """A gabled tile roof whose overhang is the point of the silhouette. Ridge along the long axis."""
    along_y = depth >= width
    span = width if along_y else depth          # the axis the slopes run down
    ridge_len = (depth if along_y else width) + 2 * EAVE
    reach = span / 2.0 + EAVE                   # horizontal run of one slope
    rise = reach * math.tan(math.radians(PITCH))
    slope_len = reach / math.cos(math.radians(PITCH))
    ridge_z = floor + WALL_H + rise

    for side in (-1, 1):
        # Local +X runs down the slope, so the far slab is turned about and both nose down.
        yaw = (0 if side > 0 else 180) + (0 if along_y else 90)
        centre_x, centre_y = (cx + side * reach / 2.0, cy) if along_y else (cx, cy + side * reach / 2.0)
        box(name + ' roof', (centre_x, centre_y, floor + WALL_H + rise / 2.0),
            (slope_len, ridge_len, TILE_T), materials['tile'],
            rotation=unreal.Rotator(0.0, -PITCH, yaw))
        # A rafter line under the overhang: the eave has to read as carried, not floating.
        edge_x, edge_y = (cx + side * reach, cy) if along_y else (cx, cy + side * reach)
        box(name + ' eave fascia', (edge_x, edge_y, floor + WALL_H - 4),
            (14, ridge_len, 16) if along_y else (ridge_len, 14, 16), materials['timber'])

    box(name + ' ridge', (cx, cy, ridge_z + TILE_T / 2.0),
        (34, ridge_len, 26) if along_y else (ridge_len, 34, 26), materials['tile'])


def machiya(place, projection, materials):
    bounds = place['bounds']
    x0, y0 = projection.xy(bounds['x0'], bounds['z0'])
    x1, y1 = projection.xy(bounds['x1'], bounds['z1'])
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    width, depth = abs(x1 - x0), abs(y1 - y0)
    floor = projection.z(bounds['y0'])
    name = place['name']

    box(name + ' plinth', (cx, cy, floor - 12), (width + 60, depth + 60, 24), materials['stone'])
    timber_frame(name, cx, cy, floor, width, depth, materials)
    deep_eaved_roof(name, cx, cy, floor, width, depth, materials)

    # An engawa on the side the canonical door is on, so the veranda faces the way people arrive.
    door = place.get('door')
    if door:
        dx, dy = projection.xy(door['x'], door['z'])
        if abs(dx - cx) > abs(dy - cy):
            side = 1 if dx > cx else -1
            box(name + ' engawa', (cx + side * (width / 2.0 + ENGAWA_W / 2.0), cy, floor + ENGAWA_H / 2.0),
                (ENGAWA_W, depth, ENGAWA_H), materials['timber'])
            lantern(name + ' lantern', (cx + side * (width / 2.0 + ENGAWA_W), cy - depth / 4.0, floor + WALL_H - 60), materials['paper'])
            lantern(name + ' lantern', (cx + side * (width / 2.0 + ENGAWA_W), cy + depth / 4.0, floor + WALL_H - 60), materials['paper'])
        else:
            side = 1 if dy > cy else -1
            box(name + ' engawa', (cx, cy + side * (depth / 2.0 + ENGAWA_W / 2.0), floor + ENGAWA_H / 2.0),
                (width, ENGAWA_W, ENGAWA_H), materials['timber'])
            lantern(name + ' lantern', (cx - width / 4.0, cy + side * (depth / 2.0 + ENGAWA_W), floor + WALL_H - 60), materials['paper'])
            lantern(name + ' lantern', (cx + width / 4.0, cy + side * (depth / 2.0 + ENGAWA_W), floor + WALL_H - 60), materials['paper'])


def market_stall(place, projection, materials):
    """Four posts, a counter, and a deep tiled canopy. The same roof language, one storey down."""
    bounds = place['bounds']
    x0, y0 = projection.xy(bounds['x0'], bounds['z0'])
    x1, y1 = projection.xy(bounds['x1'], bounds['z1'])
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    width, depth = abs(x1 - x0), abs(y1 - y0)
    floor = projection.z(bounds['y0'])
    name = place['name']
    post_h = 205.0

    box(name + ' ground', (cx, cy, floor - 8), (width + 40, depth + 40, 16), materials['earth'])
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(name + ' post', (cx + sx * width / 2.0, cy + sy * depth / 2.0, floor + post_h / 2.0),
                (POST, POST, post_h), materials['timber'])
    box(name + ' counter', (cx, cy - depth / 2.0 + 22, floor + 46), (width, 44, 10), materials['timber'])
    reach = width / 2.0 + 95
    rise = reach * math.tan(math.radians(24))
    for side in (-1, 1):
        box(name + ' canopy', (cx + side * reach / 2.0, cy, floor + post_h + rise / 2.0),
            (reach / math.cos(math.radians(24)), depth + 190, 14), materials['tile'],
            rotation=unreal.Rotator(0.0, -24.0, 0 if side > 0 else 180))
    lantern(name + ' lantern', (cx, cy - depth / 2.0 - 10, floor + post_h - 30), materials['paper'])


def well(place, projection, materials):
    """A stone kerb, two posts and a small tiled cap -- the corner's landmark."""
    bounds = place['bounds']
    x0, y0 = projection.xy(bounds['x0'], bounds['z0'])
    x1, y1 = projection.xy(bounds['x1'], bounds['z1'])
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    floor = projection.z(bounds['y0'])
    name = place['name']
    box(name + ' kerb', (cx, cy, floor + 40), (150, 150, 80), materials['stone'], mesh=CYLINDER)
    box(name + ' mouth', (cx, cy, floor + 78), (112, 112, 12), materials['earth'], mesh=CYLINDER)
    for side in (-1, 1):
        box(name + ' post', (cx + side * 78, cy, floor + 130), (16, 16, 260), materials['timber'])
    box(name + ' beam', (cx, cy, floor + 258), (190, 16, 16), materials['timber'])
    for side in (-1, 1):
        box(name + ' cap', (cx + side * 62, cy, floor + 292), (140, 190, 12), materials['tile'],
            rotation=unreal.Rotator(0.0, -26.0, 0 if side > 0 else 180))
    lantern(name + ' lantern', (cx, cy, floor + 232), materials['paper'])


def frange(start, stop, step):
    values, v = [], start
    while v <= stop + 1e-6:
        values.append(v)
        v += step
    if abs(values[-1] - stop) > 1e-6:
        values.append(stop)
    return values


# ------------------------------------------------------------------ light
def light_the_corner(materials):
    """Late afternoon, low and warm, with enough fog for the eaves to have depth under them."""
    for actor in actors.get_all_level_actors():
        if isinstance(actor, unreal.DirectionalLight):
            actor.light_component.set_editor_property('intensity', 5.5)
            actor.light_component.set_editor_property('light_color', unreal.Color(255, 226, 188))
            actor.set_actor_rotation(unreal.Rotator(0, -14, -128), False)
            actor.light_component.set_editor_property('volumetric_scattering_intensity', 2.0)
        elif isinstance(actor, unreal.SkyLight):
            actor.light_component.set_editor_property('intensity', 1.2)
            actor.light_component.set_editor_property('real_time_capture', True)

    fog = actors.spawn_actor_from_class(unreal.ExponentialHeightFog, unreal.Vector(0, 0, 0))
    fog.set_actor_label('Valley air')
    fog.tags = [TAG]
    fog.component.set_editor_property('fog_density', 0.035)
    fog.component.set_editor_property('fog_height_falloff', 0.12)
    fog.component.set_editor_property('fog_inscattering_luminance', unreal.LinearColor(0.16, 0.19, 0.25, 1.0))
    fog.component.set_editor_property('volumetric_fog', True)
    fog.component.set_editor_property('volumetric_fog_extinction_scale', 1.5)

    post = actors.spawn_actor_from_class(unreal.PostProcessVolume, unreal.Vector(0, 0, 0))
    post.set_actor_label('Corner grade')
    post.tags = [TAG]
    post.set_editor_property('unbound', True)
    settings = post.get_editor_property('settings')
    settings.set_editor_property('override_auto_exposure_min_brightness', True)
    settings.set_editor_property('auto_exposure_min_brightness', 0.6)
    settings.set_editor_property('override_auto_exposure_max_brightness', True)
    settings.set_editor_property('auto_exposure_max_brightness', 2.2)
    settings.set_editor_property('override_bloom_intensity', True)
    settings.set_editor_property('bloom_intensity', 0.55)
    post.set_editor_property('settings', settings)


# ------------------------------------------------------------------ run
def main():
    scene = canonical_scene()
    projection = Projection(scene)
    levels.load_level(LEVEL)

    removed = 0
    for actor in actors.get_all_level_actors():
        if TAG in [str(t) for t in actor.tags]:
            actors.destroy_actor(actor)
            removed += 1

    materials = palette()

    # The integration floor is a bare grey plane. Giving it packed earth costs nothing and stops
    # the corner reading as a diorama on a table. The floor itself stays exactly where it is.
    for actor in actors.get_all_level_actors():
        if isinstance(actor, unreal.StaticMeshActor) and 'Foundation floor' in actor.get_actor_label():
            actor.static_mesh_component.set_material(0, materials['earth'])

    places = {p['name']: p for p in scene['places']}
    built = []
    for name in CORNER:
        place = places.get(name)
        if not place:
            unreal.log_warning('Canonical place %r is not in this world; skipping.' % name)
            continue
        if place['type'] == 'stall':
            market_stall(place, projection, materials)
        elif place['type'] == 'well':
            well(place, projection, materials)
        else:
            machiya(place, projection, materials)
        built.append(name)

    light_the_corner(materials)
    levels.save_current_level()
    print('SETTLEMENT_CORNER_READY cleared=%d built=%s' % (removed, ', '.join(built)))


main()
