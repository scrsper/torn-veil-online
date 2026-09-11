# PCG dwelling: canonical 6 × 8 m benchmark

Graph paths: /Game/TornVeil/PCG/Buildings/TV_Dwelling_6x8_S01 through S05.
Test level: /Game/TornVeil/PCG/Tests/Dwelling/L_PCG_Dwelling_6x8.
Generator: [pcg_dwelling.py](../../unreal/scripts/pcg_dwelling.py).

An explicit canonical input supplies buildingId, widthMetres=6 and depthMetres=8.
v0.1 rejects other dimensions. The generator converts metres to centimetres, measures
vendor mesh bounds and compiles deterministic seeded recipes into native PCG nodes:
CreatePointsGrid → TransformPoints → StaticMeshSpawner → Output. PCG owns every
construction instance; these are not manually spawned houses beside a smoke graph.

Each recipe has 12 floor tiles, 12 wood ceiling tiles, 14 perimeter bays, eight pitched
roof panels, four supports and one/two barrels. Exactly one door and three/four windows
replace full wall bays. The door side/position, windows, brick/wood floor and pantry
storage vary by seed. Dressing is excluded from the 130 cm entrance lane.
The boarded ceiling closes the roof module's bevel openings above the room.
Roof panels overlap 20 cm along the ridge and between depth bays.

All construction uses the Quaternius modules listed in [ASSET_CATALOG](ASSET_CATALOG.md).
Only /Game/AdvancedVillagePack/Meshes/SM_Barrel supplies dressing. No prefab houses,
Fab props, vendor edits, Ashford changes or canonical collision/navigation changes.

## Measured envelope and determinism

Canonical floor/wall bounds: X=[-300,300], Y=[-400,400] cm.
All five complete generated bounds: X=[-320,320], Y=[-410,410], Z=[0,508] cm
(up to floating-point error below 0.001 cm). Horizontal size: 6.4 × 8.2 m.
Roof overhang: 20 cm in X, 10 cm in Y; permitted margin: 20 cm each side.
Largest excursion: 20 cm. Pantry dressing remains inside the walls.

| Seed | Instances | Door slot (side,index) | Local mesh/transform SHA-256 prefix |
|---:|---:|---|---|
| 1 | 52 | east,1 | 1c38d6c7457a5b8c |
| 2 | 51 | north,1 | 197b137027a0d671 |
| 3 | 52 | west,1 | cc6941a1ed5d96c0 |
| 4 | 51 | south,1 | b56962e9c9d517fb |
| 5 | 52 | east,2 | 2a2cd610e06d99d |

[Acceptance evidence](../evidence/dwelling/acceptance.json) records every actual ISM
mesh path, local transform and transformed mesh bounds before cleanup, after regeneration,
and after disk reload. Hashes exclude display offsets and actor labels. Thus distinct
seeds differ in construction, and equal seeds truly reproduce their meshes/transforms.

Verification observed zero instances after cleanup, regenerated all five components,
matched every expected role/slot to an actual instance within 0.1 cm, saved the level,
unloaded it, reloaded all five graph packages from disk, reopened the level and
rechecked signatures and bounds. All stages passed. Generated collision is disabled.

The neutral display slab is tagged TV.TestStage and excluded from dwelling measurement;
it is the sole allowed standalone StaticMeshActor. Every dwelling component comes
from PCG. During development an AdvancedVillagePack material auto-dirtied on load;
that transient change was discarded by package reload without saving. The final
verification had no dirty vendor package and Git shows no vendor asset changes.

## Reproduce

With one UE 5.8.2 editor, no PIE, and the canonical Desktop project:
run unreal/scripts/create_pcg_dwelling_test.py through MCP execute_python; wait for
PCG_DWELLING_SAVED. Then run unreal/scripts/verify_pcg_dwelling.py and wait for
PCG_DWELLING_ACCEPTANCE_PASS. Both use Slate callbacks for asynchronous PCG work.
Run unreal/scripts/capture_pcg_dwelling.py for entrance views of all five variants
and an interior view. The saved JSON and PNGs are under docs/evidence/dwelling/.

## Limits and next step

This is one fixed modular archetype compiled into five seed-specific graphs. General
dimensions, a single runtime-parameterized graph and canonical settlement selection
are deferred. Entrances/windows are open modules, with minimal pantry dressing.
The roof silhouette is shared across variants. Lighting is an isolated benchmark,
not a finished environment. Geometry has no gameplay collision or navigation authority.
Before production integration, bind this archetype to canonical building/door semantics
and verify canonical entrance access; do not infer world truth from generated geometry.
