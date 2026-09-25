"""Derive instancing-capable copies of the AdvancedVillage base materials.

The source pack's opaque materials lack the InstancedStaticMeshes usage flag, so instanced
presentation silently falls back to the default material in PIE. Copies are written under the
git-ignored /Game/TornVeil/Materials/LocalPalette/Village folder; vendor assets are untouched.
Instances are copied and reparented to flagged copies of their shared base material.
"""
import json
import os

import unreal

ROOT = os.path.abspath(os.path.join(unreal.Paths.project_dir(), "../.."))
REPORT = os.path.join(ROOT, ".debug/playable-world-slice2/local-assets/local-village-materials.json")
SOURCE = "/Game/AdvancedVillagePack/Materials/"
OUT_DIR = "/Game/TornVeil/Materials/LocalPalette/Village"
NAMES = ["M_Inst_Pack_01", "M_Inst_Pack_02", "M_Inst_Pack_03", "M_Inst_Pack_04", "M_Inst_Pack_05",
         "M_Inst_Pack_06", "M_Inst_Pack_06_Cutout", "M_Inst_Pack_07", "M_Inst_Pack_08", "M_Inst_Pack_09",
         "M_Inst_Pack_03_LightsOn", "M_Inst_Pack_04_LightsOn"]


def main():
    if unreal.EditorLevelLibrary.get_pie_worlds(False):
        raise RuntimeError("Refusing material derivation while PIE is active")
    library = unreal.EditorAssetLibrary
    library.make_directory(OUT_DIR)
    report = {}
    for name in NAMES:
        source = SOURCE + name
        target = OUT_DIR + "/M_TV_Village_" + name.replace("M_Inst_", "")
        if not library.does_asset_exist(source):
            report[name] = "missing"
            continue
        if not library.does_asset_exist(target) and not library.duplicate_asset(source, target):
            report[name] = "duplicate failed"
            continue
        material = library.load_asset(target)
        if isinstance(material, unreal.MaterialInstanceConstant):
            # The pack's instances share base materials; flag a local copy of the base and reparent.
            # Always derive from the vendor source, not a previous generated copy. Reruns
            # must repair missing parents and retain stable paths rather than copy a copy.
            parent = library.load_asset(source).get_editor_property("parent")
            base = parent.get_base_material() if parent else None
            if not base:
                report[name] = "instance without base material"
                continue
            base_target = OUT_DIR + "/M_TV_VillageBase_" + base.get_name()
            if not library.does_asset_exist(base_target) and not library.duplicate_asset(base.get_path_name().split(".")[0], base_target):
                report[name] = "base duplicate failed"
                continue
            base_copy = library.load_asset(base_target)
            if not base_copy.get_editor_property("used_with_instanced_static_meshes"):
                base_copy.set_editor_property("used_with_instanced_static_meshes", True)
                unreal.MaterialEditingLibrary.recompile_material(base_copy)
            # duplicate_asset creates an in-memory package even if the source already has
            # the flag. Persist it before saving an instance which references that package.
            if not library.save_loaded_asset(base_copy, only_if_is_dirty=False):
                raise RuntimeError("Could not save " + base_target)
            if parent != base:
                report[name] = "nested instance parent unsupported: " + parent.get_path_name()
                continue
            unreal.MaterialEditingLibrary.set_material_instance_parent(material, base_copy)
            unreal.MaterialEditingLibrary.update_material_instance(material)
            if not library.save_loaded_asset(material, only_if_is_dirty=False):
                raise RuntimeError("Could not save " + target)
            report[name] = {"instance": target, "base": base_target}
            continue
        material.set_editor_property("used_with_instanced_static_meshes", True)
        unreal.MaterialEditingLibrary.recompile_material(material)
        library.save_loaded_asset(material)
        report[name] = target
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, "w", encoding="utf-8") as stream:
        json.dump(report, stream, indent=2)
    print("LOCAL_VILLAGE_MATERIALS_READY", REPORT)


main()
