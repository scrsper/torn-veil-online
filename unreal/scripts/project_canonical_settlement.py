"""Project a loaded canonical settlement through a culture visual profile.

Run with the bridge live:
  ./unreal/scripts/Run-EditorPython.ps1 -Script unreal/scripts/project_canonical_settlement.py

The bridge owns facts: terrain columns, footprints, elevations, doors, fences and resources.
This script owns only how those facts read in Unreal.  It intentionally has no Ashford place-name
conditions; a new settlement can use the same traversal with a different visual profile.
"""
import json
import math
import os
import sys
import urllib.request

import unreal
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from visual_profiles import ASHFORD_JAPANESE_MEDIEVAL_FANTASY as PROFILE, family_for_place, stable_variant

LEVEL = '/Game/TornVeil/Maps/Ashford'
MATERIAL_DIR = '/Game/TornVeil/Materials'
TAG = 'TornVeilCanonicalProjection'
BRIDGE = 'http://127.0.0.1:8787/scene'
KEN, POST, WALL_H, EAVE = 182.0, 20.0, 250.0, 135.0

actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
CUBE = unreal.load_asset('/Engine/BasicShapes/Cube')
CYLINDER = unreal.load_asset('/Engine/BasicShapes/Cylinder')
CONE = unreal.load_asset('/Engine/BasicShapes/Cone')


def canonical_scene():
    try:
        with urllib.request.urlopen(BRIDGE, timeout=8) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as error:
        raise RuntimeError('Could not read canonical /scene (%s). Start npm run bridge; this script never invents a layout.' % error)


class Projection:
    def __init__(self, scene):
        self.origin, self.units = scene['origin'], float(scene['unitsPerMetre'])
    def xy(self, x, z): return ((x - self.origin['x']) * self.units, (z - self.origin['z']) * self.units)
    def z(self, y): return (y - self.origin['y']) * self.units


