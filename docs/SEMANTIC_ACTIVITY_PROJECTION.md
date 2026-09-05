# Semantic Activity Projection Framework

**Scope:** a presentation-architecture feature on top of `main`. Branch:
`sonnet/semantic-activity-projection`. This is not a construction feature and not a rendering
rewrite — it is a small, general presentation layer that turns canonical simulation activity
into visible actor behaviour, object stages, and transient effects, proven with two vertical
slices: construction and woodcutting/resource extraction.

---

## 1. Why

Torn Veil's simulation already contains real, canonical activity for chopping, harvesting,
hauling, milling, baking, construction, combat, repair, crafting, and resource extraction. Much
of it is either invisible, collapsed into one generic pose, or only observable after the fact:

```
simulation knows something is happening
        ↓
player cannot perceive what is happening
```

Construction is the clearest example before this change: a project silently accumulates
materials and labour, and a finished building appears the instant `laborDone` reaches
`laborRequired`. Chopping/quarrying is the same problem in miniature: every labouring actor —
woodcutter, mason, builder — plays the identical generic `work` bob (`game/actors/actors.ts`),
so a player watching an NPC has no way to tell *what* they're doing, only that they're doing
*something*.

The Constitution (§46, "Rendering Is Not Reality") already establishes that the renderer must
never become authoritative. This feature is the other half of that principle: given that the
renderer isn't authoritative, it still has an obligation to make the truth legible. A
simulation whose activity is invisible is not more "pure" for it — it's just harder to inhabit.

## 2. Boundary

```
sim = truth           canonical state: ConstructionProject, ResourceNode, Body.pose, Action, events
projection = interpretation   pure functions: canonical state → ActivityPresentation
renderer = visuals     Three.js: ActivityPresentation → meshes, animation, particles
```

Concretely:

- `src/sim/` is untouched by this feature. No new canonical fields, no new save-schema version,
  no `visualStage` on `ConstructionProject`, no new `Pose` values. The one read this feature
  adds to existing render code (`workStyleFor`, see §5) reads `Person.mind.plan` — already
  canonical, already public — and mutates nothing.
- The projection layer lives at `src/game/presentation/*Projector.ts`. Every
  `derive*Presentation(world, entity)` function is **pure**: same canonical input in, same
  presentation out, no mutation, not persisted. Reload a save and the identical presentation
  re-derives from canonical state with zero special-case reload code — this is what "presentation
  reconstructs entirely from canonical state" (§17 of the brief) means in practice, and it isn't
  a promise this doc makes; it's a direct consequence of the functions containing no `this.cache`
  of their own and no writes.
- The renderer layer (`constructionRenderer.ts`, `extractionEffects.ts`, and the two small
  additions to `actors.ts`) is the only place that imports `three`. It is a *consumer* of
  presentations, never a producer of canonical facts. `src/sim/` still imports nothing from
  `src/game/` (unchanged — verify with `grep -rn "from '.*game" src/sim` returning nothing).

## 3. General framework

```
CANONICAL WORLD
     │
     ├── actions (Action.type: chop / gather / build / ...)
     ├── state   (ConstructionProject, ResourceNode, ...)
     ├── resources (Place stock — sim/world/stock.ts)
     ├── progress (laborDone/laborRequired, node.remaining/capacity)
     └── events  (resource_extracted, resource_depleted, construction_progress, ...)
           ↓
   ACTIVITY PROJECTION           src/game/presentation/*Projector.ts
           ↓
DERIVED PRESENTATION STATE       ConstructionPresentation, ExtractionPresentation
           ↓
 ┌─────────┼───────────┐
 ↓         ↓           ↓
actor     object      effects
motion    stage       particles (impact/reaction bursts)
```

### Shared vocabulary (`src/game/presentation/types.ts`)

- `ActivityKind` — the set of canonical activity families this framework can eventually cover
  (`construction`, `resource_extraction`, `crop_work`, `production`, `crafting`, `repair`,
  `cooking`). Only the first two have real projectors; the rest are declared as extension points
  (§6), not stubs.
- `PresentationCue` / `PresentationCueType` — a small semantic vocabulary
  (`actor_pose`, `face_target`, `show_material`, `show_stage`, `impact`, `damage_reaction`,
  `completion`, `hide_temporary_visual`). A cue names *what should happen*, never a Three.js
  detail — a renderer maps a cue to whatever it can do with it today (an animation branch, a
  particle burst) and can map the same cue to more later (a sound — see §7) without the
  projector changing.
- `ActivityPresentation` — the illustrative common shape from the brief, used as a base
  interface. `ConstructionPresentation` and `ExtractionPresentation` extend it with their own
  domain fields (`stage`/`materials` vs. `phase`/`growthStage`) rather than being forced into one
  all-knowing shape with mostly-unused fields — different activities have different causal
  structures (§4), and the type system should say so.
- No universal `progressPercent: 0..100`. `progress` exists on the base interface for activities
  that genuinely have a real fractional measure (construction's `laborFraction`, a node's
  `remaining/capacity`), but `phase`/`stage` — a semantic label, not a percentage — is what a
  projector is required to produce.

