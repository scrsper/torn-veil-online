"""Build the presentation-only material used by streamed settlement terrain.

The terrain mesh supplies continuous UVs and vertex colors: R is worn path/yard, G is
farmland, B is woodland floor beyond settlements, and A is the paved square.  This script only creates the
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
    node.set_editor_property("a", channel == "A")
    connect(source, "", node, "")
    return node


def lerp(material, a, b, alpha, x, y):
    """Inputs may be expressions or (expression, output pin) pairs."""
    node = expression(material, unreal.MaterialExpressionLinearInterpolate, x, y)
    for source, pin in ((a, "A"), (b, "B"), (alpha, "Alpha")):
        expression_node, output = source if isinstance(source, tuple) else (source, "")
        connect(expression_node, output, node, pin)
    return node


def sampler_for(texture, want_normal):
    """Match the sampler to the texture asset; a mismatch fails shader compilation silently in PIE."""
    compression = texture.get_editor_property("compression_settings")
    if compression == unreal.TextureCompressionSettings.TC_NORMALMAP:
        return unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL
    if compression in (unreal.TextureCompressionSettings.TC_MASKS, unreal.TextureCompressionSettings.TC_GRAYSCALE) or not texture.get_editor_property("srgb"):
        return unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_GRAYSCALE if compression == unreal.TextureCompressionSettings.TC_GRAYSCALE else unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR
    return unreal.MaterialSamplerType.SAMPLERTYPE_COLOR


LAYERS = {
    # name: (basecolor, normal, uv scale relative to the terrain's metres/4 coordinates)
    "grass": ("/Game/AdvancedVillagePack/Textures/Landscape/T_Landscape_Grass_DH", "/Game/AdvancedVillagePack/Textures/Landscape/T_Landscape_Grass_N", 0.9),
    "dirt": ("/Game/Iceland_Environment/Textures/T_Iceland_Dirt/T_Iceland_Dirt_BaseColor", "/Game/Iceland_Environment/Textures/T_Iceland_Dirt/T_Iceland_Dirt_Normal", 1.2),
    "forest": ("/Game/Iceland_Environment/Textures/T_ForestGround/T_ForestGround_A", "/Game/Iceland_Environment/Textures/T_ForestGround/T_ForestGround_N", 1.0),
    "soil": ("/Game/AdvancedVillagePack/Textures/Landscape/T_Landscape_Soil_DH", "/Game/AdvancedVillagePack/Textures/Landscape/T_Landscape_Soil_N", 2.0),
    "cobble": ("/Game/SM_Roads_05/Materials/Roads_05/MT00133-Cobblestone_01/T_MT00133-Cobblestone_01_basecolor", "/Game/SM_Roads_05/Materials/Roads_05/MT00133-Cobblestone_01/T_MT00133-Cobblestone_01_normal", 2.4),
}
VARIATION = "/Game/Iceland_Environment/Textures/T_Voronoi_Perturbed_4k"


def build():
    """Layered scanned ground. Vertex colors from the native projection select layers:
    R trampled/worn earth, G cultivated soil, B woodland floor, A paved square."""
    library = unreal.EditorAssetLibrary
    material = library.load_asset(MATERIAL_PATH)
    if not material:
        tools = unreal.AssetToolsHelpers.get_asset_tools()
        material = tools.create_asset("M_TV_SettlementGround", "/Game/TornVeil/Materials", unreal.Material, unreal.MaterialFactoryNew())
    if not material:
        raise RuntimeError("Could not create " + MATERIAL_PATH)
    unreal.MaterialEditingLibrary.delete_all_material_expressions(material)
    material.set_editor_property("two_sided", False)
    material.set_editor_property("blend_mode", unreal.BlendMode.BLEND_OPAQUE)
    material.set_editor_property("used_with_instanced_static_meshes", True)

    uv = expression(material, unreal.MaterialExpressionTextureCoordinate, -1800, 0)
    samples = {}
    y = -900
    for name, (base_path, normal_path, scale) in LAYERS.items():
        base_tex, normal_tex = library.load_asset(base_path), library.load_asset(normal_path)
        if not base_tex or not normal_tex:
            raise RuntimeError("Missing ground layer texture for " + name)
        scaled = expression(material, unreal.MaterialExpressionMultiply, -1550, y)
        connect(uv, "", scaled, "A")
        connect(constant(material, scale, -1700, y + 60), "", scaled, "B")
        base = expression(material, unreal.MaterialExpressionTextureSample, -1300, y)
        base.texture = base_tex
        base.set_editor_property("sampler_type", sampler_for(base_tex, False))
        connect(scaled, "", base, "UVs")
        normal = expression(material, unreal.MaterialExpressionTextureSample, -1300, y + 180)
        normal.texture = normal_tex
        normal_sampler = sampler_for(normal_tex, True)
        normal.set_editor_property("sampler_type", normal_sampler)
        connect(scaled, "", normal, "UVs")
        normal_out = normal
        if normal_sampler != unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL:
            # Linear-encoded normal maps need the 0..1 -> -1..1 remap a normal sampler performs.
            doubled = expression(material, unreal.MaterialExpressionMultiply, -1100, y + 180)
            connect(normal, "RGB", doubled, "A")
            connect(constant(material, 2.0, -1250, y + 260), "", doubled, "B")
            normal_out = expression(material, unreal.MaterialExpressionSubtract, -950, y + 180)
            connect(doubled, "", normal_out, "A")
            connect(constant(material, 1.0, -1100, y + 260), "", normal_out, "B")
        samples[name] = (base, normal_out)
        print("GROUND_LAYER", name, str(base.get_editor_property("sampler_type")), str(normal_sampler))
        y += 420

    # Large-scale brightness variation breaks visible tiling across meadows and paths.
    variation_uv = expression(material, unreal.MaterialExpressionMultiply, -1550, y)
    connect(uv, "", variation_uv, "A")
    connect(constant(material, 0.045, -1700, y + 60), "", variation_uv, "B")
    variation = expression(material, unreal.MaterialExpressionTextureSample, -1300, y)
    variation.texture = library.load_asset(VARIATION)
    variation.set_editor_property("sampler_type", sampler_for(variation.texture, False))
    connect(variation_uv, "", variation, "UVs")
    brightness = lerp(material, constant(material, 0.78, -1100, y), constant(material, 1.12, -1100, y + 60), mask(material, variation, "R", -1100, y + 120), -900, y)

    vertex = expression(material, unreal.MaterialExpressionVertexColor, -1300, y + 400)
    # Use the vertex color node's own channel pins: its default output is RGB only, so masking A fails.
    worn, farm, woodland, paved = [(vertex, channel) for channel in ("R", "G", "B", "A")]

    # The scanned Iceland grass is autumn-pale; tint it toward a temperate summer olive, and warm
    # the grey dirt toward trodden earth, so the settlement does not read as a bleached plain.
    grass_tint = expression(material, unreal.MaterialExpressionMultiply, -900, -900)
    connect(samples["grass"][0], "RGB", grass_tint, "A")
    connect(color(material, (0.82, 0.88, 0.70), -1050, -860), "", grass_tint, "B")
    dirt_tint = expression(material, unreal.MaterialExpressionMultiply, -900, 0)
    connect(samples["dirt"][0], "RGB", dirt_tint, "A")
    connect(color(material, (1.05, 0.90, 0.72), -1050, 40), "", dirt_tint, "B")
    samples["grass"] = (grass_tint, samples["grass"][1])
    samples["dirt"] = (dirt_tint, samples["dirt"][1])

    def stack(output):
        grass = samples["grass"][0 if output == "RGB" else 1]
        result = lerp(material, grass, samples["forest"][0 if output == "RGB" else 1], woodland, -700, -200 if output == "RGB" else 400)
        result = lerp(material, result, samples["dirt"][0 if output == "RGB" else 1], worn, -500, -200 if output == "RGB" else 400)
        result = lerp(material, result, samples["soil"][0 if output == "RGB" else 1], farm, -300, -200 if output == "RGB" else 400)
        return lerp(material, result, samples["cobble"][0 if output == "RGB" else 1], paved, -100, -200 if output == "RGB" else 400)

    base_color = expression(material, unreal.MaterialExpressionMultiply, 100, -200)
    connect(stack("RGB"), "", base_color, "A")
    connect(brightness, "", base_color, "B")
    unreal.MaterialEditingLibrary.connect_material_property(base_color, "", unreal.MaterialProperty.MP_BASE_COLOR)
    unreal.MaterialEditingLibrary.connect_material_property(stack("N"), "", unreal.MaterialProperty.MP_NORMAL)
    roughness = lerp(material, constant(material, 0.92, -100, 700), constant(material, 0.78, -100, 760), paved, 100, 700)
    unreal.MaterialEditingLibrary.connect_material_property(roughness, "", unreal.MaterialProperty.MP_ROUGHNESS)
    unreal.MaterialEditingLibrary.recompile_material(material)
    library.save_loaded_asset(material)
    print("ENVIRONMENT_MATERIAL_READY", MATERIAL_PATH)


build()