def make_material(name, colour, roughness, emissive=None, tint_parameter=False):
    path = '%s/%s' % (MATERIAL_DIR, name)
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        material = unreal.load_asset(path)
        # Appearance profiles apply these four parameterised materials to the Epic-compatible
        # skeletal mesh.  The usage flag is a renderer requirement, not a character fact; keep
        # it correct even when a profile pass reuses an existing material asset.
        if tint_parameter:
            material.set_editor_property('used_with_skeletal_mesh', True)
            unreal.MaterialEditingLibrary.recompile_material(material)
            unreal.EditorAssetLibrary.save_asset(path)
        return material
    unreal.EditorAssetLibrary.make_directory(MATERIAL_DIR)
    material = unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, MATERIAL_DIR, unreal.Material, unreal.MaterialFactoryNew())
    if tint_parameter:
        material.set_editor_property('used_with_skeletal_mesh', True)
    base = unreal.MaterialEditingLibrary.create_material_expression(material, unreal.MaterialExpressionVectorParameter if tint_parameter else unreal.MaterialExpressionConstant3Vector, -400, 0)
    if tint_parameter:
        base.set_editor_property('parameter_name', 'Tint'); base.set_editor_property('default_value', unreal.LinearColor(colour[0], colour[1], colour[2], 1))
    else:
        base.set_editor_property('constant', unreal.LinearColor(colour[0], colour[1], colour[2], 1))
    rough = unreal.MaterialEditingLibrary.create_material_expression(material, unreal.MaterialExpressionConstant, -400, 160)
    rough.set_editor_property('r', roughness)
    unreal.MaterialEditingLibrary.connect_material_property(base, '', unreal.MaterialProperty.MP_BASE_COLOR)
    unreal.MaterialEditingLibrary.connect_material_property(rough, '', unreal.MaterialProperty.MP_ROUGHNESS)
    if emissive:
        glow = unreal.MaterialEditingLibrary.create_material_expression(material, unreal.MaterialExpressionConstant3Vector, -400, 300)
        glow.set_editor_property('constant', unreal.LinearColor(emissive[0], emissive[1], emissive[2], 1))
        unreal.MaterialEditingLibrary.connect_material_property(glow, '', unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    unreal.MaterialEditingLibrary.recompile_material(material); unreal.EditorAssetLibrary.save_asset(path)
    return material


def palette():
    return {
        'tile': make_material('M_TV_RoofTile', (0.022, 0.024, 0.030), .34),
        'timber': make_material('M_TV_DarkTimber', (.042, .030, .022), .72),
        'plaster': make_material('M_TV_Plaster', (.56, .52, .44), .88),
        'stone': make_material('M_TV_Stone', (.18, .178, .168), .82),
        'earth': make_material('M_TV_PackedEarth', (.105, .088, .068), .95),
        'paper': make_material('M_TV_LanternPaper', (.90, .62, .30), .55, (4.5, 2.3, .75)),
        'grass': make_material('M_TV_ValleyGrass', (.115, .235, .075), .96),
        'path': make_material('M_TV_ValleyPath', (.20, .135, .075), .98),
        'field': make_material('M_TV_FieldEarth', (.11, .052, .022), .98),
        'water': make_material('M_TV_RiverWater', (.025, .11, .18), .25),
        'foliage': make_material('M_TV_ValleyFoliage', (.045, .20, .055), .92),
        'banner': make_material('M_TV_AshfordBanner', (.35, .018, .025), .7),
        'indigo': make_material('M_TV_AshfordIndigo', (.025, .06, .21), .7),
        'gold': make_material('M_TV_CeremonialGold', (.55, .30, .04), .42),
        'crop': make_material('M_TV_RipeCrop', (.55, .37, .045), .94),
        # Native characters use these as dynamic Material Instances.  Their colours are read
        # from the canonical appearance record; this script only creates the reusable palette.
        'character_skin': make_material('M_TV_CharacterSkin', (.72, .48, .32), .72, tint_parameter=True),
        'character_cloth': make_material('M_TV_CharacterCloth', (.08, .12, .26), .78, tint_parameter=True),
        'character_hair': make_material('M_TV_CharacterHair', (.04, .025, .016), .88, tint_parameter=True),
        'character_prop': make_material('M_TV_CharacterProp', (.18, .12, .055), .7, tint_parameter=True),
    }


def visual_blocker(component):
    """Camera sees canonical solids; player movement remains TypeScript-authoritative."""
    try:
        component.set_collision_enabled(unreal.CollisionEnabled.QUERY_ONLY)
        component.set_collision_response_to_channel(unreal.CollisionChannel.ECC_Pawn, unreal.CollisionResponse.IGNORE)
        component.set_collision_response_to_channel(unreal.CollisionChannel.ECC_Camera, unreal.CollisionResponse.BLOCK)
    except Exception:
        # Engine enum bindings differ by minor UE release.  An ordinary static actor remains a
        # safer visual than failing all projection, and the bridge remains movement authority.
        pass


def box(label, centre, size, material, rotation=None, mesh=None, camera_block=True):
    actor = actors.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(*centre), rotation or unreal.Rotator())
    actor.set_actor_label(label); actor.tags = [TAG]
    component = actor.static_mesh_component; component.set_static_mesh(mesh or CUBE); component.set_material(0, material)
    actor.set_actor_scale3d(unreal.Vector(size[0] / 100., size[1] / 100., size[2] / 100.))
    if camera_block: visual_blocker(component)
    return actor


def lantern(label, pos, p):
    box(label, pos, (24, 24, 38), p['paper'], mesh=CYLINDER)
    light = actors.spawn_actor_from_class(unreal.PointLight, unreal.Vector(*pos)); light.set_actor_label(label + ' light'); light.tags = [TAG]
    component = light.light_component; component.set_editor_property('intensity', 180.); component.set_editor_property('attenuation_radius', 440.)
    component.set_editor_property('light_color', unreal.Color(r=255, g=176, b=96)); component.set_editor_property('cast_shadows', True)


