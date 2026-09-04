# v0.3 — Living World I: Logistics, Materials & Construction

**Scope:** a focused vertical slice on top of v0.2.4 World Metabolism (`main` at `5fe3f38`
at the start of this pass). Branch: `claude/v0.3-living-world-logistics`. This is **not** the
whole economy/ecology/civilization vision — it is the smallest *complete* example of a world
where **a resource must actually be where it is needed before anyone can use it**, and where
**NPC labour can extract, move, transform, and consume material to permanently alter canonical
world state**.

**Method:** every number below was produced by running the real headless engine
(`npm run sim`, the same canonical `World` / `Simulation` / village generation the browser
client uses) at fixed seed `918271`, plus the deterministic test suite (180 tests), plus a
real browser smoke test of the voxel client.

The central question this milestone answers:

> Can material needs cause entities to physically move resources through the world, transform
> those resources, and permanently alter the environment?

**Yes.** At seed 918271, with no player present, over 8 world-days:

```
a tree in the woodcutter's clearing is felled          (13 trees over 8 days)
↓  its logs are carried to the sawpit                   (hauled: log)
↓  the sawyer cuts them into planks                     (log → plank via transform)
↓  the planks are carried to the storage-shed site      (hauled: plank)
↓  stone is broken from the north quarry                (resource_extracted)
↓  and carried the length of the village to the site    (hauled: stone)
↓  three villagers do build labour at the site          (construction_progress)
↓  the storage shed becomes a real, persistent Place    (construction_completed)
```

and the v0.2.4 food chain, previously abstract in its transport, is now spatial:

```
grain is harvested and stays at the farm
↓  a hauler carries it to the mill                       (hauled: grain)
↓  the miller mills grain physically at the mill         (transform, local stock only)
↓  a hauler carries the flour to the bakery              (hauled: flour)
↓  the baker bakes flour physically at the bakery
↓  bread is carried to the market stall                  (hauled: bread)
↓  villagers buy and eat it
```

---

## 1. Place stock as first-class state (Priority 1)

`src/sim/world/stock.ts`. **No new database.** Material stock at a Place *is* the existing
`Item` entity model: an `Item` with `placeId` set, `holderId` null, and `quantity > 0` is a
stack physically present there. Ownership (`ownerId`) is tracked **separately** from physical
location (`placeId`), so:

```
20 grain · at North Farm    · owned by Alwin     (from a harvest)
20 grain · at the old mill  · owned by the miller (after a haul delivered it)
```

are two distinguishable stacks of the same `ItemType`.

| helper | answers |
|---|---|
| `stockAt(world, type, placeId)` | how much of `type` is physically at one Place |
| `stockTotal(world, type, placeIds[])` | …at any of several Places |
| `worldStock(world, type)` | how much exists anywhere (at a Place, carried, or loose) — the conservation check |
| `addPlaceStock` | add units, merging into the one stack of that type per Place, with provenance |
| `takePlaceStock` | remove units, **oldest stack first (deterministic by id)**; a drained stack is emptied and detached, never deleted (provenance stays valid) |

`stockAt`/`stockTotal` were moved here from `metabolism.ts` (re-exported for compatibility).
`RESOURCE_CATEGORY` gains `log`/`plank`/`stone` → `material`.

## 2. Generalized haul workflow (Priority 2)

`src/sim/logistics/haul.ts` · `World.haulTasks`.

```
HaulTask { id, resource, quantity, carried, delivered,
           sourcePlaceId, destPlaceId, reason, requesterId, projectId?,
           claimantId, cargoItemId?, status, priority, createdAt, updatedAt }

status: needed → claimed → in_transit → delivered
                        ↘ failed / cancelled   (cargo stays canonical)
```

A hauling actor:

1. **learns of the task** — `pickHaulTask(world, person, pos)` only returns tasks whose source
   is within ~90 units (you do not hear of a shortage across the map), scored by
   `priority × 0.5 + roleAffinity × 0.35 + proximity × 0.15`, deterministic tiebreak by id;
