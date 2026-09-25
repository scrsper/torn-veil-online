"""Read-only commandlet probe of native attachment composition (not visual acceptance).

Uses the actual TVCharacter component hierarchy; no map or asset is saved.
The two requested scales reproduce the pre-repair assignments in ApplyAppearance/ApplyProfile.
"""
import json
import os
import unreal

subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
actor = subsystem.spawn_actor_from_class(unreal.TVCharacter, unreal.Vector(0, 0, 100))
assert actor, "TVCharacter did not spawn"
driver = actor.get_component_by_class(unreal.SkeletalMeshComponent)
visible = actor.get_component_by_class(unreal.TVCharacterPresentation)
assert driver and visible, "missing driver or visible component"
rows = []
for build, height in [(0.82, 0.82), (1.0, 1.0), (1.18, 1.16)]:
    requested = unreal.Vector(build, build, height)
    driver.set_relative_scale3d(requested)
    visible.set_relative_scale3d(requested)
    actual = visible.get_world_scale()
    rows.append({"requested": [build, build, height], "composed": [actual.x, actual.y, actual.z]})
report = {"kind": "native attachment reproduction, explicit scale fixture", "actor": actor.get_class().get_name(),
          "parent": visible.get_attach_parent().get_name(), "rows": rows}
out = os.path.abspath(os.path.join(unreal.Paths.project_dir(), '../../.debug/unreal/scale-before.json'))
with open(out, 'w', encoding='utf8') as stream:
    json.dump(report, stream, indent=2)
print('TV_SCALE_BEFORE ' + json.dumps(report))
subsystem.destroy_actor(actor)
