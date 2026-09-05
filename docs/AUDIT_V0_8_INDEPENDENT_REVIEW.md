# Independent Adversarial Audit — Torn Veil Online at v0.8

**Status:** Independent review. Not a milestone, not an implementation plan.
**Reviewer role:** principal architect / adversarial simulation reviewer (not the v0.8 implementation agent).
**Subject:** `main` @ `d36cb64` and `claude/v0.8-legible-world` @ `8bea2ae` (PR #12). PR #11
(`claude/v0.8-materials-fire-processes`) read for architectural context only.
**Authority:** `docs/TORN_VEIL_CONSTITUTION.md` > `AGENTS.md` > `src/` > `tests/`.

---

## 0. Method, and the one question this audit asks

Everything below was verified against code, not against architecture-report prose. Where a
report claims a property, I read the implementation and, where possible, measured it.

What I actually ran on `claude/v0.8-legible-world`:

- `npm install && npx vitest run` → **35 files, 331/331 passing** (294 s). Baseline confirmed.
- Two new, purely observational probes written for this audit (`tools/audit/`, outside `src/`,
  imported by nothing in the simulation):
  - `worldlab-probe.ts` — daily time-series sampling of stock, resource nodes, construction,
    haul queue, wealth distribution, and **per-individual deprivation streaks**, across seeds.
  - `rng-coupling-probe.ts` — same seed, same code, differing only by *k* semantically
    meaningless `world.rng.next()` calls burned after generation.
- Runs: seed 918271 × 30 days; seed 918272 × 20 days; seed 1337 (the seed the **browser client
  actually uses**) × 20 days; seed 918271 × 25 days × burn ∈ {0..5}.

The question:

> If every existing test passed, in what ways could Torn Veil still be a broken, dead,
> incoherent, or misleading artificial world?

**The answer, in one line:** all 331 tests pass, and the world still (a) destroys ~45 % of its
money supply in 30 days with no source, (b) exhausts its only timber supply on day 5 with a
912-day regrowth timer, (c) trends bread monotonically toward zero while grain pins at its cap,
(d) leaves named individuals at ≥ *urgent* hunger for **31 consecutive days out of 31**, and (e)
reports exactly one anomaly type (`stuck_agent`) while doing so. This is not a tuning problem.
It is a measurement problem: the harness structurally cannot see any of it.

### The headline evidence (seed 918271, 30 world-days, no player)

| day | grain | flour | bread | trees standing | stone left | shed | total village wealth | Gini | villagers < 3 silver | cumulative shortages |
|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| 0 | 146 | 34 | **267** | **14** | 72 | gathering | **1380** | 0.50 | **3** | 0 |
| 5 | 500 | 53 | 61 | **0** | 52 | gathering | 1243 | 0.56 | 6 | 4 |
| 10 | 154 | 39 | 54 | 0 | 52 | gathering | 1159 | 0.73 | 12 | 415 |
| 17 | 32 | 35 | 49 | 0 | 52 | gathering | 835 | 0.82 | 20 | 1356 |
| 22 | 337 | 45 | 46 | 0 | 52 | **complete** | 813 | 0.81 | 20 | 2030 |
| 30 | 504 | 53 | **34** | **0** | 52 | complete | **753** | **0.84** | **21** / 32 | **3180** |

Worst individual hunger streaks (consecutive daily samples at ≥ `urgent`): **Vex (bandit) 31/31
days**, Brigid Tallow (guard) 25, Skarn (bandit) 21, Edda Ironhand (cook) 11, Hale Dorn (guard)
11, Old Wyn (herbalist) 9.

End-of-run anomalies from the *existing* detector: `stuck_agent × 5`. Nothing else.

Goal occupancy across all 32 people × 31 daily samples: `sleep=256, socialize=219, work=115,
drink_water=95, eat=92, shelter=52, worship=52, idle=42, none=32, plant=21, guard_post=20,
haul=11, patrol=10, harvest=4, chop=2, build=1`. The village spends more than twice as much of
its life socialising as working, and the entire 30-day timber/construction economy consists of
**2 chop-samples and 1 build-sample**.

It reproduces on both other seeds I ran, including the one the game actually ships:

| | seed 918271 (30 d) | seed 918272 (20 d) | **seed 1337 (20 d) — the browser's own seed** |
|---|---|---|---|
| total village wealth | 1380 → **753** | 1380 → **952** | 1380 → **1049** |
| Gini | 0.50 → **0.84** | 0.50 → **0.81** | 0.50 → **0.80** |
| villagers below 3 silver (of 32) | 3 → **21** | 3 → **19** | 3 → **20** |
| bread in the world | 267 → **34** | 267 → **38** | 267 → **45** |
| trees standing | 14 → **0** (day 5) | 14 → **9** | 14 → **3** |
| cumulative `resource_shortage` | **3180** | **1614** | **1755** |
| worst individual hunger streak | Vex **31/31 days** | Skarn & Vex **21/21 days** | Skarn & Vex **21/21 days** |
| worst individual thirst streak | Vex 21 days | Skarn 12 days | Skarn **21/21 days** |
| richest person's share of all wealth | 25.5 % (baker) | 35.1 % (baker) | 24.5 % (baker) |
| anomalies reported by the harness | `stuck_agent × 5` | `stuck_agent × 6` | `stuck_agent × 5` |

Seed 1337 matters on its own: `main.ts:31` boots `newWorld(1337)` unconditionally, so this is the
world every player has ever played, and **no architecture report in the repository has ever
benchmarked it** — every measurement in v0.4 through v0.8 uses 918271.

---

## Part 1 — Functional-world audit

Classification key:
`FUNCTIONALLY CLOSED` (a real, self-sustaining loop) · `FUNCTIONAL BUT FRAGILE` (closed, but one
tuning constant or one actor away from failing) · `PARTIALLY CLOSED` (real mechanism, missing a
terminal or a feedback edge) · `PLACEHOLDER/ABSTRACTED` (resources or effects appear from an
abstraction) · `BROKEN` (present but does not do what it claims) · `UNTESTED` (no deterministic
test asserts the behaviour).

| System | Verdict | Why |
|---|---|---|
| Food production (grain) | **FUNCTIONAL BUT FRAGILE** | `harvestPlot` → real `grain` at the farm, conserved, seed-consuming (`plantPlot` takes `SEED_PER_PLOT`). But output is pinned by `GRAIN_CAP = 500`: grain sits at ~500 for most of a 30-day run while bread starves. The cap is a demand-shaping constant applied to the *wrong stage* of the chain. |
| Crop lifecycle | **FUNCTIONALLY CLOSED** | `stepMetabolism` drives moisture → growth → `mature` → `SPOIL_HOURS` → `fallow`. Deterministic, no RNG, real state machine, four distinct visible states after v0.8 §C. The best-closed loop in the project. |
| Harvesting | **FUNCTIONALLY CLOSED** | Plot state changes, yield is deterministic, plot cannot be re-harvested, player and NPC share `harvestPlot` (v0.8 §D). |
| Milling | **PARTIALLY CLOSED** | Real conserved `transform` gated on grain physically at the mill and a real production Request. But throughput (one `MILL_RATIO` batch per ~8 world-minutes of *work-action time*, and the miller's work goal occupies a small fraction of the day) is far below village consumption — see the bread column above. |
| Baking | **PARTIALLY CLOSED** | Same shape as milling, plus a skill-driven cadence. Same throughput deficit. `BREAD_CAP = 200` is never approached; the binding constraint is upstream, and nothing detects that. |
| Eating | **PARTIALLY CLOSED** | `eatFood` consumes a real item and restores a real reserve. But `findAccessibleFood`/`buyFoodPortion` reach only carried food, home larder, household members present at home, and for-sale food *at the person's current place*. Whole occupations have no reachable path (below). |
| Water acquisition | **FUNCTIONAL BUT FRAGILE** | Two `well`-type Places, real `drinkAt`, real hydration. Water itself is infinite and unmodelled (no well capacity, no drought, no carrying). Thirst streaks of 21 consecutive days (Vex) show the *access* path fails even though the resource is infinite. |
| Sleep / rest | **FUNCTIONALLY CLOSED** | Real fatigue/sleep-debt reserves, real bed anchors, real recovery, real oversleep guard. |
| Labour | **PARTIALLY CLOSED** | `performBuildLabor`/`extractFromNode`/haul legs all cost real physiology and pay real wages through one audited `Request` path. But labour is barely ever chosen: 11 haul / 2 chop / 1 build samples in 992 person-days. |
| Occupations | **FUNCTIONAL BUT FRAGILE** | 20 occupations with real schedules. But `canHaul()` excludes child, guard, captain, priest, acolyte, elder and *all hostiles* — six occupations have **no income mechanism at all**, and bandits additionally have no food source (below). |
| Hauling / logistics | **FUNCTIONALLY CLOSED** | The strongest subsystem: physical multi-trip carriage, per-person mass capacity, partial deliveries, cargo dropped canonically on failure, stale-claim release, deterministic task selection. Genuinely closed. |
| Ownership | **PARTIALLY CLOSED** | `ownerId` is tracked separately from `placeId`, provenance is recorded, v0.8 §G made the HUD respect what the player *knows*. But ownership is not **enforced**: the player takes a 40-unit bread stack from the bakery with one keypress; it is recorded as `theft` and that is the entire consequence unless someone happens to perceive it. |
| Markets | **PLACEHOLDER/ABSTRACTED** | There is no market. There is retail (`buyFoodPortion`, buyer must be standing at the seller's place) and wholesale (`settleWholesale`, triggered by delivery). No offers, no bargaining, no clearing, no arbitrage, no price discovery. |
| Pricing | **PARTIALLY CLOSED** | `effectivePrice` is a bounded scarcity curve — but `PRICE_REFERENCE_STOCK` covers only `bread/flour/grain`. Every other tradable (`ale`, `meat`, `cheese`, `plank`, `stone`, `log`) is a flat constant, and wholesale ignores scarcity entirely. Scarcity therefore cannot propagate as a price signal through the wood/stone chain at all. |
| Wages | **FUNCTIONALLY CLOSED** | One audited path (`payWage`), never pays more than the payer has, never pays for failed work. Correct. |
| **Currency conservation** | **BROKEN** | Two one-way sinks, **zero sources**. (1) `restockTavern` deletes `ALE_RESTOCK_QTY × ITEM_VALUE.ale` from the world every restock. (2) `executeRobbery`'s `wealth` branch does `victim.wealth -= amount` and mints a **coin item**, which no NPC can ever spend (`buyFoodPortion` reads `wealth`). Measured: village wealth 1380 → 753 in 30 days; `supply_cost_amount = 312`, the remaining ~295 is robbery converting spendable wealth into inert coins. |
| Wealth concentration | **BROKEN** | Gini 0.50 → 0.84 in 30 days; 21 of 32 villagers below 3 silver — below the price of a loaf. v0.7 fixed *the innkeeper's* share and declared victory; the concentration simply moved (richest at day 30 is the baker, 25.5 % of all village wealth; on seed 918272 it is the other baker, 35.1 %). |
| Resource depletion / regeneration | **PLACEHOLDER/ABSTRACTED** | `TREE_REGROW_HOURS = 2.5 × 365 × 24` (**912 world-days**) against a grove of **14 trees × 6 logs = 84 logs, total, for the life of the world**. Whether that stock is exhausted is seed/phase-dependent (all 14 felled by day 5 at seed 918271; 9 still standing at 918272; 3 at 1337) — but a `resource_regrew` event is unreachable in any run anyone will ever perform. Stone is non-renewable: 72 units, the one project needs 8, so 52 sit untouched forever. "Renewable" is true only outside every horizon that will ever be simulated. |
| Construction | **FUNCTIONAL BUT FRAGILE** | The single authored project genuinely completes through real material delivery and real labour credit. But completion day is effectively a random variable: **21–22** (918271), **20** (918272), **5** (1337), and **1.4 – 21.2** at one seed under pure RNG-phase perturbation (Part 4). There is exactly one project; nothing generates a second. |
| Conflict | **FUNCTIONALLY CLOSED** | Genuinely good: intents, escalation, disengagement, surrender, pursuit bounds, re-engagement gating, lawful-intent exclusion from `isCrime`. This is the most constitutionally faithful subsystem in the codebase. |
| Arrest / custody | **FUNCTIONAL BUT FRAGILE** | Real detention with a release timer and a `layLowUntil` follow-up. But custody duration is "~2 world-hours" by design — there is no sentencing, no institutional memory of repeat offence, and `repeated_arrest` exists as an anomaly type precisely because the loop is known to be re-enterable. |
| Death | **PARTIALLY CLOSED** | Death exists only via `intent: 'kill'` in combat or a player's deliberate lethal choice. **Nobody can die of starvation, thirst, exposure, injury-neglect, disease, or age.** There are no births. Population is a constant. Every physiological chain therefore terminates in "reduced work capacity", never in a consequence. |
| Memory | **FUNCTIONALLY CLOSED** | Significance/recency/valence-weighted, bounded at 60, forgetting is selective not uniform, and it feeds real decisions (`knownFoodPlace` demotes a place you found empty). |
| Knowledge | **FUNCTIONALLY CLOSED** | Provenance, confidence, hops, decay scaled by importance, durable floors for relationship-relevant facts. Constitutionally excellent. |
| Rumour propagation | **FUNCTIONAL BUT FRAGILE** | `pickGossip` → `tell` → confidence attenuated by trust and speaker honesty, hops incremented. Real. But it only ever moves *event* claims: `location`, `service` and `affordance` knowledge never propagate by speech, which breaks the one player-facing quest chain (Part 2). |
| Dialogue | **FUNCTIONALLY CLOSED (grounding)** / **UNTESTED (behaviour)** | `realizeClaim` genuinely cannot name an entity absent from the claim — I verified every variant plugs only `who(...)`/`nameOf(...)` on claim fields. 8 structural tests. But no test asserts the *player-visible* dialogue tree behaves, because there is no browser test at all. |
| Generated desires / tasks | **PLACEHOLDER/ABSTRACTED** | Exactly two desires are authored (Cedric's ring, Wendel's debt). The only runtime generator is `item_missing` → `recover_item`, and that goal is unreachable without `loc:<itemId>` knowledge, which **nothing at runtime ever creates for an item** (Part 2, chain 5). |
| Player / NPC parity | **PARTIALLY CLOSED** | Excellent for combat, pickup, trade, chop/quarry, and now harvest/sow. Missing entirely for: taking a haul task, accepting a production or construction Request, planting outside a `Field`, being paid a wage, being robbed by the resource-pressure path, or being subject to arrest. The player also carries **two parallel currencies** (`person.wealth = 25` *and* a `coins` item ×25) that no NPC has. |
| Save / load | **FUNCTIONAL BUT FRAGILE** | Careful, versioned, well-reasoned. But **`world.rng`'s internal state is not serialized** (`save.ts:111` persists `clock`, `physicalTime`, `weather`, `counters` — not `rng`). A load rewinds the shared random stream to its post-generation position. Save/load is deterministic but *not continuous*. |
| World generation | **FUNCTIONAL BUT FRAGILE** | Deterministic and rich. But it is one hand-placed village; the "seed" varies terrain, relationship rolls and starting yaw, not structure. Two seeds produce the same 33 people in the same buildings with the same jobs — Constitution §55's "plausible divergence" is not yet achievable by construction. |
| Navigation / pathfinding | **FUNCTIONAL BUT FRAGILE** | Real A*, real door opening, real separation, and a documented livelock fix. But `stuck_agent × 5–6` fires on *every* long run I made, on every seed, and nothing treats that as a failure. |
| Scheduling | **FUNCTIONALLY CLOSED** | Schedules are utility candidates, not scripts — correct per Constitution §66. |
| Utility / goal selection | **FUNCTIONAL BUT FRAGILE** | Hysteresis, commitment, protected need-goals, emergency preemption — a genuinely sophisticated arbiter. But the resulting *allocation* is wrong (work 11 % vs socialise 22 %), and no test asserts anything about the distribution of chosen goals. |
| Rendering / projection | **PARTIALLY CLOSED** | See Part 6. Crop state, poses and ownership are now legible; **quantity, stockpiles, construction progress, damage, weather consequence, and carried cargo are not**. |

### Two structural findings from this table that deserve naming

**(a) Six occupations cannot earn, and two cannot eat.**
`canHaul()` (`haul.ts:342`) returns false for `child`, `guard`, `captain`, `priest`, `acolyte`,
`elder`, and for anyone `hostile`. Those people are excluded from every wage path in the game
(haul, build, gather all sit behind the same `canHaul` gate in `think()`). They have no other
income. Separately, `village.ts:284` skips bandits when seeding household larders, the camp has
no food item, and a bandit's schedule keeps them at the camp all day — so `findAccessibleFood`
returns null forever and `buyFoodPortion` has nothing to buy. Measured: both bandits at ≥ urgent
hunger for **the entire run**, on both seeds. No test covers this because no test looks at
individuals.

**(b) `mind/economy.ts` documents a causal loop that the code does not implement.**
Its comment states bandit pressure "fades as the faction accumulates wealth (including,
causally, from successful robberies)". `banditResourcePressure` sums `m.wealth`;
`executeRobbery`'s coin path calls `takeItem` (no `wealth` change) and its wealth path *mints a
coin item* rather than crediting `bandit.wealth`. Bandit pressure is therefore pinned at 1.0
permanently, no matter how much they steal. The documented feedback edge does not exist.

---

## Part 2 — Causal-chain audit

### Chain A — weather → moisture → crops → harvest → grain → mill → flour → bakery → bread → purchase → eat → physiology

**Every link exists.** This is the chain the project has invested most in, and structurally it
is real: no stage produces its output without consuming its input at the right physical place.

Defects:

1. **Broken link (throughput, not existence): mill/bakery output < village consumption.**
   Measured, seed 918271: bread 267 → 34 monotonically over 30 days while grain pinned at ~500.
   1238 meals over 30 days for 32 people = **1.33 meals/person/day**. Physiology drains a full
   caloric reserve in 21 idle-equivalent hours (`ENERGY_DRAIN_PER_HOUR = 1/21`, scaled up by
   `ACTIVITY_ENERGY_MULT` for anything above idle) and one meal restores **0.55**
   (`FOOD_HUNGER_RESTORE`, passed into `eatRestoresEnergy`). Even at pure idle the steady-state
   requirement is `(24/21)/0.55 ≈ 2.1` meals/person/day; with any real activity mix it is higher,
   and overflow above `energy = 1` is clamped and wasted. The village is *structurally* under-fed
   by roughly 40 %, permanently. Nothing measures meals-per-person-per-day.
2. **Fake link: the grain cap is applied at the wrong stage.** `GRAIN_CAP = 500` stops
   *harvesting* when the village has plenty of grain. But grain being plentiful is not evidence
   bread is plentiful. The result is the visible pathology above: a granary at its ceiling and a
   bakery running dry, simultaneously, for weeks.
3. **Seeded resource masquerading as production:** `ale`, `meat`, `cheese`, `pie` have no
   ingredient chain. `restockTavern` conjures 6 ale from "the cellar" on a stock trigger. This
   is honestly disclosed in the source comment — but it is also the food the guards' schedule
   sends them to buy, which means an entire occupation's nutrition depends on an unmodelled
   resource whose supply cost silently destroys currency.
4. **One-time stock masquerading as a system:** the 12-unit bread + 6-unit cheese larder in
   every household, and the 122 starting grain across four farms, carry the first ~week. The
   decline only becomes visible after them.
5. **State change the renderer does not show:** stock. `addPlaceStock` places one item entity at
   `place.inside` regardless of quantity; `ActorRenderer` draws one small prop per unheld item
   with a position. 500 grain and 3 grain render identically, at the same coordinate, stacked
   with every other resource type at that place. The bakery emptying is invisible.

### Chain B — tree → extraction → logs → hauling → saw → planks → construction → completed structure

**Every link exists and the chain completes.** It is also the clearest example in the project of
a one-time stock presented as a renewable system.

1. **One-time stock:** `plantGrove(..., count = 14)`, `LOGS_PER_TREE = 6` → **84 logs, total, for
   the lifetime of the world.** `TREE_REGROW_HOURS = 21 900` (912 world-days). Measured: trees
   standing 14 → **0 by day 5** at seed 918271, 14 → 9 at 918272, 14 → 3 at 1337, and under
   RNG-phase perturbation the exhaustion day is 4.13 / 6.10 / never across six otherwise-identical
   runs. Whether the timber economy dies is decided by dice; that it *cannot recover* is
   structural. A `resource_regrew` event is unreachable in any run anyone will ever perform, and
   `resourceNodeSummary.treeGrowthStages` exists to report a lifecycle nobody will see.
2. **Loop whose completion time is essentially a random variable:** completion day measured at
   **21.2** (918271), **20** (918272), **5** (1337) — and, at the *same* seed with only
   meaningless RNG-phase perturbation, anywhere from **1.44 to 21.17** (Part 4). The test that
   once asserted 12 days and now allows 35 is straddling a 14× distribution nobody had measured.
3. **Non-renewable stone with no scarcity consequence:** 72 units in the ground, 8 consumed,
   **52 frozen from day 4 to day 30**. Nothing else in the world consumes stone, so exhaustion —
   the one thing that would make a non-renewable resource meaningful — cannot occur.
4. **State change the renderer does not show:** construction progress. `laborDone` goes 0 → 100 %
   with **no visual change whatsoever** until `materializeStructure` snaps the entire building
   into existence in one frame. A player watching the site for 21 days sees a fenced empty plot,
   then a shed. `construction_progress` events fire every 900 s of credited labour and project
   only into the event feed.
5. **Canonical state with no player interaction:** the player cannot take a haul task, cannot
   contribute build labour, cannot accept a production request. `Simulation` exposes
   `extractResourceAt`, `harvestWheatAt`, `plantWheatAt` — but no `contributeBuildLabor` wrapper,
   despite `performBuildLabor` being player-agnostic already.

### Chain C — need → goal → action → path → interaction → state change → observable consequence

Structurally the healthiest chain: `think()` builds utility candidates with reasons, `plan()`
emits actions, `act()` mutates canonical state, events carry `causes`. The defects are at the ends.

1. **Missing terminal:** the need chain has no failure mode. Hunger 1.0 for 31 days produces
   `resource_shortage` events, reduced `currentExertionCapacity`, and nothing else. No collapse,
   no illness, no death, no migration, no crime driven by hunger. Constitution §3's own worked
   example — *farm output falls → food prices increase → poor households struggle → theft
   increases* — cannot occur, because hunger is not wired to anything downstream of work rate.
2. **Observable consequence is missing for the most common outcome:** 3180 `resource_shortage`
   events in 30 days (≈ 106/day) produce no visible sign anywhere in the client — no reaction, no
   emaciation, no empty-shelf rendering, no HUD signal, no chronicle entry (significance 0.2–0.3
   is below the 0.5 retention floor, so they are compacted away entirely).
3. **Retry storm, unflagged:** `NO_FOOD_RETRY_SECONDS = 30 min`. A permanently-foodless person
   (a bandit) re-adopts `eat`, walks, fails, emits a shortage, and repeats — ~48×/day, for 31
   days. `event_spam` explicitly *would* catch this, but only within a 3-hour window at the very
   end of the run, and `resource_shortage` is compacted out of `world.events` long before that.

### Chain D — event → perception → knowledge → memory → communication → other belief → dialogue

**The best chain in the project, and genuinely constitutional.** `eventClaim` respects
`actorUnknown`; `learn` carries provenance/confidence/hops; `tell` attenuates confidence by trust
and speaker honesty; `realizeClaim` cannot introduce an entity absent from the claim; the
`epistemic_leak` anomaly guards the invariant.

Two defects:

1. **Only `event` claims propagate.** `pickGossip` filters `k.kind === 'event'`. `location`,
   `service` and `affordance` knowledge is acquired only first-hand (arrival, purchase, use) or
   from generation seeding. Nobody can ever *tell* anybody where something is. This is what
   breaks Chain E.
2. **Leaked omniscience in presentation, not simulation:** the HUD's target panel prints any
   NPC's current **goal type** and exact **hit points** on sight (`hud.ts` `update()`), and the
   top bar prints the exact living population of the whole village. v0.8 §G carefully fixed
   ground-item ownership omniscience while leaving these untouched — an inconsistency, not a
   simulation bug (Part 7).

### Chain E — desire → player learns request → information search → item discovery → authorized recovery → return → payment → relationship/history change

This is the chain v0.8 §E claims to have closed. **It is closed for exactly one authored item
and structurally open for every emergent one.**

- `village.ts:396` seeds `loc:<ring>` into **Old Wyn alone**. `dialogue.ts`'s `aboutItem` reads
  `npc.knowledge['loc:' + itemId]`. So the ring quest works: hear Cedric, ask Wyn, go to shrine,
  `giveItem` fires `returned_item`, desire fulfilled, relationship changes. Genuinely end-to-end.
- **`locationKnowledge()` is only ever called for bodies** (`agent.ts:123`, on visual perception
  of another *body*). Nothing in the entire codebase writes `loc:<itemId>` at runtime.
- Therefore the *generated* case — `strategic()`'s `item_missing` → `recover_item` desire
  (`agent.ts:1643`), the one desire the world actually produces on its own — has no discoverable
  location, for the owner or for the player. Every NPC answers "I couldn't say where it ended
  up", forever. The NPC's own `recover_item` goal (`agent.ts:395`) is likewise gated on
  `p.knowledge['loc:' + d.targetId]` and can never fire.
- **Fake link:** payment. `Desire.reward` is displayed to the player ("I'd pay 30 silver") and is
  never paid by anything. `giveItem` adjusts relationships and sets `fulfilled = true`; no
  currency moves. The offer is narration.
- **Missing link:** the player has no way to *learn* an item's location by looking at it either —
  picking it up, seeing it traded, or witnessing it stolen creates no `loc:` knowledge.
  `owner:<itemId>` knowledge — which v0.8 §G's new HUD label depends on — is created in exactly
  **three places in the codebase, all at generation time** (`village.ts:399/402/403`: Anna's ring,
  Oathkeeper, Tam's hammer). No runtime path writes it. So the new ownership label reads
  "not sure whose this is" for every item in the world except those three, and the `for sale`
  display-anchor heuristic is carrying the entire feature. The epistemics are right; the
  acquisition paths were not built alongside them.

**Net:** v0.8 §E's acceptance criterion ("one generated lost/stolen-property task completed
end-to-end with real entities") is satisfied by an **authored** task, not a generated one. The
report's own wording ("generated lost/stolen-item task discoverability") overstates it.

---

## Part 3 — WorldLab adversarial review

The proposed direction is right. The risk is that WorldLab becomes "more numbers in
`WorldRunSummary`", which would change nothing, because the current harness's blindness is
**structural, not a coverage gap**. Three architectural defects cause all of it:

### D1 — Everything is an endpoint

`buildWorldRunSummary` reads `world` *once*, at the end. `metabolismSummary`, `constructionSummary`,
`resourceNodeSummary`, `circulationSummary`, `embodiedSummary`, `pricing` are all end-state
snapshots. `runTally` fields are lifetime totals. **There is no time axis anywhere.**

Consequences I measured:
- Bread 267 → 34 monotonic decline reports as `stock.bread: 34` — indistinguishable from a
  healthy world that happened to be between bakes.
- Trees 14 → 0 on day 5 reports as `trees.available: 0` at day 30, with no indication that the
  timber economy had been dead for 25 days.
- Grain oscillating 500 → 32 → 500 reports as `500`.
- The v0.7 report's own "innkeeper wealth 0/0/0 at 90 days" is a three-point endpoint sample that
  was read as proof of a bounded sink. It is equally consistent with the innkeeper being
  *permanently insolvent*, which is what my measurements show is actually happening.

### D2 — Anomaly detection only sees the last three hours of a run, of a log that has already been thinned

`detectAnomalies` uses `within(e, window)` with `window = 3 h` for checks 4 (`event_spam`), 5
(`stuck_agent`), 6 (`goal_churn`) and 8 (`surrender_or_custody_ignored`). It reads
`world.events`, which `compactEvents(4000)` has already filtered to *the last 4000 events plus
anything with `significance ≥ 0.5` or `category === 'history'`*.

So: a goal-churn storm on day 3 of a 90-day run is doubly invisible — outside the window, and
compacted away. `resource_shortage` (significance 0.2–0.3), `path_failure` (0.0), `goal_changed`
(0.12), `arrived` (0.05) are all below the retention floor. The detector cannot, even in
principle, report on 99 % of a long run.

Meanwhile the telemetry stream (`FileSink`, JSONL, per-event, written before compaction) **is** a
complete time series — and nothing consumes it. The single highest-leverage change in this whole
audit is: *make the analysis read the telemetry stream, not the compacted in-memory log.*

### D3 — Everything is a village aggregate

`avgHunger`, `avgSoilMoisture`, `hungerBandMinutes` (summed across all people), `wealthByOccupation`
(avg/min/max per occupation). A person starving for 31 straight days contributes 1/32 of the
average and is invisible. The only per-individual signal in the entire summary is
`villagersBelow3Silver`, and it was 21/32 at day 30 with nothing reacting.

### How a naive harness declares this exact world healthy

Every one of these is a real, current false-negative, not a hypothetical:

| Failure mode | How the current harness misses it | What actually happened |
|---|---|---|
| Event occurred once, loop then died | `resource_regrew`/`resource_extracted` are lifetime tallies | 16 extractions, all in days 0–5; timber economy dead from day 5 |
| Averages hide starving minorities | `avgHunger` over 32 people | Vex at ≥ urgent for 31/31 days |
| Endpoint hides long failure | `stock.bread = 34` | 267 → 34 monotonic; the run *ends* mid-collapse |
| Final stock hides oscillation | `stock.grain = 504` | 500 → 32 → 500 twice |
| Completion hides absurd latency | `construction.complete = 1/1` | 21 days of which 20 were `gathering` at 0 % labour |
| Poorly-chosen threshold | `goal_churn` needs 40 switches in 3 h; `event_spam` needs 30 same-tuple events in 3 h | 3180 shortages over 30 days never trip either |
| Deterministic seed passes, neighbours collapse | one benchmark seed (918271), and the browser ships a *different* seed (1337) that has never been benchmarked | see Part 4 |

### Designed detectors

These are specified as **invariant** (must never be violated), **liveness** (something must keep
happening), and **tail** (no individual may be sacrificed to an average). All are computable from
the existing telemetry stream plus a per-day sample; none requires new simulation state.

Naming convention below matches how I'd want them to appear in a report so a reviewer can grep them.

#### T1 — Temporal coverage (liveness). `liveness.production`
For each of `{crop_harvested, resource_transformed, food_consumed, resource_delivered}`: no
window of **3 consecutive world-days** may contain zero events, in any run longer than 7 days.
*Catches:* "it happened once and the loop died." Would currently fail on `resource_extracted`
(zero from day 5 onward).

#### T2 — Progress velocity (liveness). `liveness.construction_velocity`
While a project's status is `gathering`, its material deficit must strictly decrease at least
once every **2 world-days**, or a `blocked_project` finding is raised naming the deficient
resource and whether a producer place has any stock. *Catches:* the 20-day 0 %-labour plateau.

#### T3 — Individual deprivation duration (tail). `tail.deprivation_streak`
For every person, the **maximum consecutive world-hours at severity ≥ `urgent`** for hunger,
thirst, and sleep. Report the top 5 by name and occupation. Assert: no person exceeds
**48 consecutive hours** at ≥ urgent hunger in a healthy run. *Catches:* Vex (744 h), Brigid
(600 h). Village averages cannot detect this; a per-person maximum cannot miss it.

#### T4 — Nutrition adequacy (invariant). `invariant.meals_per_person_day`
`food_consumed / (population × days)` must be ≥ the physiologically required rate implied by
`ENERGY_DRAIN_PER_HOUR`, `ACTIVITY_ENERGY_MULT` and `FOOD_HUNGER_RESTORE` (≥ 2.1 even at pure
idle). Measured: **1.33**. This is
a *derived* threshold, not a tuned one — it changes automatically if the physiology constants do,
which is exactly the property the v0.7 ale post-mortem correctly identified as the difference
between an invariant and a calibrated number.

#### T5 — Money-supply conservation (invariant). `invariant.currency_closed`
`Σ person.wealth + Σ coin-item quantity` at end = same at start, **minus** `supply_cost_amount`,
**plus** any declared source. Every deviation must be attributable to a named, tallied exit.
Measured: 1380 → 753, of which only 312 is tallied. The remaining ~295 is untracked
`wealth → coin-item` conversion in `executeRobbery`. This test fails today.

#### T6 — Distribution health (tail). `tail.wealth`
Gini coefficient sampled daily, plus the count of villagers below the current effective price of
one loaf. Assert Gini does not increase monotonically across the run, and that
`below_one_loaf / population` does not exceed 0.5. Measured: 0.50 → 0.84 monotone; 21/32.

#### T7 — Stalled workflows (liveness). `liveness.queue_age`
For every `HaulTask`, `Request`, and `ConstructionProject`, track age in status. Report the
maximum. Assert no open work item exceeds **1 world-day** in `needed`/`open` while its
prerequisites are satisfied. *Distinguishes* "nobody is available" (fine) from "nobody will ever
take it" (a defect).

#### T8 — Prerequisite availability vs completion (invariant). `invariant.no_phantom_output`
For every `resource_transformed`, assert the input stock at that place ≥ the ratio input, in the
tick before. For every `addPlaceStock` not preceded by a matching `takePlaceStock`,
`extractFromNode`, or `harvestPlot`, flag `unexplained_material`. This is the general form of the
`restockTavern` disclosure — it makes every future "resources from an abstraction" *visible in
the report* rather than dependent on someone remembering to write a comment.

#### T9 — Latency distributions (report, not assert). `latency.*`
p50/p90/max world-hours for: need-adopted → need-satisfied (per need); haul created → delivered;
production request open → completed; crop planted → harvested. A p90 in the hundreds of hours is
the signal that "it completes" is hiding "it barely completes."

#### T10 — Repeated interruptions / retry storms (liveness). `churn.retry`
Count `(actor, goal-type)` adopt→fail cycles per world-day, over the **whole run**, not a
trailing window. Assert no actor exceeds 20/day for the same goal. *Catches:* the bandit eat-loop
(≈ 48/day for 31 days) which `event_spam`'s 3-hour window structurally cannot see.

#### T11 — Cyclic goal changes. `churn.goal_cycle`
Detect A→B→A→B oscillation over the full run (not 40-in-3-hours). Report the top cycling actors
by cycles/day.

#### T12 — Supply-chain depletion (invariant). `invariant.renewable_horizon`
For each renewable node type: assert `total_capacity / consumption_rate > regrow_period`, i.e.
the stock can actually outlast one regeneration cycle. Currently: 84 logs consumed in ~5 days
against a 912-day regrow — this fails by a factor of ~180 and would have failed the moment
`TREE_REGROW_HOURS` was set. This is the test that turns "seeded resource masquerading as
production" from a judgement call into an arithmetic one.

#### T13 — Fragile dependency chains (metamorphic). `metamorphic.seed_neighbourhood`
Run seeds `{s, s+1, s+2, s+3, s+4}` for the same duration. Assert every **qualitative** outcome
is stable: does the shed complete at all, does the food chain stay alive, does anyone starve for
> 48 h, does the money supply survive. Assert nothing about exact values. *Catches:* a fix that
works only at 918271.

#### T14 — RNG-perturbation metamorphic test. `metamorphic.rng_phase`
The test in Part 4. This is the one that converts "the construction test keeps needing more days"
from folklore into a measured, bounded property.

**One more design note.** These belong in **two tiers**: a small set of fast invariants that run
in `npm test` on a short deterministic world, and a slower `npm run worldlab` suite (multi-seed,
20–30 days) run per milestone whose output is a **diffable artifact**, like `benchmarkReport.ts`
already produces. Do not put a 30-day multi-seed sweep in the unit-test suite; do not let the
milestone DoD be satisfied without running it.

---

## Part 4 — RNG architecture audit

### Where randomness is consumed

There is exactly **one** runtime stream: `World.rng`, constructed as `new RNG(seed)` in
`world.ts:79`. `RNG` is a mulberry32 with a single mutable `s`. `fork(salt)` exists and is used
**once**, at generation time (`village.ts:27`, for the structure builder). Everything at runtime
shares the one stream:

| Consumer | Site | Draws |
|---|---|---|
| Weather transitions (kind, intensity, wind, next-change time) | `agent.ts:1697-1698` | 4 per change |
| Idle yaw jitter during `work` | `agent.ts:955` | **1–2 per actor per physics substep while working** |
| Work-action duration | `agent.ts:777` | 1 per `work` plan |
| Sit/socialise duration | `agent.ts:779` | 1 per plan |
| Anchor choice (bed, seat, work spot) | `agent.ts:771` | 1 per anchored plan |
| Patrol start index | `agent.ts:796` | 1 per patrol plan |
| Wander target | `agent.ts:793` | 2 per wander plan |
| Chat partner choice | `agent.ts:1303` | 1 per chat |
| Small-talk line | `agent.ts:1325` | 1 per small talk |
| Listener acknowledgement line | `agent.ts:1354` | 1 per gossip |
| Combat damage roll | `agent.ts:1406` | 1 per blow |
| Player lethality roll | `agent.ts:1450` | 1 |
| Missing-possession inference check | `agent.ts:1636` | **1 per person per world-minute at their workplace** |
| Creature wander | `agent.ts:1292` | up to 4 per creature per timer expiry |
| Robbery compliance | `robbery.ts:45` | 1 per demand |
| Robbery take size | `robbery.ts:65` | 1 per take |
| Player looting scatter | `interaction.ts:71` | 2 per looted item |

### The coupling, precisely

Two of these consumers draw at a rate proportional to **actor behaviour**, not to wall time:
`agent.ts:955` (yaw jitter, `if (a.pos && w.rng.next() < physDt * 0.15)` — a draw *every substep*
for every actor in a `work` action) and `agent.ts:1636` (a draw per person per world-minute while
at their workplace). Nine chickens add up to four more draws each on their own timers.

So **the number of draws consumed by time T is a function of how many people happened to be
working**. Any change that alters how often anyone adopts `work` — a new goal candidate, a
changed utility constant, a new pose, an extra event — permanently re-phases every subsequent
draw for every other consumer.

The consumer that matters most downstream is **weather**, because weather is not a cosmetic:

```
world.rng ──▶ weather.kind/intensity ──▶ stepMetabolism soil moisture ──▶ crop growth rate ──▶ harvest timing
                     │
                     ├──▶ think()'s rainPenalty on outdoor schedule utility ──▶ whether the woodcutter goes to the clearing
                     ├──▶ physiology wetness ──▶ needs.comfort ──▶ shelter goal competes
                     └──▶ perception seeRange (fog) ──▶ who witnesses what ──▶ knowledge ──▶ conflict
```

That is the mechanism behind the 12 → 25 → 35 day construction drift. A dialogue change (v0.8 §A)
alters how often `sayLater`/gossip draws fire, which re-phases weather, which changes the rain
penalty on Bors Ashwood's outdoor `work` schedule slot, which changes how many sawing batches he
completes per day, which changes when 16 planks reach the site. **Nothing about that is
emergence.** It is one shared mutable counter.

### Are the tests checking emergence, or trajectory identity?

Mostly the latter, and increasingly so:

- `tests/living-world-logistics.test.ts:435` — 35-day budget. The *assertions* are qualitative
  and good (`construction_completed === 1`, `hauled:plank > 0`). The **day budget is the
  trajectory-identity part**, and it has been widened three times.
- `tests/headless-benchmarks.test.ts` Benchmark B asserts two runs at the same seed produce
  identical `events.map(type)` and identical `summary`. That is a *replay* test, which is correct
  and worth keeping — but it is the only "determinism" test, and it proves nothing about
  robustness.
- `tests/determinism.test.ts` asserts one combat damage roll replays. Fine, trivially.
- **Nothing anywhere tests that a nearby seed, or a re-phased stream, produces a structurally
  similar world.** That is the gap.

### Measured: the RNG-phase experiment

`tools/audit/rng-coupling-probe.ts` runs seed 918271 for 25 world-days, with the only difference
being *k* extra `world.rng.next()` calls burned immediately after generation — a perturbation
with no semantic content at all.

```
burn | shed complete | ready | first plank | trees gone | extractions | wealth @d25 | supplyCost | events
   0 |     21.17     | 20.42 |     3.40    |    4.13    |     16      |     773     |    312     |  9100
   1 |      6.50     |  6.28 |     0.28    |   never    |     12      |     865     |    125     |  8070
   2 |      1.47     |  1.33 |     0.28    |    6.10    |     15      |    1059     |    258     |  8743
   3 |      4.39     |  4.28 |     0.43    |   never    |      5      |    1040     |    124     |  9398
   4 |      1.44     |  1.35 |     0.27    |   never    |     11      |     859     |    222     |  8537
   5 |      3.31     |  1.38 |     1.28    |   never    |      8      |    1021     |    186     |  9272
```

**Result: the same world, same seed, same code, differing only by up to five meaningless random
draws, completes the storage shed anywhere between world-day 1.44 and world-day 21.17 — a
14× spread.** In the same experiment:

- The timber economy dies on **day 4.13** in one run, on **day 6.10** in another, and **never
  runs out at all** in four of six — the difference between "renewable resource" and "exhausted
  in a week" is decided by RNG phase, not by consumption.
- Total village wealth at day 25 ranges **773 – 1059** (37 % spread).
- Tavern supply-cost currency destruction ranges **124 – 312** (2.5×).
- Extraction events range **5 – 16** (3.2×).

Three things follow.

1. **The construction test's day budget is not measuring the world.** Its only substantive
   assertion (`construction_completed === 1`) is satisfiable at day 1.5 and at day 21. Widening
   12 → 25 → 35 was widening a ceiling over a distribution nobody had measured. The v0.8 report's
   own framing — "the woodcutter intermittently drifts into other schedule activities" — is a
   symptom description; the cause is that his drift is phase-locked to a counter shared with
   weather, gossip, and chicken wandering.
2. **Every cross-commit comparison in every architecture report so far is confounded.** "Wealth
   share fell from 59.1 % to 58.1 %" (the v0.7 pre-correction measurement) is well inside the
   noise this experiment measures. The v0.7 post-mortem was right that tuning to a benchmark
   number is a trap; it did not know how wide the noise band actually is.
3. **This is not the world being unpredictable in the Constitution's sense.** §64 asks for
   "unpredictable consequences from understandable causes." Here the cause is not understandable
   and not in the world: it is the ordinal position of a `next()` call.

### Recommendation (deliberately narrow — do not do a sweeping rewrite)

`RNG.fork(salt)` already exists and is already used for generation. The safe change is to add a
small number of **named, independent, lazily-created streams** on `World`, and move only the
consumers whose *rate* depends on behaviour, plus the consumers whose *outputs* have long-range
physical consequences:

```ts
// core/world.ts — additive, no behaviour change for anything not migrated
private streams = new Map<string, RNG>();
stream(name: StreamName): RNG {
  let r = this.streams.get(name);
  if (!r) { r = this.rng.fork(hashName(name)); this.streams.set(name, r); }
  return r;
}
```

Migrate in this order, each as its own commit with the metamorphic test (T14) run before and after:

1. **`weather`** — the highest-leverage single move. Weather is a world-level process whose
   sequence should not depend on how many villagers are sawing. Migrating this alone should
   collapse most of the observed drift.
2. **`ambient`** — yaw jitter, small-talk lines, chat-partner choice, listener acknowledgements,
   creature wander. These are pure presentation-adjacent noise that currently perturbs everything.
3. **`combat`** — damage rolls, robbery compliance/take. Keeps a fight's dice independent of how
   busy the village was that morning.
4. Leave everything else on the main stream for now.

**Constraints this must respect:**
- Per-stream state **must be persisted** (`save.ts` currently persists no RNG state at all — see
  P1-4). Adding streams without persisting them makes the existing save-continuity bug worse.
- Streams must be derived deterministically from the world seed (`this.rng.fork(hash(name))` at
  first use, *not* from a counter, so lazily creating them in a different order is harmless).
- Do **not** make streams per-entity yet. Per-entity streams are the right long-term answer for
  a world with thousands of agents, but they change save format, entity identity, and CLOD
  behaviour all at once; that is a milestone, not a fix.
- Success criterion is **not** "the construction test stops needing more days." It is: T14 shows
  bounded qualitative variance across burns, and the construction test's day budget can be
  *lowered* back toward the measured completion day with margin, rather than raised again.

---

## Part 5 — Testing architecture audit

331 tests, 35 files, all green, and they encode a great deal of genuinely hard-won knowledge —
several test files exist because a real defect was found by a real benchmark and then pinned.
That is good practice and should not be disturbed. The gaps are categorical.

### Brittle tests / tests asserting incidental timing

- **`tests/living-world-logistics.test.ts:435`** — `advance(world, sim, 35 * SECONDS_PER_DAY/60)`.
  A 600 s-timeout, whole-village, 35-day integration test whose budget has been widened three
  times for unrelated reasons. Measured completion under pure RNG-phase perturbation: **1.44 to
  21.17 days at the same seed** (Part 4). The assertions are right; the budget is a chaos
  absorber sitting on top of a 14× distribution. **Keep the test; replace the fixed budget with a
  bounded-latency assertion across ≥ 3 seeds** ("completes within N days at each"), so a
  regression that pushes completion out *fails* instead of passing silently under a raised
  ceiling — and so the next person to widen it has to widen a measured bound, not a guess.
- **`tests/headless-benchmarks.test.ts:71`** — asserts two *different seeds* do not produce
  identical event counts *and* identical summaries. This is a tautology-adjacent test that can
  only fail if generation ignores the seed. It is not a divergence test.
- `SHORT_DAYS = 0.05` (72 world-minutes) in `headless-benchmarks` and `benchmark-report` tests.
  These verify plumbing, which is fine and should be labelled as such — but the file is named
  "headless benchmarks" and reads, to a reviewer skimming a PR, like benchmark coverage. It is
  not: **no committed test simulates more than 3 days except the one 35-day construction test.**

### Tests that validate implementation rather than behaviour

- `tests/stress-benchmarks.test.ts` "pickHaulTask itself declines to offer work to an exhausted
  person" — the test's own comment says the gate is elsewhere and then asserts
  `expect(offer).not.toBeNull()`, i.e. it asserts the *opposite* of its title, with
  `void personalCarryUnits;` to satisfy the linter. This is a documentation comment wearing a
  test's clothes. It should be deleted or rewritten to drive `think()`.
- Several `expect(...).toBeGreaterThan(0)` counters (`hauled:log > 0`, `resource_extracted > 2`)
  assert that a mechanism fires *at all*. Necessary, not sufficient — none asserts a *rate*.

### Tests that silently tolerate failure

- **`tests/stress-benchmarks.test.ts` "food pressure"** drains all grain/flour/bread, runs
  1.5 days, and asserts (i) a shortage event fired, (ii) needs stay within `[0,1]`, (iii)
  `≥ 30` people alive. (ii) is a clamp invariant that cannot fail. (iii) **cannot fail**, because
  nothing in the codebase can kill anyone by starvation. The test therefore certifies that a
  famine is survivable by construction. It asserts nothing about *recovery* — whether the chain
  refills, whether anyone eats again, how long the deficit lasts.
- `tests/ale-supply-invariant.test.ts` — four tests, all of which set `innkeeper.wealth = 500`.
  The invariant they prove (`net = value of unsold stock`) **depends on the innkeeper being
  solvent**: `restockTavern` computes `cost = min(qty × price, innkeeper.wealth)` and restocks
  regardless. At `wealth = 0` — which is the state the v0.7 report cites as its proof of success
  ("innkeeper wealth 0/0/0 at 90d") — the cost is 0 and ale enters the world free. The tests are
  well-reasoned and prove a real property; they just prove it only in the regime that does not
  occur. **Add the insolvent case.**

### Missing categories

| Category | Status |
|---|---|
| Invariant tests (conservation) | Partial. Item quantity and per-transaction currency are tested; **whole-world money supply is not**, and it is currently non-conserved. |
| Liveness tests | **None.** Nothing asserts anything keeps happening. |
| Property / metamorphic tests | **None.** No "same input class → same qualitative output". |
| Multi-seed tests | **None** beyond "two seeds differ". Every behavioural integration test uses seed 918271 or a fixed test-world seed. |
| Long-horizon tests | One (35-day construction). No committed 30/90-day economic test despite the roadmap's global rule "run real headless benchmarks" for every version. |
| Browser / Playwright tests | **Zero committed.** `playwright` is a devDependency; all browser verification across v0.4–v0.8 was ad-hoc throwaway driver scripts, with prose + screenshots in reports as the only artifact. There is nothing to re-run and nothing in CI. |
| CI | **None.** No `.github/` directory. Nothing runs `npm test` on push. |
| The shipped seed | `main.ts` boots `newWorld(1337)` unconditionally. **The world players actually play has never been benchmarked**; all evidence in every report is seed 918271. |

### Smallest high-leverage improvements (ranked)

1. **Feed the analysis from the telemetry stream, not `world.events`.** One change; removes D2
   entirely; unlocks every whole-run detector in Part 3 without touching the simulation.
2. **`invariant.currency_closed` (T5)** — ~20 lines, fails today, and its failure is a real
   defect (P0-1).
3. **`tail.deprivation_streak` (T3)** — ~15 lines, fails today, catches the single most
   embarrassing class of "tests pass, world is broken."
4. **`metamorphic.seed_neighbourhood` (T13)** at 3 seeds × 20 days, as a `npm run worldlab`
   target (not in `npm test`). Makes "works on one seed" impossible to claim.
5. **Two committed Playwright specs** (boot + `window.game.stepSim(3600)` + assert canonical
   state changed + assert one DOM affordance). Turns 5 milestones of screenshot prose into
   something that can regress.
6. **A `.github/workflows/ci.yml`** running typecheck + `npm test`. Everything above is
   decoration without it.

---

## Part 6 — Renderer / interface audit

### Is the voxel-first renderer adequate?

**As physical infrastructure: yes, and it should be kept.** The grid is genuinely canonical
(`sim/physical/`), the mesher is a faithful projection, nav is built from it, line-of-sight for
perception is computed on it, and doors have authoritative open/closed state that both perception
and pathing respect. That is exactly right, and it is what makes future digging/building/mining
tractable.

**As the only projection: no.** The current architecture has one rendering strategy — *write the
semantic state into a block id, then draw blocks* — and it has already hit its ceiling. Evidence:
v0.8 §C had to **add two new block ids to the palette to express two crop states**, and the same
change had to fix a latent mesher bug (blocks ignoring their own declared height). Every future
semantic distinction costs a palette entry, a save-compatibility consideration, and a mesher path.
That does not scale to trees with growth stages, damaged buildings, partial construction,
stockpiles with quantity, or carried cargo.

More concretely, here is what the simulation currently owns that the player cannot see at all:

| Canonical state | Currently rendered as | Gap |
|---|---|---|
| Stockpile quantity (`Item.quantity` at a Place) | one small prop at `place.inside`, identical for 3 and 500 units, co-located with every other resource type there | **the entire economy is invisible** |
| Construction progress (`laborDone / laborRequired`) | nothing, then the whole building at 100 % | 21 days of work show as an empty fenced plot |
| Tree lifecycle (`growthStage: felled/sapling/young/mature`) | `B.Air` when depleted, original blocks when regrown | 3 of 4 stages have no projection |
| Resource node remaining (`remaining/capacity`) | binary available/depleted | a nearly-exhausted quarry looks untouched |
| Carried cargo (`HaulTask.carried`, `cargoItemId`) | `pose = 'haul'` and the held weapon **hidden** | v0.8's own disclosed simplification |
| Body damage (`health/maxHealth`) | HUD number on target; no visual | a beaten NPC looks identical to a healthy one |
| Weather consequence (`physiology.wetness`) | nothing on the actor | rain has a physiological model and no visible result |
| Tools (`Item.condition` 1 → 0, `tool_broke`) | nothing | durability is unobservable |
| Actor work state | 8 poses (good — v0.8 §B) | the *object* of the work is not shown |

### Recommended hybrid architecture

Keep one rule from `AGENTS.md` absolutely intact — **`sim/` never imports `game/`, and the
renderer never owns state** — and add a second layer that reads canonical state directly rather
than through the block palette.

```
                      CANONICAL SIMULATION  (sim/)  — sole owner of truth
                       │
        ┌──────────────┴───────────────────────────────┐
        │                                              │
   VOXEL SUBSTRATE                              SEMANTIC ENTITIES
   world.grid (block ids)                       Item / ResourceNode / Field /
   • terrain, walls, floors, doors              ConstructionProject / Body / Person
   • anything a player will dig or build        • quantity, condition, growth,
   • the thing nav + LOS are computed from        progress, cargo, damage, wetness
        │                                              │
        ▼                                              ▼
   ChunkMesher (existing)                       PropRenderer  (new, game/props/)
   greedy-ish chunk meshes                      instanced meshes keyed by entity id,
   rebuilt on dirtyChunks                       rebuilt from a per-frame reconcile pass
        └──────────────┬───────────────────────────────┘
                       ▼
                 Three.js scene
```

**Placement rule — the thing that keeps this from becoming duplicate state:**

> A phenomenon belongs in the **voxel substrate** if and only if it must participate in
> collision, navigation, or line-of-sight. Everything else is a **semantic prop**, rendered from
> the entity, never mirrored into a block.

Applying that rule to the audit candidates:

| Candidate | Layer | Rationale |
|---|---|---|
| Trees (trunk) | **voxel** | blocks LOS and pathing; already correct |
| Trees (canopy, growth stage) | **prop** | a sapling/young stage needs no nav change; a prop can interpolate visually with zero palette cost |
| Crops | **voxel** (keep) | already correct, cheap, and they *do* affect walk cost |
| Resource nodes (remaining) | **prop overlay** on the voxel | e.g. a boulder that visibly shrinks; blocks stay authoritative for nav |
| Dropped items | **prop** (already) | correct today |
| **Stockpiles** | **prop, quantity-driven** | the single highest-value change: render N sacks/crates for N units, tiered (1 / 5 / 20 / 100), laid out along the Place's `work`/`inside` anchors instead of all at `place.inside` |
| Carried cargo | **prop parented to the actor's hand/back** | read `HaulTask.cargoItemId` → item type + quantity; replaces v0.8's "hide the held item" simplification |
| Buildings (finished) | **voxel** | they are walls |
| Construction stages | **prop scaffolding + partial voxel** | lay the foundation/frame as *real blocks* at 33 %/66 % (they should block movement — that is the point of a building site) and draw scaffolding/materials as props |
| Damage | **prop/material** | tint + a wound decal on the actor; block-level damage state on structures later |
| Weather consequences | **material/shader** | wet-sheen on actor materials driven by `physiology.wetness`; puddle decals on `Farmland`/`Path` driven by `Field.soilMoisture` — both read-only projections of state that already exists |
| Tools | **prop with condition** | already held; drive colour/notch from `Item.condition`; a broken tool visibly changes |
| Actor work states | **pose (existing) + prop** | keep the 8 poses; add the *object* — a sheaf when harvesting, a sack when hauling, a hammer strike at a build site |

**Constraints for whoever implements it:**

- `PropRenderer` must be a pure function of canonical state each frame: `reconcile(world) → meshes`.
  No prop may hold state that is not derivable from an entity. This is what prevents the duplicate-
  state failure mode; it is the same contract `ActorRenderer.sync()` already honours.
- Instanced meshes keyed by `entity.id`, with an add/remove diff exactly like
  `ActorRenderer.itemMeshes` already does. Stockpiles should be one instanced draw per resource
  type, not one mesh per unit.
- **Do not** add block ids for anything that is not dug, built, walked on, or seen through. The
  Seedling/Stubble additions in v0.8 were correct (crops affect walk cost and are dug/planted);
  a "half-built shed" block id would not be.
- Future digging/mining/building keeps working unchanged, because the substrate is untouched: a
  player mining a boulder edits blocks *and* decrements `ResourceNode.remaining`, and the prop
  overlay follows automatically.

---

## Part 7 — Constitution audit

Where an implementation passes its tests and still conflicts with the document.

### §4 / §76-I "Canonical Reality" — *"The simulation owns truth."*

> "It is not acceptable to preserve the appearance of depth by breaking canonical consistency."
> — §71

**Conflict: `restockTavern` and the abstract food types.** `ale`, `meat`, `cheese`, `pie` enter
the world from no source. The source comment is admirably honest about this. But the mechanism is
now load-bearing: it is the only food an entire occupation's schedule can reach, and its
"supply cost" silently destroys ~312 silver per 25 days. Constitution §39 is explicit that
"the economy should eventually represent real flows rather than arbitrary shop inventories."
This is an arbitrary shop inventory with a currency incinerator attached.

### §5 / §76-III "Local knowledge" — *"Entities do not automatically know canonical truth."*

**Conflict (presentation, not simulation): the HUD.** `hud.ts`'s target panel prints, for any NPC
the player looks at: their current **goal type** (`goal.type` and `goal.data.label`), their exact
**hit points**, and — in the top bar — the exact count of everyone alive in the village. v0.8 §G
went to real trouble to make *item ownership* respect `player.knowledge['owner:' + id]`, quoting
this principle. The same principle applies to another person's intentions and injuries. This is
an inconsistency in one file, not an architectural problem, and it is cheap to fix
(`goal.type` → an inferable activity word derived from the *pose*, which is genuinely visible;
hit points → a coarse visible-injury band).

### §6 "Knowledge Must Have Provenance"

**Conflict: `loc:` knowledge for items is unreachable.** §6 lists `witnessed`, `heard`, `told`
among valid provenances. The dialogue layer (`aboutItem`) is built to honour exactly that — and
then no runtime path ever produces `loc:<itemId>` with any provenance at all, so the honest answer
is always "I couldn't say." The epistemics are correct; the acquisition paths are missing.

### §9 / §76-VI "The Player Is an Entity, Not an Exception"

> "Whenever reasonable, anything fundamentally possible for the player should also be possible for
> appropriate simulated entities" — and the corollary in `AGENTS.md`: *"an NPC and the player
> should always go through the same code path for the same action."*

**Conflicts, in increasing severity:**
1. The player has `wealth = 25` **and** a `coins` item ×25 — two currencies. `buyItem` spends the
   coin item and credits `seller.wealth`; `sellItem` debits `buyer.wealth` and mints a coin item.
   No NPC has this dual representation. This is a genuine player exception in the money ontology.
2. The player cannot accept a `Request` (haul, build, production) and therefore cannot be paid a
   wage — a whole economic verb exists for NPCs only.
3. `agent.ts:1450` — lethality includes `attacker.controlled && dmg > 20 && rng.next() < 0.5`.
   The player kills on a coin-flip where an NPC needs explicit `intent: 'kill'`. This is a
   deliberate playability choice; it should be *stated as a constitutional exception* rather than
   left as an inline condition.

### §10 / §76-VIII "Motivations Before Scripts" — *"Generic systems should produce specific behavior."*

**Largely honoured, and worth saying so.** `think()` is a genuine utility arbiter and
`robbery.ts`'s comment is right that any hostile actor can drive the pipeline. The one place it
breaks down is the **desire system**: two hand-authored desires plus one narrow generator
(`item_missing`). Constitution §37's worked example (an Adventurer Guild emerging from demand)
requires desires to be produced by circumstance, and currently they essentially are not.

### §11 "Conflict Must Have Intent" / §76 "Death should mean something"

**Honoured for combat, and this is the project's best work.** But death means something *only*
in combat: it is the only way anyone can die. Constitution §55's benchmark list ("population,
deaths, ...") assumes population is a variable. Here it is a constant, in both directions — no
deaths from any non-violent cause, and no births.

### §39 "Economy" — *"Disruption should propagate."*

> ```
> war kills farmers → agricultural output falls → grain prices increase →
> urban hunger increases → crime increases → political pressure increases
> ```
> "These consequences should arise mechanically."

**Conflict: the propagation edges do not exist.** Hunger does not increase crime
(`banditResourcePressure` reads only faction wealth, which robbery does not increase). Prices do
not respond outside three food types. Wealth does not gate anything except affordability at a
counter. The chain terminates two links in.

### §46 / §76-XIII "Rendering Is Not Reality"

**Honoured architecturally** — `sim/` has no `THREE`/DOM/`window` imports; `initPhysical`/`initNav`
are simulation-owned; the headless runner drives the identical `Simulation.step`. This invariant
is in good shape and Part 6's recommendation is designed to preserve it exactly.

### §53 "Developer Observability" — *"The player/developer should not have to manually record every unusual event."*

**The central conflict of this audit.** Observability exists (telemetry, anomalies, chronicle,
benchmark report) and is genuinely well-built — but it is aimed at the wrong time window and the
wrong granularity, so a developer *does* have to notice by hand that bread is trending to zero,
that trees ran out on day 5, that a named person has been starving for a month. Part 3 is the
remedy.

### §55 "Artificial-World Benchmark" and §71 "Computational Pragmatism"

§55 prescribes: run 365 days, inspect population/wealth distribution/deaths/shortages, **then
repeat with another seed**, and judge *plausible divergence*. The project has never run this.
The longest committed run is 35 days at one seed; the browser ships a seed (1337) that has never
been benchmarked at all. §56's "one believable village" is the right priority — but "believable"
is precisely what the current harness cannot certify.

---

## Part 8 — Prioritized findings

Each finding: **evidence · affected code · why it matters · recommended test · milestone**.

### P0 — blocks declaring the current world functional

**P0-1 · The money supply has two sinks and no source, and is collapsing.**
*Evidence:* seed 918271, 30 days: total NPC wealth 1380 → 753 (−45 %); `supply_cost_amount = 312`
at 25 days; villagers below 3 silver 3 → 21 of 32; Gini 0.50 → 0.84. Reproduced at seed 918272
(1380 → 952 in 20 days, 19/32 below 3 silver).
*Code:* `world/metabolism.ts:383` `restockTavern` (explicit exit, unbounded in run length);
`mind/agent.ts:1544` `executeRobbery` (`victim.wealth -= amount` → mints a coin item that no NPC
can spend, because `buyFoodPortion`/`payWage` read `wealth`). No path anywhere adds currency.
*Why it matters:* Constitution §39. A village where most people cannot afford a loaf is a dead
economy; every downstream mechanic that depends on money (wages, wholesale, purchase, robbery
pressure) degenerates. It also invalidates the v0.7 conclusion: the fix bounded the *innkeeper's*
share by making the tavern a currency incinerator, and nobody measured the aggregate.
*Test:* **T5 `invariant.currency_closed`** — `Σ wealth + Σ coin-item quantity` must be conserved
modulo explicitly tallied exits. Fails today.
*Milestone:* **current v0.8**. This is not new scope; it is the correctness of a fix v0.8 merged.

**P0-2 · Named individuals starve for the entire run, and nothing can see it.**
*Evidence:* Vex (bandit) ≥ `urgent` hunger for 31/31 daily samples at seed 918271 and 21/21 at
918272; Brigid Tallow (guard) 25 days; Skarn 21 days. Village `avgHunger` looks unremarkable.
*Code:* `logistics/haul.ts:342` `canHaul()` excludes guard/captain/child/priest/acolyte/elder and
all hostiles from every wage path; `world/village.ts:284` skips bandits when seeding larders; the
bandit schedule keeps them at a camp with no food item; `mind/knowledge.ts:329` `knownFoodPlace`
ignores distance.
*Why it matters:* Constitution §5/§10 — these people have needs, a decision system, and no
reachable action that satisfies them. It is the exact shape of failure that averages hide.
*Test:* **T3 `tail.deprivation_streak`** (max consecutive hours ≥ urgent, per person, reported by
name) + **T4 `invariant.meals_per_person_day`** (measured 1.33 vs ≥ 2.1 required).
*Milestone:* detection in **current v0.8**; the fix (a food path for camps/guards) may be v0.9.

**P0-3 · The only benchmark horizon in the test suite is 72 world-minutes; the shipped seed has never been run.**
*Evidence:* `SHORT_DAYS = 0.05` in `headless-benchmarks.test.ts` and `benchmark-report.test.ts`;
longest committed run is the 35-day construction test at seed 918271; `main.ts:31` boots
`newWorld(1337)` unconditionally, and no report in `docs/` benchmarks 1337. My 20-day run at 1337
shows the same collapse (wealth 1380 → 1049, Gini 0.80, 20/32 below 3 silver, both bandits at
≥ urgent hunger for the entire run, `stuck_agent × 5` the only reported anomaly).
*Why it matters:* every pathology in this audit is invisible before ~day 5 and obvious by day 20.
The roadmap's own global rule requires "run real headless benchmarks" for every version; v0.8's
report states its evidence was browser verification, "not benchmark quantity" — so no long
headless run was performed for this milestone at any seed.
*Test:* **T13 `metamorphic.seed_neighbourhood`** as a `npm run worldlab` target, seeds
{1337, 918271, 918272} × 20 days, asserting qualitative outcomes only.
*Milestone:* **current v0.8**.

**P0-4 · The anomaly detector structurally cannot see 99 % of a run.**
*Evidence:* `telemetry/anomaly.ts` checks 4/5/6/8 use a 3-hour trailing window against
`world.events`, which `world.ts:183` `compactEvents(4000)` has already reduced to the last 4000
events plus `significance ≥ 0.5`. `resource_shortage` (0.2–0.3), `goal_changed` (0.12),
`path_failure` (0.0) never survive. My 30-day run produced 3180 shortages and reported
`stuck_agent × 5`.
*Why it matters:* Constitution §53. Every future milestone's "no anomalies" claim is unfalsifiable.
*Test:* re-point `detectAnomalies` at the telemetry stream (which is complete and pre-compaction),
and add whole-run detectors **T1, T7, T10, T11**.
*Milestone:* **current v0.8** — this is the enabling change for WorldLab.

### P1 — serious architectural fragility

**P1-1 · One global RNG stream couples weather to how many people are sawing.**
*Evidence:* **measured** — burning k ∈ {0..5} semantically meaningless `rng.next()` calls at the
same seed moves shed completion across **1.44 → 21.17 world-days (14×)**, moves day-25 village
wealth across 773 → 1059 (37 %), and decides whether the timber supply is exhausted at all
(day 4.13 / day 6.10 / never, in six runs). Mechanism: `agent.ts:955` draws per-actor-per-substep
during `work`; `agent.ts:1636` draws per-person-per-world-minute; weather (`agent.ts:1697`) shares
the same counter and drives soil moisture, rain penalties on outdoor work, wetness, and fog
perception range. The 12 → 25 → 35-day construction-test drift v0.8 §10 flagged as an
ARCHITECTURAL QUESTION is this, quantified.
*Why it matters:* it makes every long-horizon measurement non-comparable across commits, and it
makes "a change had no effect on X" unprovable.
*Test:* **T14 `metamorphic.rng_phase`** — burn k ∈ {0..5} draws, assert qualitative stability.
*Fix:* named lazy streams via the existing `RNG.fork`, migrating `weather` → `ambient` → `combat`
only. **Not** a sweeping rewrite. **Milestone: v0.9**, with T14 landing now as the measurement.

**P1-2 · Timber is a one-time stock of 84 logs behind a 912-day regrowth timer.**
*Evidence:* `world/village.ts:296` `plantGrove(..., 14)`; `world/resources.ts:24` `LOGS_PER_TREE = 6`;
`resources.ts:37` `TREE_REGROW_HOURS = 2.5 × 365 × 24`. Measured: 14 → 0 standing trees by day 5
at seed 918271 (14 → 9 at 918272, 14 → 3 at 1337; exhaustion day 4.13 / 6.10 / never under
RNG-phase perturbation).
*Why it matters:* the wood → plank → construction chain is presented (in `resources.ts`'s own
doc comment, in `resourceNodeSummary.treeGrowthStages`, in the roadmap) as a renewable system with
a lifecycle. Within every horizon anyone will simulate, it is a fixed stock. Any future milestone
that consumes wood (fire, fuel, crafting — i.e. PR #11) will exhaust the world permanently.
*Test:* **T12 `invariant.renewable_horizon`** — `capacity / consumption_rate > regrow_period`.
Fails by ~180×. *Milestone:* the invariant now (v0.8); the rebalance in v0.9.

**P1-3 · Grain is capped at the wrong stage; the food chain deadlocks with a full granary and an empty bakery.**
*Evidence:* `GRAIN_CAP = 500` gates the farmer's `harvest` goal (`agent.ts:445`). Measured: grain
pinned ~500 while bread fell 267 → 34; 3180 shortage events.
*Why it matters:* the chain is *structurally* correct and *behaviourally* broken — exactly the
class of defect that only a time series reveals.
*Test:* **T4** + a stock-ratio liveness check (downstream stock must not fall for N consecutive
days while upstream is at its cap). *Milestone:* v0.8 detection, v0.9 fix.

**P1-4 · `save.ts` does not persist RNG state, so load rewinds the world's random stream.**
*Evidence:* `persist/save.ts:111` serializes `clock`, `physicalTime`, `weather`, `counters`, and
no RNG. `deserialize` calls `newWorld(seed)` → `generateVillage`, leaving `world.rng` at its
post-generation position regardless of how long the saved world ran.
*Why it matters:* a 30-day world that is saved and reloaded does not continue — it re-plays the
day-0 stream. Determinism tests pass because they never save mid-run. This also **must** be fixed
before P1-1's named streams land, or the problem multiplies.
*Test:* run N seconds → serialize → deserialize → run M more; compare against an uninterrupted
run of N+M. *Milestone:* v0.8 or v0.9; needs a `SAVE_VERSION` bump.

**P1-5 · Nothing is enforced about ownership, and the player is the only actor who can violate it freely.**
*Evidence:* `interaction.ts` `interact()` on an item calls `sim.takeItem(player, it, 'theft')` for
any owned item — including a 40-unit bread stack at the bakery — with the sole consequence being
whether anyone perceives it. *Milestone:* v0.11 (the roadmap's own property/law milestone). Noted
here because v0.8 §G improved the *legibility* of ownership without touching its force.

**P1-6 · `mind/economy.ts` documents a feedback loop the code does not implement.**
*Evidence:* Part 1(b). `banditResourcePressure` sums `wealth`; `executeRobbery` never credits it.
*Why it matters:* a doc comment asserting a causal loop that does not exist is worse than no
comment — it is exactly what "do not assume architecture-report claims are true" is guarding
against. *Test:* a unit test that robs a bandit's target and asserts pressure decreases.
*Milestone:* v0.8 (either fix the loop or correct the comment; do not leave both).

**P1-7 · `stuck_agent` fires on every long run, on every seed, and is treated as noise.**
*Evidence:* `stuck_agent × 5` (918271/30d), `× 6` (918272/20d). *Why it matters:* the one
detector that does fire has been normalised. *Test:* assert `stuck_agent` count is 0 in a healthy
run, or explicitly triage each. *Milestone:* v0.8.

### P2 — important but safe to defer

- **P2-1 · The generated-task chain has no knowledge-acquisition path for items.** `loc:<itemId>`
  is never written at runtime (`locationKnowledge` is called only for *bodies*, `agent.ts:123`),
  and `owner:<itemId>` is written in exactly three generation-time places (`village.ts:399/402/403`).
  The only working instance of the whole chain is the authored ring; v0.8 §G's ownership label and
  §E's "ask about an item" both depend on knowledge nothing produces. *Test:* an end-to-end test
  on a *generated* `item_missing` desire, not the seeded one. *Milestone:* v0.9.
- **P2-2 · `Desire.reward` is never paid.** The player is told "30 silver" and receives nothing.
  *Milestone:* v0.9 (small; `giveItem` already has both parties).
- **P2-3 · Stockpiles, construction progress, tree stages, damage, wetness and cargo are
  canonical and unrendered.** Part 6. *Milestone:* v0.9 as a scoped "PropRenderer" pass.
- **P2-4 · The HUD is omniscient about NPC goals, hit points and village population.** Part 7.
  Cheap, and it closes an inconsistency v0.8 itself opened. *Milestone:* v0.9.
- **P2-5 · No CI, no committed Playwright specs.** Five milestones of browser evidence exist only
  as prose. *Milestone:* v0.8 or v0.9; small and permanently valuable.
- **P2-6 · Pricing covers three item types.** Scarcity cannot propagate through the wood/stone
  chain at all, and wholesale ignores scarcity entirely. *Milestone:* v0.9–v0.11.
- **P2-7 · `tests/stress-benchmarks.test.ts`'s food-pressure test cannot fail** (no starvation
  death exists; `≥30 alive` is vacuous). Rewrite it around *recovery latency*. *Milestone:* v0.8.
- **P2-8 · The ale-supply invariant is untested in the regime it actually runs in** (insolvent
  innkeeper). *Milestone:* v0.8 (one test).

### P3 — future depth

- **P3-1 · Population is a constant.** No births, no non-violent deaths, no ageing. Constitution
  §55's benchmark presumes demography. This is a milestone of its own.
- **P3-2 · Desires are essentially authored.** Constitution §37 (institutions emerging from
  demand) is unreachable until circumstance generates goals at the *desire* level, not just the
  goal level.
- **P3-3 · One village, one project, one grove, one quarry, one metaphysics.** World generation
  varies terrain and dice, not structure; §55's "plausible divergence" between seeds cannot be
  demonstrated until generation composes settlements rather than places them.
- **P3-4 · CLOD tiers `deep`/`aggregate` are defined and unused.** Fine for now; flagged so it
  isn't mistaken for working infrastructure.
- **P3-5 · Non-renewable stone has no consumer.** 52 of 72 units are frozen forever; exhaustion —
  the only thing that makes non-renewability meaningful — cannot occur.

---

## Part 9 — Review checklist for Sonnet's v0.8 PR

Designed so that **tests passing, one benchmark seed, one successful event, final-state
screenshots, and architecture-report prose are each individually insufficient**.

Ask for the artifacts, not the claims. Every item below is either a file in the PR or a number in
a committed report.

### A. Evidence that is not prose

- [ ] **A1.** A committed, re-runnable command produces the long-horizon evidence
      (e.g. `npm run worldlab`). Not a throwaway script, not a screenshot, not a table typed into
      a `.md`. If I cannot re-run it from the PR, it is prose.
- [ ] **A2.** Its output is a **committed artifact** (JSON) with a stable shape, diffable against
      the previous milestone's — like `benchmarkReport.ts` already is.
- [ ] **A3.** At least **three seeds**, one of which is **1337** (the seed `main.ts` actually
      boots). If the report cites only 918271, the shipped world is unmeasured.
- [ ] **A4.** At least **20 world-days** per seed. Every pathology in this audit is invisible
      before day 5.
- [ ] **A5.** Any Playwright evidence is a **committed spec file** that fails if the behaviour
      regresses. A screenshot in a report is not evidence; it is a memory of evidence.

### B. Time series, not endpoints

- [ ] **B1.** Every stock claim is a **series**, not a final value. "bread: 34" is not an answer
      to "is the food chain working."
- [ ] **B2.** Every "it completes" claim carries a **latency**: which day, and how many days it
      spent in each status. "The shed completes" hid 20 days at 0 % labour.
- [ ] **B3.** Every "no anomalies" claim states **which window** the detector covered. If it is
      still the 3-hour trailing window over `world.events`, the claim means "nothing broke in the
      last three hours of a 30-day run."
- [ ] **B4.** Any monotone trend across the run (in either direction) is called out explicitly,
      even if the endpoint looks fine.

### C. Individuals, not averages

- [ ] **C1.** A **per-person deprivation table**: max consecutive hours at ≥ urgent hunger /
      thirst / sleep, top 5 by name and occupation. Any value over 48 h is a finding, not a note.
- [ ] **C2.** A **per-occupation income and food-access check**: every occupation has at least one
      reachable income path and at least one reachable food source. Currently six occupations fail
      the first and two fail the second.
- [ ] **C3.** Wealth distribution reported as **Gini + count below one loaf**, sampled over time —
      not `avg/min/max` per occupation.

### D. Conservation and liveness

- [ ] **D1.** `Σ wealth + Σ coin-items` reconciles start → end against tallied exits. Any residual
      is named. (This currently fails by ~295 silver per 25 days.)
- [ ] **D2.** No 3-day window with zero `crop_harvested`, `resource_transformed`, `food_consumed`,
      or `resource_delivered`.
- [ ] **D3.** For every renewable resource: `capacity / consumption_rate > regrow_period`, stated
      as a number. (Timber currently fails by ~180×.)
- [ ] **D4.** For every new resource or process the PR introduces: where does the first unit come
      from, and is that source itself produced? An `unexplained_material` count of zero, or an
      explicit list of abstraction debts with a milestone attached to each.

### E. Robustness, not a lucky trajectory

- [ ] **E1.** **No test's day/time budget was widened** to make it pass. If one was, that is the
      finding — the fix is a bounded-latency assertion at multiple seeds, not a bigger ceiling.
      (`living-world-logistics.test.ts` has now been widened three times: 12 → ~25 → 35.)
- [ ] **E2.** A **metamorphic RNG-phase result**: same seed, k ∈ {0..5} meaningless extra draws,
      qualitative outcomes stable. If completion day swings by more than ~2× across k, the PR is
      measuring a trajectory, not a world.
- [ ] **E3.** Neighbouring seeds (s, s+1, s+2) produce the same **qualitative** verdicts.
- [ ] **E4.** If any RNG consumer was added, removed, or moved, E2 was re-run before and after.

### F. Tests that can actually fail

- [ ] **F1.** For each new test, ask: *what world would make this fail?* Reject any test whose
      failure condition is unreachable — e.g. asserting nobody starved to death in a world where
      starvation cannot kill.
- [ ] **F2.** No new `expect(x).toBeGreaterThan(0)` stands alone as evidence a system works. It
      proves the mechanism fires once. Pair every one with a **rate** or a **latency**.
- [ ] **F3.** Every new invariant is **derived** from the constants it constrains, not tuned to
      the observed number. (The v0.7 ale post-mortem is the right precedent: `cost == ITEM_VALUE.ale`
      is an identity; `ITEM_VALUE.ale - 0.1` was a calibration.)
- [ ] **F4.** Any test that sets a field to make the scenario work (`innkeeper.wealth = 500`) has a
      sibling test for the regime the simulation actually reaches (`wealth = 0`).

### G. Constitutional review

- [ ] **G1.** Does anything new let an entity act on truth it did not acquire? Check both
      simulation *and* presentation (the HUD currently leaks goal type and hit points).
- [ ] **G2.** Can the player do it, and can an NPC do the same thing through the same function?
      Name the shared function. (`harvestPlot` — good. Requests/wages — currently NPC-only.)
- [ ] **G3.** Is any new behaviour keyed on a name, an occupation string, or a specific entity
      rather than on capability, need, and circumstance?
- [ ] **G4.** Does any new resource appear from an abstraction? If yes, is it disclosed *in the
      report's disclosure section* and does it have a follow-up milestone?
- [ ] **G5.** Is any new consequence purely cosmetic — a visual, a line of dialogue, or an event
      summary with no canonical state behind it?
- [ ] **G6.** Does `sim/` still import nothing from `game/`? Does any new renderer object hold
      state not derivable from an entity?

### H. Disclosure discipline

- [ ] **H1.** Every item the PR classifies as FOLLOW-UP has a **milestone** and a **one-line
      reason it is safe to defer** — not just a label.
- [ ] **H2.** Any claim inherited from a previous report (e.g. "the wealth sink is closed") that
      this PR relies on was **re-measured**, not re-cited.
- [ ] **H3.** The report distinguishes, for every acceptance criterion, whether it was satisfied
      by an **authored** instance or a **generated** one. (v0.8's "generated lost-item task
      completed end-to-end" is satisfied by the authored ring; no generated instance is
      completable.)

### The four questions to ask before approving

1. **Where is the time series?** If the answer is a final-state number, the PR has not shown the
   world works — only how it looked when the clock stopped.
2. **Who is the worst-off individual, by name?** If the answer is an average, the PR cannot see
   the failure mode this world is most prone to.
3. **What would make this test fail?** If nothing realistic would, it is documentation.
4. **Does it hold at seed 1337 and at seed s+1?** If it holds at one seed, it is a trajectory.

---

## Appendix — the probes

Two tools were added under `tools/audit/`. They are outside `src/`, imported by nothing in the
simulation, and read-only with respect to canonical state.

```bash
npx tsx tools/audit/worldlab-probe.ts --days 30 --seeds 918271,918272,1337
npx tsx tools/audit/rng-coupling-probe.ts --days 25 --seed 918271 --burns 0,1,2,3,4,5
```

**Every number in this audit was measured against `claude/v0.8-legible-world` @ `8bea2ae`**, not
against the `main`-based branch these files are committed on. Re-running them on a different
commit will produce different numbers — that is P1-1, not a bug in the probes. Re-run them on
whatever commit is under review and compare *qualitative* verdicts, not digits.

They live outside `tsconfig.json`'s `include` (`["src", "tests"]`) on purpose, so an audit tool
can never affect `npm run typecheck` or `npm run build`; they run under `tsx`, which the repo
already uses for `npm run sim`.

They are deliberately *not* wired into `npm test`: they are 2–20 minutes of wall clock each, and
their purpose is to be the measurement substrate a real WorldLab replaces. Everything they print
is derivable from state the simulation already owns — which is the point: **none of these findings
required new simulation state, only a different place to look and a different length of time to
look for.**