def bounds(place, projection):
    b = place['bounds']; x0, y0 = projection.xy(b['x0'], b['z0']); x1, y1 = projection.xy(b['x1'], b['z1'])
    return (x0, y0, x1, y1, projection.z(b['y0']), abs(x1 - x0), abs(y1 - y0))


def door_side(place, projection, cx, cy):
    door = place.get('door')
    if not door: return None
    dx, dy = projection.xy(door['x'], door['z'])
    if abs(dx - cx) > abs(dy - cy): return ('x', 1 if dx > cx else -1)
    return ('y', 1 if dy > cy else -1)


def wall_shell(label, cx, cy, floor, width, depth, door, p, tall=1):
    h = WALL_H * tall
    # Back and side walls are single canonical-visible masses; the door-facing wall splits at
    # the canonical doorway so an opening stays visibly an opening.
    if door and door[0] == 'x':
        box(label + ' back wall', (cx - door[1] * width / 2., cy, floor + h / 2.), (POST, depth, h), p['timber'])
        box(label + ' north wall', (cx, cy - depth / 2., floor + h / 2.), (width, POST, h), p['plaster'])
        box(label + ' south wall', (cx, cy + depth / 2., floor + h / 2.), (width, POST, h), p['plaster'])
        for offset in (-1, 1): box(label + ' front wall', (cx + door[1] * width / 2., cy + offset * (depth / 2. - 78), floor + h / 2.), (POST, max(30, depth / 2. - 115), h), p['plaster'])
    elif door:
        box(label + ' back wall', (cx, cy - door[1] * depth / 2., floor + h / 2.), (width, POST, h), p['timber'])
        box(label + ' east wall', (cx + width / 2., cy, floor + h / 2.), (POST, depth, h), p['plaster'])
        box(label + ' west wall', (cx - width / 2., cy, floor + h / 2.), (POST, depth, h), p['plaster'])
        for offset in (-1, 1): box(label + ' front wall', (cx + offset * (width / 2. - 78), cy + door[1] * depth / 2., floor + h / 2.), (max(30, width / 2. - 115), POST, h), p['plaster'])
    else:
        box(label + ' wall', (cx, cy, floor + h / 2.), (width, depth, h), p['plaster'])
    # Structural language: exposed posts and a dark head beam, irrespective of family variant.
    for sx in (-1, 1):
        for sy in (-1, 1): box(label + ' corner post', (cx + sx * width / 2., cy + sy * depth / 2., floor + h / 2.), (POST, POST, h), p['timber'])
    box(label + ' head beam N', (cx, cy - depth / 2., floor + h - 10), (width + 30, 20, 20), p['timber'])
    box(label + ' head beam S', (cx, cy + depth / 2., floor + h - 10), (width + 30, 20, 20), p['timber'])


def roof(label, cx, cy, floor, width, depth, p, style='gable', tier=0):
    eave = EAVE + tier * 18; rise = (min(width, depth) / 2. + eave) * math.tan(math.radians(31))
    if style == 'layered':
        roof(label + ' lower roof', cx, cy, floor, width, depth, p, 'hip', 0)
        roof(label + ' upper roof', cx, cy, floor + 145, width * .67, depth * .67, p, 'hip', 1); return
    along_y = depth >= width; span = width if along_y else depth; ridge = (depth if along_y else width) + 2 * eave
    reach = span / 2. + eave; slope = reach / math.cos(math.radians(31)); z = floor + WALL_H + rise / 2.
    if style == 'hip':
        for side in (-1, 1):
            x, y = (cx + side * reach / 2., cy) if along_y else (cx, cy + side * reach / 2.)
            yaw = (0 if side > 0 else 180) + (0 if along_y else 90)
            box(label + ' roof', (x, y, z), (slope, ridge, 20) if along_y else (ridge, slope, 20), p['tile'], unreal.Rotator(0, -31, yaw))
    else:
        for side in (-1, 1):
            x, y = (cx + side * reach / 2., cy) if along_y else (cx, cy + side * reach / 2.)
            yaw = (0 if side > 0 else 180) + (0 if along_y else 90)
            box(label + ' roof', (x, y, z), (slope, ridge, 22) if along_y else (ridge, slope, 22), p['tile'], unreal.Rotator(0, -31, yaw))
    box(label + ' ridge', (cx, cy, floor + WALL_H + rise + 14), (32, ridge, 28) if along_y else (ridge, 32, 28), p['tile'])


