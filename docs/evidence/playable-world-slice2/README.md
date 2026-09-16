# Slice 2 — environment presentation checkpoint

2026-09-16. Branch `codex/playable-world-slice-2`, based on the preserved playable
checkpoint `4fd5114`. **WIP: visual acceptance is incomplete. Nothing is merged.**
The source/build checkpoint is not a claim that Slice 2's complete quality target passes.

## Preserved state

The active project is `C:/Users/green/Desktop/projects/torn-veil-online-foundational`,
not the older Documents checkout. Recovery tag: `checkpoint/playable-life-slice-1-4fd5114`.
The existing seven-settlement save remains seed 918271, with 128 people, 141 bodies,
and player `p_128` bound to `b_141`. No fresh world, fake population or teleport was used.

The pre-existing `TornVeilWorld.umap` modification remains excluded. Its bytes and
the starting save are backed up in `.debug/slice2-preservation/`. The map's saved
timestamp matches `create_playable_world.py`'s `PLAYABLE_WORLD_LEVEL_READY` log at
2026-09-16 03:44:46 UTC (September 15 22:44 local). Compared with the baseline LFS
object, the 27,277-byte map differs only in timestamp and identifier/hash-sized
fields. It is preserved as setup output; no authored geometry change was identified.

## Implemented

- `TVEnvironmentGrammar`: paired wooden roof slopes, ridge along the longer
  footprint axis, 25 cm eaves and measured source-pivot compensation. This replaces
  a 66 cm tile strip stretched across a whole building. Indoor ceilings close the underside.
- `TVWorldProjection`: continuous world-anchored ground UVs, feathered masks from
  existing canonical road/path geometry, and subdivision of existing terrain triangles.
  Raised road/path cubes are removed; canonical heights and collision stay unchanged.
- Deterministic clustered Poly Haven grass replaces eight-metre shrub rows. It
  samples the rendered terrain triangles, avoids paths, water, steep cells and
  building/workplace bounds, and has 45–90 m rendering cull distances.
- `EnvironmentPalette.json`: replaceable presentation roles for roofs, walls,
  windows, workshop walls, ground and grass. No asset path enters simulation code.
- Bridge projection adds a three-metre path halo and nearby building exclusions,
  allowing adjacent regions to share presentation context without duplicate structures.
- `create_environment_materials.py`: reproducible owned terrain material with
  scanned diffuse/normal detail, muted grass/earth colors and farmland/path masks.

All rules apply to streamed settlements generally; there are no Fenwick coordinates
or settlement-name branches in the implementation. Saved settlement layout, terrain,
resources, people, actions, identities and knowledge are unchanged.

## Asset audit and treatment

Use now: documented CC0 Quaternius Medieval Village MegaKit Standard roof/wall/floor
modules and Poly Haven `brown_mud_leaves_01` / `grass_medium_01`. Existing meshes and
textures are reused. Only the project's own generated material is added through LFS.

The safe local Fab library database contained only Game Animation Sample. The Unreal
Fab panel returned a server-error page, including after its Home action. This does
not establish that the expanded account library is empty. Its audit remains incomplete.

Already imported Free Medieval Environment Props Collection (~617 MB) and
AdvancedVillagePack (~440 MB) offer plausible work/storage/furniture assets, but
their publisher/license records were absent from the local catalog and repository.
New use is deferred pending provenance; no pack was downloaded, imported or republished
by this slice. Current low-poly shrubs were rejected for this grass palette because
their repeated silhouettes conflicted with the scanned ground detail. Epic Manny/GASP
remain the unchanged local licensed prerequisites.

## Evidence and verification

Before image: [ordinary PIE](before.png). Raw local evidence lives in
`.debug/playable-world-slice2/`: `before-walk.mp4` is 22 seconds / 962 frames,
43.73 fps average from a requested 60 Hz capture. It includes native controller-key
walking. `.debug/playable-life-slice1/slice2-before.json` has 2,177 read-only render
samples over 20 seconds (8.93 ms median / 11.42 ms p95 sampled frame interval).
This is baseline evidence, not evidence for the changed environment.

Passed before interruption, still applicable to this checkpoint:

- TypeScript typecheck.
- `playable-world.test.ts` and `bridge-streaming.test.ts`: 13 tests, including
  shared path seam context and projection non-mutation.
- Six presence/dialogue/wildlife/core/life/visual bridge files: 30 tests.
- UE 5.8 Development Editor build with the existing local AutoSDK.
- Native `TornVeil.Presentation.EnvironmentRoof` and `EnvironmentRoutes`: 2 tests.

The initial build could not discover the SDK; setting `UE_SDKS_ROOT` to the existing
main checkout's `.debug/AutoSDK` fixed toolchain discovery. One shadowed local variable
was then corrected; the final build passed. No test assertions or deadlines were weakened.

An early updated projection load logged 177.96 ms for the first region and 67.53 ms
for the second, with roughly 5,000 grass instances each. These are loading samples,
not sustained-play measurements. The increased terrain density needs visual and
streaming-performance assessment before quality acceptance.

Save/reload state retains the same seed, person count, body count and player binding.
Full post-change ordinary PIE walking, visible NPC locomotion, dialogue, interior
readability and save/reload interaction evidence are still pending. Automation
interruptions and missing tool connections are not evidence of a game crash; no
fatal game stack was observed in the inspected logs.

## Human playtest required

1. In the exact foundational project, open `TornVeilWorld` and use normal **Play**
   (Alt+P), not Simulate. Wait for the existing persistent region to finish streaming.
2. Walk the square and two connecting paths with WASD; use Shift to run and mouse
   look. Inspect continuous path surfaces, shoulders, slope support and region seams.
3. Inspect roofs from both ends, eaves, entrances and one interior. Check for inverted
   slopes, gaps, floating panels, dark interiors and camera obstruction.
4. Check grass contact with the ground, clustering, culling, road/door clearances,
   and whether the ground palette looks natural in ordinary daylight.
5. Approach actual residents. Confirm visible bodies and continuous locomotion when
   they move; observe sleep/rest honestly if that is their current activity. Press E
   to talk when offered, select a reply, then leave dialogue and regain movement.
6. Use the pause-menu Save, stop PIE, start normal Play again, and confirm identities,
   learned names and control. A bridge restart from the same save checks disk reload.
7. Walk for several minutes and report stutters, grass popping or simulation stalls.

Macro spacing/terrain, functional props/interiors, professional vegetation palette,
workplace legibility and regional approach composition still need further Slice 2
work. Slice 3 has not begun. Human visual acceptance is required before claiming
this checkpoint improves the playable world.

## Design critique

Manor Lords' focus on organic road-oriented places motivates making existing movement
routes visually legible rather than inventing decorative shortcuts ([developer site](https://manorlords.com/)).
The grounded-physicality principle from the brief is applied through roof proportions,
bounded eaves and support-plane placement. The lived-in-detail goal is not yet met;
this checkpoint repairs the environment's basic visual grammar, not daily-life content.
