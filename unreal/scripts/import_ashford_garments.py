"""Import the Ashford cultural garment set and build the shader that colours it.

    unreal/scripts/Run-EditorPython.ps1 -Script unreal/scripts/import_ashford_garments.py

Reads the FBX that `art/tools/ashford_garments/build_garments.py` wrote to
`.debug/ashford-garments/out/`, imports each one onto the City Sample clothing skeleton
(`SK_Base`), and assigns the four region materials described below.

## Why the imported assets are not committed

They are generated, and they embed the vendor skeleton's reference pose. `Content/TornVeil/`
LocalPalette already draws this line for environment content derived from licensed library
packages: the *generator* is the source of truth and is committed, the built `.uasset` is
machine-local and rebuilt on demand. Anybody with the City Sample Crowds pack installed runs the
Blender generator and then this script, and gets byte-identical geometry.

## The shader

`M_TV_AshfordCloth` and three instances of it, one per region, assigned to the four material
slots every garment carries. All four read the parameters the presentation layer already pushes
onto every part -- `Tint`, `Accent`, `Wear`, `Grooming` -- and differ only in which ones they
listen to:

    0 Cloth   the garment's own colour: `Tint`, dulled toward dirt by `Wear`.
    1 Hem     the same, dirtier: hems and knees are where dirt actually collects.
    2 Accent  the collar band, the obi, the thong of a sandal: `Accent`.
    3 Under   the pale under-layer inside the collar. Barely tinted, ever.

That is what lets one mesh produce a muted indigo kosode with a vermilion collar, and the reason
this set needs no material per colourway.

**These regions were vertex colours first, and that does not work here.** UE 5.8 imports FBX
through Interchange, and Interchange ignores `FbxImportUI.skeletal_mesh_import_data.
vertex_color_import_option`. The generator wrote the masks, the exported FBX was verified to
carry all four of them, and they arrived in the engine as nothing -- with no error, no warning,
and every garment in the settlement rendering as one flat colour. A material slot cannot go
missing quietly.
"""
import json
import os

import unreal

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SOURCE = os.path.join(REPO, '.debug', 'ashford-garments', 'out')
CONTENT = '/Game/TornVeil/Characters/Ashford'
MATERIAL_PATH = '/Game/TornVeil/Materials/M_TV_AshfordCloth'
SKELETON = '/Game/CitySampleCrowd/Character/Shared/Rig/SK_Base'

# The cloth this culture actually weaves, before any per-person tint. Hemp and plant-dyed
# cotton: never pure white, never pure black, and warm rather than neutral.
UNDER_LAYER = (0.74, 0.71, 0.63)


def connect(source, output, target, input_name):
    if not unreal.MaterialEditingLibrary.connect_material_expressions(source, output, target, input_name):
        raise RuntimeError('pin connection failed: %s.%s -> %s.%s'
                           % (source.get_name(), output, target.get_name(), input_name))


def expression(material, kind, x, y):
    return unreal.MaterialEditingLibrary.create_material_expression(material, kind, x, y)


def vector_param(material, name, value, x, y):
    node = expression(material, unreal.MaterialExpressionVectorParameter, x, y)
    node.set_editor_property('parameter_name', name)
    node.set_editor_property('default_value', unreal.LinearColor(*value, 1.0))
    return node


def scalar_param(material, name, value, x, y):
    node = expression(material, unreal.MaterialExpressionScalarParameter, x, y)
    node.set_editor_property('parameter_name', name)
    node.set_editor_property('default_value', value)
    return node


def colour(material, value, x, y):
    node = expression(material, unreal.MaterialExpressionConstant3Vector, x, y)
    node.set_editor_property('constant', unreal.LinearColor(*value, 1.0))
    return node


def constant(material, value, x, y):
    node = expression(material, unreal.MaterialExpressionConstant, x, y)
    node.set_editor_property('r', value)
    return node


# Inputs below may be a node, or a (node, output pin) pair. The vertex-colour channels are taken
# from `VertexColor`'s own named outputs rather than through a `ComponentMask` node: a mask whose
# input is wired by `connect_material_expressions` reports "Missing ComponentMask input" at
# compile time and silently drops the whole material to Epic's default grey, which is worse than
# a wrong colour because nothing at runtime says so.
def pin(source):
    return source if isinstance(source, tuple) else (source, '')


def lerp(material, a, b, alpha, x, y):
    node = expression(material, unreal.MaterialExpressionLinearInterpolate, x, y)
    for source, name in ((a, 'A'), (b, 'B'), (alpha, 'Alpha')):
        connect(*pin(source), node, name)
    return node


