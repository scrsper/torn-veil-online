# Slice 2 — environment presentation

## Visual finish continuation (Claude), 2026-09-17

Branch `claude/playable-world-slice-2-visual-finish`, created from the Codex checkpoint
`ff36e25` (itself on protected `4fd5114`). **Nothing is merged or pushed.** Same persistent
save (seed 918271, player `p_128`/`b_141`, 7 settlements, 127 residents); no fresh world, no
spawned people, no teleportation. The pre-existing dirty map and imported packs stay excluded.

Commits: `adb6cda` evidence tooling · `c9c5508` woodland and horizon · `cf834fd` places,
architecture, interiors, ground · `d7a7d4b` recorder fix and input tools · `7e5d5a1` doors,
fixtures, tool hardening.

### Evidence

| File | What it shows |
|---|---|
| [before.png](before.png) / `.debug/playable-world-slice2/before-walk.mp4` | Original baseline (Codex capture). |
| [after-ff36e25.jpg](after-ff36e25.jpg), [ff36e25-diagnostic-views.jpg](ff36e25-diagnostic-views.jpg) | The ff36e25 checkpoint in ordinary PIE, before any change here. |
| `.debug/playable-world-slice2/after-ff36e25-walk.mp4` | 40 s ff36e25 walk at 72 fps. Its coloured pixel blocks are a defect of the FrameGrabber recorder used then (see below), not the game. |
| [after.png](after.png), [before-after.jpg](before-after.jpg) | After: approaching the square at walking height. |
| [after-settlement-aerial.jpg](after-settlement-aerial.jpg), [after-diagnostic-views.jpg](after-diagnostic-views.jpg) | Diagnostic camera views (not the player camera). |
| [after-interior.jpg](after-interior.jpg), [after-house-interior.jpg](after-house-interior.jpg) | Lit tavern interior (diagnostic view); house interior from the player walk. |
| [after-dialogue.jpg](after-dialogue.jpg) | Yara Hart's dialogue at the tavern door during the recorded walk. |
| `.debug/playable-world-slice2/after-walk.mp4` | **150 s, 1280×720, recorded at 28–29 fps** (encoded at 30). Two continuous ordinary-PIE takes joined: **A (0–100 s)** woodland → settlement edge past working residents → paved square among residents → house entry, interior and exit; **B (100–150 s)** tavern approach, E to talk, reply "Who are you?", close, return to walking. Timelines: `after-walk-final-timeline.txt`, `after-walk-dialogue-timeline.txt`. |

How the walk was driven: editor-only `TV.TestWalkTo` holds the ordinary W/Shift keys and steers
with ordinary MouseX axis input; the bridge adjudicates every step. E is an ordinary
PlayerController key. The dialogue reply and Close use `TV.TestUIChoice`, which issues the same UI
command a button click sends, because an unfocused editor cannot give the modal widget keyboard
focus. Screen control of the editor was not available. The takes were joined because long
unattended takes kept failing on steering (a doorway occupied by two keepers, a building corner),
not because any shown section was staged.

### Visual problems found at ff36e25 (ordinary PIE)

A flat open plane ending in a blue band at the horizon; no woodland despite canonical forest 0.85
around Fenwick; invisible grass (the pack grass wrote invalid pixels); stretched single-storey
plaster boxes with black window holes and grey untextured roofs (AdvancedVillage materials lack the
instanced-mesh usage flag, so PIE fell back to the default material); open gable triangles;
pitch-black interiors (fixed EV100 12 exposure, no interior light); pastel untextured ground; cone
crops; checkerboard fixtures.

### What changed

- **Woodland and horizon** (`TVWoodland.cpp`, `regions.ts` vista): canonical forest density drives
  zoned vegetation in 5 m world cells: an open village core, medlar orchards beside houses, a
  thickening edge with spindle scrub, then oak woods with clearings. Paths, roads, buildings,
  fields, water and steep cells stay clear. The bridge sends a read-only `vista` of the versioned
  geographic baseline (±5.1 km at 32 m); the client builds a horizon ring with ~33k far oaks.
  Megaplant English oak, Japanese medlar and European spindle are derived locally into static
  Nanite assemblies (`create_local_vegetation.py` + `TV.BakeNaniteAssembly`, with parts remapped to
  static twins). This requires `r.Nanite.AllowAssemblies=1` and `r.Nanite.AllowVoxels=1`.
