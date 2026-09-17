"""Create project-owned PBR wrappers for the imported Free Medieval props.

Run inside the Unreal Editor Python environment. Only assets under
/Game/TornVeil/Materials/LocalPalette are written; vendor meshes/materials are
never edited. The registry is used as the source of truth for exact package and
texture names.
"""
import json
import os

import unreal


ROOT = os.path.abspath(os.path.join(unreal.Paths.project_dir(), "../.."))
REGISTRY = os.path.join(ROOT, ".debug/playable-world-slice2/local-assets/registry.json")
OUT_DIR = "/Game/TornVeil/Materials/LocalPalette"
REPORT = os.path.join(ROOT, ".debug/playable-world-slice2/local-assets/local-prop-materials.json")
SOURCE_ROOT = "/Game/Fab/Free_Medieval_Environment_Props_Collection/"
TEXTURE_ROOT = SOURCE_ROOT + "MedievalAssetsWithoutTextures3_"

ROLES = [
    ("WoodenTableLong", "WoodenTableLong"),
    ("WoodenTableBench", "WoodenTableBench"),
    ("WoodenChair", "WoodenChair"),
    ("WoodenStool", "WoodenStool"),
    ("WoodenCrate", "WoodenCrate"),
    ("WoodenStorageBox", "WoodenStorageBox"),
    ("Barrle1", "Barrle1"),
    ("Fence1", "Fence1"),
    ("LogsPile", "LogsPile"),
    ("Cloth1", "Cloth1"),
    ("LanternRound", "LanternRound"),
    ("CookingPot", "CookingPot"),
    ("Sack", "Sack"),
    ("SackTied", "SackTied"),
    ("SackFallen", "SackFallen"),
    ("LogLong", "LogLong"),
    ("LogShort", "LogShort"),
    ("HeyStackCylinder", "HeyStackCylinder"),
    ("HeyStackSquare", "HeyStackSquare"),
    ("Container1", "Container1"),
    ("Container2", "Container2"),
    ("Bucket", "Bucket"),
    ("WallLantern", "WallLantern"),
    ("Carrage", "Carrage"),
    ("StoneWall", "StoneWall"),
    ("StoneWallBlock", "StoneWallBlock"),
    ("ArrowSignLR", "ArrowSignLR"),
    ("BarrleStand", "BarrleStand"),
    ("Barrle2", "Barrle2"),
    ("HalfBarrle", "HalfBarrle"),
    ("Ladder", "Ladder"),
    ("Campfire", "Campfire"),
    ("Cloth2", "Cloth2"),
    ("Cloth3", "Cloth3"),
    ("WoodenPack", "WoodenPack"),
    ("WoodenTableRound", "WoodenTableRound"),
    ("WoodenChair2", "WoodenChair2"),
]
# Meshes whose texture set carries a shared name in the source pack.
TEXTURE_ALIASES = {"PlankTall": "Planks", "PlankMid": "Planks", "PoleLong": "Pole", "PoleMid": "Pole"}
ROLES += [("PlankTall", "PlankTall"), ("PlankMid", "PlankMid"), ("PoleLong", "PoleLong"), ("PoleMid", "PoleMid")]


def require_connection(ok, description):
    if not ok:
        raise RuntimeError("Material connection failed: " + description)


def node(material, kind, x, y):
    return unreal.MaterialEditingLibrary.create_material_expression(material, kind, x, y)


def make_material(role, mesh_path, textures):
    path = OUT_DIR + "/M_TV_Local_" + role
    material = unreal.EditorAssetLibrary.load_asset(path)
    if not material:
        material = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
            "M_TV_Local_" + role, OUT_DIR, unreal.Material, unreal.MaterialFactoryNew()
        )
    if not material:
        raise RuntimeError("Could not create " + path)
    unreal.MaterialEditingLibrary.delete_all_material_expressions(material)
    material.set_editor_property("two_sided", False)
    material.set_editor_property("blend_mode", unreal.BlendMode.BLEND_OPAQUE)
    material.set_editor_property("used_with_instanced_static_meshes", True)

    coords = node(material, unreal.MaterialExpressionTextureCoordinate, -900, 0)
    diffuse = node(material, unreal.MaterialExpressionTextureSample, -650, -120)
    diffuse.set_editor_property("texture", textures["baseColor"])
    require_connection(unreal.MaterialEditingLibrary.connect_material_expressions(coords, "", diffuse, ""), role + " diffuse coordinates")
    normal = node(material, unreal.MaterialExpressionTextureSample, -650, 120)
    normal.set_editor_property("texture", textures["normal"])
    normal.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL)
    require_connection(unreal.MaterialEditingLibrary.connect_material_expressions(coords, "", normal, ""), role + " normal coordinates")
    roughness = node(material, unreal.MaterialExpressionTextureSample, -650, 360)
    roughness.set_editor_property("texture", textures["roughness"])
    roughness.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_COLOR if textures["roughness"].get_editor_property("srgb") else unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)
    require_connection(unreal.MaterialEditingLibrary.connect_material_expressions(coords, "", roughness, ""), role + " roughness coordinates")
    require_connection(unreal.MaterialEditingLibrary.connect_material_property(diffuse, "RGB", unreal.MaterialProperty.MP_BASE_COLOR), role + " base color")
    require_connection(unreal.MaterialEditingLibrary.connect_material_property(normal, "RGB", unreal.MaterialProperty.MP_NORMAL), role + " normal")
    require_connection(unreal.MaterialEditingLibrary.connect_material_property(roughness, "R", unreal.MaterialProperty.MP_ROUGHNESS), role + " roughness")
    unreal.MaterialEditingLibrary.recompile_material(material)
    unreal.EditorAssetLibrary.save_loaded_asset(material)
    return path


def main():
    with open(REGISTRY, "r", encoding="utf-8") as stream:
        registry = {entry.get("package") for entry in json.load(stream).get("assets", [])}
    unreal.EditorAssetLibrary.make_directory(OUT_DIR)
    report = {"registry": REGISTRY, "output": OUT_DIR, "created": [], "skipped": []}
    for role, source_name in ROLES:
        mesh_path = SOURCE_ROOT + "Medieval1_fbx_" + source_name
        texture_name = TEXTURE_ALIASES.get(source_name, source_name)
        texture_paths = {
            "baseColor": TEXTURE_ROOT + texture_name + "_BaseColor",
            "normal": TEXTURE_ROOT + texture_name + "_Normal",
            "roughness": TEXTURE_ROOT + texture_name + "_Roughness",
        }
        missing_registry = [p for p in [mesh_path, *texture_paths.values()] if p not in registry]
        if missing_registry:
            report["skipped"].append({"role": role, "reason": "missing from registry", "paths": missing_registry})
            continue
        mesh = unreal.EditorAssetLibrary.load_asset(mesh_path)
        textures = {key: unreal.EditorAssetLibrary.load_asset(path) for key, path in texture_paths.items()}
        missing_assets = [path for key, path in texture_paths.items() if not textures[key]]
        if not mesh:
            missing_assets.insert(0, mesh_path)
        if missing_assets:
            report["skipped"].append({"role": role, "reason": "asset load failed", "paths": missing_assets})
            continue
        report["created"].append({"role": role, "mesh": mesh_path, "textures": texture_paths, "material": make_material(role, mesh_path, textures)})
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, "w", encoding="utf-8") as stream:
        json.dump(report, stream, indent=2)
    print("LOCAL_PROP_MATERIALS_READY", REPORT)


main()