2. **decides to do it** — the `haul` goal, utility `0.42 + score·0.4` (`0.68 + score·0.4` once
   it is already this actor's task, so the multi-step plan runs to completion);
3. **travels to the source** — an ordinary `goto`;
4. **loads an available amount** — `haul_load`: up to `min(remaining, stockAt(source))` moves
   from the source stack into a **real carried `Item`** (`holderId = hauler`, `haulTaskId` set,
   in the hauler's `inventory`). Partial loads are valid;
5. **physically carries it** — the cargo `Item` travels with the hauler's body;
6. **travels to the destination** — a `goto`;
7. **deposits it** — `haul_unload`: the carried stack merges into the destination Place's stock
   (owner becomes the requester institution), the cargo `Item` is retired;
8. **finishes** — `status = delivered`.

**No teleportation. No materials from nowhere.** Verified by test: `worldStock` of the resource
is identical before and after a full haul journey.

**Failure semantics** (`failHaulTask` / `maintainHauls`, Priority 18):

- *Source emptied before pickup* — `haul_load` finds nothing → the task fails cleanly, a
  `haul_failed` event fires, no cargo is created.
- *Hauler interrupted* (detained / surrendered / dead / gone) mid-journey — `maintainHauls`
  drops the carried stack as a **loose `Item` exactly where the hauler is** (a later task can
  pick it up), fails the task. The resource still exists — `worldStock` is conserved (tested).
- *Stale claim* — a claimed-but-not-progressing task older than 40 world-minutes is released
  back to `needed`.
- Resolved tasks are pruned after 90 world-minutes so `World.haulTasks` stays bounded by live
  activity, not calendar time.

## 3. Logistics need generation (Priority 4)

`generateLogisticsNeeds(world)` + `stepConstruction(world)`, run on the same ~10-world-minute
upkeep cadence as `stepMetabolism`. Needs arise from **world state**, never a named schedule:

```
consumer Place stock (+ inbound haul tasks) < trigger
        AND a supplier Place has surplus
                → one haul task, source = the supplier with the most spare stock
```

| consumer | resource | supplier | target / trigger |
|---|---|---|---|
| the mill | grain | the farm with the most grain above its 12-grain seed reserve | 55 / 36 |
| the bakery | flour | the mill | 34 / 20 |
| the market stall | bread | the bakery | 16 / 6 |
| the sawpit | log | the woodcutter's clearing (while any project needs planks) | <10 |
| a construction site | plank | the sawpit | its manifest deficit |
| a construction site | stone | the quarry | its manifest deficit |

`priority` scales with how deep the deficit is; construction needs are pinned at 0.85. Exactly
the same mechanism will serve `lumber yard needs logs`, `smith needs ore`, `army needs food`.

## 4. Physical food-chain changes (Priority 3)

`transform()` now consumes **only physically-local stock**. `mill()` / `bake()` / the new
`saw()` pass a single-element `inputPlaces` (`[millId]`, `[bakeryId]`, `[sawpitId]`) — they no
longer reach across the village. If the input has not been hauled in yet they are a **quiet
no-op** (not a "shortage" — the logistics generator already raised the haul). Village
generation now seeds the mill/bakery with only a working day's stock and the farms with grain
to be carried.

Tests prove: the mill cannot mill grain still at a farm; the bakery cannot bake flour still at
the mill; delivering the input to the mill enables production; conservation through the ratio
holds.

## 5. Resource nodes (Priorities 5, 6, 8)

`src/sim/world/resources.ts` · `World.resourceNodes`.

```
ResourceNode { id, kind: 'tree'|'stone', yield: 'log'|'stone', pos,
               blocks: {x,y,z,id}[],           // canonical voxels — a projection of state
               remaining, capacity, renewable, regrowHours,
               state: 'available'|'depleted'|'regrowing', depletedAt?, regrowAt?,
               dropPlaceId, placeId? }
```

- **Trees** — `plantGrove` lays a deterministic stand of 14 trees on flat, reachable plateau
  ground in the woodcutter's clearing (the surrounding forest's own trees sit on terrain too
  steep for the single-block-step A* to path to — a felled tree whose logs nobody can fetch
  teaches nothing). Each tree = 6 logs, 2 per chop. `regrowHours` = 30 world-days.
- **Stone** — `registerStoneNodes` lays a small stone outcrop at the north quarry: 3 nodes ×
  24 stone, 3 per gather, **non-renewable**.
- **Canonical state is authoritative, not the block.** `chop` / `gather` → `extractFromNode`
  → real `log`/`stone` items at the node's drop Place + a `resource_extracted` event. When
  `remaining` hits 0 → `depleteNode`: the node's voxels are cleared (tree → `Air`, stone →
  `Gravel`), navigation rebuilt, a `resource_depleted` history event fires. A depleted node
  **stops offering itself** (`nearestAvailableNode` skips it), so a harvester does not retry it
  every cognition tick (Priority 18). `maintainResourceNodes` regrows renewable nodes once
  `regrowAt` passes — voxels restored, `resource_regrew` event. `syncResourceNodeBlocks`
  re-projects on load.