def banner(label, cx, cy, z, p, gold=False):
    box(label + ' pole', (cx, cy, z + 105), (10, 10, 210), p['timber'])
    box(label + ' cloth', (cx + 24, cy, z + 140), (40, 8, 82), p['gold'] if gold else p['banner'])


def japanese_building(place, projection, p, variant, family):
    x0, y0, x1, y1, floor, width, depth = bounds(place, projection); cx, cy = (x0 + x1) / 2., (y0 + y1) / 2.
    name, door = place['name'], door_side(place, projection, cx, cy)
    box(name + ' stone plinth', (cx, cy, floor - 12), (width + 45, depth + 45, 24), p['stone'])
    tall = 2 if variant in ('two_storey', 'two_storey_shop', 'tall_gatehouse') else 1
    wall_shell(name, cx, cy, floor, width, depth, door, p, tall)
    if tall == 2:
        box(name + ' upper ledge', (cx, cy, floor + WALL_H + 15), (width + 80, depth + 80, 30), p['timber'])
    roof(name, cx, cy, floor + (WALL_H if tall == 2 else 0), width + (0 if tall == 1 else 25), depth + (0 if tall == 1 else 25), p, 'hip' if variant in ('raised_sidewing', 'two_storey_shop') else 'gable')
    if door:
        axis, sign = door; ex, ey = (cx + sign * (width / 2. + 65), cy) if axis == 'x' else (cx, cy + sign * (depth / 2. + 65))
        size = (130, depth, 40) if axis == 'x' else (width, 130, 40)
        box(name + ' raised engawa', (ex, ey, floor + 20), size, p['timber'])
        # The bridge's current canonical door state controls whether the visible entrance is a
        # dark timber panel or an open threshold.  It never changes passage authority.
        if not place.get('doorOpen', False):
            panel = (18, 118, 205) if axis == 'x' else (118, 18, 205)
            box(name + ' canonical closed door', (ex, ey, floor + 104), panel, p['timber'])
        lantern(name + ' lantern', (ex, ey, floor + WALL_H - 62), p)
    if family == 'shop':
        banner(name, cx, cy - depth / 2. - 30, floor, p)
        box(name + ' counter', (cx, cy - depth / 2. - 55, floor + 55), (min(width * .7, 420), 55, 90), p['timber'])
    if family == 'workshop':
        box(name + ' forge chimney', (cx + width * .28, cy + depth * .28, floor + 205), (85, 85, 410), p['stone'])
        box(name + ' worktable', (cx - width * .25, cy - depth * .35, floor + 52), (150, 80, 78), p['timber'])
    return cx, cy, floor


def stall(place, projection, p, variant):
    x0, y0, x1, y1, floor, width, depth = bounds(place, projection); cx, cy = (x0 + x1) / 2., (y0 + y1) / 2.; name = place['name']
    for sx in (-1, 1):
        for sy in (-1, 1): box(name + ' post', (cx + sx * width / 2., cy + sy * depth / 2., floor + 100), (18, 18, 200), p['timber'])
    box(name + ' counter', (cx, cy - depth / 2. + 30, floor + 48), (width + 25, 70, 88), p['timber'])
    roof(name + ' canopy', cx, cy, floor - 55, width + 145, depth + 145, p, 'gable')
    banner(name, cx + width * .33, cy, floor, p)
    for index in range(3): box(name + ' basket', (cx - width * .25 + index * 55, cy - depth * .35, floor + 104), (34, 34, 30), p['crop'], mesh=CYLINDER)