def multiply(material, a, b, x, y):
    node = expression(material, unreal.MaterialExpressionMultiply, x, y)
    connect(*pin(a), node, 'A')
    connect(*pin(b), node, 'B')
    return node


def add(material, a, b, x, y):
    node = expression(material, unreal.MaterialExpressionAdd, x, y)
    connect(*pin(a), node, 'A')
    connect(*pin(b), node, 'B')
    return node


def build_material():
    # Deleted and rebuilt, never edited in place. The editor loads and compiles every material in
    # the project at startup, so a previous broken version reports its failure in the log before
    # this script runs at all -- and that made it impossible to tell from the log whether the
    # graph written *by this run* compiles. Starting from nothing makes the log mean something.
    if unreal.EditorAssetLibrary.does_asset_exist(MATERIAL_PATH):
        unreal.EditorAssetLibrary.delete_asset(MATERIAL_PATH)
    package, name = MATERIAL_PATH.rsplit('/', 1)
    material = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        name, package, unreal.Material, unreal.MaterialFactoryNew())
    material.set_editor_property('two_sided', False)
    # Without this the material compiles, is assigned, reports no error at import, and then
    # renders as Epic's grey default the moment it is put on a skinned mesh -- the only notice
    # being one line in the PIE log ("missing usage flag SkeletalMesh"). Every garment in the
    # settlement came out untextured grey on the first PIE run because of it.
    material.set_editor_property('used_with_skeletal_mesh', True)

    tint = vector_param(material, 'Tint', (0.18, 0.21, 0.30), -1200, -400)
    accent = vector_param(material, 'Accent', (0.55, 0.14, 0.13), -1200, -200)
    wear = scalar_param(material, 'Wear', 0.25, -1200, 100)
    # Declared so an instance can be told how clean a person keeps themselves, and so the
    # parameter the presentation layer pushes for hair and skin does not log a miss here.
    scalar_param(material, 'Grooming', 0.5, -1200, 250)

    # Per-instance dials. One parent material serves all four regions; an instance says which
    # colour this region takes and how hard wear hits it, and nothing else changes.
    accent_mix = scalar_param(material, 'AccentMix', 0.0, -1200, -100)
    under_mix = scalar_param(material, 'UnderMix', 0.0, -1200, -50)
    wear_strength = scalar_param(material, 'WearStrength', 0.35, -1200, 160)

    under = colour(material, UNDER_LAYER, -1200, 0)

    # Ground cloth -> pale under-layer -> accent band. Order matters: the accent is painted last
    # so a collar band stays the accent colour even where the under-collar is also mixed in.
    # Vector parameters are taken on their RGB pin; their default output is four-channel, and a
    # Lerp between a float4 and a float3 is an undefined arithmetic in the shader compiler.
    with_under = lerp(material, (tint, 'RGB'), under, under_mix, -500, -200)
    with_accent = lerp(material, with_under, (accent, 'RGB'), accent_mix, -300, -100)

    # Wear reaches as far as the region lets it, so a hem goes grubby and a shoulder does not.
    #
    # It *darkens*, rather than blending toward a dirt colour. Blending toward a mid-brown lifted
    # a near-black charcoal kosode (0x22222a) to a mid grey -- dirt was making the darkest cloth
    # in the palette three times brighter, which is the opposite of what dirt does and flattened
    # the whole range. The canonical appearance layer has also already weathered the colour once
    # (`weatheredColour` mixes toward a dusty neutral before the tint is ever pushed), so a second
    # blend here was double-counting as well as inverting.
    local_wear = multiply(material, wear, wear_strength, -500, 300)
    darken = expression(material, unreal.MaterialExpressionOneMinus, -300, 300)
    connect(*pin(multiply(material, local_wear, constant(material, 0.45, -400, 380), -350, 320)),
            darken, '')
    base_colour = multiply(material, with_accent, darken, -100, 0)
    unreal.MaterialEditingLibrary.connect_material_property(
        base_colour, '', unreal.MaterialProperty.MP_BASE_COLOR)

    # Worn cloth is rougher, never shinier. Plant-dyed hemp starts rough to begin with.
    rough_base = constant(material, 0.72, -500, 500)
    rough_add = multiply(material, local_wear, constant(material, 0.16, -500, 620), -300, 540)
    unreal.MaterialEditingLibrary.connect_material_property(
        add(material, rough_base, rough_add, -100, 520), '', unreal.MaterialProperty.MP_ROUGHNESS)

    unreal.MaterialEditingLibrary.recompile_material(material)
    unreal.EditorAssetLibrary.save_asset(MATERIAL_PATH)
    unreal.log('TV_ASHFORD material %s' % MATERIAL_PATH)
    return material