## 6. Wood transformation (Priority 7)

`log → plank` reuses the exact `transform()` architecture: `saw(world, sawyer)`, 2 logs → 3
planks, at the sawpit, from logs physically at the sawpit, capped at 40 planks. The woodcutter's
schedule now splits: `cut timber` at the clearing 07:00–13:00 (the `chop` goal), `saw planks`
at the sawpit 13:00–17:00 (a `work` goal that runs `saw()` on the same batch cadence as the
miller/baker).

## 7. Stone (Priority 8)

Minimal by design: a stone outcrop → `gather` → `stone` items → hauled → consumed by
construction. Demand-driven — a would-be builder adopts the `gather` goal only when a project
is short of stone and none is in the pipeline (site + quarry + carried), capped at 2 concurrent
gatherers.

## 8. Construction project (Priorities 9, 10, 12)

`src/sim/world/construction.ts` · `World.constructionProjects`.

```
ConstructionProject { id, name, template, siteBounds, sitePlaceId,
                      required: {type, quantity}[], laborRequired, laborDone,
                      contributions: Record<personId, seconds>,   // the wage hook
                      status, ownerId, createdAt, startedAt?, completedAt?, resultPlaceId? }

status: gathering (waiting on materials) → ready → building → complete
                                                          ↘ cancelled
```

- **One authored project** (Constitution §67 — an authored starting condition; its
  *fulfilment* is entirely emergent): Elder Godwin wants **the village storage shed** — 16
  planks + 8 stone + 3 world-hours of labour — on a staked-out plot near the Fletcher fields.
  Its `sitePlaceId` is a real `type: 'construction'` Place created at village generation, so
  material deliveries accrue there like any Place stock.
- **The structure is NOT built on creation.** `stepConstruction` raises a haul task per
  deficient material each upkeep. When `stockAt(site, type) ≥ required` for every material →
  `ready`. Then `build` labour (a generic goal for up to 3 concurrent workers within ~120
  units of the site) accrues `laborDone` and records `contributions[workerId]`. A site with
  all its materials but **no workers does not complete** (tested — Priority 12: resource
  availability is separate from labour availability).
- On completion: the delivered materials are **consumed** (`takePlaceStock` — conservation),
  `materializeStructure` lays the shed's blocks (plank walls, stone footing, a door, a tiled
  roof, a lantern), rebuilds navigation, and **mutates the site Place into a usable `hut`**
  (indoor, with a door, an interior anchor, and a shelf work anchor). `resultPlaceId` = the
  site id. A `construction_completed` history event fires (Chronicle-eligible).

## 9. Player / NPC shared ontology (Priority 11)

Every v0.3 action is a canonical world-action, not player- or NPC-specific:
`extractFromNode`, `loadHaulCargo` / `depositHaulCargo`, `contributeBuildLabor`, `saw`,
`plantPlot` (now with seed cost). NPCs drive them through the goal/utility system
(`haul` / `chop` / `gather` / `build` in `think()`, planned in `plan()`, executed in `act()`).
The same functions are available for the player to call. No `NPC-only tree system`, no
`player-only construction system`. `grep` for any cast slug in `sim/logistics/`,
`sim/world/resources.ts`, `sim/world/construction.ts` returns nothing.

## 10. Seed cost (Priority 13)

