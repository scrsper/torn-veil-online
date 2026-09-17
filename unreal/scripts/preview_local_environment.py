"""Capture bounded, unsaved previews of the local environment asset candidates.

Run in an interactive Unreal Editor Python session. Each candidate is spawned as a
temporary, non-colliding StaticMeshActor, framed, captured, and destroyed before
the next candidate. The editor level is changed transiently; it is never saved.
"""
import json
import math
import os

import unreal


ROOT = os.path.abspath(os.path.join(unreal.Paths.project_dir(), "../.."))
REGISTRY = os.path.join(ROOT, ".debug/playable-world-slice2/local-assets/registry.json")
OUTPUT = os.path.join(ROOT, ".debug/playable-world-slice2/local-assets/previews")
TEMP_TAG = "TV.LocalEnvironmentPreview"

HOUSE_MEDIEVAL = "/Game/Fab/Medieval_House/medieval_houses_10"
HOUSE_GOTHIC = "/Game/Fab/Gothic_House/gothic_houses_4"
HOUSE_VILLAGE = "/Game/AdvancedVillagePack/Meshes/SM_House_Var01"
TREE = "/Game/AdvancedVillagePack/Meshes/SM_Tree_Var01"
GRASS = "/Game/ThirdParty/PolyHaven/Meshes/grass_medium_01_1k"
ICELAND_ROCK = "/Game/WaterPlane/Environment/Props/SM_Rock"
ROOF = "/Game/TornVeil/LocalPalette/SM_StoneTimberRoof"
GRASS_PATCH = "/Game/AdvancedVillagePack/Meshes/SM_GrassPatch_Var01"
LOCAL_PROP_MATERIAL_ROOT = "/Game/TornVeil/Materials/LocalPalette/M_TV_Local_"

PROPS = [
    ("logs_pile", "/Game/Fab/Free_Medieval_Environment_Props_Collection/Medieval1_fbx_LogsPile", (-220, 0, 0)),
    ("tablebench", "/Game/Fab/Free_Medieval_Environment_Props_Collection/Medieval1_fbx_WoodenTableBench", (-70, 0, 0)),
    ("barrel", "/Game/AdvancedVillagePack/Meshes/SM_Barrel", (80, 0, 0)),
    ("crate", "/Game/AdvancedVillagePack/Meshes/SM_Crate_Closed", (180, 0, 0)),
    ("lantern", "/Game/Fab/Free_Medieval_Environment_Props_Collection/Medieval1_fbx_LanternRound", (260, 0, 80)),
    ("cart", "/Game/AdvancedVillagePack/Meshes/SM_Cart_Var01", (0, 150, 0)),
]

CANDIDATES = [
    ("medieval-house", [("house", HOUSE_MEDIEVAL, (0, 0, 0))]),
    ("gothic-house", [("house", HOUSE_GOTHIC, (0, 0, 0))]),
    ("advanced-village-house", [("house", HOUSE_VILLAGE, (0, 0, 0))]),
    ("props-group", PROPS),
    ("tree", [("tree", TREE, (0, 0, 0))]),
    ("oak-branch", [("branch", "/Game/Megaplant_Library/Tree_English_Oak/Instances/Branch_English_Oak_01", (0, 0, 0))]),
    ("iceland-rock-grass", [("rock", ICELAND_ROCK, (0, 0, 0)), ("grass", GRASS, (360, 0, 0))]),
]
SLICE2_CANDIDATES = [
    ("roof-repaired", [("roof", ROOF, (0, 0, 0))]),
    ("advanced-grass-patch", [("grass-patch", GRASS_PATCH, (0, 0, 0))]),
    ("props-group-repaired", PROPS),
]
ROOF_CANDIDATES = [("roof-repaired", [("roof", ROOF, (0, 0, 0))])]


def asset_metadata(mesh, path):
    result = {"path": path, "name": mesh.get_name(), "assetClass": "StaticMesh"}
    try:
        bounds = mesh.get_bounds()
        result["boundsCm"] = {
            "origin": [bounds.origin.x, bounds.origin.y, bounds.origin.z],
            "extent": [bounds.box_extent.x, bounds.box_extent.y, bounds.box_extent.z],
        }
    except Exception as exc:
        result["boundsError"] = str(exc)
    try:
        result["lodCount"] = mesh.get_num_lods()
    except Exception:
        pass
    try:
        nanite = mesh.get_editor_property("nanite_settings")
        result["naniteEnabled"] = bool(nanite.get_editor_property("enabled"))
    except Exception:
        pass
    try:
        result["materials"] = [m.get_path_name() if m else None for m in mesh.get_materials()]
    except Exception:
        try:
            result["materials"] = [
                entry.get_editor_property("material_interface").get_path_name()
                if entry.get_editor_property("material_interface") else None
                for entry in mesh.get_editor_property("static_materials")
            ]
        except Exception:
            pass
    return result