### Projector architecture

```
ActivityProjection
    │
    ├── ConstructionProjector        (implemented)
    ├── ResourceExtractionProjector  (implemented)
    ├── CropWorkProjector            (extension point — §6)
    ├── ProductionProjector          (extension point — §6)
    ├── CraftingProjector            (extension point — §6)
    └── RepairProjector              (extension point — §6)
```

Each projector is a standalone module keyed to one canonical subsystem — no monolithic
`switch (activityKind)` doing everyone's job. `constructionProjector.ts` knows about
`ConstructionProject`/place stock; `extractionProjector.ts` knows about `ResourceNode`/`Action`.
Neither imports the other, and neither needs to for a future `CraftingProjector` to exist.

## 4. Construction implementation

`deriveConstructionPresentation(world, project)` (`src/game/presentation/constructionProjector.ts`)
reads:

- `stockAt(world, type, project.sitePlaceId)` for each `ConstructionRequirement` — real delivered
  material, not a fabricated number.
- `project.laborDone` / `project.laborRequired`.
- `project.status`.

...and derives a `ConstructionStage`:

```
site → materials → foundation → frame → walls → roof → complete
```

**Causality rule:** every required material must be *fully* delivered before any stage past
`materials` is reachable — `foundation`/`frame`/`walls`/`roof` are gated on `allComplete`
(`materials.every(m => m.delivered >= m.required)`), independent of `laborFraction`. This is
deliberately stricter than "average delivery" would allow: a project with planks fully
delivered and stone at 0% stays at `materials`, however much labour a test (or a future bug)
manages to credit — the projector defends this itself, not just the simulation's own gating
(`performBuildLabor`/`contributeBuildLabor` already refuse to progress without materials; the
projector doesn't trust that as its only line of defence — see the "never claims a stage past
materials" test). `site` is reserved for the stricter "nothing has arrived at all" case; a
project with SOME material piled (even if other types are still zero) has visibly moved past a
bare planned site.

**Materials** are projected as bucketed piles (`none`/`some`/`many` — `bucketFor` in
`types.ts`), never one mesh per canonical unit. `ConstructionRenderer` places brown/tan/grey
boxes near the site's edge, sized by bucket.

**Renderer:** `ConstructionRenderer` (`constructionRenderer.ts`) is a dedicated semantic
renderer, not branches bolted onto the generic voxel mesher (`game/voxel/mesher.ts`, which
remains untouched terrain/block geometry). It:

- derives a presentation and a **signature** (`stage` + per-type material bucket) for every
  active project each frame;
- rebuilds a project's Three.js group only when its signature changes — not every frame (§12 of
  the brief: bounded, incremental cost as project count grows);
- disposes and removes a project's group the moment `status` becomes `complete`/`cancelled`. By
  the time that happens, the real building already exists as ordinary voxel blocks
  (`materializeStructure` in `sim/world/construction.ts`), so no duplicate stage geometry
  survives completion.

Frame/wall/roof geometry is deliberately low-detail (skeleton posts and beams, partial wall
panels, exposed roof beams) — legible at a glance, not a second building model.

## 5. Resource extraction proof

The second slice exists to prove the framework isn't secretly construction-specific. It reuses
the existing canonical tree/stone `ResourceNode` and `chop`/`gather` `Action`s
(`sim/world/resources.ts`, `sim/mind/agent.ts`) untouched — no new tree ontology, no ecology.

`deriveExtractionPresentation(world, node)` (`extractionProjector.ts`) finds the worker (if any)
whose **active** plan step is `chop`/`gather` targeting this node (`activeExtractionWorker`) and
derives a phase:

- `idle` — node available, no active worker (a worker still walking over reads as `idle`, not
  `active` — the walk is a separate `goto` step; only the in-range `chop`/`gather` step being
  *active* counts, which is exactly when the actor is close enough to actually be swinging);
- `active` — a real, in-range worker is extracting right now;
- `regrowing` — depleted, renewable, mid-regrowth (`node.growthStage` carries the felled →
  sapling → young → mature detail already implemented in v0.4);
- `depleted` — depleted, non-renewable (a worked-out quarry).

**Actor cue:** `workStyleFor(world, person)` (`activityCues.ts`) resolves what an actor's
generic `work` `Body.pose` should visually look like from their currently active `Action`:
`build` → `hammer` (the existing generic bob already reads as hammering, so it is kept exactly
as-is — minimal diff), `chop` → a two-armed overhead swing, `gather` against a stone node →
a one-armed downward pick motion. `Humanoid.animate` in `actors/actors.ts` branches on this
style only inside the existing `pose === 'work'` case; every other action (haul, plant,
harvest, ...) is untouched and keeps the original generic animation.

**Facing** the target needed no new work: `Body.yaw` is already set toward the node in
`agent.ts`'s `chop`/`gather` action handler, and `ActorRenderer` already rotates every body to
its canonical `yaw` every frame.

