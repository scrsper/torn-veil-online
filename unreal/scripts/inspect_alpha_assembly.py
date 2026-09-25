"""Read installed body/footwear materials and the exact failed groom binding; no asset writes."""
import json
import os
import unreal

library = unreal.EditorAssetLibrary
materials = unreal.MaterialEditingLibrary
report = {"meshes": [], "grooms": [], "bindings": []}
meshes = [
    "/Game/CitySampleCrowd/Character/Female/UnderWeight/Meshes/f_tal_unw_body",
    "/Game/TornVeil/Characters/Ashford/SKM_TV_Waraji_female_unw",
    "/Game/TornVeil/Characters/Ashford/SKM_TV_Hakama_Short_female_unw",
]
for path in meshes:
    if not library.does_asset_exist(path):
        report["meshes"].append({"path": path, "missing": True})
        continue
    mesh = library.load_asset(path)
    row = {"path": path, "materials": [], "skeleton": mesh.get_editor_property("skeleton").get_path_name()}
    for slot in mesh.get_editor_property("materials"):
        material = slot.material_interface
        entry = {"slot": str(slot.material_slot_name), "material": material.get_path_name() if material else None}
        if material:
            entry["scalars"] = {str(name): materials.get_material_instance_scalar_parameter_value(material, name)
                                for name in materials.get_scalar_parameter_names(material)} if isinstance(material, unreal.MaterialInstanceConstant) else {}
            entry["textures"] = {str(name): str(materials.get_material_instance_texture_parameter_value(material, name))
                                 for name in materials.get_texture_parameter_names(material)} if isinstance(material, unreal.MaterialInstanceConstant) else {}
            entry["blend"] = str(material.get_blend_mode())
        row["materials"].append(entry)
    report["meshes"].append(row)
    # Export the actual installed geometry for vertex-coverage diagnosis, never a substitute
    # for the rendered-session check. The vendor asset is read only.
    export_dir = os.path.abspath(os.path.join(unreal.Paths.project_dir(), "../../.debug/unreal/assembly-geometry"))
    os.makedirs(export_dir, exist_ok=True)
    task = unreal.AssetExportTask()
    task.object = mesh
    task.filename = os.path.join(export_dir, path.split("/")[-1] + ".fbx")
    task.automated = True
    task.prompt = False
    task.replace_identical = True
    options = unreal.FbxExportOption()
    options.collision = False
    options.level_of_detail = False
    options.export_preview_mesh = False
    task.options = options
    if not unreal.Exporter.run_asset_export_task(task):
        raise RuntimeError("Geometry export failed: " + path)
for face in ["f_003", "f_004"]:
    path = f"/Game/CitySampleCrowd/Character/Female/{face}/Hair/Hair/Hair_S_Updo"
    asset = library.load_asset(path) if library.does_asset_exist(path) else None
    report["grooms"].append({"requested": path, "loaded": asset.get_path_name() if asset else None})
for face in ["f_005", "f_006"]:
    path = f"/Game/CitySampleCrowd/Character/Female/GroomBindings/GB_{face}_nrw_FaceMesh_Hair_S_Updo"
    binding = library.load_asset(path) if library.does_asset_exist(path) else None
    report["bindings"].append({"path": path, "groom": binding.groom.get_path_name() if binding and binding.groom else None,
                               "face": binding.target_skeletal_mesh.get_path_name() if binding and binding.target_skeletal_mesh else None})
out = os.path.abspath(os.path.join(unreal.Paths.project_dir(), "../../.debug/unreal/assembly-assets.json"))
with open(out, "w", encoding="utf8") as stream:
    json.dump(report, stream, indent=2)
print("TV_ALPHA_ASSEMBLY", out)