- **Buildings** (`TVWorldProjection.cpp`): a two-tier timber-frame grammar on the canonical footprint
  (brick plinth, door frame and lintel, storey beam, timber-grid upper storey with plaster infill,
  32 cm corner posts, stone chimneys on homes/tavern/bakery, gable fills, textured shingle roofs).
  Canonical doors and openings are unchanged; open door leaves hinge at the jamb.
- **Functional places** (`TVPlaceDressing.cpp`): clusters derived from place type, footprint, door and
  path cells. Households get firewood, a chopping block, water butt, bench, pumpkin garden, flowers
  and wall lanterns; the tavern outdoor tables, a keg rack and barrels; the bakery flour sacks and
  fuel; the mill a cart and sacks; the square lamp posts, a notice post, benches and a cart; the well
  buckets and a trough; the stall produce under its roof; the sawpit logs, a stump and axe; the
  quarry boulders, stone blocks and a cart; the farm haystacks, a cart, sacks and a pitchfork. All
  props are decorative and non-colliding, placed clear of path cells, door approaches and other places.
- **Ground** (`create_environment_materials.py`): scanned layers selected by vertex channels: grass
  (AdvancedVillage landscape), worn yards, paths and door aprons (Iceland dirt), cultivated soil,
  woodland floor beyond the settlement, and a cobbled square (SM_Roads_05 cobblestone). Crops render
  as plants sized by canonical growth.
- **Interiors and lighting** (`TVPlayableLighting.cpp`): room fill plus canonical lantern/forge lights,
  bounded exposure adaptation EV100 7–12, a lower afternoon sun (−36°), aerial fog for depth.
- **Materials:** AdvancedVillage instances are copied and reparented to flagged base copies
  (`create_local_village_materials.py`); Free Medieval props route to their local PBR wrappers.
  Derived assets are git-ignored local content; only recipes and semantic roles are committed.
  No asset path enters `src/sim`.

### Verification

- UE 5.8 Development Editor build passes on the final source (Live Coding used between restarts).
- Native `TornVeil.Presentation`: **14/14 pass**, including DaylightInfrastructure against the new
  exposure contract, EnvironmentRoof, EnvironmentRoutes and RenderedReadability.
- `tsc --noEmit` clean. Vitest: 9 focused files / **45 tests pass** (dialogue, humanoid presence,
  life, visual state, streaming, playable world, the new vista test, movement, controller lease).
- Playable life in PIE: animated player walk/run; residents visible, working, walking and gathered
  on the square; dialogue opens, answers in character, closes, and control returns.
- Persistence: in-game F5 save → bridge stopped → restarted from disk → PIE reconnected. Same
  `p_128`/`b_141`, 127 residents and 7 settlements; names learned this session (Yara Hart, Aster
  Alder) persist; an unmet resident stays "an unfamiliar person"; movement works after reload.

### Performance observations

Unthrottled ordinary PIE with the full village, woods and horizon: **78 fps median** (12.7 ms p50,
13.9 ms p95, 49 ms worst over 5 s). Region builds take 5–83 ms each; the vista build takes 20–55 ms
once per region crossing (bridge-side projection ~15 ms). Recording costs frames (capture at ~29 fps).
The bridge's canonical scheduler still shows overruns, with event-loop p95 of 28–109 ms under load:
the pre-existing cognition-performance frontier, not introduced here. An unfocused editor throttles
PIE to ~3 fps, which starves movement input; unattended runs use `TV.EditorThrottle 0`.

### Tooling defects found and fixed

The FrameGrabber back-buffer recorder produced corrupt pixel blocks (in JPEG and PNG alike, absent
from Slate screenshots) and hung the editor on shutdown with non-zero frame latency; the recorder
now uses Slate screenshot readback. A strong viewport reference crashed the editor on PIE stop
(engine assertion); it is now weak. Escape in an unfocused editor stops PIE.

### Remaining visible deficiencies

- Canonical terrain is nearly flat (1 m voxel steps across the settlement). No presentation grading
  was added, because character support uses canonical heights.
- The settlement layout is canonical: sparse hub-and-spoke paths with wide gaps between places.
  Presentation fills them with yards and vegetation but does not invent buildings.
- Vegetation and props have no collision; the player and camera can pass through shrubs.
- Woodland still reads partly as evenly spaced parkland at mid distance; beyond ~5 km the horizon
  is fog and sky.
