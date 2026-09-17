"""Extract an owned roof-only mesh from the inspected AdvancedVillage house.

This is an editor-only asset operation. The source package is never modified;
the plane cut is deliberately unfilled because the roof is a presentation
module and its open underside is closed by the runtime building assembly.
"""
import json
import os

import unreal


ROOT = os.path.abspath(os.path.join(unreal.Paths.project_dir(), "../.."))
REPORT = os.path.join(ROOT, ".debug/playable-world-slice2/local-assets/architecture-extraction.json")
SOURCE_PATH = "/Game/AdvancedVillagePack/Meshes/SM_House_Var01"
OUTPUT_PATH = "/Game/TornVeil/LocalPalette/SM_StoneTimberRoof"
CUT_Z_CM = 310.0


def vec(v):
    return [float(v.x), float(v.y), float(v.z)]


def bounds(mesh):
    b = mesh.get_bounds()
    return {"originCm": vec(b.origin), "extentCm": vec(b.box_extent),
            "minCm": vec(b.origin - b.box_extent), "maxCm": vec(b.origin + b.box_extent)}


def source_materials(mesh):
    return [slot.get_editor_property("material_interface") for slot in mesh.get_editor_property("static_materials")]


def assign_source_materials(source, owned):
    materials = source_materials(source)
    if not materials:
        raise RuntimeError("Source has no material slots")
    for index, material in enumerate(materials):
        if material:
            owned.set_material(index, material)
    return [material.get_path_name() if material else None for material in materials]


def verify_result(result, label):
    """GeometryScript may return (primary, outcome); validate the outcome pin."""
    if isinstance(result, tuple):
        if len(result) < 2 or result[-1] != unreal.GeometryScriptOutcomePins.SUCCESS:
            raise RuntimeError("GeometryScript operation failed: " + label)
        return result[0]
    if result is None:
        raise RuntimeError("GeometryScript returned no outcome for " + label)
    return result


def main():
    if unreal.EditorLevelLibrary.get_pie_worlds(False):
        raise RuntimeError("Refusing architecture extraction while PIE is active")
    if unreal.EditorAssetLibrary.does_asset_exist(OUTPUT_PATH):
        existing = unreal.EditorAssetLibrary.load_asset(OUTPUT_PATH)
        existing_paths = [m.get_path_name() if m else None for m in source_materials(existing)]
        if any(path and "WorldGrid" not in path for path in existing_paths):
            raise RuntimeError("Owned roof already has non-default materials; refusing to overwrite: " + OUTPUT_PATH)
        if not unreal.EditorAssetLibrary.delete_asset(OUTPUT_PATH):
            raise RuntimeError("Could not remove the previous untextured owned roof: " + OUTPUT_PATH)
    source = unreal.EditorAssetLibrary.load_asset(SOURCE_PATH)
    if not source:
        raise RuntimeError("Missing source mesh: " + SOURCE_PATH)
    source_bounds = bounds(source)
    unreal.EditorAssetLibrary.make_directory("/Game/TornVeil/LocalPalette")

    dynamic = unreal.DynamicMesh()
    copy_options = unreal.GeometryScriptCopyMeshFromAssetOptions()
    copy_options.set_editor_property("apply_build_settings", True)
    copy_options.set_editor_property("request_tangents", True)
    lod = unreal.GeometryScriptMeshReadLOD()
    lod.set_editor_property("lod_index", 0)
    copied = unreal.GeometryScript_AssetUtils.copy_mesh_from_static_mesh_v2(
        source, dynamic, copy_options, lod, True
    )
    verify_result(copied, "copy")
    if dynamic is None:
        raise RuntimeError("GeometryScript failed to copy source mesh")

    cut_options = unreal.GeometryScriptMeshPlaneCutOptions()
    cut_options.set_editor_property("flip_cut_side", True)
    cut_options.set_editor_property("fill_holes", False)
    cut_options.set_editor_property("fill_spans", False)
    cut_options.set_editor_property("uv_world_dimension", 100.0)
    cut_frame = unreal.Transform()
    cut_frame.set_editor_property("translation", unreal.Vector(0.0, 0.0, CUT_Z_CM))
    cut = unreal.GeometryScript_MeshBooleans.apply_mesh_plane_cut(dynamic, cut_frame, cut_options)
    verify_result(cut, "plane cut")

    create_options = unreal.GeometryScriptCreateNewStaticMeshAssetOptions()
    create_options.set_editor_property("enable_collision", False)
    create_options.set_editor_property("enable_nanite", False)
    create_options.set_editor_property("enable_recompute_normals", False)
    create_options.set_editor_property("enable_recompute_tangents", False)
    created = unreal.GeometryScript_NewAssetUtils.create_new_static_mesh_asset_from_mesh(
        dynamic, OUTPUT_PATH, create_options
    )
    verify_result(created, "asset creation")
    owned = unreal.EditorAssetLibrary.load_asset(OUTPUT_PATH)
    if not owned:
        raise RuntimeError("Created roof asset could not be loaded: " + OUTPUT_PATH)
    source_material_paths = assign_source_materials(source, owned)
    if not unreal.EditorAssetLibrary.save_loaded_asset(owned):
        raise RuntimeError("Could not save textured roof asset: " + OUTPUT_PATH)
    report = {"source": SOURCE_PATH, "output": OUTPUT_PATH, "cutZCm": CUT_Z_CM,
              "plane": "XY horizontal; flip_cut_side=true; fill_holes=false; fill_spans=false",
              "sourceBounds": source_bounds, "outputBounds": bounds(owned),
              "sourceMaterials": source_material_paths,
              "outputMaterials": [m.get_path_name() if m else None for m in source_materials(owned)]}
    with open(REPORT, "w", encoding="utf-8") as stream:
        json.dump(report, stream, indent=2)
    print("LOCAL_ARCHITECTURE_READY", REPORT)


main()