`plantPlot` now consumes 1 `grain` from the field's own farm stock and returns `false` (no
state change, a `resource_shortage` with `reason: 'seed'`) if there is none. A farmer does not
adopt the `plant` goal without seed grain on hand (`farmSeedGrain(field) ≥ 1`). Harvests
deposit grain at the farm first, and the logistics generator only hauls grain **above** a
12-grain `FARM_SEED_RESERVE` to the mill — so a run of harvests never leaves a farm unable to
re-sow. Fields no longer produce future grain from literally zero input.

## 11. Stock spoilage (Priority 14)

`stepSpoilage(world, hours)` on the upkeep cadence. Broad durability tiers, fraction lost per
world-day: **bread / pie / meat 0.10**, **cheese 0.05**, **flour 0.015**, **grain 0.003**;
`log` / `plank` / `stone` are absent → never spoil. **Stack-level batched**: each perishable
stack accumulates fractional loss in `Item.spoilAccum` and drops whole units when it crosses 1
— no per-item-per-minute work, at most one `resource_spoiled` event per stack per pass.
Deterministic. This is the genuine reason a larder does not grow without bound.

## 12. Request foundation (Priority 16)

No traditional quest database. The `HaulTask` and `ConstructionProject` records *are* the
world-generated needs for this milestone — each carries `reason`, `requesterId`, `status`, and
a fulfiller-agnostic shape (`pickHaulTask` / `activeBuildProjects` are the "who can take this"
queries, and NPCs and the player are both potential fulfillers). The abstraction generalizes
to `"we need three more workers"`, `"I need food"`, `"find where this person went"` without
redesign, but a general `Request` entity is deferred until a second consumer needs it.

## 13. Observability (Priority 17)

- **Events** (semantic milestones only — never a per-step "walking with cargo" event):
  `haul_requested`, `haul_started`, `resource_picked_up`, `resource_delivered`, `haul_failed`,
  `resource_extracted`, `resource_depleted`, `resource_regrew`, `construction_started`,
  `construction_material_delivered`, `construction_progress`, `construction_completed`,
  `resource_spoiled`. `construction_completed` and `resource_depleted` are `category: 'history'`
  (retained through compaction); the rest are tallied in `World.runTally` so the headless
  summary reports accurate lifetime totals despite compaction. `hauled:<resource>` running
  totals are tallied on delivery.
- **Telemetry** gains `'logistics'` and `'construction'` categories.
- **Headless summary** gains a `logistics` block: haul task counts + units moved by resource,
  resource-node state (standing / felled / regrown, stone remaining), construction project
  detail (delivered vs required, labour %, worker count), and a per-Place stock table for the
  production places. `formatWorldRunSummary` prints a `Logistics:` section.
- **Anomaly detector**: naturally-bursty semantic waves (`crop_matured`, `resource_delivered`,
  `resource_extracted`, spoilage, …) are excluded from the `event_spam` check — a field
  ripening together is a wave of real activity, not a stuck loop.

## 14. Persistence (Priority 19)

`SAVE_VERSION` bumped **5 → 6**. New canonical state that depends on simulation history and
cannot be re-derived from present state:

| state | why persisted |
|---|---|
| `World.haulTasks` | a haul in transit / cargo that is at no Place cannot be reconstructed |
| `World.resourceNodes` | tree/stone depletion + regrowth timing is history |
| `World.constructionProjects` | a half-supplied project, `laborDone`, per-worker `contributions` |
| `Item.haulTaskId`, `Item.spoilAccum` | round-trip with the item (`{...i}`) |

Materials/logs/planks/stone are ordinary items and already round-trip. Chopped/built voxels
round-trip via grid diffs, but node/project state is **authoritative** and re-projected on
load (`syncResourceNodeBlocks`; `materializeStructure` for any `complete` project — village
generation rebuilds its site as a bare `construction` Place, and this restores the structure's
identity). Regression-tested: a haul in transit, a depleted tree, a part-supplied project, and
a completed structure all survive `serialize`/`deserialize`; a version-5 save is rejected.

## 15. Benchmarks

Seed `918271`, headless, deterministic — every state hash below was reproduced across ≥ 2
independent runs, and a divergent seed (`424242`) produces a different hash. The v0.2.4 column
is that milestone's own documented figure (a re-run of `main`@`5fe3f38` was not repeated this
pass; the wall-clock machine is the same class).