def well(place, projection, p):
    x0, y0, x1, y1, floor, _, _ = bounds(place, projection); cx, cy = (x0 + x1) / 2., (y0 + y1) / 2.; name = place['name']
    box(name + ' stone kerb', (cx, cy, floor + 40), (155, 155, 80), p['stone'], mesh=CYLINDER)
    box(name + ' water', (cx, cy, floor + 83), (108, 108, 12), p['water'], mesh=CYLINDER, camera_block=False)
    for side in (-1, 1): box(name + ' well post', (cx + side * 76, cy, floor + 130), (16, 16, 260), p['timber'])
    box(name + ' beam', (cx, cy, floor + 258), (190, 16, 16), p['timber']); roof(name + ' cap', cx, cy, floor - 85, 190, 160, p, 'gable'); lantern(name + ' lantern', (cx, cy, floor + 230), p)


def temple(place, projection, p, variant):
    x0, y0, x1, y1, floor, width, depth = bounds(place, projection); cx, cy = (x0 + x1) / 2., (y0 + y1) / 2.; name = place['name']
    box(name + ' ceremonial terrace', (cx, cy, floor - 18), (width + 180, depth + 180, 36), p['stone'])
    wall_shell(name, cx, cy, floor, width * .78, depth * .72, door_side(place, projection, cx, cy), p)
    roof(name, cx, cy, floor, width + 80, depth + 80, p, 'layered' if variant != 'small_shrine' else 'hip')
    for step in range(3): box(name + ' step', (cx, cy + depth / 2. + 70 + step * 54, floor + step * 15), (width * .42 + (2 - step) * 75, 54, 30), p['stone'])
    for side in (-1, 1):
        lantern(name + ' pillar lantern', (cx + side * (width / 2. + 65), cy + depth / 2. + 90, floor + 118), p)
        banner(name + ' crest', cx + side * width * .33, cy - depth / 2. - 55, floor, p, True)


def farm(place, projection, p, seed):
    x0, y0, x1, y1, floor, width, depth = bounds(place, projection); name = place['name']
    for x in range(int(x0 + 90), int(x1), 120):
        for y in range(int(y0 + 90), int(y1), 120):
            if stable_variant(seed, '%s:%d:%d' % (place['id'], x, y), (0, 1, 2)):
                box(name + ' crop row', (x, y, floor + 9), (82, 26, 18), p['crop'], camera_block=False)
    for x in (x0, x1): box(name + ' fence', (x, (y0 + y1) / 2., floor + 55), (12, depth + 80, 110), p['timber'])
    for y in (y0, y1): box(name + ' fence', ((x0 + x1) / 2., y, floor + 55), (width + 80, 12, 110), p['timber'])


def tree(label, x, y, z, p, scale=1):
    box(label + ' trunk', (x, y, z + 145 * scale), (36 * scale, 36 * scale, 290 * scale), p['timber'])
    box(label + ' crown', (x, y, z + 350 * scale), (215 * scale, 215 * scale, 215 * scale), p['foliage'], mesh=CONE)


def wilderness(place, projection, p, seed):
    x0, y0, x1, y1, floor, width, depth = bounds(place, projection); count = max(4, min(15, int(width * depth / 80000)))
    for i in range(count):
        sx = stable_variant(seed, '%s:x:%d' % (place['id'], i), tuple(range(13, 88))) / 100.; sy = stable_variant(seed, '%s:y:%d' % (place['id'], i), tuple(range(13, 88))) / 100.
        tree(place['name'] + ' tree', x0 + width * sx, y0 + depth * sy, floor, p, .75 + (i % 3) * .12)


