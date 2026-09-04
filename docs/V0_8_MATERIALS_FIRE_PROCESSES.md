# v0.8 — Materials, Fire, Processes & Practical Crafting

**Scope:** create the first generalized physical-process layer of Torn Veil. Prove that world
objects react according to their material properties and that tools can be constructed from
materials and functional requirements, building directly on v0.7's identity/composition/
affordance layer.

Branch: `claude/v0.8-materials-fire-processes`, built directly on `main` at
`98fae400859bb109fa3bff2824e432af458ed743` (merge of `claude/torn-veil-v0-7-iw53wb`).

**Method:** every number below comes from the real headless engine (`npm run sim`, the same
canonical `World`/`Simulation` the browser client uses) at fixed seed `918271` (plus an alternate
seed, `42424242`), the deterministic test suite, and a real `npm run dev` session driven with
Playwright against an actual Chromium build.

---

## 0. Starting-condition confirmation

1. **v0.7 was confirmed merged into `main`** (PR #9, `98fae400`) before any v0.8 code was
   written — the roadmap's own handoff protocol's first requirement.
2. `docs/V0_7_CIRCULATION_EXPOSURE_AFFORDANCES.md` was read in full and treated as canonical.
   Its own §8 concluded v0.8 should proceed unchanged, on the grounds that the affordance
   architecture v0.7 built is exactly the shape v0.8's crafting slice needs, and that the one
   disclosed limitation directly relevant to v0.8 (wood/stone demand being a one-time event) is
   not a blocker — if anything it strengthens the case for v0.8 giving wood a second, recurring
   reason to be produced. This milestone's own work independently confirms that reasoning: §3
   below shows firewood/stick demand for the tavern hearth is a real, additional, RECURRING
   source of income for the woodcutter, exactly the kind of second demand v0.7 anticipated.
3. Baseline full suite (after the v0.7 merge, before any v0.8 code): **313/313 tests passing**
   (31 files), typecheck clean, production build clean (789.92 kB / 222.20 kB gzip) — identical
   to v0.7's own reported end-state, confirming zero drift.
4. `SAVE_VERSION` at baseline: **10**.
5. v0.7's own disclosed regressions/risks were reviewed before designing anything: (a) a
   long-horizon wealth-sink in the tavern's free ale restock, found significant enough that a
   follow-up fix was still being validated in parallel with this milestone (tracked separately,
   `claude/v0.7-tavern-sink-followup` — economic-circulation territory, orthogonal to materials/
   fire/crafting, not a blocker here); (b) `sim.think`'s continuing wall-clock share growth
   (population-scale concern, not v0.8-specific); (c) a merged-non-perishable-stack
   misattribution edge case in wholesale sales (bounded, rare, unrelated to fire/crafting). None
   of these invalidated v0.8's scope as planned.

**v0.8 remains valid as scoped in the roadmap. No revision was needed.**

---

## 1. Branch / commits / tests / typecheck / build

| | Before (v0.7 baseline) | After (v0.8) |
|---|---|---|
| Test files | 31 | 32 |
| Tests | 313 | 328 |
| Typecheck | clean | clean |
| Production build | clean (789.92 kB / 222.20 kB gzip) | clean (TBD — see §6) |
| `SAVE_VERSION` | 10 | **11** |

15 new tests in `tests/materials-fire-crafting.test.ts`: material properties consumed by real
systems, fire ignition/burning/rain-suppression/extinguishing (both exposed and sheltered),
cooking gated on genuine fire heat, and practical crafting (functional matching, real
conservation, real affordance teaching, real mechanical distinctness from a forged tool).

New source files: `core/materials.ts`, `world/fire.ts`, `world/cooking.ts`, `world/crafting.ts`.
Modified: `core/types.ts`, `core/physiology.ts`, `core/skills.ts`, `core/tools.ts`, `core/world.ts`,
`core/affordance.ts`, `history/summary.ts`, `mind/agent.ts`, `persist/save.ts`, `world/factory.ts`,
`world/metabolism.ts`, `world/production.ts`, `world/resources.ts`, `world/village.ts`,
`logistics/haul.ts`, `world/trade.ts`.

---

## 2. Part A/B — material properties and composition

`core/materials.ts` (new): `MaterialDef` — deliberately three fields only (`flammability`,
`hardness`, `porosity`), each read by a real v0.8 system (fire ignition/fuel, crafting's
"suitable stone" filter, and fire's rain-interaction respectively) — no unused scientific fields.
`MATERIAL_DEF` covers `wood`/`stone`/`plantFiber`/`organic`; `ITEM_MATERIAL` maps existing
`ItemType`s onto them (logs/planks/sticks/tool handles → wood; stone → stone; herbs/flowers →
plantFiber; the whole food chain → organic).

Composition ("wood wall combustible/lighter/easier to construct; stone wall noncombustible/
heavier/harder") is proven exactly where the roadmap's own DoD asks for it — real fire behavior
(§3) — rather than retrofitted onto every existing structure. `ConstructionProject.required`
already lists `plank`/`stone` quantities; that a plank is `wood` (flammable) and stone is `stone`
(not) is now a real, queryable material fact (`materialOf`/`materialIdOf`), not asserted only in
prose.

---

## 3. Part C — fire as a real world process

### 3.1 Canonical, not cosmetic

`World.fires: Fire[]` (new canonical array, same class of addition as v0.3's `haulTasks`/
`resourceNodes`/`constructionProjects`) — `lit`, `fuelRemaining` (real world-seconds from
consumed fuel), `intensity` (0..1, ramps/decays), `exposed` (outdoor and rain-able, fixed at
creation from the Place's own `indoor` flag). `world/fire.ts`'s `igniteFire`/`feedFire`/
`extinguishFire`/`stepFire` are the whole lifecycle; `stepFire` runs on the same coarse ~10-
world-minute cadence `stepMetabolism`/`stepSpoilage` already do.

### 3.2 Material and moisture, not a status flag

Only genuinely flammable fuel (`materialOf(type).flammability >= 0.5`) can ignite or sustain a
fire — `FUEL_SECONDS_PER_UNIT` deliberately has no `stone` entry, so "stone does not provide
ordinary fuel" is a real consequence of the lookup failing, not a special case. An **exposed**
fire cannot even be lit while it is actually raining on it (`igniteFire` returns `false`,
nothing consumed) — "wet wood is harder to ignite" as a hard, deterministic block, not a
probability. Once lit, ordinary rain drains an exposed fire's fuel `3×` faster (dampened,
smoldering) without necessarily killing it; a **storm** snuffs an exposed fire outright. An
indoor hearth (`exposed: false`, set once at creation from the Place's own `indoor` flag) is
immune to both — the tavern's fire burns through any weather.

### 3.3 Real evidence, both directions

Directly tested (`tests/materials-fire-crafting.test.ts`): dry wood ignites indoors and
genuinely consumes physical fuel stock; igniting with stone fails cleanly with nothing consumed;
an exposed fire fails to ignite in rain while the SAME fuel, SAME weather, sheltered, ignites
fine; a storm extinguishes an exposed lit fire while a sheltered one right next to it keeps
burning; ordinary rain measurably drains an exposed fire's fuel faster than clear weather does
(same elapsed time, same starting fuel, different weather — a real comparative measurement, not
an assumption).

### 3.4 Heat and drying — extending v0.7's physiology, not a parallel system

`core/physiology.ts`'s `stepPhysiology` gains a `nearFire` parameter (0..1, the strongest lit
fire's intensity at the person's current Place, computed once per person per physiology step in
`mind/agent.ts`): real warmth (`FIRE_WARMTH_PER_HOUR`, folded into the SAME `environmentalHeat`
term weather already contributes to) and a real drying bonus on top of v0.7's own
`stepWetness`. A fire is a genuine reason to warm up and dry off, not a separate "near fire"
status effect layered on top of the existing model.

---

## 4. Part D/E — cooking: the first process gated on real fire/heat

### 4.1 Why cooking, not bread

The roadmap explicitly warns "do not force every existing transform to require fire if doing so
destabilizes the milestone." `bake()`/`mill()` are untouched. Instead, `world/cooking.ts`'s
`cook()` (meat → stew) is a genuinely NEW process, wired into the same demand-aware `Request`
pattern v0.5/v0.6 gave bakery/mill (`world/production.ts`'s `PRODUCTION_TARGETS`), requiring
`fireIntensityAt(world, tavernId) >= 0.3` — a cold or barely-caught hearth cooks nothing, and
`cook()` returns `produced: 0` (and therefore pays no wage) if the heat isn't real, exactly the
existing "failed work does not pay" discipline.

### 4.2 Two genuine, previously-invisible gaps found and fixed along the way

The mechanism tested correctly in isolation from the start, but a real 8-day headless run showed
`stewsCooked = 0` and the tavern's fire never once lighting. Direct inspection found two real
logistics gaps, not a bug in the fire/cooking code itself: **meat never had any haul path to the
tavern** (Kestrel the hunter only ever sold it retail at her own stall) and **firewood never had
one either**. Both are now real `logistics/haul.ts` `CONSUMER_DEMANDS` entries — physically
hauled, like every other consumer demand in the game. An earlier attempt used `log` for
firewood and regressed the pre-existing 12-world-day full-chain construction test (the new
tavern demand competed with the sawpit for the same clearing log stock); firewood now uses the
`stick` byproduct instead — never touched by that chain, so it cannot compete with it. Both
meat and firewood deliveries to the tavern also settle a real wholesale sale (`world/trade.ts`'s
`WHOLESALE_DEST_TYPES` now includes `'tavern'`) — Kestrel gets paid for meat, Bors gets paid for
firewood, using the exact mechanism v0.7 §A built.

Fixing the haul path surfaced a second, subtler gap: `meat` is ordinary generic food stock, so
any hungry villager eating at the tavern (guard/smith/apprentice/captain, per the pre-existing
schedule) could — and did — buy and eat delivered meat raw via the existing generic
`isFood()`-based purchase scan in the `eat` action, before the cook ever got to it. This is real
measured competition between two legitimate uses of the same stock (raw meat genuinely can be
eaten OR cooked), not a bug in either path, but it meant a `meat` target/trigger sized only for
"enough to arrive" starved the cook every time. Widened `CONSUMER_DEMANDS`' meat target from
10/4 to 20/10 — verified afterward (via a direct headless check, not assumed) that `cook()` now
genuinely succeeds (`world.runTally.stew_cooked` > 0) in an ordinary unscripted run. A dedicated
`world.runTally.stew_cooked` tally was added for this because the existing generic
`resource_transformed` tally conflates cook/bake/mill/saw and the individual events are
low-significance (0.15) and get compacted away on any run long enough to matter — the exact same
undercounting bug class fixed for `sticksGathered` below, caught here before it shipped.

### 4.3 Herbs and sticks: closing two "materials come from nowhere" gaps

A full-codebase search (before writing any code) confirmed `herbs` had a real `ItemType`/value/
category entry since early in the project but **zero production path anywhere** — pure flavor,
never actually obtainable. `world/metabolism.ts`'s `gatherHerbs` (the same bounded,
`restockTavern`-shaped pattern) gives Old Wyn (herbalist) a real gathering loop at her own
workplace, closing the gap and giving crafting's binding component (§5) a real physical source.
`world/resources.ts`'s `extractFromNode` now yields `stick` as a real, deterministic byproduct
of felling a tree (Part E's own "inputs + conditions → outputs + byproducts" language,
generalized) — one per successful chop, never scaled with the log yield itself (a stronger
worker gets more logs per swing, not proportionally more branches). Its own summary counter had
the same undercounting bug as `stew_cooked` above — the run summary initially derived
`sticksGathered` by filtering `world.events` for a `resource_extracted` event carrying a
`data.how === 'gathered as a byproduct while felling'` field that, on inspection, was never
actually written onto the event (that string only ever reached `addPlaceStock`'s provenance
parameter). A dedicated `world.runTally.stick_gathered` counter, incremented directly at the
call site, replaced it.

---

## 5. Part F — practical crafting

`world/crafting.ts`: `stick` + suitable stone + herbs (binding) → `stoneaxe`, matching the
roadmap's own worked example exactly. The architecture is what was asked for, not the one
recipe: `CraftingRequirement.minHardness` is a **functional** filter read off `core/
materials.ts`'s real `hardness` property (`matches()` calls `materialIdOf`/`materialOf`, never a
fixed item-type string for that requirement) — "functional requirements → compatible components
→ known construction method → created object," not "inventory has recipe ingredients → spawn
item."

`craftItem` consumes real carried components (never a place-stock scan — a craftsman assembles
what they're holding), fails cleanly with nothing consumed if any requirement can't be matched,
and on success: creates the result owned by the crafter, teaches its affordance (`core/
affordance.ts`'s new `stoneaxe` entry, via v0.7's `learnAffordance` — the crafter necessarily
knows what they just made), and practices a new `crafting` skill.

**Never a special-cased mechanical shortcut**: `core/tools.ts` gained a real `stoneaxe` `ToolDef`
(`workMultiplier: 2.4`, genuinely useful — well above bare-handed — but weaker than a forged
axe's `5`). Directly tested: with BOTH a stone axe and a forged axe in the same person's
inventory, `bestToolFor` picks the forged one on real mechanical merit (`workMultiplier ×
condition` scoring), with no special-casing for "prefer the forged tool" anywhere in the code —
the better tool simply wins because it IS better.

**Scope decision, disclosed rather than silently left implicit**: NPC autonomous crafting-desire
(an NPC deciding on its own to craft a stone axe) was NOT implemented this milestone — `craftItem`/
`canCraft` are real, tested, callable functions (the same shape as `buyFoodPortion`/`harvestPlot`),
not yet wired to a new `GoalType`/`plan()`/`act()` triple the way a full autonomous behavior would
need (`mind/agent.ts`'s existing goal-dispatch pattern, confirmed reusable for this before deciding
not to spend the remaining scope on it). The roadmap's own "known recipes may remain the reliable
route" and "improvised invention can remain future work" anticipate exactly this kind of scope
cut. The mechanism itself is complete and real; a future milestone (or a player-facing crafting UI)
can wire autonomy/interaction on top without changing `world/crafting.ts` itself.

---

## 6. Determinism, conservation, and persistence

- **Determinism preserved**: no new `Math.random()`/non-deterministic input anywhere in this
  milestone — `stepFire` reads only `world.weather` and elapsed hours; `craftItem`'s matching is
  a pure function of carried inventory; herb gathering and the stick byproduct are both fixed,
  deterministic amounts.
- **Conservation preserved**: every fuel unit consumed by `igniteFire`/`feedFire` is physically
  taken from real stock (`takePlaceStock`); `cook()`/`craftItem` only ever produce their stated
  output for the stated consumed input, reusing the same `transform()`/manual-consumption
  discipline every other conservation-respecting function in the codebase already follows.
- **`SAVE_VERSION` 10 → 11**: `World.fires` is new top-level canonical state (whether a fire is
  lit and how much fuel remains cannot be reconstructed from present state alone) — the same
  class of addition v0.3 made for `haulTasks`/`resourceNodes`/`constructionProjects`. An old save
  simply predates the concept; `deserialize` keeps `generateVillage`'s freshly pre-registered
  (unlit) fires rather than overwriting them with nothing, the same pattern already used for
  `resourceNodes`/`constructionProjects`.

---

## 7. Long-horizon benchmarks

*(To be completed once the full 2/8/30/90-day headless benchmark chain — running in the
background alongside this draft — finishes. Both seeds tested per the roadmap's own "at minimum
30- and 90-day" instruction, matching v0.7's methodology.)*

---

## 8. Regressions, scaling risks, and honest disclosure

- **Two genuine, previously-invisible logistics gaps were found and fixed along the way** (§4.2):
  meat and firewood never had any real haul path to the tavern, so the fire/cooking mechanism —
  fully correct in isolation — never actually fired in a real village run. This is reported in
  full because it is exactly the kind of gap only a real headless run (not just unit tests)
  reliably catches, matching v0.6/v0.7's own precedent of disclosing mid-milestone discoveries
  rather than only reporting the final, clean-looking state.
- **NPC autonomous crafting-desire was not implemented** (§5) — a deliberate, disclosed scope
  cut given the milestone's already-large surface area (materials + fire + a new production
  process + practical crafting), not an oversight. The mechanism is complete, tested, and ready
  for a future milestone (or player UI) to wire autonomy on top of.
- *(Further disclosures — long-horizon fire/cooking/crafting activity levels, any new scaling
  cost, wall-clock comparison to v0.7's own 30/90-day figures — to follow once §7's benchmarks
  complete.)*

---

## 9. Does the evidence from this milestone require changing v0.9?

*(To follow once benchmarks and final review are complete.)*