def destroy_preview_actors(actors):
    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    for actor in list(actors):
        if actor:
            subsystem.destroy_actor(actor)


def frame_camera(bounds):
    center, extent = bounds
    radius = max(extent.x, extent.y, extent.z, 100.0)
    target = center + unreal.Vector(0, 0, extent.z * 0.25)
    location = center + unreal.Vector(radius * 1.45, -radius * 1.85, radius * 0.95)
    rotation = unreal.MathLibrary.find_look_at_rotation(location, target)
    unreal.EditorLevelLibrary.set_level_viewport_camera_info(location, rotation)
    return {"location": [location.x, location.y, location.z], "target": [target.x, target.y, target.z]}


def combined_bounds(actors):
    minimum = unreal.Vector(1e30, 1e30, 1e30)
    maximum = unreal.Vector(-1e30, -1e30, -1e30)
    for actor in actors:
        origin, extent = actor.get_actor_bounds(False)
        minimum = unreal.Vector(min(minimum.x, origin.x - extent.x), min(minimum.y, origin.y - extent.y), min(minimum.z, origin.z - extent.z))
        maximum = unreal.Vector(max(maximum.x, origin.x + extent.x), max(maximum.y, origin.y + extent.y), max(maximum.z, origin.z + extent.z))
    return (minimum + maximum) * 0.5, (maximum - minimum) * 0.5


def spawn_mesh(path, location, label):
    mesh = unreal.load_asset(path)
    if not mesh:
        return None, {"path": path, "missing": True}
    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    actor = subsystem.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(*location))
    actor.set_actor_label("TV Preview " + label)
    actor.tags = [TEMP_TAG]
    component = actor.get_component_by_class(unreal.StaticMeshComponent)
    component.set_editor_property("static_mesh", mesh)
    try:
        component.set_editor_property("collision_enabled", unreal.CollisionEnabled.NO_COLLISION)
    except Exception:
        pass
    metadata = asset_metadata(mesh, path)
    marker = "/Medieval1_fbx_"
    if marker in path:
        role = path.rsplit(marker, 1)[1]
        override_path = LOCAL_PROP_MATERIAL_ROOT + role
        override = unreal.load_asset(override_path)
        if override:
            component.set_material(0, override)
            metadata["materialOverride"] = override_path
    return actor, metadata


_STATE = None
_SLATE_HANDLE = None


def finish():
    global _SLATE_HANDLE
    if _SLATE_HANDLE is not None:
        unreal.unregister_slate_post_tick_callback(_SLATE_HANDLE)
        _SLATE_HANDLE = None
    previous = _STATE["previous_camera"]
    if previous and len(previous) >= 2:
        unreal.EditorLevelLibrary.set_level_viewport_camera_info(previous[0], previous[1])
    destroy_preview_actors(_STATE["actors"])
    _STATE["actors"] = []
    destroy_preview_actors(_STATE["lighting"])
    _STATE["lighting"] = []
    persist_reports()
    print("LOCAL_ENVIRONMENT_PREVIEWS_READY", OUTPUT)


def persist_reports():
    with open(os.path.join(OUTPUT, "candidates.json"), "w", encoding="utf-8") as stream:
        json.dump(_STATE["reports"], stream, indent=2)


