"""Bind the installed f_003 Updo to the inspected faces, without editing vendor assets.

The pack contains distinct f_003/f_004 groom assets. Its supplied bindings reference only f_004;
the Foundry can select f_003. Generate exact f_003 bindings and extend the local runtime palette.
"""
import json
import os
import unreal

root = os.path.abspath(os.path.join(unreal.Paths.project_dir(), "../.."))
palette_path = os.path.join(unreal.Paths.project_content_dir(), "TornVeil/Presentation/CharacterPalette.local.json")
with open(palette_path, encoding="utf8") as stream:
    palette = json.load(stream)
groom_path = "/Game/CitySampleCrowd/Character/Female/f_003/Hair/Hair/Hair_S_Updo"
groom = unreal.EditorAssetLibrary.load_asset(groom_path)
source = unreal.EditorAssetLibrary.load_asset("/Game/CitySampleCrowd/Character/Female/f_003/Face/f_003_nrw_FaceMesh")
assert groom and source
rows = []
for index in range(1, 7):
    face_path = f"/Game/CitySampleCrowd/Character/Female/f_{index:03}/Face/f_{index:03}_nrw_FaceMesh"
    face = unreal.EditorAssetLibrary.load_asset(face_path)
    assert face
    path = f"/Game/TornVeil/Characters/GroomBindings/GB_TV_f003_Updo_f{index:03}"
    binding = unreal.EditorAssetLibrary.load_asset(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else None
    if not binding:
        binding = unreal.GroomLibrary.create_new_groom_binding_asset_with_path(path, groom, face, 100, source, 0)
    assert binding and binding.groom == groom and binding.target_skeletal_mesh == face, path
    assert unreal.EditorAssetLibrary.save_loaded_asset(binding, only_if_is_dirty=False)
    palette.setdefault("groomBindings", {})[groom_path + "|" + face_path] = binding.get_path_name().split(".")[0]
    rows.append({"groom": groom_path, "face": face_path, "binding": binding.get_path_name()})
with open(palette_path, "w", encoding="utf8") as stream:
    json.dump(palette, stream, indent=2)
with open(os.path.join(root, ".debug/unreal/updo-bindings.json"), "w", encoding="utf8") as stream:
    json.dump(rows, stream, indent=2)
print("TV_UPDO_BINDINGS", len(rows))