| metric | 2-day | 4-day | 8-day | 30-day |
|---|---|---|---|---|
| wall-clock (v0.2.4 → v0.3) | 4.0s → **3.6s** | 7.8s → **7.3s** | 17.0s → **15.3s** | 103s → **101s** |
| deterministic state hash | `e395cc91` | `b7b56a4a` | `c29bcb06` | `ac5caffd` |
| population start → end | 33 → 33 | 33 → 33 | 33 → 33 | 33 → 33 |
| deaths | 0 | 0 | 0 | 0 |
| anomaly groups | 0 | 0 | 0 | **0** |
| path failures | 0 | 5 | 1 | **1** |
| crops planted / matured / harvested | 321 / 85 / 119 | 660 / 361 / 181 | 887 / 470 / 239 | 2874 / 2975 / 676 |
| resource transforms (mill+bake+saw) | 67 | 131 | 272 | 1070 |
| grain / flour / bread stock (end) | 503 / 114 / 200 | 501 / 102 / 197 | 500 / 95 / 200 | 502 / 92 / 201 |
| avg hunger / thirst | 0.43 / 0.38 | 0.28 / 0.29 | 0.38 / 0.31 | 0.36 / 0.30 |
| meals / drinks / **shortages** / spoiled | 196 / 159 / **0** / 31 | 420 / 346 / **0** / 87 | 836 / 697 / **0** / 171 | 3055 / 2513 / **0** / 659 |
| **haul tasks requested / delivered / failed** | 16 / 16 / **0** | 24 / 24 / **0** | 43 / 43 / **0** | **148 / 148 / 0** |
| units moved — grain / flour | 115 / 48 | 181 / 131 | 328 / 326 | **1144 / 1387** |
| units moved — log / plank / stone / bread | 18 / 16 / 8 / 0 | 18 / 16 / 8 / 0 | 18 / 16 / 8 / 0 | 18 / 16 / 8 / 22 |
| tree/stone extractions · trees felled | 13 · 3 | 25 · 7 | 44 · 13 | 45 · 14 |
| trees regrown | 0 | 0 | 0 | 0 (regrow = 30 world-days) |
| **construction projects complete** | **1 / 1** | **1 / 1** | **1 / 1** | **1 / 1** |
| violent incidents / robberies | 16 / 1 | 26 / 1 | 42 / 3 | 195 / 8 |

**Resource conservation checks** (`worldStock` before vs after, from the test suite): every haul
journey conserves the resource exactly; `takePlaceStock` over-draw never goes negative and
never deletes an entity; an interrupted haul's cargo is conserved as a dropped `Item`;
construction consumes exactly its manifest; spoilage removes only whole units it accounts for.

**Wood/stone haul volume is flat across durations** because the one seeded project completes on
day 1–2 (18 log → 16 plank → 8 stone is its entire demand), after which there is no construction
pull for timber or stone. Grain/flour scale with time as the food chain runs continuously.

**Checked against the failure modes the brief names:**
- *One failing logistics job deadlocks the world* — **no.** 0 failed haul tasks at seed 918271;
  the interrupted-hauler and source-dry cases are unit-tested to fail cleanly and drop cargo
  canonically; `maintainHauls` re-queues released claims.
- *Workers retry an exhausted node every tick* — **no.** A depleted node stops appearing in
  `nearestAvailableNode`; the woodcutter simply has no `chop` goal once the grove is stumps.
  Path failures stay at 0–5 across all durations (vs a v0.2.1-era 400–565 in a single window).
- *Event storms while hauling* — **no.** No per-step "walking" event; `resource_picked_up` /
  `_delivered` fire once each per leg; 30-day anomalies = 0.
- *Infinite food accumulation* — **no.** Bread stays ~200 (cap + spoilage of 659 units over 30
  days); grain ~500.
- *Village can't reproduce crops after seed cost* — **no.** 2874 plantings over 30 days; the
  farm seed reserve is never exhausted.

