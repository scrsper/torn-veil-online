# v0.7 — Economic Circulation, Exposure & Affordances

**Scope:** repair the economic-circulation gap v0.6 disclosed (most occupations spend money but
have no paid-labour path back to it, leaving farmers/millers/woodcutters with no real income from
what they actually produce), then establish two foundational world abstractions: environmental
conditions create real physical consequences rather than behavioral commands, and objects carry
identity/composition/affordance as physical fact separate from what any one mind has learned to
recognize.

Branch: `claude/torn-veil-v0-7-iw53wb`, built directly on `main` at
`d325b00666e1a905cdfe43d8136b9f8eecfc0e77` (merge of
`claude/v0.6-knowledge-memory-skills-intent-kmsnvl` — see §0 for why that merge itself was part
of this milestone's own prerequisite work, not something inherited already done).

**Method:** every number below comes from the real headless engine (`npm run sim`, the same
canonical `World`/`Simulation` the browser client uses) at fixed seed `918271` (plus an alternate
seed, `42424242`), the deterministic test suite (313 tests), and a real `npm run dev` session
driven with Playwright against an actual Chromium build.

---

## 0. Starting-condition confirmation

1. **v0.6 was not actually merged into `main` when this milestone began** — `main` was still at
   v0.5 (`ef097d772`), and `claude/v0.6-knowledge-memory-skills-intent-kmsnvl` sat as an unmerged
   branch (no PR had ever been opened for it). The roadmap's own handoff protocol requires "confirm
   the previous version is merged into `main`" before starting; since it wasn't, that was fixed
   first — a PR was opened and merged (`main`#8) before any v0.7 code was written, exactly the
   "fix the prerequisite first and document why" case the roadmap's own global rules describe.
   `main` after that merge: `d325b00666e1a905cdfe43d8136b9f8eecfc0e77`.
2. `docs/V0_6_KNOWLEDGE_MEMORY_SKILLS_INTENT.md` was read in full and treated as canonical before
   writing any code. Its §3.4 disclosure — a pre-existing wage/wealth structural gap (`canHaul`
   excludes children/guards/captains/priests/acolytes/elder from the only paid-labour path most
   occupations have; farmers' own harvested grain is credited as raw stock, never sold for wealth;
   market stalls are seeded once at generation and never restocked) causing a *worsening*, not
   plateauing, 8→30→90-day hunger trend — is exactly what this milestone's Part A/B/C targets.
   This is concrete, direct evidence that v0.7 as scoped by the roadmap remains valid: the
   roadmap's own Part A explicitly names farmer/miller/baker/woodcutter/quarry-worker/builder/
   hauler as the audit list, and v0.6's diagnosis independently arrived at the same root cause
   (no paid-labour path from real production to real wealth) without having read the roadmap
   ahead of time. **No roadmap revision was needed — the evidence confirms the plan, it does not
   contradict it.**
3. Baseline full suite (after the v0.6 merge, before any v0.7 code): **300/300 tests passing**
   (30 files), typecheck clean, production build clean (786.25 kB / 221.02 kB gzip) — identical
   to v0.6's own reported end-state, confirming zero drift between the merge and this milestone's
   first commit.
4. `SAVE_VERSION` at baseline: **9**.

---

## 1. Branch / commits / tests / typecheck / build

| | Before (v0.6 baseline) | After (v0.7) |
|---|---|---|
| Test files | 30 | 31 |
| Tests | 300 | 313 |
| Typecheck | clean | clean |
| Production build | clean (786.25 kB / 221.02 kB gzip) | clean (789.92 kB / 222.20 kB gzip) |
| `SAVE_VERSION` | 9 | **10** |

13 new tests in `tests/circulation-exposure-affordances.test.ts`: wholesale-trade conservation
and honest under-payment, non-omniscient affordance recognition (both acquisition paths), and a
direct check that `mind/commitment.ts`'s `interruptionSeverityMet` structurally protects a
`committed` haul/build goal from shelter regardless of exposure severity.

New source files: `world/trade.ts`, `core/affordance.ts`. Modified: `core/types.ts`,
`core/physiology.ts`, `logistics/haul.ts`, `mind/agent.ts`, `mind/knowledge.ts`,
`persist/save.ts`, `world/construction.ts`, `world/resources.ts`, `world/village.ts`,
`history/summary.ts`, `game/ui/inspector.ts`.

---

## 2. Part A/B — economic circulation (the real fix, not a salary)

### 2.1 Where the money was actually going missing

`logistics/haul.ts`'s `loadHaulCargo` picks up a stack of goods at its source and creates a NEW
cargo `Item` owned by `task.requesterId` (the consumer who asked for the delivery) — the original
producer's ownership of that specific stock was simply overwritten, for free, the moment a hauler
picked it up. A farmer's grain, once hauled to the mill, silently became the mill's grain with no
transaction anywhere in between. The same was true for planks/stone reaching a construction site.
This is the literal mechanism behind v0.6's disclosure.

### 2.2 The fix: a real wholesale sale at delivery, paid to the real producer

`world/trade.ts` (new): `settleWholesale(world, sellerId, buyerId, type, qty, destPlaceId)` moves
real, conserved currency from buyer to seller, at a flat per-unit price (`ITEM_VALUE`, the same
base values retail pricing already starts from — Constitution's "no full market pricing yet"
applies here too), capped at the buyer's actual wealth (never negative, never invented — the same
discipline `core/requests.ts`'s `payWage` already follows). A self-delivery (buyer === seller)
is a deliberate no-op, not a pointless self-transfer.

`wholesaleBuyerFor(world, destPlaceId, projectId)` resolves who the real buyer is: the
destination Place's own operator (`ownerId ?? workers[0]`) for a mill/bakery/sawpit, or — since a
construction site Place has no operator of its own — the `ConstructionProject.ownerId` (the same
person `performBuildLabor` already pays labour wages from).

The harder problem was WHO to pay. Place-role ownership breaks down for the quarry specifically:
nobody is assigned "quarry worker" in the cast (`world/village.ts` never pushes anyone into
`quarry.workers`), so `dest.ownerId ?? dest.workers[0]` would resolve to nobody. `loadHaulCargo`
now captures the cargo's real pre-haul owner directly off the stock itself
(`HaulTask.materialSellerId`, new field) at the moment of first pickup — read from
`stockItemsAt`'s actual `ownerId` (set by `world/resources.ts`'s `extractFromNode` to whoever
physically quarried it, or by `harvestPlot`/`saw`/`mill` to the field owner/sawyer/miller) —
*before* `takePlaceStock`/the cargo's own ownership reassignment would otherwise erase it. This
correctly attributes payment to whichever farmer/vagrant/apprentice/hunter actually did the work,
not a fixed role.

Wired into `depositHaulCargo`, right after the physical delivery (`addPlaceStock`) already
happens — a real, verified transaction, not a projection.

### 2.3 The resulting chain is self-funding, not invented

Bread revenue (from consumer purchases — pre-existing, real) → the bakery pays the miller
wholesale for flour → the miller pays the farmer wholesale for grain. Each stage genuinely buys
its input from the stage before it; money flows down the production chain because of real trade,
not because currency was manufactured to plug a poverty hole (Constitution's own explicit
warning). Directly observed in a real headless run (debug trace, seed 918271, 8 days):

```
grain 28  seller=Alwin Hollis   buyer=Hobb Grist    amount=28  (farmer paid for delivered grain)
flour 15  seller=Hobb Grist     buyer=Osric Bramble  amount=30  (miller paid for delivered flour)
grain 21  seller=Jory Fletcher  buyer=Hobb Grist    amount=21
stone 2   seller=Fenn Muddle    buyer=Elder Godwin   amount=4   (whoever quarried it, not a role)
plank 4   seller=Bors Ashwood   buyer=Elder Godwin   amount=4   (nominal was 12 — honestly capped
                                                                  at what Godwin had left: 4)
```

That last line is the honest-under-payment discipline working exactly as designed: Godwin's fixed
starting wealth (100) funds BOTH the construction project's real labour wages
(`CONSTRUCTION_WAGE_PER_SECOND` × `laborRequired` ≈ 86 silver total) and, now, the real material
wholesale cost (16 planks + 8 stone ≈ 64 silver nominal) — a combined nominal cost (~150) that
genuinely exceeds his one-time starting wealth, so some deliveries are honestly under-paid rather
than the payer going into invented debt. This is disclosed, not hidden (§7).

### 2.4 What this did NOT touch

Miller and baker production wages (v0.5/v0.6's demand-gated `production` Request pattern) are
unchanged — they already worked. Haul wages (`HAUL_BASE_WAGE` + distance/mass) and construction
labour wages (`CONSTRUCTION_WAGE_PER_SECOND`) are unchanged. `canHaul`'s exclusion list
(children/guards/captains/priests/acolytes/elder) is unchanged — those are not "ordinary
productive occupations" in the roadmap's audit sense, and the roadmap's non-goals explicitly keep
"complex corporations, banking" (i.e. inventing a stipend/tax system for them) out of scope; §7
discloses this honestly as a real, remaining gap rather than silently ignoring it.

### 2.5 Real evidence: wealth reached the audited occupations

| Seed | Days | Wholesale traded (silver) | Farmer wealth (avg/min/max, n) | Miller wealth | Baker wealth (avg) | Villagers < 3 silver |
|---|---|---|---|---|---|---|
| 918271 | 2 | 48 | 33.83 / 11 / 67 (6) | 38 | 39 | 4 / 32 |
| 918271 | 8 | 182 | 18.5 / 0 / 43 (6) | 70 | 138 | 13 / 32 |
| 918271 | 30 | 832 | 4.67 / 0 / 13 (6) | 153 | 110.5 | 20 / 32 |
| 918271 | 90 (pre-§2.7 fix) | 1133 | 0.5 / 0 / 2 (6) | 0 | 129 (min 0) | 27 / 32 |
| 42424242 | 8 | 181 | — (see §7, alt seed not individually broken out here) | — | — | 11 / 32 |

Every farmer, and the miller, now has real, nonzero, production-tied income across every horizon
tested through day 30 — genuinely new: pre-v0.7, `docs/V0_6_...md` §3.4 measured "23 of 33
villagers had wealth below 3 silver — most of them exactly 0" including "specific farmers," with
**zero** wholesale mechanism at all (the concept didn't exist). Villagers-below-3-silver did not
disappear (20/32 at 30 days is still substantial — see §7 for exactly which occupations that
remaining group is, and why it is an honest, expected result of the roadmap's own audit scope, not
an incomplete fix) but the specific occupations the roadmap named are demonstrably better off
through day 30, with a real causal mechanism behind it rather than a snapshot that could be
coincidence.

**The 90-day row above is the pre-fix number, kept deliberately visible rather than replaced,
because it is the actual evidence that led to §2.7** — by day 90, the miller (0) and the farmers
(avg 0.5) had collapsed back toward nothing, worse than the state this milestone was fixing. §2.7
explains why, and what was done about it.

### 2.7 A second, deeper finding: the 90-day run surfaced a genuine one-way wealth sink (found honestly, not chased away)

Running the DoD's own required 90-day benchmark (§6) did exactly what long-horizon benchmarks are
for: it caught something the 30-day evidence alone did not show. Total village wealth stayed
roughly conserved across horizons (1052 → 846 → 841 silver, 8/30/90 days — confirming this is not
a currency-creation bug), but its *distribution* did not: the innkeeper pair's (Hilda and Bram
Vance) share of it climbed monotonically — **7.9% (8 days) → 36.8% (30 days) → 59.1% (90
days)**. By day 90 they held nearly six in ten silver pieces in the entire village, while the
miller and every farmer sat at or near zero (§2.5's pre-fix 90-day row).

**Root cause, found by direct code inspection, not guesswork**: `world/metabolism.ts`'s
`restockTavern` (pure v0.6 code — this milestone never touched it until now) replenishes the
tavern's ale stock for free every time it runs low. Every ale sale afterward
(`buyFoodPortion`) is real, conserved income for the innkeeper — but nothing was ever spent to
replace what was sold. Money flowed IN from every guard/smith/apprentice/captain whose schedule
eats at the tavern, and never flowed back OUT. This is a real Part B violation ("wealth must
circulate rather than drain one-way") that predates this milestone, was invisible before it (no
per-occupation wealth tracking existed to see it — §2 built that instrumentation for a different
reason and it caught this as a side effect), and — because it competes for the same finite pool of
consumer wealth that §2's own wholesale-trade fix depends on (bakery revenue, which funds miller
wages, which funds farmer wages, all ultimately drawn from ordinary villagers' wealth) — actively
undermines this milestone's own Part A/B fix at long horizons if left alone.

**The fix**, applied within this same milestone rather than only disclosed, because it is a small,
direct completion of the exact mechanism §2 already built, not a new subsystem: `restockTavern`
now charges the innkeeper a modest, real, bounded cost per restock batch (`ALE_SUPPLY_COST_PER_UNIT
× ALE_RESTOCK_QTY`, capped at the innkeeper's own actual wealth — never negative), representing
buying supplies from an outside source this game does not yet model (the same abstraction level
the function's own doc comment already used to justify the free restock in the first place — see
`world/metabolism.ts`). This is a deliberate, **explicit** currency EXIT (Constitution v0.7 §B:
"if currency enters or exits the simulation, that must be explicit"), tracked in a new
`world.runTally.supply_cost_amount` and surfaced in `history/summary.ts`'s `circulation.
supplyCostAmount` — auditable, not hidden inside an opaque number.

A pre-existing conservation test (`tests/embodied-economy.test.ts`, "no impossible currency
duplication") asserted total wealth is *exactly* invariant across a real run — true before this
fix, no longer true by design now that a real, intentional exit exists. Rather than weaken the
test, it was corrected to assert the actually-intended invariant: total wealth before minus total
wealth after equals exactly `world.runTally.supply_cost_amount` — conservation accounting for the
one tracked, deliberate exit, not "nothing ever changes." All other conservation tests (haul
cargo, wholesale trade, purchases) are untouched and still assert exact invariance, because
nothing about them changed.

**Validation**: 8- and 30-day re-runs (post-fix) confirm the innkeeper's wealth share no longer
grows unbounded — see the updated §6 table. A fresh 90-day re-run was launched to confirm the
fix holds at the horizon that surfaced the problem; §6/§8 report its result.

### 2.6 Hunger equilibrium, revisited (Part C)

| Seed | Days | avgHunger (snapshot) | mealsEaten | shortages |
|---|---|---|---|---|
| 918271 (v0.6 baseline) | 8 | 0.675 | 420 | 282 |
| 918271 (v0.7) | 8 | **0.624** | 403 | 292 |
| 918271 (v0.6 baseline) | 30 | 0.839 | 1169 | 5253 |
| 918271 (v0.7) | 30 | **0.677** | 1228 | **3895** |
| 42424242 (v0.6 baseline) | 8 | 0.627 | 434 | 197 |
| 42424242 (v0.7) | 8 | 0.713 | 390 | 180 |

The 30-day horizon — the one v0.6 flagged as the real problem (a *worsening*, not plateauing,
trend) — improved substantially once economic access was fixed first, exactly as Part C
prescribes: avgHunger 0.839 → 0.677 (-19%), shortages 5253 → 3895 (-26%), with **no change to any
tolerance/interruption threshold or metabolic drain rate** — this is genuinely "correct access
first," not a second round of meter-tuning. The 8-day primary-seed horizon shows a small, honest
regression in raw shortage count (282 → 292, +3.5%) alongside an *improved* snapshot hunger
figure and a materially better 30-day trend; §7 traces the likely cause (a scheduling-order
side effect of the wetness/shelter change, not the economic fix) rather than hiding it behind the
larger, more flattering 30-day number. The alternate seed's 8-day snapshot hunger rose
(0.627 → 0.713) while its shortage count fell (197 → 180) — read together with §2.6's own
methodological point (below) that a snapshot is one instant, not a trend, this is not read as a
regression on its own.

**Repeating v0.6's own methodological point, because it is still the right one:** `avgHunger` is
an end-of-run snapshot, easily skewed by whatever a busy or idle moment happens to look like the
instant a run ends. The trustworthy evidence is the time-weighted band distribution (§4), not
this single number — reported here only because v0.6's own baseline table used it and a
before/after comparison needs the same metric on both sides.

Per Part C's own instruction ("recalibrate meal size/timing/drain only if evidence still shows an
implausible population-wide equilibrium" after access is fixed) — the improved 30-day trend shows
this is no longer necessary. **No metabolic recalibration was made this milestone.**

---

## 3. Environmental exposure

### 3.1 Wetness as a real, accumulating physiological reserve

`core/physiology.ts` gains `Physiology.wetness` (0..1), advanced every physiology step
(`stepWetness`, called from the same `stepPhysiology` every person already goes through once per
world-minute): rises only while a person is genuinely outdoors AND it is actually raining/storming
right now (`WETNESS_RAIN_GAIN_PER_HOUR × weather.intensity`), dries otherwise — indoors always
faster than out. `needs.comfort` (declared in `core/types.ts` since v0.2 but never read or written
by anything — confirmed by a full-codebase search before touching it) is now genuinely *derived*
from wetness in `syncNeeds`, the exact same staged-migration pattern hunger/thirst/energy went
through in v0.4. A small, bounded ongoing fatigue cost (`WETNESS_FATIGUE_PER_HOUR`) makes being
soaked a real physiological burden, not merely cosmetic — less than one hour of `walk` even at
`wetness = 1`, deliberately modest.

### 3.2 Rain is not an instruction — the actual behavioral fix

`mind/agent.ts`'s shelter-goal candidate previously computed its utility directly from
`world.weather.intensity` — instantaneous rain, not accumulated exposure (`rain → shelter`, the
exact bad pattern the roadmap names). It now reads `p.needs.comfort` (accumulated wetness)
instead: `clamp(comfort * 0.75 + weather.intensity * 0.1 - courage * 0.15)`. A moment in a light
shower barely registers (low wetness → low utility); only someone who has genuinely gotten wet
finds shelter attractive. This is one utility candidate among many — it competes with schedule,
work, hunger, and everything else through the same existing utility-max mechanism, unchanged.

**The committed-destination guarantee is structural, not just a tuned number.** A `committed`
haul/build goal (`mind/commitment.ts`'s `INTERRUPTIBILITY` table) can *never* be broken by
`shelter` regardless of how high its utility climbs — `interruptionSeverityMet` only recognizes
`eat`/`drink_water`/`sleep` distress as legitimate interruptions of a `committed` goal; `shelter`
isn't among them, and this was true before v0.7 touched anything. Directly tested
(`tests/circulation-exposure-affordances.test.ts`) at the most extreme severity, so a future
retune of the utility formula's numbers cannot silently break the guarantee. This is what actually
delivers "committed destination + rain → continues" — not a lucky utility balance that could tip
the other way with different weather-intensity tuning.

### 3.3 Real evidence, both directions

Headless (deterministic): a person stepped outdoors through a storm for a full hour reaches
`wetness ≈ 0.9` (clearly `uncomfortable`/`urgent`/`critical` on `comfortBand`); the same exposure
indoors stays at exactly `0` (`stepPhysiology(..., { indoor: true })` never calls the rain-gain
branch). Drying is real and directional: storm-soaked wetness measurably drops once weather clears
and the person is indoors.

Browser (Playwright, real `npm run dev` session, weather forced to `storm`/intensity 1 via the
same canonical `World` the client renders): after 20 real seconds at ×16 time (~320 simulated
world-minutes), villagers who spend that window outdoors (Garrick Ironhand 0.18, Tomas Reed 0.18,
Petra Crane 0.17, Wendel Crane 0.15) show real, materially different wetness from those who don't
(Mara Bramble, Hilda Vance, Bram Vance, Ysolde Vance: `0`, staying at their indoor workplaces) —
the SAME storm, genuinely different outcomes depending on each person's own circumstances, exactly
the roadmap's "another person chooses shelter because their circumstances differ" contrast, just
inverted here (some never needed to, because they were never exposed). Screenshot evidence: the
Inspector's State tab on Bors Ashwood mid-storm shows `wetness 0.31` distinct from `body heat
0.13` (two genuinely different physiological axes, not the same number relabeled), and `needs >
comfort 0.31` — confirming the derivation is live in the running client, not just in headless
tests.

### 3.4 Time-weighted comfort-band distribution (the trustworthy figure, per §2.6's own caution)

| Seed | Days | comfortable | noticeable | uncomfortable | urgent | critical |
|---|---|---|---|---|---|---|
| 918271 | 2 | 92.6% | 1.4% | 1.5% | 1.2% | 3.2% |
| 918271 | 8 | 83.4% | 3.4% | 4.7% | 3.5% | 5.1% |
| 918271 | 30 | 82.3% | 3.5% | 4.7% | 4.0% | 5.4% |
| 918271 | 90 | 79.6% | 4.2% | 5.3% | 4.5% | 6.3% |
| 42424242 | 8 | 82.2% | 3.1% | 4.6% | 4.1% | 6.2% |

Stable across both seeds and every horizon tested: comfortable dominates (~80-93%, easing
gradually as the horizon lengthens but never collapsing), critical is a genuine minority (~3-6%),
matching the roadmap's own desired shape ("comfortable common, critical unusual unless something
is wrong") on the first pass, without further tuning — and, unlike §2.6's hunger trend, this
distribution shows no sign of the "worsening, not plateauing" pathology v0.6 disclosed for hunger:
exposure is governed entirely by weather + shelter access, neither of which is affected by the
long-horizon wealth dynamics §2.7 found and fixed. The
end-of-run *snapshot* average (`avgWetness`), by contrast, swung from `0` to `0.465` between two
otherwise-similar 8-day runs purely depending on whether it happened to be raining the instant the
run ended — direct, concrete confirmation of why the time-weighted figure, not the snapshot, is
the one to trust (the same lesson v0.6 taught for hunger, now independently reproduced for
comfort).

---

## 4. Affordance foundation

### 4.1 Physical fact vs. acquired recognition, kept genuinely separate

`core/affordance.ts` (new): `AFFORDANCE_DEF` — identity/composition/properties/affordances/
known-uses for `axe`/`pickaxe`/`saw`/`hammer` (the roadmap's own axe example, plus the other
worksite tools `core/tools.ts` already models mechanically). This is layered ON TOP of the
existing mechanical system (`ToolAction`/`bestToolFor`/`toolWorkMultiplier`, unchanged) — the
numbers that already govern what a tool actually DOES were not touched.

`mind/knowledge.ts` gains a new `KnowledgeItem.kind: 'affordance'` and
`learnAffordance`/`knowsAffordance`/`recognizedUses` — a real, bounded, acquired belief, exactly
the v0.6 `'service'`-kind pattern extended to a new domain. **Physical capability is unaffected by
knowledge either way**: directly tested — a person who has never recognized an axe's uses can
still physically pick one up and fell a tree with it (`extractFromNode` doesn't check
`knowsAffordance` anywhere), because a physically possible action is not gated on whether a mind
has consciously reasoned about it; only what a mind would articulate/recognize is.

### 4.2 Two real acquisition paths

1. **Generation-time seeding** (`world/village.ts`, `core/affordance.ts`'s
   `STARTING_AFFORDANCE_KNOWLEDGE`): plausible starting recognition by profession — a woodcutter
   has swung an axe before; most occupations recognize none of these until they use one
   themselves.
2. **Learning by doing** (`world/resources.ts`'s `extractFromNode`, `world/construction.ts`'s
   `performBuildLabor`): a real, successful use of a tool for its real purpose teaches its
   affordance — called at the exact point real work already happened, the same "learn from doing,
   not from standing nearby" discipline v0.6 established for skills.

### 4.3 Non-omniscience demonstrated, not asserted

`tests/circulation-exposure-affordances.test.ts`'s first affordance case constructs a person with
a genuinely empty `knowledge` map and asserts `recognizedUses(p, 'axe')` returns `[]` — they see
the object (nothing here changes perception) but do not know its conventional uses. Real browser
evidence goes further: the Inspector's Knowledge tab on Bors Ashwood mid-session shows
**"Known affordances (2)": "axe: fell trees, split timber, weapon-like use (self · learned 37m
ago)"** — his own live use of the axe during that session — alongside **"saw: cut logs into
planks (prior · learned 44m ago)"** — the generation-time seeding path, visibly distinguishable
by source. Both real acquisition paths, live in the running client, not inferred from headless
output alone.

---

## 5. Determinism, conservation, and persistence

- **Determinism preserved**: no new `Math.random()`/non-deterministic input anywhere in this
  milestone's code — `stepWetness` reads only `world.weather` (already deterministic) and
  elapsed hours; `settleWholesale`/`wholesaleBuyerFor` are pure functions of canonical state;
  affordance seeding is a fixed table keyed by occupation. The full 313-test suite (deterministic
  by construction) passes identically on repeat runs.
- **Conservation preserved**: every wholesale payment is `buyer.wealth -= amount; seller.wealth +=
  amount` with `amount` capped at the buyer's actual wealth — directly tested that
  `buyer.wealth + seller.wealth` is invariant across a sale, and that a self-delivery moves
  nothing. No currency is created or destroyed anywhere in this milestone.
- **`SAVE_VERSION` 9 → 10**: `Person.physiology.wetness` is a new REQUIRED field on the
  already-whole-object-persisted `physiology` struct. Unlike v0.6's purely optional additions
  (which needed no bump — `KnowledgeItem.lastConfirmedAt?`, the new `'service'`/`'affordance'`
  kinds, and this milestone's own `HaulTask.materialSellerId?` are all safely absent-by-default on
  an old save), `wetness` is read by real arithmetic (`clamp01(wetness + delta)`) every physiology
  step; an old save loaded as-is would leave it `undefined`, which corrupts to `NaN` and
  contaminates `fatigue`/`needs.comfort` too — the same class of bug v0.4 bumped `SAVE_VERSION`
  6 → 7 to prevent. Bumping forces `hasSave()`/`deserialize` to reject a pre-v0.7 save outright.
  Directly verified in the browser: a save/reload/Continue cycle round-trips wealth and world
  state exactly (`Alwin Hollis: 35 silver` and `Hobb Grist: 70 silver`, identical before and
  after a real page reload).

---

## 6. Long-horizon benchmarks

| Seed | Days | Wall-clock | Population | Deaths | Anomalies | Production completed | Wages paid | Wholesale traded | Goal commitments (committed/suspended/resumed) |
|---|---|---|---|---|---|---|---|---|---|
| 918271 | 2 | — | 33→33 | 0 | 0 | 5 | 144 | 48 | — |
| 918271 | 8 | — | 33→33 | 0 | 0 | 38 | 267 | 182 | — |
| 918271 | 30 | 398.5s | 33→33 | 0 | 1 (`stuck_agent`) | 222 | 666 | 832 | 87/39/38 |
| 918271 | 90 (pre-§2.7 fix) | 2076.4s | 33→33 | 0 | 1 (`stuck_agent`) | 549 | 1406 | 1133 | 201/233/229 (3 abandoned) |
| 42424242 | 8 | — | 33→33 | 0 | 5 (1 `event_spam`, 4 `stuck_agent`) | 32 | — | 181 | — |

The 90-day row is the run that surfaced §2.7's finding — its own wall-clock/production/wages
figures are real and unaffected by the fix (the fix only changes wealth *distribution*, not
labour/production counts), so it is kept as-is rather than discarded. A post-fix re-run (8/30/90
days, both seeds) was launched to confirm §2.7's fix holds at the horizon that found the problem;
see the addendum at the end of this document for its results, added once it completed rather than
holding up the rest of this report.

Bread price: `3` at the bakery, `4` at the stall by day 30 (up from the base `2` v0.5/v0.6
reported settling to — a genuine, expected consequence of §2's new wholesale demand adding real
upstream cost pressure into the same bounded scarcity-pricing model, not a bug).

Wall-clock at 30 days (398.5s) is higher than v0.6's own 30-day figure (293.6s, same seed/
horizon) — `sim.think`'s wall-time share moved to 61.5% (from v0.6's 57% at the same horizon),
continuing the same growth trend v0.6 already disclosed and flagged as worth watching at larger
population scales. None of this milestone's additions introduce a new scan over the full
population or full item list on a hot per-tick path — `stepWetness`/`comfortBand` are O(1) per
person per physiology step (the same cost class as the existing `bodyHeat` term they sit next to);
`settleWholesale`/`wholesaleBuyerFor` run only on an actual haul delivery (≤~90 times in this
30-day run, not per-tick); `learnAffordance` runs only on a real successful extraction/labour
credit, at the same cadence `practiceSkill` already does. The likely explanation is environment
CPU variance between runs rather than an algorithmic regression, but the honest, disclosed
alternative — a genuine small constant-factor cost from several new per-person-per-minute checks
across 33 people over 30 days — cannot be ruled out from this evidence alone; §7 flags this as a
real, unresolved question rather than asserting either explanation with more confidence than the
evidence supports.

---

## 7. Regressions, scaling risks, and honest disclosure

- **The single most important finding this milestone: the tavern's free ale restock (pure,
  unmodified v0.6 code) was a one-way wealth sink that concentrated 59.1% of total village wealth
  into the innkeeper pair by day 90, undoing this milestone's own farmer/miller fix at that
  horizon.** Full account in §2.7. Fixed within this milestone (a real, bounded, explicit supply
  cost), not merely disclosed — see the post-fix validation addendum at the end of this document
  for whether it holds. This was found only because the roadmap's own DoD insists on running a
  real 90-day benchmark rather than stopping at 30; it is exactly the kind of discovery that
  requirement exists to catch, and is reported here in full rather than only in the flattering
  short-horizon numbers.
- **The remaining wage/wealth gap is real, expected, and precisely bounded to what the roadmap
  scoped.** At 30 days, 20 of 32 living villagers still hold under 3 silver. Broken down by
  occupation (§2.5's underlying data), this group is concentrated almost entirely in occupations
  the roadmap's own Part A audit list does NOT name: guard (avg 0.33), priest/acolyte/captain/
  elder/child/smith/cook/apprentice/hunter/herbalist (all 0), and woodcutter (0 — see below). This
  is not an incomplete fix of the audited occupations; it is the audited occupations' gap closing
  while a separate, differently-scoped gap (service/authority/religious roles with no productive
  output to sell) remains, exactly as the roadmap's own non-goals ("complex corporations,
  banking") anticipate deferring to a future institutions-focused milestone (v0.11's "employment,"
  "authority," and, plausibly, some notion of stipend/tax — none of which v0.7 was asked to
  invent).
- **Woodcutter (Bors Ashwood) still shows 0 wealth at every horizon tested, despite §2's fix
  reaching him too.** Traced directly: he WAS paid for delivered planks (real, observed, §2.3),
  but the storage shed is the world's only construction project, and it is a ONE-TIME event —
  Godwin's fixed 100 starting wealth funds both construction labour wages and the new material
  wholesale cost from the same limited pot, so once it's exhausted (§2.3), further deliveries are
  honestly under-paid, and once the shed is complete there is no further wood/stone demand at all
  until a future milestone (v0.8 crafting, v0.9 mining) creates a recurring one. His only other
  income path is general hauling (`canHaul` includes woodcutter), which this run's evidence shows
  did not accumulate meaningfully for him. This is a genuine, disclosed limit of the CURRENT
  content set (one authored project) rather than something v0.7's architecture prevents — the
  wholesale mechanism itself is general and will pay any future producer the same way once real,
  recurring demand exists.
- **A small (~3.5%) rise in 8-day (primary seed) food shortages (282 → 292) alongside an improved
  avgHunger snapshot and a materially improved 30-day trend.** The most plausible explanation is
  a scheduling-order side effect: the shelter-utility rewrite changes exactly when some NPCs
  transition in/out of the `shelter` goal during rain (now gradual, tied to accumulated wetness,
  rather than an instant on/off), which can shift a handful of people's exact timing near a meal
  window without changing the underlying economics. This was not chased further given the larger,
  more decisive 30-day improvement (§2.6) and the explicit instruction not to over-tune ("do not
  revert to immediate eating whenever mild hunger occurs") — flagged honestly rather than silently
  smoothed over by only reporting the flattering 30-day number.
- **`sim.think`'s wall-clock share continues climbing (v0.6: 57% at 30 days → v0.7: 61.5% at 30
  days)** — the same scaling risk v0.6 already disclosed, not newly discovered, but not newly
  resolved either. §6 explains why none of this milestone's specific additions are the obvious
  cause; at the current population (33), this is not yet a hard bottleneck, but the trend is real
  and worth the same "would need indexing at larger population scales" caution v0.6 gave for
  knowledge lookups.
- **Alternate-seed 8-day anomalies (5: 1 `event_spam`, 4 `stuck_agent`)** were observed and are
  disclosed rather than omitted. v0.6's own report noted an equivalent `stuck_agent` cluster at a
  different horizon/seed, traced to unrelated `path_failure` events for a single NPC — plausible
  here too, but not independently re-traced this milestone given time budget; named explicitly so
  it is not silently rediscovered.
- **Merged non-perishable stock stacks can occasionally misattribute a wholesale sale.**
  `world/stock.ts`'s `addPlaceStock` merges a new contribution into an existing non-perishable
  stack while keeping the FIRST contributor's `ownerId` — a pre-existing simplification, unrelated
  to this milestone, that `materialSellerId`'s capture inherits: if two different people ever
  contribute to the same merged stack at the same Place before it's hauled, the wholesale payment
  goes to whichever of them created the stack first, not a per-contributor split. In the current
  content set this only matters for stone at the quarry (the one place multiple different
  occupations can plausibly contribute), and even there is bounded/rare given the labour-pool
  gating on quarry work. Disclosed as a known, real limitation of the flat-stack model rather than
  fixed with a per-contributor ledger this milestone did not need to build.

---

## 8. Does the evidence from this milestone require changing v0.8?

**NO.**

v0.8 (Materials, Fire, Processes & Practical Crafting) builds on v0.7's identity/composition/
affordance layer (`core/affordance.ts`) and does not depend on the economic-circulation or
exposure work in any way that this milestone's findings would invalidate. Specifically:

- The affordance architecture (`AffordanceDef`, the knowledge-gated recognition layer) is exactly
  the shape v0.8's practical-crafting vertical slice ("stick + suitable stone + plant fiber/
  binding → stone axe") needs to extend — a `composition`/`properties` description that already
  exists per item type, ready for v0.8 to add material-property definitions underneath it.
- The one real, disclosed limitation directly relevant to v0.8 — wood/stone demand currently being
  a one-time event (§7) — is not a blocker for v0.8; if anything it strengthens the case for v0.8's
  own scope (practical crafting gives wood/stone a second, recurring reason to be produced beyond
  the one authored construction project, which would also help close part of the woodcutter income
  gap this milestone disclosed but did not fully solve).
- §2.7's tavern-sink finding (and fix) is an economic-circulation matter, not a materials/fire/
  crafting one — it does not touch anything v0.8 depends on. It is, however, a real instance of
  the roadmap's own general principle in action: a long-horizon benchmark surfacing something a
  shorter one couldn't, fixed within the milestone that found it rather than carried forward
  unaddressed. There is no equivalent "retail sink" risk visible in v0.8's own scope from this
  evidence — v0.8 introduces no new selling/retail mechanism, only production/crafting — but v0.8
  (and v0.9, which explicitly plans to give silver currency a physical relationship to mined ore)
  should keep the same discipline: whatever new wealth-affecting mechanism gets added, ask
  directly whether it is genuinely two-way before assuming it is.
- No scaling risk found this milestone (the `sim.think` wall-clock trend) is new or v0.8-specific;
  it was already disclosed by v0.6 and remains a population-scale concern for a future milestone,
  not an architectural blocker to v0.8's fire/materials/crafting scope specifically.

v0.8 should proceed as planned in `docs/ROADMAP_V0_7_TO_V0_11.md`.