**Impact/reaction:** `ExtractionEffectsController` (`extractionEffects.ts`) is purely
event-driven (§6/§14 below) — it listens for the real `resource_extracted`/`resource_depleted`
events `extractFromNode`/`depleteNode` already emit and spawns a short wood-chip/stone-chip
particle burst plus a brief expanding "reaction" flash at the node's position. It owns no
per-node persistent state; a node's actual felled/depleted visual continues to be the existing
canonical voxel block clear/restore (`syncResourceNodeBlocks`), which already updates correctly
on its own.

**Completion** follows canonical extraction exactly: nothing in the presentation layer decides
how much a swing yields or when a node depletes — `extractFromNode`/`depleteNode` in
`sim/world/resources.ts` remain the only code that changes `node.remaining`/`node.state`.

## 6. Event vs. state projection

```
STATE → what should remain visible          EVENT → what should briefly happen
```

- Construction stage, material piles, a depleted/regrowing node's blocks: derived from
  **persistent canonical state**, re-derived identically every frame/reload.
- A chop/quarry impact, a wood-chip burst, a depletion flash: derived from a **transient
  canonical event** (`resource_extracted`/`resource_depleted`), owned only by
  `ExtractionEffectsController`'s own short-lived particle list, never written back anywhere,
  never required to survive a reload.

Nothing in this feature encodes a transient effect as persistent canonical state, and nothing
encodes a persistent stage as a one-off event.

## 7. Future adapters (documented, not implemented)

These `ActivityKind`s exist in `types.ts` as the extension surface this framework is meant to
grow into. None has a projector file, and none should be inferred as "coming soon" on any
particular timeline — they are named here so a future adapter has an obvious home rather than
inventing a new pattern:

- **`CropWorkProjector`** — `plant`/`harvest` against `Field`/`CropPlot` (`sim/world/metabolism.ts`)
  already has its own direct voxel-block projection (`cropBlockFor`); a projector here would
  add actor/cue coverage (a farmer visibly planting vs. harvesting) on top of that, not replace it.
- **`ProductionProjector`** — milling, baking, and other `production` `Request`s
  (`sim/world/production.ts`) — a worker visibly milling/baking rather than a generic
  `work` pose, and a mill/bakery showing its current batch.
- **`CraftingProjector`** — reserved for when a real crafting subsystem exists. Not created now
  (§8, scope exclusions: no new crafting recipes).
- **`RepairProjector`** — damage + material + labour → restored object, mirroring
  construction's shape but against an existing structure's condition rather than a from-scratch
  build.
- **`CookingProjector`** — cook-specific motion at a hearth/oven, distinct from generic `work`.

**Cue vocabulary compatibility with sound (§16 of the brief):** cues are semantic
(`impact`, `actor_pose`, `completion`, ...), not "play file X.wav" — a chop's `impact` cue, a
construction's `completion` cue, and a mill's future `production` cue are all suitable hooks for
axe/hammer/grinding/clang sounds later without the projector or cue vocabulary changing.

## 8. Deferred work

Explicitly out of scope for this feature (left for a future pass, not silently dropped):

- **Falling-tree animation.** A felled tree currently clears to `Air` instantly (existing v0.3
  behaviour, unchanged) rather than visibly toppling. A real fall animation needs either a
  per-node overlay mesh (trunk/canopy are baked into shared chunk geometry today — see
  `extractionEffects.ts`'s own note on why a shake/topple isn't cheaply addressable per-node) or
  a chunk-mesh transform hook; both are real engine work, not a presentation-layer add-on, and
  risky to rush alongside worldgen/collision/targeting. The brief explicitly permits stopping at
  reaction/depletion instead of the full fall — this is that stop point.
- Milling/baking/crafting/repair adapters (§7).
- Sound implementation (cues are compatible; no audio was added here).
- Richer particle effects (instancing, GPU particles) — the current bursts are a handful of
  short-lived boxes per event, adequate at this scale; instancing was deliberately not added
  pre-emptively (brief §12: "do not overengineer prematurely").
- Migrating haul/plant/harvest/eat/drink/combat to this framework — only construction and
  resource extraction were in scope for this feature (brief §21).

## 9. Testing

`tests/construction-projection.test.ts` and `tests/resource-extraction-projection.test.ts`
exercise the two projector modules directly — no Three.js, no browser, deterministic —
following the same `tests/helpers/world.ts` headless setup every other simulation test uses.
Both cover: real canonical state changing the derived presentation, the causality guard (a
missing required material blocking every stage past `materials` regardless of labour), an idle
actor never falsely showing an active cue, an unrelated target never reacting, depleted/complete
terminal states, determinism (same input twice → equal output), and non-mutation (the projector
never changes the project/node/world it read).

## 10. Verification

- `npm run typecheck` — passes.
- `npm test` — passes (331 tests, including the 14 new deterministic projection tests; no
  existing test was changed).
- `npm run build` — passes.
- Manual browser verification: booted the dev client, advanced simulation time to walk a
  construction project through `site → materials → foundation → frame → walls → roof`, and
  through completion (intermediate visuals removed, no duplicate geometry), and observed a
  woodcutter perform the distinct chop swing against an actual tree node with an impact/reaction
  burst on extraction.
