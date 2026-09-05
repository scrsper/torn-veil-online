# Rendering Architecture — audit and hybrid semantic direction (v0.8 §12-16)

**Status:** audit + direction for this milestone. Not a rewrite plan — see "What this milestone
does NOT do" at the bottom.

## Constitutional framing

Constitution §46 ("Rendering Is Not Reality"): the voxel client is one presentation layer over
canonical simulation state; a rendering bug cannot redefine canonical truth. This document is
about how presentation reads that state more legibly — nothing here proposes moving any decision
into the renderer.

## Current architecture (as of this milestone)

```
src/sim/                              src/game/
  core/            entities, World,     voxel/        chunked mesher (Three.js geometry)
                   causal event log     actors/       procedural humanoid/creature rigs
  physical/        VoxelGrid, blocks.ts render/       scene/atmosphere/weather visuals
                   (block palette —     player/        controller + interaction targeting
                   see below), doors,   ui/           HUD, dialogue, event feed, Inspector
                   A* navigation
  mind/            agent runtime:            main.ts   (only file owning the frame loop;
                   perception, memory,                  wires sim + renderer + UI together)
                   knowledge, goals,
                   dialogue
  world/           generation: terrain,
                   structures, cast,
                   village, metabolism,
                   logistics, production
  persist/         save/load
```

`src/sim/` never imports from `src/game/` (AGENTS.md's non-negotiable rule, mechanically true
today — verified by grep, no exceptions). `src/game/` reads `sim/` state every frame and never
mutates it directly; player actions go through the same `Simulation` methods (`takeItem`,
`harvestWheatAt`, `extractResourceAt`, `attack`, ...) an NPC's own action-execution loop calls.
This is the correct shape and this milestone does not change it.

### The one architectural wrinkle: `physical/blocks.ts`

`blocks.ts` lives in `sim/physical/` but its `BlockDef` carries `color`/`shape`/`emissive`/
`height` — visual hints, not physical simulation facts, with a code comment explicitly defending
this: "the renderer is a faithful projection of the physical world." For genuine terrain (stone,
grass, dirt, water) this is a reasonable simplification — there is exactly one physically true
appearance per block type, no semantic layer above it.

For crop lifecycle, this same mechanism is stretched further than it comfortably goes: a
`CropPlot`'s semantic state (`fallow`/`planted`/`growing`/`mature`/`harvested`) is projected to a
literal different **block id** (`world/metabolism.ts`'s `cropBlockFor` — `mature` → `B.Wheat`,
`growing` → `B.Sprout`, `harvested` → `B.Stubble`), each with its own baked-in color/height in
`blocks.ts`, and the mesher reads each block's declared `height` to vary the rendered cross-quad
size per stage. This is a real, working, deterministic semantic projection — CropPlot state is
never duplicated, the block IS the single source of truth for what's rendered — but it means
"one more crop lifecycle stage" costs a new block enum value plus persisted-save-compatibility
care (block ids are raw numbers in every save's voxel grid; `blocks.ts`'s own comment already
flags this: append-only, never renumber). That is the general shape of "everything becomes a
voxel": it works, but it does not scale gracefully to richer semantic state, and it is the
pattern this document recommends moving away from for anything that is not, physically, terrain.

## What should remain voxel-rendered

- **Terrain**: soil, stone, water, roads, farmland, snow/mud overlays. These are genuinely part
  of the physical grid substrate (`sim/physical/`) — future digging/mining/building needs exactly
  this representation. No change recommended.
- **Structures** (walls, floors, roofs, furniture-as-fixture): procedurally placed once at
  generation (`world/structures.ts`) and static thereafter. Voxel representation is appropriate;
  these are not semantic objects with their own lifecycle the way a crop or a tree is.
- **Construction-in-progress** sites: confirmed finding — `world/construction.ts`'s
  `materializeStructure` lays the ENTIRE finished structure's blocks (floor, walls, roof, door,
  lantern) in one shot, only ever called once, at 100% `laborDone` (`completeProject`). A site at
  1% labor and a site at 99% labor are visually identical (bare/gathering-placeholder ground) —
  `ConstructionProject.laborDone`/`.contributions` genuinely advance underneath (confirmed by
  this milestone's own WorldLab `construction-progresses-with-materials-and-workers` liveness
  check passing across every scenario/seed run — see §11 below), but nothing about that progress
  is visible. This is a real legibility gap, not a functional defect (§5's example "shed did not
  progress" describes the underlying labour actually being stuck; here the labour itself is
  fine, only its visual evidence is missing) — classified FOLLOW-UP, not a BLOCKER, and listed in
  the migration path below since "a structure visibly becoming more complete" is one of this
  milestone's own §14 acceptance examples (`construction_progress` → "partial structure becomes
  visibly more complete").