A first pass surfaced a `surrender_or_custody_ignored` finding at 2 days — traced to a false
positive in the detector itself (it compared an already-landed `attack` event against the
victim's *current* surrender state, which a same-tick yield by a different attacker flips
retroactively). The check now requires the held state to have **predated** the blow
(`surrender.at < e.tick`); all four durations are clean.

## 16. Tests

**180 deterministic tests pass** (v0.2.4 baseline: 158; +22). `npm run typecheck` clean.
`npm run build` (tsc + vite production build) **succeeds**.

`tests/living-world-logistics.test.ts` (22): place-stock accounting + ownership/location
separation; deterministic `takePlaceStock` drain + conservation; haul pickup/carry/deposit
conservation through a physical journey; source-emptied-before-pickup failure;
interrupted-hauler cargo drop + conservation; a full-sim NPC delivering grain to the mill;
mill/bakery cannot use remote stock + delivery enables production; tree → log → deplete →
voxel removal → 30-day regrow; depleted node stops offering itself (no retry); stone gathering
+ conservation; the player chopping a tree through the same `extractResourceAt` path an NPC
uses; log → plank; construction not built on creation; materials → ready → labour →
canonical structure + per-worker `contributions`; seed cost + harvest replenishment; batched
spoilage (bread vs grain, ≤ 1 event/stack/pass, materials never spoil); SAVE_VERSION 6
round-trip; a 12-day no-player integration test of the whole tree→shed causal chain.

Two v0.2.4 crop-lifecycle tests were updated (not weakened) to seed grain at the test farm,
since `plantPlot` now legitimately requires seed — same as v0.2.3 arming the robbery-test
bandit when combat resolution changed.

## 17. Remaining bottlenecks / limitations

- **The one project completes too fast to feel like a saga.** 3 builders finish 3 world-hours
  of labour inside a day once materials arrive; the shed is up by day 1–2 of a 30-day run.
  Correct causally, anticlimactic narratively. A larger `laborRequired`, a `MAX_BUILDERS` of 2,
  or several staged projects would spread it out.
- **Haul selection is a bounded per-person scan.** `pickHaulTask` walks `world.haulTasks`
  (pruned to ≲ 40) for every `canHaul` person every think tick. Fine at 33 people / dozens of
  tasks; at settlement scale this wants a spatial task index. Same carried-forward note as
  `World.entities`/`byKind` (v0.2.2 HIGH risk) — not exercised yet.
- **One crop, one structure template, one project, one grove, one quarry.** The shapes
  (`HaulTask`, `ResourceNode`, `ConstructionProject`, `transform`) are generic; the *content*
  is a single instance of each. `lumber yard needs logs`, `smith needs ore`,
  `construction site needs stone for a wall` all reuse the same code with new rows.
- **No wages.** `ConstructionProject.contributions` and `HaulTask.requesterId` are recorded but
  nothing pays anyone. Labour → wages → wealth → price is the next milestone's job; the hooks
  are in place (Priority 12).
- **Trees regrow but the grove is finite.** 14 trees, 30-day regrow — a 30-day run fells all of
  them and none regrow within the window. A longer run would see the cycle; a real forestry
  system (planting saplings, rotation) is out of scope.
- **Grain piles up at farms.** Harvests deposit grain at the farm; the mill only pulls ~40 at a
  time above the seed reserve, so farm grain climbs to ~150 before `GRAIN_CAP` throttles
  harvesting. Realistic as "farm surplus", but a farm-level cap or a granary Place would be
  tidier.
- **Spoilage resets the clock on replenishment.** `spoilAccum` is per-stack and a fresh
  delivery merges into the stack without aging it — slightly generous. Per-batch aging needs
  either multiple stacks per Place or a weighted-age field.

## 18. Constitutional review

