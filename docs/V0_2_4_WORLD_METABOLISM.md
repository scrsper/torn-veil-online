# v0.2.4 — World Metabolism Foundation

**Scope:** a focused vertical slice on top of v0.2.3 Social & Conflict Resolution
(`main` at `bb7eeb2` at the start of this pass). Branch:
`claude/v0.2.4-world-metabolism`. This is **not** the whole ecology/economy/
construction vision — it is the smallest *complete* example of a world that
materially changes through time and entity actions.

**Method:** every number below was produced by running the real headless engine
(`npm run sim`, the same canonical `World`/`Simulation`/village generation the
browser client uses) at fixed seed `918271`, plus the deterministic test suite,
plus a real browser smoke test of the voxel client.

---

## 1. The problem the playtest exposed

The v0.2.3 playtest confirmed NPCs move, talk, witness crimes, and resolve
conflicts convincingly — but **the environment itself was static**. Wheat blocks
were decoration. Rain was a visual effect. Farmers played a farming *animation*.
Food "production" did not consume or produce anything. There was no thirst.

## 2. The vertical slice — now real and canonical

```
weather → soil moisture → crop growth → mature wheat → harvest → grain
        → mill → flour → bake → bread → eat → hunger down
water source → drink → thirst down
```

Every arrow is a canonical simulation mechanic (not a visual script, not a
random flavour event, not player-only). NPCs and the player operate through the
same world-action APIs (`harvestPlot`, `plantPlot`, `mill`, `bake`, `eatFood`,
`buyFoodPortion`, `drinkAt`).

---

## 3. Needs

`Needs` gains **`thirst`** (alongside the existing `hunger`; `energy`, `social`,
`comfort` unchanged — no ten survival bars).

| | rises | satisfied by | unmet |
|---|---|---|---|
| **hunger** | `+h/14` per world-hour (≈ full in 14h) | eating a real food item (`eat` action → `eatFood`) | pressure only — `eat` keeps outcompeting other goals; **not lethal** |
| **thirst** | `+h/11` per world-hour, ×1.2 under clear sky, ×0.8 under rain, ×0.3 asleep | drinking at a canonical water Place (`drink_water` goal → `drink` action → `drinkAt`) | pressure only — **not lethal** |

Both drive utility/goal selection, are deterministic, and persist
(`p.needs` already round-trips). `Mind.noFoodUntil` throttles a genuine food
shortage so the event log doesn't fill with retry spam — hunger still rises.

## 4. Resources

- `ItemType` gains `grain` and `flour` (`bread` already existed).
- `RESOURCE_CATEGORY: Record<ItemType, ResourceCategory>` in `factory.ts` —
  `food | material | crop_yield | tool | valuable | misc` — so production /
  consumption logic reasons about "is this food" without a per-type `switch`.
- Grain / flour / bread stock are **ordinary `Item` entities** with `quantity`,
  `ownerId`, `placeId` — reusing the existing item system, no new database.
- `transform(world, { inputType, inputQty, inputPlaces, outputType, outputQty,
  outputPlace, ... })` — a generic conservation-respecting transformation.
  This is the shape `tree→log→plank`, `ore→ingot`, `hide→leather` reuse later
  without redesign.

## 5. Crop lifecycle (`World.fields`, `src/sim/world/metabolism.ts`)

One `Field` per farm `Place` (4 at Ashford Vale), each carrying:

```
Field  { id, placeId, ownerId, soilMoisture (0..1), plots: CropPlot[] }
CropPlot { x, y, z, crop:'wheat', state, growth (0..1), plantedAt, maturedAt?, harvestedAt?, lastYield? }
CropState = fallow | planted | growing | mature | harvested
```

- Plots are read from the farm's already-generated Farmland cells at village
  generation (`createFields`). ~1280 plots across the 4 fields.
- **Canonical state is authoritative, not the block.** The renderer projects
  each plot's state onto one of three blocks: `Air` (fallow / planted /
  harvested), a new `Sprout` block (growing — green, short), `Wheat` (mature —
  golden). `syncFieldBlocks` re-projects on load.
- Growth advances through **world time** in `stepMetabolism` (called on a
  ~10-world-minute cadence from `strategic()`), at
  `growth += (hours / MATURE_HOURS) × moistureGrowthFactor(soilMoisture)`.
  `MATURE_HOURS = 120` (5 world-days) at full moisture; a dry field takes
  proportionally longer.
- Transitions: `planted` (< 0.15 growth) → `growing` → `mature` (≥ 1, emits
  `crop_matured`). A `harvested` plot → `fallow` after `REGROW_HOURS` (1 day).
  A `mature` plot left standing > `SPOIL_HOURS` (6 days) lodges and reverts to
  `fallow` — so fields keep cycling once the granary is full rather than
  freezing every plot at `mature`.