- Ground reads bright and even in daylight; roads have no stone edging or ruts.
- The player and residents are untextured mannequins; residents sometimes stack on one cell.
- Some house interiors are sparse (canonical furnishings only); windows have no glazing or shutters.
- Megaplant pine materials have missing local dependencies, so pines are replaced by young oaks.
- Stall roofs and some prop scales are approximate; signs are simple boards.

**Acceptance judgement:** the before/after difference is immediately obvious. Fenwick now reads as
a woodland village with real architecture, functional places, a lit interior and living residents:
the beginning of an RPG world rather than an integration plane. It does not yet meet the full
reference bar (flat canonical terrain, mannequin people, parkland woods). Human visual acceptance is
still required. Slice 3 has not been started.

---

## Earlier Codex checkpoint notes

2026-09-16. Branch `codex/playable-world-slice-2`, based on the preserved playable
checkpoint `4fd5114`. **WIP: visual acceptance is incomplete. Nothing is merged.**
The source/build checkpoint is not a claim that Slice 2's complete quality target passes.

## Latest integration: expanded local library, September 16 evening

**Source/build checkpoint only. Final ordinary PIE acceptance remains pending.**
The work continued in the foundational Desktop checkout, preserving the same save.
The actual Unreal registry contained 3,714 assets in 39 local groups; this audit used
local package/dependency metadata and bounded native previews, with no Fab account access.
See [local asset selection and provenance](../../playable-world-slice2-local-assets.md).

Changes since `6893ef5`:

- Fixed disconnected component-mask, desaturation and UV material inputs in
  `create_environment_materials.py`; failed connections now raise errors. Rebuilt
  the owned CC0-backed terrain material. Ordinary PIE confirmed the checkerboard
  disappeared, then exposed large-coordinate UV stripes. The subsequent native
  fix uses local UV coordinates with the same world texture phase; visual recheck pending.
- Expanded `EnvironmentPalette.json` with optional local roof, trees, grass, well,
  rock, fences, whole furniture and open/closed storage. Missing packages fall back;
  each PIE loads the palette anew. No marketplace paths enter `src/sim`.
- Added `TVFixturePresentation` and read-only furnishing DTOs in `regions.ts`.
  Existing world cells provide location/support; chairs face their adjacent tables.
  Region revision invalidation remains authoritative. These are fixtures, not new items.
- `TVWorldProjection` fits a roof-only derived asset to canonical footprints with
  25 cm eaves, keeps existing entrances, leaves canonical smithy frontage open,
  projects fixtures/wells, uses textured storage/fences, varies existing resource-tree
  silhouettes and normalizes clustered grass height by measured asset bounds.
- Added local registry audit, bounded preview, PBR-wrapper and roof-extraction scripts.
  Vendor packages are unchanged. Derived licensed binaries are ignored/local; only
  recipes and semantic mappings are committed. Publisher/license facts not available
  locally remain unresolved rather than inferred from folder names.
- Disabled the imported ConvAI plugin: closing its unsolicited login panel called
  `StopAllListeners()` and stopped Unreal's native Remote Control server. Enabled
  ProceduralVegetationEditor for imported plant material parents (also provides the
  GeometryScripting dependency used by editor-only roof extraction). No credentials used.
- Isolated native Python script globals so deferred preview callbacks cannot consume
  another script's variables; guarded reentrant callbacks and cleaned temporary actors.

Verified at this checkpoint:

- `npx vitest run tests/playable-world.test.ts --reporter=dot`: 9 passed, including
  non-mutation, region ownership and chairs facing actual tables.
- `npx tsc --noEmit`: passed after the final chair-facing change.
- UE 5.8 Development Editor build: passed in 28.19 seconds. Native source did not
  change afterward. Existing environment tests predate the new palette integration.
- Independent read-only review found a chair-facing defect; it was fixed and the
  regression assertion passes. No container duplication or invalidation defect found.
- Normal bridge `save` request acknowledged `saved`; player `p_128` / `b_141`,
  seven settlements and 127 NPC residents remain. This is NOT final disk-reload proof.
- Excluded map hash remains `F195BAFD7566018EC0534DECA8A4A015F05404304E0D63E5F7B6AB7FBD1B5B87`.

Evidence under `.debug/playable-world-slice2/local-assets/`:

| Evidence | What it supports |
|---|---|
| `registry.json`, `materials.json` | Local inventory; imported prop materials referenced default textures despite matching PBR textures being present |
| `current-before00000.png` | Ordinary persistent PIE before terrain material repair |
| `material-repaired00000.png` | Material graph repair visible; remaining stripes diagnosed, not final quality acceptance |
| `previews/props-group-repaired.png` | Authored props render with owned PBR wrappers; isolated asset preview only |
| `previews/advanced-grass-patch.png` | Grass candidate's actual appearance; isolated asset preview only |
| `architecture-extraction.json` | Roof bounds Z=310–678 cm and assigned source material slot |
| `integration-build.log`, `furnishing-tests.log` | Latest build and focused test results |

The roof preview file still has its earlier untextured capture timestamp; it is NOT
proof of the later material assignment. Recapture it and inspect the in-game roof.
No final AFTER settlement image, new walking/NPC video, dialogue or save/reload
acceptance is claimed. The earlier 43.73 fps baseline video remains available below.

The editor exited cleanly for the completed rebuild. Automatic approval review then
rejected the combined bridge restart and visible editor launch with only `blocked
by policy`. Nothing in that rejected command executed; no alternate relaunch was tried.
**At handoff: no editor; old-source bridge PID 10236 remains on 8787.** It must be
saved and restarted from this exact checkout before the new furnishing DTO is available.
Use ordinary Play after the restart, then the playtest below. Do not regenerate the map.

Remaining visual deficiencies: macro spacing/flatness, building scale, coherent
regional approaches, usable/illuminated interiors, primitive fallback work fixtures,
and crop representation. No claim yet that the selected palette solves these.
Performance: roof instance count falls to one envelope per building; grass remains
culled at 45–90 m. No sustained performance measurement of this final palette exists.
Slice 3 should begin only after approval, with canonical work/approach slots made
readable in the accepted environment. Nothing has been merged.

Reference principles applied from the user's brief: Kingdom Come → bounded physical
architecture and retained entrances; Manor Lords → existing roads/workplaces determine
presentation; RDR2 → canonical furniture makes interiors legible; Witcher 3 → clustered
edge vegetation; Skyrim → continuous visible routes. These are design intentions,
not claims of comparable quality or copied content.

## Earlier recovery handoff (superseded by the integration status above)

Implementation checkpoint: `b17f876` (`WIP: checkpoint Slice 2 environment grammar
before visual acceptance`). An independent read-only review covered those changes
and reported no actionable defects. The subsequent launch-script change removes
`-WindowStyle Hidden`, so normal interactive launches are visible. PowerShell parsing
and `git diff --check` passed; the reviewer also checked this one-line change.

At recovery, no `UnrealEditor.exe` or playable bridge listener on 8787 remained.
Two older Node server process trees belonged to the separate main checkout; they
were left untouched. One matching playable bridge was started (PID 10236), and its
health response confirms the foundational checkout, protocol 2, seven settlements,
127 NPC residents, and player `p_128` / `b_141`. No duplicate target process was started.

The attempted visible editor launch was rejected by automatic approval review with
`blocked by policy`, without a more specific reason. Unreal did not start. No retry,
computer-use reconnect, alternative launch workaround or fresh world was attempted.
The editor is therefore **not open** at handoff; the bridge is ready. The previous
session's automation interruption remains unexplained by the game logs, which show
no inspected fatal game stack. Neither interruption establishes a game defect.

To open the already-built project visibly, run this exact PowerShell command locally:

```powershell
& 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor.exe' 'C:/Users/green/Desktop/projects/torn-veil-online-foundational/unreal/TornVeilOnline/TornVeilOnline.uproject' /Game/TornVeil/Maps/TornVeilWorld -RCWebControlEnable -RCWebInterfaceEnable
```

Do not start another bridge while 8787 is listening. This command uses the normal
editor/project/map configuration and deliberately avoids rerunning map setup or an
unchanged build. The complete visual playtest is below. Visual acceptance remains
awaiting human confirmation; no AFTER image or post-change motion claim is supplied.

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

For a full disk reload after Save and stopping PIE, stop only the bridge owning port
8787, then run `npm run bridge:playable` from the foundational checkout and use Play
again. Do not stop the unrelated main-checkout servers. Compare people/body bindings,
learned names and possessions with the state immediately before Save. Restarting PIE
alone checks client reconnection but does not prove a disk reload.

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