| invariant | effect |
|---|---|
| **I — Simulation authority** | **strengthened.** Stock, haul cargo, resource nodes, and construction projects are canonical (`World.*` + items); the renderer projects them. A block edit cannot change what a node or a project *is*; `syncResourceNodeBlocks` / `materializeStructure` make canonical state win on load. |
| **II — Player non-centrality** | **strengthened.** The entire tree→log→plank→haul→build→structure loop, and the spatial food chain, run with **no player present** (verified headless, 2–30 days). The player calls the same `extractFromNode` / `loadHaulCargo` / `contributeBuildLabor` APIs. |
| **VI — Shared ontology** | **strengthened.** `haul` / `chop` / `gather` / `build` are canonical world-actions; `grep` for a cast slug in `sim/logistics/`, `sim/world/resources.ts`, `sim/world/construction.ts` returns nothing. |
| **VII — Causality** | **strengthened.** *No materials from nowhere:* `transform` consumes only local stock, seed grain is consumed to sow, `worldStock` is conserved through every haul (tested), spoilage removes real units. *No teleported transport:* a haul is `goto → load → goto → unload`, cargo is a real carried `Item`, an interrupted haul drops it canonically. *No structures from nowhere:* the shed's blocks are laid only after 16 planks + 8 stone physically arrive and 3 world-hours of labour are done. |
| **VIII — Emergence over scripting** | **preserved.** No NPC is named in any logistics/construction mechanic. Needs arise from `supply < demand` comparisons; haulers are chosen by role affinity + proximity + urgency; the one authored project is an authored *starting condition* whose fulfilment is entirely emergent (a `grep` of `sim/world/construction.ts` for cast slugs is empty). |
| **XII — Historical continuity** | **preserved.** Node/project/haul state persists; the deterministic replay hash is stable across runs; `construction_completed` and `resource_depleted` survive compaction as history. |

## 19. Final acceptance

> A resource must actually be where it is needed before someone can use it.

**True.** The mill cannot mill grain still at a farm; the bakery cannot bake flour still at the
mill; the shed's blocks are not laid until its planks and stone have physically arrived — all
proven by test, and demonstrated over 8–30 headless days at seed 918271.

> NPC labour can extract, move, transform, and consume material resources to permanently alter
> canonical world state.

**True.** Over 8 world-days with no player: 13 trees felled (their voxels gone), their logs
carried to the sawpit and cut into planks, those planks and quarried stone carried the length
of the village, and three villagers' build labour turned the staked-out plot into a persistent
`hut` that survives save/load and appears in the voxel client.

> The defining demo is understandable simply by watching the world: a tree disappears → a
> person carries its material away → another workplace transforms it → materials accumulate at
> a building site → people work there → a new persistent structure exists.

**True** (browser-verified — see §15).

## 20. Is Torn Veil ready for the next Living World milestone (emergent requests, economy, richer cognition, conversational NPCs)?

## YES, WITH SPECIFIC CONSTRAINTS

**Evidence:** the material substrate the next milestone needs now exists and is proven.
Resources are physical (a place-keyed `Item`), needs are world-generated (`supply < demand`),
transport is real labour (`goto → load → carry → unload`, conserved, fails cleanly), extraction
and transformation permanently alter canonical state (13–14 trees felled per run, their voxels
gone), and a construction project turned hauled materials + recorded per-worker labour into a
persistent `hut` — all with no player, deterministically, at 2/4/8/30 world-days, with 0
shortages, 0 unresolved logistics jobs, and ≤ 5 path failures.

**Constraints for the next milestone:**

1. **Wire `contributions` / `requesterId` to a wealth transfer before anything price-related.**
   The hooks exist but pay nothing; a wage loop is the load-bearing piece that turns "the mill
   is short of grain" into "grain costs more" into the Constitution's scarcity → theft →
   unrest cascade.
2. **Generalize `HaulTask` + `ConstructionProject` into the shared `Request` abstraction now,
   with a second consumer** (e.g. "the smith needs ore", "the watch needs a lookout built"),
   before the ad-hoc `pickHaulTask` / `activeBuildProjects` queries multiply.
3. **A spatial task index** if entity/settlement count grows — `pickHaulTask` and the
   per-person goal scans are the first thing that will bite at scale, alongside the still-unfixed
   `World.entities`/`byKind` full-scan (v0.2.2 HIGH risk, still not exercised).
4. **More content per shape**: a second crop, 2–3 construction templates, staged projects, so
   the economy has something to actually be an economy *about*. The mechanics are ready; they
   are currently demonstrating themselves on a single instance of each.

The world can now move material through space by labour and change permanently as a result.
Build the economy on it.