## 6. Soil moisture + weather

`stepMetabolism` moves each field's `soilMoisture` by
`(wetting − drying) × hours`, clamped 0..1:

- **rain / storm** → `+ intensity × 0.11` per hour (a few hours of rain fills it)
- **clear** → `− 0.035` per hour (a multi-day clear spell drops it ~0.8)
- **cloudy** → `− 0.021`, **fog** → `− 0.010`

`moistureGrowthFactor(m)`: ~0.05 bone-dry, ramps to ~1.0 by `m ≈ 0.45`, a mild
waterlogging penalty (0.85) above 0.9. No per-voxel hydrology — one number per
field. **Weather now materially changes canonical reality:** the seed-918271
2-day run starts in a dry spell (soil `0.07`, visibly slowed growth); the 8-day
run is wet (soil `1.00`).

## 7. Farmer actions

The farmer's schedule `work`-at-a-field entry now dispatches to a canonical
goal:

- `harvest` (utility ~0.7) when the field has a `mature` plot **and** the
  village grain stock is below `GRAIN_CAP` — `harvestPlot` sets the plot
  `harvested`, produces `GRAIN_PER_PLOT_BASE + 0..3` real grain items at the
  farm owned by the field owner, emits `crop_harvested`. **A plot cannot be
  harvested twice** — it must regrow.
- `plant` (utility ~0.58) when the field has a `fallow` plot and it is not
  raining — `plantPlot` sets the plot `planted`, emits `crop_planted`.

## 8. Food production chain

| producer | action | ratio | source | output | cap |
|---|---|---|---|---|---|
| miller | `mill()` — one batch per ~8 work-minutes | 3 grain → 4 flour | mill + every farm | flour at the mill | `FLOUR_CAP` 120 |
| baker | `bake()` — one batch per ~8 work-minutes | 2 flour → 5 bread | bakery + mill | bread at the bakery | `BREAD_CAP` 200 |

Conservation is enforced by `transform` — if the input is not available,
**nothing is consumed or produced** and a `resource_shortage` fires (no bread
from nothing). Production is **demand-driven**: `mill`/`bake` do nothing once
the village stock is at its cap, and resume when it falls. Transport between
farm → mill → bakery is abstracted (the transformation reaches for its input
wherever the village has it) — no explicit haul action this pass.

## 9. Food consumption

The `eat` action consumes a **real** food item, in preference order:

1. carried food (`p.inventory`)
2. the household larder (`p.homeId` — any resident may eat a co-resident's
   larder food)
3. bought from a vendor at the current place — paid from `wealth` (most
   villagers carry no coin item), buying up to 3 units and carrying the rest
   home, so the whole village doesn't funnel to one counter every few hours.

If none of those work, `resource_shortage` (throttled) and hunger keeps rising.
Nothing is conjured from nowhere. Ashford Vale is seeded with a starting larder
in every household plus food-chain stock at the mill/bakery/market so the chain
is not cold on day 1.

## 10. Water / thirst loop

Two canonical `well`-type water `Place`s: the village well (now a real Place,
not square decoration) and a river-bank draw near the mill for the western
farms. A thirsty NPC (`thirst > 0.38`) adopts `drink_water`, paths to the
nearest one, and `drinkAt` reduces thirst by `WATER_THIRST_RESTORE` (0.85) and
emits `water_consumed`. Water is abstracted at the source — no buckets, no
plumbing, no fluid simulation.

## 11. Observability

New semantic events (transitions only — **never** a per-tick growth event):
`crop_planted`, `crop_matured`, `crop_harvested`, `resource_transformed`,
`food_consumed`, `water_consumed`, `resource_shortage`.

- `World.runTally` keeps accurate lifetime counts of these (they are
  low-significance and dropped by event compaction, so `world.events` would
  undercount).
- The headless `WorldRunSummary` gains a `metabolism` block: field count, soil
  moisture, crop-state histogram, average growth, chain activity counts, grain
  / flour / bread stock, average hunger / thirst, meals / drinks / shortages.
  `formatWorldRunSummary` prints a `Metabolism:` section.
- Telemetry records carry a new `'metabolism'` category.

## 12. Backwards-walking fix

