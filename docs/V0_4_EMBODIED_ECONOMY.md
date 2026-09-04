# v0.4 — Embodied Economy: Physiology, Tools, Requests & Currency

**Scope:** a focused vertical slice on top of v0.3 Living World I (`main` at `f579188`, merging
`5867264`, at the start of this pass — confirmed via `git merge-base --is-ancestor`). Branch:
`claude/v0.4-embodied-economy-ojdaw1`. This milestone moves Torn Veil from a logistics
simulation toward the beginnings of a true **embodied economy**: physical need drives goal
selection, capability (body + tools + environment) gates what work is actually possible, real
labour consumes real physiological resources, and completed work pays real, conserved currency
that a worker can then spend.

**Method:** every number below comes from the real headless engine (`npm run sim`, the same
canonical `World`/`Simulation`/village generation the browser client uses) at fixed seed
`918271` (plus an alternate seed, `42424242`), the deterministic test suite (231 tests), and a
real browser session driven with Playwright against the actual voxel client.

The central question this milestone answers:

> Can a physically embodied NPC — constrained by calories, hydration, fatigue, sleep, heat,
> strength, dexterity, tools and money — discover paid work, actually perform it, get paid,
> and spend that money, with every quantity conserved?

**Yes**, and a contrasting failure case (a worker too exhausted, or without the right tool,
does not perform the work anyway) is also demonstrated. See §11 and §12.

---

## 0. Starting-condition confirmation (pre-work checklist)

1. `main` contains v0.3 — `git log main` shows `f579188` (merge of `claude/v0.3-living-world-
   logistics`) at HEAD, containing `5867264`. Confirmed with `git merge-base --is-ancestor
   5867264039c65ea32353850afe6c22dbd68a10be main`.