def _tick(delta_seconds):
    state = _STATE
    if state is None:
        return
    state["elapsed"] += max(0.0, delta_seconds)
    if unreal.EditorLevelLibrary.get_pie_worlds(False):
        raise RuntimeError("preview_local_environment.py refuses to run during PIE")
    if state["stage"] == "spawn":
        if state["index"] >= len(state["candidates"]):
            finish()
            return
        name, entries = state["candidates"][state["index"]]
        state["actors"] = []
        state["report"] = {"name": name, "registry": REGISTRY, "assets": [], "missingFromRegistry": [], "missing": []}
        for role, path, offset in entries:
            if state["registry_paths"] and path not in state["registry_paths"]:
                state["report"]["missingFromRegistry"].append(path)
            actor, metadata = spawn_mesh(path, offset, role)
            state["report"]["assets"].append(dict(role=role, **metadata))
            if actor:
                state["actors"].append(actor)
            elif not metadata.get("missing"):
                state["report"]["missing"].append(path)
        if not state["actors"]:
            state["reports"].append(state["report"])
            persist_reports()
            state["index"] += 1
            return
        state["report"]["camera"] = frame_camera(combined_bounds(state["actors"]))
        state["frames"] = 0
        state["elapsed"] = 0.0
        state["stage"] = "settle"
        return
    if state["stage"] == "settle":
        state["frames"] += 1
        if state["frames"] >= 3 and state["elapsed"] >= 1.0:
            output = os.path.join(OUTPUT, state["report"]["name"] + ".png").replace("\\", "/")
            state["report"]["screenshot"] = output
            if os.path.exists(output):
                os.unlink(output)  # This script's previous capture, never a user asset.
            unreal.AutomationLibrary.take_high_res_screenshot(1280, 720, output)
            state["frames"] = 0
            state["elapsed"] = 0.0
            state["stage"] = "capture"
        return
    state["frames"] += 1
    if os.path.exists(state["report"]["screenshot"]) and state["frames"] >= 2:
        state["report"]["captureResult"] = True
        destroy_preview_actors(state["actors"])
        state["actors"] = []
        state["reports"].append(state["report"])
        persist_reports()
        state["index"] += 1
        state["stage"] = "spawn"
        state["elapsed"] = 0.0
    elif state["elapsed"] >= 15.0:
        state["report"]["captureResult"] = False
        state["report"]["captureError"] = "screenshot did not appear within 15 seconds"
        destroy_preview_actors(state["actors"])
        state["actors"] = []
        state["reports"].append(state["report"])
        persist_reports()
        state["index"] += 1
        state["stage"] = "spawn"
        state["elapsed"] = 0.0


def tick(delta_seconds):
    # Unreal may synchronously compile/load a mesh while a post-tick callback is
    # executing. The callback can be reentered during that call; keep the guard
    # set until every editor operation returns so spawn cannot recurse.
    state = _STATE
    if state is None or state["busy"]:
        return
    state["busy"] = True
    try:
        _tick(delta_seconds)
    except Exception as exc:
        unreal.log_error("Environment preview stopped: " + str(exc))
        finish()
    finally:
        state["busy"] = False


def setup_lighting():
    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    lights = []
    sun = subsystem.spawn_actor_from_class(unreal.DirectionalLight, unreal.Vector(0, 0, 2000))
    sun.set_actor_label("TV Preview Temporary Sun")
    sun.tags = [TEMP_TAG]
    sun.set_actor_rotation(unreal.Rotator(pitch=-40, yaw=128, roll=0), False)
    sun.get_component_by_class(unreal.DirectionalLightComponent).set_editor_property("intensity", 12000.0)
    lights.append(sun)
    sky = subsystem.spawn_actor_from_class(unreal.SkyLight, unreal.Vector(0, 0, 1000))
    sky.set_actor_label("TV Preview Temporary Sky")
    sky.tags = [TEMP_TAG]
    sky.get_component_by_class(unreal.SkyLightComponent).set_editor_property("intensity", 1.0)
    lights.append(sky)
    return lights


def main():
    global _STATE, _SLATE_HANDLE
    os.makedirs(OUTPUT, exist_ok=True)
    registry_paths = set()
    if os.path.exists(REGISTRY):
        with open(REGISTRY, "r", encoding="utf-8") as stream:
            registry_paths = {entry.get("package") for entry in json.load(stream).get("assets", [])}
    if unreal.EditorLevelLibrary.get_pie_worlds(False):
        raise RuntimeError("preview_local_environment.py refuses to run during PIE")
    previous_camera = None
    try:
        previous_camera = unreal.EditorLevelLibrary.get_level_viewport_camera_info()
    except Exception:
        pass
    selection = globals().get("TV_PREVIEW_SELECTION", os.environ.get("TV_PREVIEW_SELECTION", "all"))
    if selection == "all" and globals().get("TV_CAPTURE_LABEL") in ("slice2-local", "roof-only"):
        selection = globals()["TV_CAPTURE_LABEL"]
    selected_candidates = ROOF_CANDIDATES if selection in ("roof", "roof-only") else SLICE2_CANDIDATES if selection in ("slice2", "local", "slice2-local") else CANDIDATES
    _STATE = {"registry_paths": registry_paths, "candidates": selected_candidates, "previous_camera": previous_camera, "reports": [],
              "index": 0, "actors": [], "lighting": [], "report": None, "stage": "spawn",
              "frames": 0, "elapsed": 0.0, "busy": False}
    _STATE["lighting"] = setup_lighting()
    _SLATE_HANDLE = unreal.register_slate_post_tick_callback(tick)


main()
