"""Build the presentation-only material used by streamed settlement terrain.

The terrain mesh supplies continuous UVs and vertex colors: R is worn path, G is
farmland, and B is the canonical forest scalar.  This script only creates the
material asset; it does not alter vendor assets, the canonical grid, or a map.
Run inside the Unreal Editor Python environment.
"""
import unreal


MATERIAL_PATH = "/Game/TornVeil/Materials/M_TV_SettlementGround"
TEXTURE_ROOT = "/Game/ThirdParty/PolyHaven/Textures/"


def connect(source, output, target, input_name):
    if not unreal.MaterialEditingLibrary.connect_material_expressions(source, output, target, input_name):
        raise RuntimeError(f"Material pin connection failed: {source.get_name()}.{output} -> {target.get_name()}.{input_name}")


def expression(material, expression_type, x, y):
    node = unreal.MaterialEditingLibrary.create_material_expression(
        material, expression_type, x, y
    )
    return node


def constant(material, value, x, y):
    node = expression(material, unreal.MaterialExpressionConstant, x, y)
    node.set_editor_property("r", value)
    return node


def color(material, value, x, y):
    node = expression(material, unreal.MaterialExpressionConstant3Vector, x, y)
    node.set_editor_property("constant", unreal.LinearColor(*value, 1.0))
    return node


def mask(material, source, channel, x, y):
    node = expression(material, unreal.MaterialExpressionComponentMask, x, y)
    node.set_editor_property("r", channel == "R")
    node.set_editor_property("g", channel == "G")
    node.set_editor_property("b", channel == "B")
    node.set_editor_property("a", False)
    connect(source, "", node, "")
    return node


def lerp(material, a, b, alpha, x, y):
    node = expression(material, unreal.MaterialExpressionLinearInterpolate, x, y)
    connect(a, "", node, "A")
    connect(b, "", node, "B")
    connect(alpha, "", node, "Alpha")
    return node


def build():
    library = unreal.EditorAssetLibrary
    material = library.load_asset(MATERIAL_PATH)
    if not material:
        tools = unreal.AssetToolsHelpers.get_asset_tools()
        material = tools.create_asset(
            "M_TV_SettlementGround",
            "/Game/TornVeil/Materials",
            unreal.Material,
            unreal.MaterialFactoryNew(),
        )
    if not material:
        raise RuntimeError("Could not create " + MATERIAL_PATH)

    unreal.MaterialEditingLibrary.delete_all_material_expressions(material)
    material.set_editor_property("two_sided", False)
    material.set_editor_property("blend_mode", unreal.BlendMode.BLEND_OPAQUE)
    material.set_editor_property("used_with_instanced_static_meshes", True)

    # The bridge's terrain UVs are continuous world metres / 4 in the native
    # presentation path. Keep this source continuous; do not use generated UVs.
    uv = expression(material, unreal.MaterialExpressionTextureCoordinate, -1100, 0)
    diffuse = expression(material, unreal.MaterialExpressionTextureSample, -900, -120)
    diffuse.texture = library.load_asset(TEXTURE_ROOT + "brown_mud_leaves_01_diff_1k")
    connect(uv, "", diffuse, "")

    normal = expression(material, unreal.MaterialExpressionTextureSample, -900, 220)
    normal.texture = library.load_asset(TEXTURE_ROOT + "brown_mud_leaves_01_nor_dx_1k")
    try:
        normal.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL)
    except AttributeError:
        # Older editor Python bindings infer the sampler from the normal asset.
        pass
    connect(uv, "", normal, "")

    vertex = expression(material, unreal.MaterialExpressionVertexColor, -1100, 500)
    worn = mask(material, vertex, "R", -900, 500)
    farm = mask(material, vertex, "G", -900, 620)
    forest = mask(material, vertex, "B", -900, 740)

    # Muted daylight palette: grass is olive, worn roads are neutral earth, and
    # cultivated soil is darker. Forest scalar deepens natural grass only.
    grass = color(material, (0.27, 0.29, 0.17), -650, 500)
    forest_tint = color(material, (0.16, 0.22, 0.11), -650, 620)
    grass_with_forest = lerp(material, grass, forest_tint, forest, -430, 500)
    earth = color(material, (0.34, 0.27, 0.18), -650, 700)
    farmland = color(material, (0.20, 0.14, 0.085), -650, 800)
    ground = lerp(material, grass_with_forest, earth, worn, -180, 520)
    ground = lerp(material, ground, farmland, farm, 40, 600)

    # Preserve the scanned texture's fine detail while keeping its leaf/brown
    # contrast restrained. Worn paths use its grayscale form specifically.
    desaturated = expression(material, unreal.MaterialExpressionDesaturation, -650, -40)
    connect(diffuse, "RGB", desaturated, "")
    detail = lerp(material, diffuse, desaturated, worn, -400, -60)
    detail_mix = constant(material, 0.32, -180, 80)
    base_color = lerp(material, ground, detail, detail_mix, 280, 520)

    unreal.MaterialEditingLibrary.connect_material_property(
        base_color, "", unreal.MaterialProperty.MP_BASE_COLOR
    )
    unreal.MaterialEditingLibrary.connect_material_property(
        normal, "RGB", unreal.MaterialProperty.MP_NORMAL
    )
    unreal.MaterialEditingLibrary.connect_material_property(
        constant(material, 0.9, 280, 760), "", unreal.MaterialProperty.MP_ROUGHNESS
    )
    unreal.MaterialEditingLibrary.recompile_material(material)
    library.save_loaded_asset(material)
    print("ENVIRONMENT_MATERIAL_READY", MATERIAL_PATH)


build()