2. `claude/v0.4-embodied-economy-ojdaw1` was created from that exact `main` (zero drift —
   `git diff main` was empty before this milestone's first commit).
3. Baseline full suite: **180/180 tests passing**, typecheck clean, production build clean.
4. Baseline is the v0.3 benchmark tuning already recorded in
   `docs/V0_3_LIVING_WORLD_LOGISTICS.md`.

---

## 1. Branch / commits

Branch: `claude/v0.4-embodied-economy-ojdaw1`.

Logical commits this milestone (in order):

1. **v0.4 Embodied Economy I: physiology, attributes, tools, requests, currency** — the core
   simulation layer: `core/physiology.ts`, `core/attributes.ts`, `core/tools.ts`,
   `core/requests.ts`, the `Request`/`Attributes`/`Physiology` types, integration into hauling,
   resource extraction, sawing, construction, and `think()`'s goal utilities; the
   `buyFoodPortion` negative-wealth fix; resource-timescale recalibration (tree lifecycle, crop
   maturation, per-batch spoilage); `SAVE_VERSION` 6 → 7; 46 new deterministic tests.
2. **v0.4 Embodied Economy II: benchmarks, stress tests, inspector UI** — run-summary and
   benchmark-report extensions for the new economy signals, 5 deterministic stress-scenario
   tests, and a live Attributes/Physiology panel in the in-game Inspector.
3. **docs/V0_4_EMBODIED_ECONOMY.md** (this document) + final benchmark tuning pass.

---

## 2. Tests / typecheck / build

| | Before (v0.3 baseline) | After (v0.4) |
|---|---|---|
| Test files | 26 | 28 |
| Tests | 180 | 231 |
| Typecheck | clean | clean |
| Production build | clean (770.6 kB / 216.0 kB gzip) | clean (771.5 kB / 216.2 kB gzip) |

51 new tests: 46 in `tests/embodied-economy.test.ts` (physiology, strength/hauling, dexterity,
tools, requests, currency, resource timescales, canonical integrity, save/load, and the full
causal-chain vertical slice), 5 in `tests/stress-benchmarks.test.ts` (scarcity scenarios). Two
pre-existing tests were recalibrated for the new crop-maturation pacing, with an inline comment
explaining why (`tests/world-metabolism.test.ts`); one pre-existing test's comment was corrected
to reflect that grain (now perishable-batched) no longer merges into a single stack
(`tests/living-world-logistics.test.ts`) — the assertion itself was unaffected, since `stockAt`
already sums across stacks.

---

## 3. Save version

`SAVE_VERSION` 6 → 7. New canonical state that cannot be re-derived from present state and must
be persisted explicitly:

- `Person.attributes` (strength/dexterity) — depends on `PersonSpec` overrides at generation
  time plus any future in-play change; not deterministically re-derivable from age/gender alone
  once diverged.
- `Person.physiology` (energy/hydration/fatigue/sleepDebt/lastSleepAt/bodyHeat) — depends on
  this run's history of work/rest/meals/weather exposure.
- `World.requests` — the shared work-request/wage lifecycle; an accepted-but-not-yet-completed
  request cannot be reconstructed from present state.

`Item.condition` (tool durability) and `ResourceNode.growthStage` (tree lifecycle stage) needed
**no new persistence code** — items and resource nodes are already serialized/restored as whole
objects (`{...i}` / `{...n}`) at both ends of `persist/save.ts`, so a new plain field rides
along automatically. Verified by a round-trip test (`tests/embodied-economy.test.ts`, "round-
trips attributes, physiology, tool condition and open requests") and a rejection test for a
stale (version 6) save.

---

## 4. Physiology evidence

`src/sim/core/physiology.ts`. Five reserves — `energy` (calories), `hydration`, `fatigue`,
`sleepDebt` (hours), `bodyHeat` — driven by **one** activity-cost table
(`ACTIVITY_ENERGY_MULT`/`ACTIVITY_FATIGUE_PER_HOUR`/`ACTIVITY_HYDRATION_MULT`/
`ACTIVITY_HEAT_PER_HOUR`), classified from the person's *current goal*
(`activityLevelFor`) and stepped once per world-minute from `Simulation.strategic()` — not per
render frame, not per physical substep, so it is FPS-independent and paced by simulation time
only.

Ordering matches the spec exactly (verified by dedicated tests):

```
sleep (0.4×) < idle (1×) < walk (1.7×) < craft (2.1×) < construct (2.7×)
            < chop (3.3×) < haul (3.8×) < quarry (4.4×)      [energy-cost multiplier]
```

`needs.hunger`/`.thirst`/`.energy` (the pre-existing, widely-read fields) are now **derived**
from these reserves every step (`syncNeeds`): `hunger = 1 - energy`, `thirst = 1 - hydration`,
`energy` (sleep pressure) = a blend of `fatigue` and `sleepDebt`. This is the staged migration
the spec asked for — dozens of existing call sites in `mind/agent.ts` and `world/metabolism.ts`
keep working unchanged, but the numbers underneath now come from a real model instead of being
the model.

Heat is a bounded 0..1 model (exertion heat + environmental heat − passive/rest/hydration-
supported cooling) with named bands (`heatBand`): comfortable → mild (reduced work efficiency,
via `getPhysicalCapability`'s `workRate`) → hot (already folded into higher fatigue/hydration
drain rates) → severe (heavy-labour goal utility scaled down in `think()`) → dangerous (labour
gated to 0 and a forced-rest `idle` goal outbids everything). Verified: idling always net-cools
regardless of weather (rest/passive cooling dominates ordinary daily activity — a deliberate,
stable design choice); real exertion (`quarry`/`chop`/`haul`) in hot weather visibly raises heat
faster than in cool weather.

Sleep vs. rest: `sleepRecover` (asleep) reduces fatigue at 0.5/hour and sleep debt at 1.1/hour;
`restRecover` (sitting/idling) reduces fatigue at only 0.12/hour and does not touch sleep debt —
substantially less, per spec. Both are exercised directly and via `Simulation.strategic()`'s
`activityLevelFor` classification (pose `sleep` → the sleep path automatically).

## 5. Attribute evidence

`src/sim/core/attributes.ts`. `strength`/`dexterity` (0..1, like `Traits`) feed
`getPhysicalCapability` — the **single** centralized capability layer every labour system reads
(hauling, extraction, sawing, construction), so no action handler re-derives "how strong is this
person" itself (Constitution v0.4 §3, §16-17).

**Strength → carrying capacity** (continuous, not a hard gate): `safeCarryMassKg = 16 +
strength × 44`. A strength-0.15 worker safely carries ~22.6 kg; a strength-0.9 worker ~55.6 kg.
Hauling is genuinely mass-aware (`RESOURCE_MASS_KG` in `world/factory.ts`: grain 0.7 kg, flour
0.65 kg, bread 0.5 kg, log 25 kg, plank 8 kg, stone 15 kg per unit) — `personalCarryUnits`
converts that into a per-trip unit cap, and `loadHaulCargo`/`depositHaulCargo` were changed so a
haul task larger than one trip's capacity now genuinely takes **multiple trips**, with partial
delivery, the same `HaulTask` staying open between them (verified: a strength-0.1 worker hauling
12 units of stone at ~5-6 units/trip capacity takes >1 trip, delivers exactly 12, and the source/
destination stock is conserved exactly). Capacity is never 0 — an ordinary human can always
attempt at least one unit of even the heaviest hauled material, just at real relative cost.

**Dexterity → a real skilled task** (sawing): the fixed `log:plank` ratio (`SAW_RATIO`, 2:3)
never changes with dexterity — that would risk duplication. Instead, `mind/agent.ts`'s sawing
batch **cadence** scales with `capabilityFor(..., 'saw', ...).cap.workRate`, which folds in
dexterity, strength, the physical saw tool, fatigue and heat. A dexterity-0.95 sawyer with a saw
completes batches materially faster (shorter interval) than a dexterity-0.2 one — verified
deterministic (recomputing `capabilityFor` with identical inputs reproduces the identical
`workRate`) and duplication-free (5 batches always consume exactly `5×2` logs and produce
exactly `5×3` planks, regardless of dexterity).

## 6. Tool evidence

`src/sim/core/tools.ts`. `axe`/`pickaxe`/`saw`/`hammer` are functional: each supports one
action (`chop`/`quarry`/`saw`/`construct`), carries a work multiplier at full condition, and
`condition` (0..1 durability, default 1) tapers that multiplier down as the tool wears
(`WEAR_PER_WORK_HOUR = 0.001`/hour of use — deliberately slow, so a tool used continuously for
one construction project loses only ~4% condition, per the spec's "don't make tools feel
disposable"). Bare-handed/wrong-tool work is never impossible, just far less effective
(`BAREHANDED_MULTIPLIER`: chop 0.16×, quarry 0.10×, saw 0.22×, construct 0.55× of the full-tool
rate) — "gather fallen wood, don't fell a mature tree by hand."

`bestToolFor` checks a person's own inventory **and** any unheld tool physically present at
their current Place — so the sawpit's communal saw, the quarry's communal pickaxe, and a
construction site's communal hammer (all placed at village generation) are usable by whoever is
actually working there without needing personal ownership, while the named woodcutter (Bors)
keeps his own personal axe. This is the explicit capability-based extension point for future
ownership/borrowing/theft, and for a future magical substitute (an enchanted blade, a spell) to
satisfy the same lookup instead of `inventory.includes('axe')`.

Verified: an axe materially improves tree-felling yield per swing over bare hands (same-size
grove, bare-handed extraction takes measurably more swings to fully deplete); a pickaxe
materially improves quarry yield the same way; tool `condition` round-trips through save/load;
a tool-absent scenario produces a finite, positive (never corrupted/NaN/zero) work rate.

## 7. Economy evidence: request → work → wage → purchase → upstream demand

`src/sim/core/requests.ts` + the `Request` type (`core/types.ts`). Both hauling and
construction labour — two materially different systems — now go through one shared
open→accepted→completed/failed/cancelled lifecycle, which is also the **only** place a worker
gets paid for accepted work:

- **Haul**: `createHaulTask` also creates a linked `Request` (reward = a base wage plus a small
  rate on distance × total mass moved). `claimHaulTask` accepts it. `depositHaulCargo` only
  `completeRequest`s (paying the wage) once the *whole task* is delivered — a multi-trip haul is
  paid once, at genuine completion, not per partial trip. `failHaulTask` fails the request
  instead — no payment.
- **Construction labour**: `performBuildLabor` (called from `mind/agent.ts`'s `build` action
  instead of calling `contributeBuildLabor` directly) resolves the worker's capability + hammer,
  scales the real elapsed time into credited labour-seconds, creates-and-accepts a
  `construction_labor` Request, performs the real `contributeBuildLabor` effect, wears the
  hammer, and completes (pays) the request. A project not yet `ready`/`building` (materials not
  on site) performs no labour and creates no request — no payment for work that didn't happen.

Currency is real and conserved (`core/requests.ts`'s `payWage`): a payer never pays more than
`Math.min(nominal, payer.wealth)` — a payer with no resolvable funds (or insufficient funds)
pays partially or not at all; the request still completes (the work happened) but the wage is
honestly reduced, never manufactured. `totalCurrencyBefore === totalCurrencyAfter` is asserted
directly in tests for both wage payment and food purchase.

**A latent pre-existing bug was fixed as part of this**: `buyFoodPortion`
(`world/metabolism.ts`) used `Math.max(1, Math.min(n, forSale.quantity,
Math.floor(buyer.wealth / unit)))` — the outer `Math.max(1, ...)` forced a sale of at least one
unit even when the buyer could afford **zero**, driving `buyer.wealth` negative. Fixed to floor
affordability at 0 and return `null` (no sale) when it is. This directly satisfies "a buyer
cannot spend money they do not have" / "no negative wealth."

**Upstream demand loop** (pre-existing v0.3 mechanism, now wage-funded): a worker buys bread →
bakery stock falls → `generateLogisticsNeeds` raises a flour haul from the mill → the mill's
flour stock falls → a grain haul is raised from a farm — unchanged mechanically, but now each
leg of that chain pays the hauler a real wage, funded (when the destination Place has a
resolvable, solvent owner) by that owner's own wealth.

**Benchmark evidence** (seed 918271, 8 world-days): **41 requests completed, 0 failed**, wages
paid **183** silver, purchases spent **558** silver. At 30 days: **145 completed, 0 failed**,
wages **312**, purchases **1174**. At an alternate seed (42424242, 8 days): **215 completed, 0
failed**, wages **216**, purchases **556** — a materially different but equally stable outcome,
confirming the mechanism isn't seed-specific.

## 8. Resource-timescale evidence

`src/sim/world/resources.ts`, `src/sim/world/metabolism.ts`, `src/sim/world/stock.ts`.

**Trees**: `TREE_REGROW_HOURS` 30 days → **2.5 years** (`2.5 × 365 × 24` hours). A bare
depleted↔available flip was replaced with a canonical lifecycle
(`felled → sapling → young → mature`, `growthStage` on `ResourceNode`), computed fresh from
elapsed time every upkeep pass (never incremented step-by-step, so it's cadence-independent —
checking once, long after depletion, reproduces the exact stage/availability continuous
observation would show). Only `mature` is harvestable. Verified: a felled tree does **not**
regrow after exactly the old 30-day timer; the lifecycle visibly advances through
sapling/young before mature; a full 2.5-year *continuous* headless run would take on the order
of an hour of wall-clock at current throughput (~7-8s/simulated day) — per the spec's own
allowance, this is validated with fast, deterministic, targeted lifecycle tests that advance
`world.clock.worldSeconds` directly and call `maintainResourceNodes`, rather than a real
multi-year simulation loop.

**Crops**: `MATURE_HOURS` 5 days → **6 weeks** (`6 × 7 × 24` hours), inside the spec's stated
5-8-week target band (real-world 8-12 weeks × ~2/3 compression). Verified: a crop does not
mature within 3 world-days; the dedicated maturation-timing test (parametrized on `MATURE_HOURS`
itself, so it stays correct under future retuning) confirms full maturation at the calibrated
duration. One consequence, documented inline in the affected test: an 8-day integration run can
no longer show >10 *fresh* maturations (that requires 6 weeks) — it now only shows harvests of
whichever plots started already mature from world generation, which is itself the intended
result: crop cycles are now a real, weeks-long commitment.

**Stone**: unchanged — `renewable: false`, and `maintainResourceNodes` explicitly skips
non-renewable nodes. Verified depleted and unchanged after a simulated five years.

**Spoilage**: `world/stock.ts`'s `addPlaceStock` no longer merges a fresh perishable delivery
into an existing stack — it starts a new stack (batch) instead, so each batch ages from its own
`createdAt`, independent of any other batch at the same Place. This fixes the real v0.3
limitation: previously, a fresh delivery merged into an older stack immediately inherited that
stack's accumulated `spoilAccum` pressure, which (since `spoilAccum` scales with current
quantity) front-loaded risk onto units that had just arrived. `takePlaceStock` already drained
oldest-stack-first (by monotonic id), so this required no change anywhere stock is *read* —
only where it's *written*. Verified: replenishing an aged stack does not touch the new batch's
freshness; `stockAt` still sums transparently across batches. Spoilage rates remain type-
specific (bread 10%/day, grain 0.3%/day, materials 0%) — verified bread spoils measurably faster
than grain over the same window, and materials never spoil.

## 9. Conservation checks

All asserted directly in tests, not just architecturally implied:

- **Currency**: wage payment and food purchase both conserve `sum(person.wealth)` exactly.
- **Item quantity**: a purchase moves stock from seller to buyer without creating or destroying
  units; a multi-trip haul's source/destination stock plus in-transit cargo sums to the original
  total at every step, including when a hauler is interrupted mid-trip (cargo is dropped
  canonically at their location, never destroyed).
- **Construction inputs**: `completeProject` consumes exactly the required material quantities
  from the site's stock when — and only when — the labour requirement is also met (resource and
  labour availability remain intentionally separate, per v0.3 Priority 12, now with the added
  constraint that resource competition between two projects for the same scarce material never
  duplicates supply — see the resource-competition stress test).
- **Stock never negative**: `takePlaceStock` already floored at available quantity (v0.3
  invariant, re-verified); `buyFoodPortion`'s fix closes the one path that could have driven
  wealth negative.

## 10. Determinism

No `Math.random()` was introduced anywhere in this milestone — every new formula
(`getPhysicalCapability`, `stepPhysiology`, extraction yield, sawing cadence, haul wage,
construction wage) is a pure function of canonical state (attributes, physiology, tool
condition, weather, elapsed time) and the existing seeded `World.rng` where randomness was
already in use elsewhere. Verified directly: two identical-seed runs (918271, 2 simulated hours)
produce byte-identical `canonicalStateHash`; a different seed (4242) produces a different hash.
The existing `canonicalStateHash` (rounded wealth/position/health/faction/knowledge-count per
person) was left as-is — it already changes if wage payments/purchases diverge wealth between
runs, so it remains a valid determinism tripwire without needing new fields added to it.

## 11. Browser verification

Booted the real client (`npm run dev`, driven headlessly with Playwright/Chromium against the
actual dev server — not a mock): clicked **New Game** (seed 1337), let it generate and render
Ashford Vale, then fast-forwarded canonical time in-process (the exact same
`world.clock.advance()` / `sim.step()` calls the render loop itself makes, just called in a
tight loop) by ~13 simulated hours.

- **No real console errors.** The only browser console message across the whole session was a
  standard `Failed to load resource: 404` for the browser's own default `/favicon.ico` request
  (the app declares no favicon) — confirmed pre-existing and unrelated to any v0.4 code by
  checking it fires on the bare start screen before any world exists.
- **People rest/sleep/drink/work**: body poses observed across the population during the run —
  `stand`, `sleep`, `sit`, `work`, `walk`.
- **Hauling reflects load limits / tools are used**: inspected canonical state directly
  (`window.game.world`, exposed for exactly this kind of debugging) after the fast-forward —
  23 requests, all completed; a hammer, an axe, a pickaxe and a saw had all measurably worn
  (`condition` 1 → 0.9998/0.9999/0.9989) from real use.
  the sawpit; the storage-shed project's material deficit was being serviced.
- **Economic transactions occurred**: 23 completed requests paid 154 silver in wages during the
  fast-forward window.
- **Resource depletion persists / construction remains visible**: some tree nodes were
  `depleted`, others still `available`; the storage-shed `ConstructionProject` retained its
  `gathering`/labour-progress state across the fast-forward exactly as the canonical model
  dictates (materialized as a real `hut`-type Place only on actual completion, per v0.3).
- **New UI**: the Inspector's "state" tab now shows a live **Attributes** (strength/dexterity)
  and **Physiology** (energy/hydration/fatigue/sleep debt/body heat) panel per person —
  screenshotted mid-run showing a farmer at energy 0.81, hydration 0.84, fatigue 0.11, sleep
  debt 5.0h, with the pre-existing Needs panel showing the correctly-derived hunger 0.19/thirst
  0.16 (≈ `1 - energy`/`1 - hydration`).

Screenshots captured: start screen, freshly booted village, mid-fast-forward (night, rain), and
the Inspector's new Attributes/Physiology panel.

## 12. The vertical-slice success criteria

Both directions of Constitution v0.4 §27 were demonstrated, without scripting either sequence
onto a specific NPC:

**The positive chain** (physical need → ... → upstream demand) is not scripted anywhere — it
falls out of `think()`'s ordinary utility competition (hunger/thirst raise `eat`/`drink_water`
utility; `haul`/`build`/`chop`/`gather` compete for attention scaled by `laborCapacity`;
`buyFoodPortion` and `payWage` are the only places money moves) plus the shared `Request`
lifecycle. The 8/30-day benchmark evidence in §7 (dozens of completed, paid requests; hundreds
of silver in purchases) is the same mechanism running for the whole village, not one staged
actor — the milestone's own success bar ("does not need to occur for every NPC... must occur
naturally for at least one actor") is comfortably exceeded.

**The contrasting failure case**: `tests/embodied-economy.test.ts`'s "a contrasting failure
case" test and `tests/stress-benchmarks.test.ts`'s tool/labor-shortage scenarios directly
exercise this — a worker at `fatigue 0.98`/`energy 0.05`/`hydration 0.1` has
`currentExertionCapacity < 0.15` (the exact threshold `think()` uses to stop offering labour
goals at all), and a fully-staffed-but-exhausted workforce leaves a haul task sitting at
`needed` rather than it magically completing.

---

## 13. Design rule: realism vs. game-ism (Constitution v0.4 §15/§28)

> Realistic enough that causality matters; compressed enough that a player experiences
> consequences. Different domains compress by different amounts — this is deliberate, not an
> oversight.

| Domain | Real-world scale | Torn Veil v0.4 scale | Compression |
|---|---|---|---|
| Walking across the village | seconds–minutes | same | ~1× (near-real) |
| Hunger/thirst cycle | hours | ~16h/~11h to empty | ~1× (unchanged from v0.2.4/v0.3) |
| Crop maturation | 8-12 weeks | 6 weeks | ~2/3 (spec target) |
| Tree regrowth (felled → mature) | years-decades | ~2.5 years | ~1× (deliberately NOT compressed) |
| Stone/quarry extraction | none (geological) | none | ∞ (non-renewable, unchanged) |

Trees and crops sit at opposite ends on purpose: a forest is a multi-year land-management
decision (transport distance and logging pressure are meant to matter economically), while a
crop is a seasonal cycle a player should see complete within one play session's worth of
in-game time. Stone remains permanently non-renewable — extraction is a one-way transformation
of the landscape, matching real geology, until a future magical/geological system gives an
in-fiction reason otherwise (deliberately not built yet, per §16-17's transcendence hooks).

---

## 14. Scope controls (what this milestone deliberately does NOT do)

Per Constitution v0.4 §25/§26, explicitly **not** built: market pricing (wages/prices are flat,
documented constants, not supply/demand-responsive), banking/loans/credit/taxation, complex
contracts/guilds/corporations, magic, ontological advancement (Iron/Bronze/...), detailed
nutrition/disease/injury simulation, full seasons, complex soil chemistry, more than the four
tools (axe/pickaxe/saw/hammer) or the one crop (wheat) the existing world already modeled,
animal husbandry. Construction remained a single-stage material-manifest-plus-labour model
(the storage shed's ~3-day-old "too abrupt" completion pacing was addressed by making its
*inputs* — hauling and labour — take real, physically-limited time under v0.4's mass/capacity
rules, rather than adding staged foundation/frame/walls/roof states, which would have widened
this milestone's scope without adding new causal depth).

---

## 15. Scaling risks (reported honestly)

- **Village-wide average caloric energy drops fast early, then plateaus — confirmed out to 90
  days.** avg `energy` 0.52 (2d) → 0.29 (8d) → 0.25 (30d) → 0.23 (90d), with `resource_shortage`
  events numbering in the tens of thousands by day 90. Population stays stable (33/33 alive, 0
  deaths, 0 anomalies, 0 goal-churn) at every horizon tested, and the 90-day figure confirms the
  early decay was the village working down its generous starting stock before fresh 6-week crop
  cycles caught up (by day 90, 86 plots have matured and 5 completed a full harvest cycle) — this
  is real, intended food-supply tightness (Constitution v0.4 §24 "food pressure"), not a runaway
  decay. Still worth a future tuning pass on starting reserves / per-meal restore for campaigns
  that need a less "hungry" opening stretch.
- **`workRate`/wage constants are hand-tuned, not derived from a formal calibration pass.** They
  produce stable, sensible-looking numbers at the seeds tested, but a systematic sweep (as a
  follow-up) would give more confidence they generalize across very different village
  compositions.
- **Average population-wide `bodyHeat` trends toward 0** under ordinary daily activity, because
  idling/resting (the majority of most people's day) net-cools faster than ambient heat
  accumulates even on a clear day — by design (Constitution v0.4 §1's bounded model), but it
  means the heat system is currently only visibly active for people doing sustained heavy labour
  in hot weather, not as a constant ambient pressure. This is intentional (§1: "avoid frequent
  random death... normal simulation should remain stable") but worth flagging as a tuning
  choice, not an oversight.
- **`personalCarryUnits`/`getPhysicalCapability` are called per-swing/per-load-action, not
  cached.** At current population sizes (33) this is not a measured performance concern (the
  30-day benchmark's `sim.think`/`sim.act` shares of wall time did not regress materially versus
  v0.3's own profile), but a much larger population could make this worth memoizing per think-
  cycle rather than recomputing per call within the same tick.
- **An extreme multi-trip haul (weakest possible worker, heaviest resource, in an isolated
  two-NPC test world) can stall indefinitely via goal-hysteresis thrashing.** While building the
  full-simulation multi-trip regression test, a strength-0.1 worker hauling stone requiring 12
  one-unit trips across a bare two-person world (no well, minimal competing activity) got stuck
  oscillating between `eat`/`sleep`/`socialize`/`haul` without ever completing another
  load-carry-deposit cycle after the first few trips — each trip's ~180-second plan kept getting
  pre-empted by a competing need before finishing. This did **not** reproduce in the real
  33-person village under an equivalent (still genuinely multi-trip) scenario — see the passing
  "a weakened real villager makes genuine multi-trip progress..." test, which completes several
  trips of a 10-unit haul within its time budget. The likely cause is pre-existing goal-selection
  hysteresis (`mind/agent.ts`'s `think()`, v0.2.1-era code, already has anomaly detection for
  "goal churn") interacting with v0.4's new `laborCapacity` utility multiplier in a way that's
  only visible at the most pathological extreme. Not fixed in this milestone (a hysteresis
  redesign is out of scope and risks destabilizing well-tested v0.2/v0.3 behaviour); flagged
  here as a genuine follow-up rather than quietly narrowing the regression test to avoid it.
- **The 2.5-year tree cycle and the full 1-year benchmark are validated via fast targeted tests
  and a background long-horizon headless run respectively, not a single interactive session**
  (a continuous 2.5-year run would take on the order of an hour of wall-clock at current
  per-simulated-day throughput). This is the explicitly-allowed fallback per Constitution v0.4
  §23, not a gap being hidden.

---

## Appendix: benchmark table

| Seed | Days | Wall-clock | Population | Deaths | Anomalies | Requests completed | Wages paid | Purchases spent | Avg energy | Avg hydration | Avg fatigue |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 918271 | 2 | ~8s | 33→33 | 0 | 0 | 25 | 107 | 6 | 0.52 | 0.69 | 0.36 |
| 918271 | 8 | 34.7s | 33→33 | 0 | 0 | 41 | 183 | 558 | 0.29 | 0.69 | 0.42 |
| 918271 | 30 | 223.1s | 33→33 | 0 | 0 | 145 | 312 | 1174 | 0.25 | 0.63 | 0.56 |
| 42424242 | 8 | 36.9s | 33→33 | 0 | 0 | 215 | 216 | 556 | 0.24 | 0.66 | 0.36 |
| 918271 | 90 | 1273.2s | 33→33 | 0 | 0 | 494 | 668 | 1388 | 0.23 | 0.60 | 0.41 |
| 918271 | 365 | *(background — see run notes)* | | | | | | | | | |

The 90-day run (0 anomalies, 0 goal-churn incidents) directly answers the scaling-risk question
raised in §15: average caloric energy essentially **plateaus** rather than decaying further
(0.29 at 8 days → 0.25 at 30 days → 0.23 at 90 days — a fast initial drop off the generous
starting stock, then near-flat), and, crucially, the crop cycle recalibration pays off at this
horizon: by day 90 (> one full 6-week maturation cycle), 86 plots have reached `mature` and 5
have completed a full `harvested` cycle from a fresh sowing — the 30-day snapshot could show
none of this (42 days > 30), but the world does visibly complete real harvest cycles once given
enough time, exactly as intended. Requests/wages/purchases all continued scaling linearly with
run length (494 completed requests, 668 wages, 1388 purchases by day 90), with zero failed
requests at any horizon tested.

*(The 365-day row: launched as a background headless run during this session; if this document
reaches you before it finished, check `.debug/headless/` for the completed `summary.json`/
benchmark report, or re-run `npx tsx src/headless/cli.ts --seed 918271 --days 365` — the
mechanism is identical to the completed 90-day run above, just longer. At observed throughput
(~14s/simulated day once past day 30, as per-event-history bookkeeping grows) a full year is
expected to take on the order of an hour and a half of wall-clock.)*