# Slot order must match `REGION_SLOTS` in art/tools/ashford_garments/ashford_lib.py: the mesh
# assigns faces by index, so the two lists are one contract in two files.
REGION_INSTANCES = [
    ('Cloth', {'AccentMix': 0.0, 'UnderMix': 0.0, 'WearStrength': 0.16}),
    ('Hem', {'AccentMix': 0.0, 'UnderMix': 0.0, 'WearStrength': 0.55}),
    ('Accent', {'AccentMix': 1.0, 'UnderMix': 0.0, 'WearStrength': 0.10}),
    ('Under', {'AccentMix': 0.0, 'UnderMix': 0.92, 'WearStrength': 0.12}),
]


def build_region_instances(parent):
    """One material instance per region, so a garment's collar can take a different colour from
    its body without a second mesh, a second texture or a vertex-colour channel."""
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    package = MATERIAL_PATH.rsplit('/', 1)[0]
    out = []
    for name, scalars in REGION_INSTANCES:
        path = '%s/MI_TV_Ashford%s' % (package, name)
        if unreal.EditorAssetLibrary.does_asset_exist(path):
            unreal.EditorAssetLibrary.delete_asset(path)
        instance = tools.create_asset('MI_TV_Ashford%s' % name, package,
                                      unreal.MaterialInstanceConstant,
                                      unreal.MaterialInstanceConstantFactoryNew())
        unreal.MaterialEditingLibrary.set_material_instance_parent(instance, parent)
        for key, value in scalars.items():
            unreal.MaterialEditingLibrary.set_material_instance_scalar_parameter_value(
                instance, key, value)
        unreal.EditorAssetLibrary.save_asset(path)
        out.append(instance)
        unreal.log('TV_ASHFORD instance %s %s' % (path, scalars))
    return out