## What should become semantic mesh renderers

- **Crops**: `CropPlot` is already the single source of truth and already projects cleanly
  through one function (`cropBlockFor`) — the state management is right, only the mechanism
  (choose-a-block-id) is the "voxel for everything" smell. A `CropRenderer` reading `CropPlot`
  directly and drawing instanced meshes (see Performance below) per stage — tiny shoots, taller
  green stalks, dense gold wheat, stubble — would let the *shape* differ per stage, not just
  color/height on a cross-quad, without needing new block ids or touching save compatibility at
  all (crop state already isn't stored as a block — `cropBlockFor` derives the visual, it doesn't
  store one). This is the safest, highest-value candidate for the "representative vertical slice"
  this milestone's brief asks for — see "What this milestone actually ships" below for why it
  was deferred to a documented follow-up instead of attempted now.
- **Trees**: currently a `ResourceNode` maps to a cluster of `B.Log`/`B.Leaves` blocks removed
  directly from the grid on extraction (`world/resources.ts`/`extractFromNode`) — a felled tree
  is blocks disappearing, not a tree-shaped object going through visible stages. A
  `TreeRenderer` keyed by `ResourceNode` (sapling/young/mature/damaged/felled/stump, matching
  §13's suggested stages) is the more invasive of the two candidates: it requires the tree to stop
  being physical grid blocks and become a semantic object placed at a grid-anchored position,
  which affects raycasting/interaction targeting (`game/player/interaction.ts`'s block-based
  targeting) and worldgen (`world/structures.ts`'s tree placement writes blocks directly today).
  Documented as a FOLLOW-UP, not attempted here — see below.
- **Items** (logs, sacks, bread, tools, cargo): already NOT voxel blocks — `Item` is a canonical
  entity with a `pos`, and `game/actors/actors.ts`'s `makeItemMesh(it: Item)` already builds one
  small prop mesh per item, keyed and cached by `Item.type`/id (`itemMeshes` map), entirely
  outside the chunk mesh. Already the right shape; richer per-type meshes are a pure art-asset
  improvement, not an architecture change.
- **Characters**: already NOT voxel blocks — `actors/actors.ts`'s procedural `Humanoid`/creature
  rigs read `Body.pose` directly. This is the actor-rendering pattern the other semantic
  renderers above should look like.

## Action → animation: the projection layer that already exists

Constitution-aligned action projection (§14's "canonical action → presentation signal →
animation") is **already implemented** for characters, just not yet fully populated: `Body.pose`
(`sim/core/types.ts`) is the canonical-to-presentation signal, `actors.ts`'s `Humanoid.animate()`
is the presentation layer reading it, and nothing in `sim/` ever reads pose back — it is
write-only from the simulation's perspective, exactly the one-way arrow the Constitution
requires. Before this milestone, several distinct actions collapsed onto one generic `'work'`
pose (harvesting, hauling-while-stationary, milling, building, chopping/quarrying all looked
identical); v0.8 already gave `eat`/`drink`/`haul`(-while-walking) their own poses, and this
milestone adds `'chop'` for resource extraction (§16 "one resource-extraction action is visibly
understandable" — see `mind/agent.ts`'s `chop`/`gather` action case, `actors.ts`'s new pose
branch, and the player's own `extractResourceAt` interaction path, which now gets the identical
pose). The pattern is proven and cheap to extend: adding a distinct pose for milling/baking/
arrest is the same three-line shape (declare the `Pose` value, assign it at the one action-
execution call site, add one `if (pose === ...)` branch in `actors.ts`) — listed as a FOLLOW-UP
rather than done exhaustively here to keep this milestone's rendering footprint reviewable.

For non-character events (`crop_harvested`, `resource_extracted`, `construction_progress`,
`storm_damage`, `entity_arrested`), no equivalent lightweight "presentation signal" field exists
yet on the canonical event — the renderer currently has to infer "something changed" from polling
state (e.g. re-reading `CropPlot.state` every mesh rebuild) rather than reacting to a discrete
signal. A minimal, additive option for a future pass: an event-driven subscription (`world`
already supports listeners — `core/world.ts`'s `emit()` calls registered listeners) that the
renderer uses to trigger one-shot effects (a particle burst on `resource_extracted`, a brief
sickle-motion cue on `crop_harvested`) without ever making the renderer a *source* of state —
purely a "play a reaction to something that already, canonically, happened."

## Performance considerations

- **Instancing**: any future `CropRenderer`/`TreeRenderer` should use `THREE.InstancedMesh` per
  stage (one draw call per stage per chunk, not per-plot/per-tree) — the village currently has
  dozens of crop plots and this milestone's WorldLab runs show that count only grows with village
  scale, so per-object mesh/material allocation would not scale the way the existing chunked
  voxel mesher already doesn't need to worry about (it batches all same-chunk geometry into one
  buffer already — `game/voxel/mesher.ts`'s `GeoBuilder`).
- **Avoiding duplicate state**: every semantic renderer described above reads a canonical field
  directly (`CropPlot.state`, `ResourceNode.state`, `Body.pose`) every frame/rebuild — none of
  them should cache a shadow copy of simulation state to decide what to draw. The existing actor
  renderer already gets this right (`Humanoid.animate(dt, body, physTime)` takes the live `Body`
  each call); any new semantic renderer should follow the identical shape rather than, say,
  keeping its own "last known crop stage" field to diff against.
- **Chunk dirtying**: today, a crop stage change dirties the block's chunk (mesher rebuild) the
  same as a physical block edit. An instanced `CropRenderer` would decouple crop visuals from
  chunk rebuilds entirely (update one instance's transform/color, no geometry rebuild) — a
  performance improvement, not just an aesthetic one, once implemented.

## Migration path (priority order, each independently shippable)

1. **Crop `CropRenderer`** (documented here, not implemented this milestone — see below): replace
   `cropBlockFor`'s block-id projection with an instanced mesh renderer reading `CropPlot`
   directly. Zero save-compatibility risk (crop state was never stored as a block id to begin
   with) and removes the need for `B.Sprout`/`B.Stubble`/future stage block ids entirely.
2. **Construction-progress staged visuals**: lay a partial/scaffold representation at labour
   milestones (e.g. footing at 25%, walls at 60%, roof at 90%) instead of one all-at-once
   `materializeStructure` call — directly closes the confirmed gap above. Same risk profile as
   crops: it's an additive visual staging on top of state (`laborDone`/`laborRequired`) that
   already exists and is already correctly tracked; no new canonical state needed.
3. **One more `Pose` value per remaining generic `'work'` site** (milling, baking, arrest):
   low-risk, same shape as this milestone's `'chop'` addition.
4. **Event-driven one-shot presentation signals** (particle/animation cues keyed off `WorldEvent`
   listeners) for `crop_harvested`/`resource_extracted`/`construction_progress`.
5. **Tree `TreeRenderer` prototype**: the highest-value, highest-risk item (affects targeting +
   worldgen block-writing, not just the mesher) — do this only after (1) has proven the pattern
   end-to-end on a lower-risk subsystem.

## What this milestone actually ships

- The crop lifecycle → block projection (`cropBlockFor`, cross-quad height by declared stage)
  predates this milestone (v0.8 §C, already merged into this PR branch) and remains the current
  crop rendering mechanism — a real, working semantic projection, just voxel-mechanism rather
  than instanced-mesh. It is NOT replaced this milestone: converting it to an instanced
  `CropRenderer` is real, non-trivial renderer-side work (a new render module, wiring it into
  `main.ts`'s frame loop, removing the now-redundant crop block ids from `blocks.ts` without
  breaking old saves that still contain them) that this hardening-focused milestone did not have
  budget to also implement and test end-to-end without raising exactly the "half-finished
  parallel system" risk §15 warns against. Recorded here as the top migration-path item instead.
- The **action → animation** vertical slice is real and shipped this milestone: the new `'chop'`
  pose (§16) is a working instance of "canonical action state visibly and specifically projected,"
  end to end, for both NPCs and the player, through the exact mechanism this document recommends
  extending to the remaining generic-`'work'` sites.
- A real, independently-discovered rendering bug was fixed alongside it: `PlayerController`
  never actually reverted a timed pose (`attack`/`hit`) back to a movement-based one once set,
  because the per-body decay in `bodyPhysics` explicitly skips player-controlled bodies. Fixed by
  checking `poseUntil` in the controller itself (see git history / PR description for detail) —
  this was found specifically because it would have made the new `'chop'` pose visibly stick.

## What this milestone deliberately does NOT do

- No rewrite of the simulation to be mesh-driven — the voxel/grid substrate remains canonical for
  terrain, exactly as the Constitution and milestone brief require.
- No `CropRenderer`/`TreeRenderer` implementation — both documented above as prioritized
  follow-ups rather than attempted half-systems.
- No new per-event presentation-signal infrastructure — sketched above as an option, not built,
  since nothing in this milestone's other work currently needs it.