def landmark(place, projection, p, seed):
    typ = place['type']; x0, y0, x1, y1, floor, width, depth = bounds(place, projection); cx, cy = (x0 + x1) / 2., (y0 + y1) / 2.; name = place['name']
    if typ == 'graveyard':
        for x in range(int(x0 + 80), int(x1 - 50), 95):
            for y in range(int(y0 + 80), int(y1 - 50), 110): box(name + ' grave', (x, y, floor + 44), (35, 18, 88), p['stone'])
    elif typ == 'quarry':
        for i in range(9): box(name + ' stone face', (x0 + 65 + (i % 3) * 115, y0 + 65 + (i // 3) * 115, floor + 45 + (i % 2) * 38), (105, 105, 90), p['stone'])
    elif typ in ('gate',):
        for side in (-1, 1): box(name + ' gate post', (cx + side * width * .32, cy, floor + 190), (55, 55, 380), p['timber'])
        box(name + ' gate roof', (cx, cy, floor + 390), (width + 115, 105, 36), p['tile'])
    elif typ in ('mill', 'sawpit', 'construction'):
        japanese_building(place, projection, p, stable_variant(seed, place['id'], ('mill_house', 'sawpit_shed', 'storage_frame')), 'industrial')
        if typ == 'mill': box(name + ' wheel', (cx - width / 2. - 45, cy, floor + 115), (30, 230, 230), p['timber'], mesh=CYLINDER)
    elif typ == 'shrine':
        temple(place, projection, p, 'small_shrine')
    elif typ == 'camp':
        for i in range(3): box(name + ' camp shelter', (cx - 160 + i * 150, cy, floor + 70), (130, 100, 140), p['timber'])
    elif typ == 'square':
        box(name + ' packed square', (cx, cy, floor + 5), (width, depth, 10), p['path'], camera_block=False)
    elif typ == 'riverbank':
        box(name + ' river water', (cx, cy, floor + 6), (width + 50, depth + 50, 12), p['water'], camera_block=False)


def project_terrain(scene, projection, p):
    terrain = scene.get('terrain', {}); columns = terrain.get('columns', [])
    if not columns: return
    cells = {(row[0], row[1]): row for row in columns}; stride = 4
    material_for = {1: p['grass'], 2: p['earth'], 3: p['stone'], 9: p['water'], 10: p['earth'], 15: p['field'], 16: p['crop'], 26: p['path'], 42: p['grass'], 43: p['foliage'], 48: p['path'], 51: p['earth']}
    for x in range(0, terrain['width'], stride):
        for z in range(0, terrain['depth'], stride):
            sample = [cells[(ix, iz)] for ix in range(x, min(x + stride, terrain['width'])) for iz in range(z, min(z + stride, terrain['depth'])) if (ix, iz) in cells]
            if not sample: continue
            average_y = sum(row[2] for row in sample) / float(len(sample)); blocks = [row[3] for row in sample]
            block = max(set(blocks), key=blocks.count); cx, cy = projection.xy(x + stride / 2., z + stride / 2.)
            box('canonical terrain %d %d' % (x, z), (cx, cy, projection.z(average_y) - 8), (stride * 100 + 4, stride * 100 + 4, 16), material_for.get(block, p['grass']), camera_block=False)
    for fence in terrain.get('fences', []):
        x, y = projection.xy(fence['x'] + .5, fence['z'] + .5); z = projection.z(fence['y']) + 50
        box('canonical fence', (x, y, z), (14, 14, 110), p['timber'])


def light_valley(p):
    # These are deliberately profile-owned atmosphere choices, not a replacement terrain or
    # weather simulation.  A future biome profile can supply a different sky, light and fog
    # treatment while this projection continues to consume the exact same canonical scene.
    sun = actors.spawn_actor_from_class(unreal.DirectionalLight, unreal.Vector(0, 0, 4200)); sun.set_actor_label('Ashford warm valley sun'); sun.tags = [TAG]
    sun.light_component.set_editor_property('intensity', 3.5); sun.light_component.set_editor_property('light_color', unreal.Color(r=255, g=226, b=188)); sun.light_component.set_editor_property('atmosphere_sun_light', True); sun.set_actor_rotation(unreal.Rotator(0, -35, -128), False)
    sky_light = actors.spawn_actor_from_class(unreal.SkyLight, unreal.Vector(0, 0, 1200)); sky_light.set_actor_label('Ashford valley skylight'); sky_light.tags = [TAG]
    sky_light.light_component.set_editor_property('intensity', 1.5); sky_light.light_component.set_editor_property('real_time_capture', True)
    atmosphere = actors.spawn_actor_from_class(unreal.SkyAtmosphere, unreal.Vector()); atmosphere.set_actor_label('Ashford valley sky'); atmosphere.tags = [TAG]
    fog = actors.spawn_actor_from_class(unreal.ExponentialHeightFog, unreal.Vector()); fog.set_actor_label('Ashford valley air'); fog.tags = [TAG]
    fog.component.set_editor_property('fog_density', .004); fog.component.set_editor_property('fog_height_falloff', .12); fog.component.set_editor_property('enable_volumetric_fog', True)


def presentation_camera(scene, projection):
    """A non-interactive inspection camera for live projection verification.

    It is positioned from the canonical square rather than a place name and never participates
    in collision, navigation or canonical state.  The playable camera remains the Traveler's.
    """
    square = next((place for place in scene['places'] if place['type'] == 'square'), scene['places'][0])
    x0, y0, x1, y1, _, _, _ = bounds(square, projection); cx, cy = (x0 + x1) / 2., (y0 + y1) / 2.
    camera = actors.spawn_actor_from_class(unreal.CameraActor, unreal.Vector(cx - 3300, cy - 3300, 3300), unreal.Rotator(0, -45, 45))
    camera.set_actor_label('Ashford presentation inspection camera'); camera.tags = [TAG]
    camera.camera_component.set_editor_property('field_of_view', 68.)


def main():
    scene = canonical_scene(); projection = Projection(scene); levels.load_level(LEVEL)
    for actor in actors.get_all_level_actors():
        if TAG in [str(t) for t in actor.tags] or 'Foundation floor' in actor.get_actor_label(): actors.destroy_actor(actor)
    p, seed = palette(), scene['seed']; project_terrain(scene, projection, p)
    openings = {('%d:%d:%d' % (row['x'], row['y'], row['z'])): row['open'] for row in scene.get('terrain', {}).get('openings', [])}
    for place in scene['places']:
        if place.get('door'):
            d = place['door']; place['doorOpen'] = openings.get('%d:%d:%d' % (d['x'], d['y'], d['z']), False)
        typ, family = place['type'], family_for_place(place['type'])
        if family == 'stall': stall(place, projection, p, stable_variant(seed, place['id'], PROFILE.families[family].variants))
        elif family == 'temple': temple(place, projection, p, stable_variant(seed, place['id'], PROFILE.families[family].variants))
        elif family: japanese_building(place, projection, p, stable_variant(seed, place['id'], PROFILE.families[family].variants), family)
        elif typ == 'well': well(place, projection, p)
        elif typ == 'farm': farm(place, projection, p, seed)
        elif typ == 'wilderness': wilderness(place, projection, p, seed)
        else: landmark(place, projection, p, seed)
    for node in scene['resources']:
        x, y = projection.xy(node['pos']['x'], node['pos']['z']); z = projection.z(node['pos']['y'])
        material = p['stone'] if node['pos']['y'] > scene['origin']['y'] + 2 else p['foliage']
        box('canonical resource %s' % node['id'], (x, y, z + 45), (75, 75, 90), material)
    light_valley(p); presentation_camera(scene, projection); levels.save_current_level()
    print('CANONICAL_SETTLEMENT_READY profile=%s places=%d resources=%d' % (PROFILE.key, len(scene['places']), len(scene['resources'])))


main()