**Root cause found:** the canonical facing convention (used by perception,
combat, and `followPath`) is `facing = (−sin yaw, −cos yaw)` — verified
self-consistent (`grep` and a renderer-independent test: a walking NPC's
canonical facing dot-product with its velocity is `+1`). The voxel mesh's
"front" (eyes, held item) is its local `+Z`, which `rotation.y = yaw` alone
points the **opposite** way. Fixed in `ActorRenderer` with `rotation.y = yaw +
Math.PI` for humanoids and chickens. **Canonical navigation is untouched.** The
same `+π` also makes third-person show the player's back rather than their
face. Browser-verified: `meshFacesAfterPI` now equals the walker's velocity
direction exactly.

## 13. Persistence

`SAVE_VERSION` bumped **4 → 5**. New canonical state that depends on simulation
history:

| state | why persisted |
|---|---|
| `World.fields` (soil moisture + every plot's lifecycle) | cannot be re-derived from present blocks; crop growth is history |
| `Needs.thirst` | already inside the persisted `p.needs` — no schema change beyond the field |

Grain / flour / bread stock are ordinary items and already round-trip. Crop
*blocks* round-trip via grid diffs, and the canonical plot state is
re-projected onto the grid on load (`syncFieldBlocks`) — authoritative if the
two ever drift. Regression-tested: fields, moisture, thirst, and stock survive
`serialize`/`deserialize`; a version-4 save is rejected.

## 14. Tests

**158 deterministic tests pass** (v0.2.3 baseline: 139; +19).
`npm run typecheck` clean. `npm run build` **succeeds**.

`tests/world-metabolism.test.ts` (19): hunger/thirst rise + determinism;
eating consumes a real item + reduces hunger; drinking reduces thirst; a
hungry NPC seeks the larder and eats (full sim); a thirsty NPC walks to the
well and drinks (full sim); thirst is not lethal; a field's plots come from its
Farmland; growth is faster in wet soil than dry; a crop reaches `mature` +
emits `crop_matured`; rain raises / dry lowers soil moisture;
`moistureGrowthFactor` shape; harvest changes state + yields grain + no
double-harvest; `transform` conserves + produces nothing without input + emits
`resource_shortage`; the mill/bakery cannot bake from an empty world; eating
never conjures food; save+reload of fields/moisture/thirst/stock;
renderer-independent facing convention; an 8-world-day integration test
asserting every link of the chain fired and nothing ran away.

## 15. Benchmarks

Seed `918271`, headless, deterministic (each hash reproduced ×2). v0.2.3 column
is a re-run of `main`@`bb7eeb2` on the same hardware.

| metric | 2-day | 4-day | 8-day | 30-day |
|---|---|---|---|---|
| wall-clock v0.2.3 → v0.2.4 | 3.1s → **4.0s** | 6.3s → **7.8s** | 14.1s → **17.0s** | 84s → **103s** |
| soil moisture (end) | **0.07 (dry spell)** | 0.83 | 1.00 (wet) | 0.89 |
| crops planted / matured / harvested | 399 / 0 / 66 | 613 / 184 / 74 | 910 / 744 / 90 | 3006 / 2756 / 193 |
| resource transforms (mill+bake) | 32 | 88 | 197 | 866 |
| grain / flour / bread stock (end) | 504 / 102 / 200 | 501 / 104 / 202 | 502 / 84 / 202 | 494 / 96 / 203 |
| avg hunger / avg thirst | 0.31 / 0.28 | 0.29 / 0.31 | 0.34 / 0.28 | 0.39 / 0.35 |
| meals / drinks / **shortages** | 206 / 179 / **0** | 414 / 338 / **0** | 837 / 681 / **0** | 3059 / 2476 / **0** |
| deaths / anomalies | 0 / 0 | 0 / 0–1 | 0 / 0 | 0 / 0 |
| population start → end | 33 → 33 | 33 → 33 | 33 → 33 | 33 → 33 |
| state hash | `f7c4f0e8` | `2722c075` | `3086535d` | `f27d1210` |

**Checked against the failure modes the brief names:**
- stocks explode infinitely — **no**, demand-driven caps hold flat over 30 days.
- everyone starves immediately — **no**, avg hunger 0.30–0.39, 0 shortages.
- everyone drinks constantly — **no**, ~2 drinks/person/day, thirst ~0.3.
- crops instantly mature — **no**, `MATURE_HOURS` = 5 world-days, moisture-scaled.
- farming loops create event storms — **no**, only semantic transitions logged;
  the earlier 47k-`resource_shortage` storm was traced to a per-think grid probe
  in `nearestWaterSource` + an un-throttled retry and fixed.

**Browser smoke test (actually performed):** the voxel client boots with no
console errors; after ~3 sim-hours it had run 240 meals, 200 drinks, 71
harvests, 188 plantings, 88 maturations, 44 transforms, 1 shortage — identical
behaviour to headless. Fields render a clear mix of golden mature wheat, green
sprout blocks, and bare tilled rows. Every walking NPC's mesh faces its
movement direction.

## 16. Limitations

- **Transport is abstracted.** Grain does not physically travel farm → mill →
  bakery; the transformation reaches for its input wherever the village holds
  it. A `haul` action is the obvious next step.
- **Planting has no seed cost.** Seed grain is assumed. Trivial to make
  `plantPlot` consume 1 grain once a `haul` step exists.
- **One crop.** Only `wheat`; pumpkins in the farm blocks are ignored. The
  `Field`/`CropPlot`/`transform` shapes are crop-generic.
- **Weather is Ashford-wide.** One weather state, one moisture delta per field —
  fields differ only in starting moisture and micro-timing, not microclimate.
- **The economy is thin.** Food purchase moves `wealth`; there is no price
  discovery, no scarcity-driven price, no wages. A prolonged crop failure would
  currently just push hunger up and stop — the motivational/economic reaction
  the Constitution wants (theft rising, unrest) is v0.3 territory.
- **No spoilage of stock.** Grain/flour/bread in a larder never rot (only
  standing wheat does).
- **Soil is the only environmental variable.** No nutrients, no crop rotation,
  no frost.

## 17. Constitutional review

| invariant | effect |
|---|---|
| I — Simulation authority | **strengthened.** Crop state, soil moisture, and resource stock are canonical (`World.fields`, items); the renderer projects them. A block edit cannot change what a plot *is*. |
| II — Player non-centrality | **preserved.** NPCs run the entire chain with no player present (30-day headless). The player eats/drinks/harvests through the same APIs. |
| VI — Shared ontology | **strengthened.** `plant` / `harvest` / `eat` / `drink` / `transform` are not player- or NPC-specific. |
| VII — Causality | **strengthened.** Rain → moisture → growth → harvest → grain → flour → bread → hunger is an explicit canonical chain with events at every transition, replacing a set of disconnected animations. |
| VIII — Emergence over scripting | **preserved.** No `wheatScript()`; a farmer harvests because `firstPlot(field, 'harvest')` is true and grain is below cap, through the generic goal/utility system. `grep` for Skarn/Vex/Alwin/Osric in `sim/world/metabolism.ts` returns nothing. |
| XII — Historical continuity | **preserved.** Field state persists; the deterministic replay hash is stable across runs. |

---

## 18. Final acceptance

> Rain in Torn Veil is no longer merely visual. It participates in a causal
> chain that can alter crop growth, food production, NPC needs, and NPC
> behaviour.

**True.** The 2-day seed-918271 run's dry spell (soil `0.07`) measurably slows
growth; the 8-day run's rain (soil `1.00`) speeds it. Farmers harvest and
plant based on canonical field state and village grain stock; the miller and
baker consume and produce real resources; hungry NPCs eat real food and get
less hungry; thirsty NPCs walk to a well.

> When a farmer harvests wheat, something in canonical reality is actually
> different afterward.

**True.** The plot goes `mature → harvested` (and its voxel block from `Wheat`
to `Air`), and 5–8 `grain` items appear in the farm's stock owned by the field
owner — a canonical, persisted, save/load-surviving change, causally linked by
a `crop_harvested` event.

---

## 19. Best expansion path into v0.3 — Living World

The single highest-leverage next step is a **generalized `haul` / carry-work
action** plus **material stockpiles as first-class place state**. That one
addition:

1. Closes the abstraction in §16 (grain physically moves farm → mill →
   bakery), making the chain fully spatial and observable.
2. Is exactly the mechanism `tree → log → lumber-yard`, `stone → mason`,
   `ore → smith` need — the `transform` helper already exists; they just need
   their inputs delivered.
3. Unlocks **construction projects** (a project is a place-bound stockpile with
   a required-materials manifest and a `build` work-action that consumes from
   it) — the path to "construction projects → structures".
4. Feeds the **economy**: hauling is labour, labour is wages, wages are the
   money loop that makes food price respond to a crop failure — turning §16's
   "hunger just goes up" into the Constitution's "theft rises, guards
   overwhelmed, political pressure" causal cascade.

Concretely, v0.3 should, roughly in order:
1. `haul` action + place stockpiles (grain/flour/log/stone) — spatialize the
   existing chain.
2. `tree → log → plank` and `stone` gathering, reusing `transform`.
3. Construction projects (material manifest + `build` action).
4. Seed-cost planting, stock spoilage, and a first pass at wages / price so a
   bad harvest propagates through the economy the way §16 currently cannot.
5. Grazing / animals (`grass → hay`, `animal → meat/hide`) once haul + stock
   are proven.

Do **not** implement v0.3 in this pass. This slice makes it much easier.
