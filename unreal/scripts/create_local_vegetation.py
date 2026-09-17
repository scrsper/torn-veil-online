"""Derive instanceable Nanite static meshes from the local Megaplant skeletal vegetation.

Editor-only and idempotent. Source packages are never modified. Outputs live under the
git-ignored /Game/TornVeil/LocalPalette/Vegetation folder because they derive from a
licensed local library; only this recipe and semantic palette roles are committed.
Skeletal wind is intentionally dropped: presentation vegetation is static and instanced.
"""
import json
import os

import unreal

ROOT = os.path.abspath(os.path.join(unreal.Paths.project_dir(), "../.."))
REPORT = os.path.join(ROOT, ".debug/playable-world-slice2/local-assets/vegetation-extraction.json")
OUTPUT = "/Game/TornVeil/LocalPalette/Vegetation"
SOURCES = {
    "SM_TV_Oak_A": "/Game/Megaplant_Library/Tree_English_Oak/Tree_English_Oak_Forest_01/Tree_English_Oak_Forest_01_A",
    "SM_TV_Oak_B": "/Game/Megaplant_Library/Tree_English_Oak/Tree_English_Oak_Forest_01/Tree_English_Oak_Forest_01_B",
    "SM_TV_Oak_C": "/Game/Megaplant_Library/Tree_English_Oak/Tree_English_Oak_Forest_01/Tree_English_Oak_Forest_01_C",
    "SM_TV_Oak_D": "/Game/Megaplant_Library/Tree_English_Oak/Tree_English_Oak_Forest_01/Tree_English_Oak_Forest_01_D",
    "SM_TV_Medlar_A": "/Game/Megaplant_Library/Tree_Japanese_Medlar/Tree_Japanese_Medlar_01/Tree_Japanese_Medlar_01_A",
    "SM_TV_Medlar_B": "/Game/Megaplant_Library/Tree_Japanese_Medlar/Tree_Japanese_Medlar_01/Tree_Japanese_Medlar_01_B",
    "SM_TV_Pine_A": "/Game/Megaplant_Library/Tree_Baltic_Pine/Tree_Baltic_Pine_Saplings_01/Tree_Baltic_Pine_Sapling_01_A",
    "SM_TV_Pine_B": "/Game/Megaplant_Library/Tree_Baltic_Pine/Tree_Baltic_Pine_Saplings_01/Tree_Baltic_Pine_Sapling_01_B",
    "SM_TV_Spindle_A": "/Game/Megaplant_Library/Shrub_European_Spindle/Shrub_European_Spindle_01/Shrub_European_Spindle_01_A",
    "SM_TV_Spindle_B": "/Game/Megaplant_Library/Shrub_European_Spindle/Shrub_European_Spindle_01/Shrub_European_Spindle_01_B",
    "SM_TV_Spindle_C": "/Game/Megaplant_Library/Shrub_European_Spindle/Shrub_European_Spindle_01/Shrub_European_Spindle_01_C",
}


def outcome_ok(result):
    return not isinstance(result, tuple) or result[-1] == unreal.GeometryScriptOutcomePins.SUCCESS


def convert(name, source_path):
    target = OUTPUT + "/" + name
    if unreal.EditorAssetLibrary.does_asset_exist(target):
        mesh = unreal.EditorAssetLibrary.load_asset(target)
        return {"source": source_path, "output": target, "reused": True, "bounds": bounds(mesh)}
    source = unreal.EditorAssetLibrary.load_asset(source_path)
    if not source:
        return {"source": source_path, "error": "missing"}
    dynamic = unreal.DynamicMesh()
    options = unreal.GeometryScriptCopyMeshFromAssetOptions()
    options.set_editor_property("apply_build_settings", True)
    options.set_editor_property("request_tangents", True)
    lod = unreal.GeometryScriptMeshReadLOD()
    lod.set_editor_property("lod_index", 0)
    if not outcome_ok(unreal.GeometryScript_AssetUtils.copy_mesh_from_skeletal_mesh(source, dynamic, options, lod)):
        return {"source": source_path, "error": "copy failed"}
    create = unreal.GeometryScriptCreateNewStaticMeshAssetOptions()
    create.set_editor_property("enable_collision", False)
    create.set_editor_property("enable_nanite", True)
    create.set_editor_property("enable_recompute_normals", False)
    create.set_editor_property("enable_recompute_tangents", False)
    if not outcome_ok(unreal.GeometryScript_NewAssetUtils.create_new_static_mesh_asset_from_mesh(dynamic, target, create)):
        return {"source": source_path, "error": "create failed"}
    mesh = unreal.EditorAssetLibrary.load_asset(target)
    materials = [m.get_editor_property("material_interface") for m in source.get_editor_property("materials")]
    for index, material in enumerate(materials):
        if material and index < len(mesh.get_editor_property("static_materials")):
            mesh.set_material(index, material)
    nanite = mesh.get_editor_property("nanite_settings")
    # Foliage keeps its silhouette at distance instead of collapsing leaf cards.
    try:
        nanite.set_editor_property("shape_preservation", unreal.NaniteShapePreservation.PRESERVE_AREA)
    except Exception:
        pass
    mesh.set_editor_property("nanite_settings", nanite)
    unreal.EditorAssetLibrary.save_loaded_asset(mesh)
    return {"source": source_path, "output": target, "materials": [m.get_path_name() if m else None for m in materials], "bounds": bounds(mesh)}


def bounds(mesh):
    box = mesh.get_bounding_box()
    return {"min": [box.min.x, box.min.y, box.min.z], "max": [box.max.x, box.max.y, box.max.z]}


def main():
    if unreal.EditorLevelLibrary.get_pie_worlds(False):
        raise RuntimeError("Refusing vegetation derivation while PIE is active")
    unreal.EditorAssetLibrary.make_directory(OUTPUT)
    report = {name: convert(name, path) for name, path in SOURCES.items()}
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, "w", encoding="utf-8") as stream:
        json.dump(report, stream, indent=2)
    print("LOCAL_VEGETATION_READY", REPORT)


main()