def import_garments(materials):
    skeleton = unreal.EditorAssetLibrary.load_asset(SKELETON)
    if skeleton is None:
        raise RuntimeError('missing %s -- install the City Sample Crowds pack first' % SKELETON)

    # Wiped, not merged. This folder is generated output, and renaming a piece in the generator
    # would otherwise leave the old asset behind for the audit to find and classify -- a stale
    # `SKM_TV_Mo_*` has no slot keyword in its name at all and falls through to `body`.
    if unreal.EditorAssetLibrary.does_directory_exist(CONTENT):
        unreal.EditorAssetLibrary.delete_directory(CONTENT)

    tasks, expected = [], []
    for fit in sorted(os.listdir(SOURCE)):
        folder = os.path.join(SOURCE, fit)
        if not os.path.isdir(folder):
            continue
        for filename in sorted(os.listdir(folder)):
            if not filename.endswith('.fbx'):
                continue
            name = filename[:-4]
            options = unreal.FbxImportUI()
            options.set_editor_property('import_mesh', True)
            options.set_editor_property('import_as_skeletal', True)
            options.set_editor_property('import_animations', False)
            # True so the importer carries the FBX's material *names* onto the mesh's sections.
            # A garment with no accent region (a plain hakama) imports fewer sections than it has
            # slots, and the survivors keep their order but not their index -- so assigning by
            # position put the cloth material on an obi, which is entirely accent. The throwaway
            # Material assets this creates are deleted below; the names are what we came for.
            options.set_editor_property('import_materials', True)
            options.set_editor_property('import_textures', False)
            options.set_editor_property('skeleton', skeleton)
            mesh_data = options.skeletal_mesh_import_data
            mesh_data.set_editor_property('import_content_type',
                                          unreal.FBXImportContentType.FBXICT_ALL)
            mesh_data.set_editor_property('vertex_color_import_option',
                                          unreal.VertexColorImportOption.REPLACE)
            mesh_data.set_editor_property('normal_import_method',
                                          unreal.FBXNormalImportMethod.FBXNIM_IMPORT_NORMALS_AND_TANGENTS)
            mesh_data.set_editor_property('import_morph_targets', False)
            mesh_data.set_editor_property('convert_scene', True)
            mesh_data.set_editor_property('use_t0_as_ref_pose', False)
            # Without this the importer rebuilds a skeleton from the FBX rather than binding to
            # the one passed above, and the garment lands on a private rig no adapter knows about.
            mesh_data.set_editor_property('update_skeleton_reference_pose', False)

            task = unreal.AssetImportTask()
            task.filename = os.path.join(folder, filename)
            task.destination_path = CONTENT
            task.destination_name = name
            task.automated = True
            task.replace_existing = True
            task.save = True
            task.options = options
            tasks.append(task)
            expected.append('%s/%s' % (CONTENT, name))

    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks(tasks)

    imported, missing, report, unresolved_slots = 0, [], {}, []
    for package in expected:
        asset = unreal.EditorAssetLibrary.load_asset(package)
        if asset is None:
            missing.append(package)
            continue
        bound = asset.get_editor_property('skeleton')
        if bound is None or bound.get_path_name().split('.')[0] != SKELETON:
            missing.append('%s (bound to %s)' % (package, bound.get_path_name() if bound else 'nothing'))
            continue
        # Assigned by the slot's *name*, which the generator set on the FBX material. A garment
        # with no accent region imports fewer sections than it has regions, so position says
        # nothing; `TV_Accent` says exactly which cloth this section is.
        by_name = {name: instance for (name, _), instance in zip(REGION_INSTANCES, materials)}
        slots, unknown = [], []
        for slot in asset.materials:
            name = str(slot.material_slot_name)
            region = name[3:] if name.startswith('TV_') else name
            instance = by_name.get(region)
            if instance is None:
                unknown.append(name)
                instance = materials[0]
            slots.append(unreal.SkeletalMaterial(material_interface=instance,
                                                 material_slot_name='TV_%s' % region))
        if unknown:
            unresolved_slots.append((package, unknown))
            unreal.log_warning('TV_ASHFORD_SLOTS %s unrecognised sections %s' % (package, unknown))
        asset.set_editor_property('materials', slots)
        unreal.EditorAssetLibrary.save_asset(package)
        imported += 1
        # Read off the AssetRegistry tags, the same way `audit_character_assets.py` does. The
        # skeletal-mesh Python object exposes no LOD accessor on this engine version.
        # `/Game/Path/Name.Name`, not `/Game/Path/Name`: the registry keys on the object path, and
        # the package path alone silently returns an empty AssetData with every tag missing.
        registry = unreal.AssetRegistryHelpers.get_asset_registry().get_asset_by_object_path(
            '%s.%s' % (package, package.rsplit('/', 1)[-1]))
        stats = {}
        for tag, field in (('Triangles', 'triangles'), ('Vertices', 'vertices'), ('LODs', 'lods')):
            value = registry.get_tag_value(tag) if registry else None
            if value and str(value).isdigit():
                stats[field] = int(value)
        stats['materialSlots'] = len(asset.materials)
        stats['regions'] = [str(s.material_slot_name) for s in asset.materials]
        report[package] = stats

    # The importer's own throwaway Material assets, created only so the section names would
    # survive. Nothing references them once the region instances are assigned.
    strays = [p for p in unreal.EditorAssetLibrary.list_assets(CONTENT, True, False)
              if '/Material' in p or p.rsplit('/', 1)[-1].startswith('TV_')]
    for stray in strays:
        unreal.EditorAssetLibrary.delete_asset(stray.split('.')[0])

    unreal.log('TV_ASHFORD_IMPORT imported=%d expected=%d missing=%d unresolvedSections=%d strays=%d'
               % (imported, len(expected), len(missing), len(unresolved_slots), len(strays)))
    for entry in missing:
        unreal.log_warning('TV_ASHFORD_MISSING %s' % entry)
    out = os.path.join(REPO, '.debug', 'ashford-garments', 'import-report.json')
    with open(out, 'w') as handle:
        json.dump({'imported': imported, 'expected': len(expected), 'missing': missing,
                   'unresolvedSections': unresolved_slots, 'meshes': report}, handle, indent=1)
    unreal.log('TV_ASHFORD_REPORT %s' % out)
    if missing:
        raise RuntimeError('%d garments did not import onto %s' % (len(missing), SKELETON))
    if unresolved_slots:
        raise RuntimeError('%d garments carry sections this script cannot name; the generator and '
                           'REGION_INSTANCES have diverged' % len(unresolved_slots))


def main():
    if not os.path.isdir(SOURCE):
        raise RuntimeError('no generated garments at %s -- run the Blender generator first' % SOURCE)
    parent = build_material()
    import_garments(build_region_instances(parent))



# Guarded so `debug_ashford_vertex_mask.py` can reuse `build_material` without re-importing
# sixty-six meshes -- there should be exactly one definition of this shader.
if __name__ == '__main__':
    main()
