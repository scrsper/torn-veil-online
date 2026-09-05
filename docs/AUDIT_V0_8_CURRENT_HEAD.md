# Independent Adversarial Audit — PR #12 current head (`6d8107a`)

**Status:** Independent review, second pass. Not a milestone, not an implementation plan.
**Subject:** `claude/v0.8-legible-world` @ **`6d8107a`** ("v0.8 §10 fix: correct advanceWorld's
world-vs-physical-time semantics; robust crop targeting"), 10 commits, +3131/−60 over `main`.
**Previous pass:** `docs/AUDIT_V0_8_INDEPENDENT_REVIEW.md`, measured at `8bea2ae`.
**PR #12 was not modified.** All inspection was done in a detached worktree; probes live only on
this audit branch.
**Authority:** `docs/TORN_VEIL_CONSTITUTION.md` > `AGENTS.md` > `src/` > `tests/`.

---

## 0. Verdict on the central question

> Does "the standard 21-run WorldLab matrix is PASS" accurately mean the world is healthy?

**No.** WorldLab is a well-built harness whose checks are, almost without exception, aimed at
quantities that are healthy in this world *while the things that are broken stay invisible*. It
conserves the wrong currency, counts village-wide "at least once" instead of per-person adequacy,
gates its construction check behind a precondition that is false exactly when construction
stalls, collects anomalies and never asserts on them, and reads live end-of-run state for three
of its eight liveness checks. Its longest standard-tier scenario is 14 world-days; the collapse
this audit measures is unambiguous by day 20 and already visible by day 10.

Concretely, on **WorldLab's own default seed 42424242**, at 30 days, with every WorldLab
invariant and liveness check passing:

- spendable wealth **1380 → 868 (−37%)**; median wealth **30 → 0**; **22 of 32 villagers cannot
  afford a single meal at any price anywhere in the village**;
- **Skarn is at ≥ urgent hunger for 712 of 720 world-hours** and Vex for 462; 17 of 32 people
  exceed 48 consecutive hours at ≥ urgent hunger, 3 exceed a full week;
- 1.28 meals/person/day against a physiological requirement of ≥ 2.1;
- `detectAnomalies()` at end of run: **none**.

And WorldLab's currency-conservation invariant passes with a **residual of exactly 0.00** while
that is happening — because the quantity it conserves (`wealth + coin items`) is not the quantity
anyone can spend.

The harness is not wrong to exist. It is measuring a world that is dead in a way its metrics are
not shaped to see. That is the finding.

---

## 1. Method

Everything below was verified against code at `6d8107a`, then measured. Five deterministic seeds,
30 world-days each, no player:

| seed | why |
|---|---|
| **918271** | the project's historical benchmark seed; my previous pass's baseline |
| **918272** | neighbouring seed (metamorphic control) |
| **1337** | **the seed `main.ts` actually boots**; still in no WorldLab tier |
| **42424242** | **a WorldLab default seed** — WorldLab reports PASS on it |
| **12345** | **a WorldLab default seed** — WorldLab reports PASS on it |

Probes added on this audit branch only (`tools/audit/`, outside `tsconfig`'s `include`, imported
by nothing in `src/`):

- `economy-survival-probe.ts` — daily currency decomposition (person wealth / coin items /
  wealth+coins / spendable / tracked sinks / flows), Gini, median, poorest-quartile share,
  richest share, below-bread-price, cannot-afford-any-meal; **hourly** per-person deprivation
  streaks; food-chain and resource-node time series.
- `recovery-chain-probe.ts` — counts runtime-generated `recover_item` desires and every `loc:`
  knowledge key in the world, split by whether it names a person or an item.
- `save-rng-continuity.ts` — draws from both PRNG streams before and after a serialize/deserialize
  round trip.
- `rng-coupling-probe.ts`, `worldlab-probe.ts` — carried over from the previous pass.

I also ran `npm run world:check` (the 21-run standard matrix) directly rather than accepting the
PASS from the PR body. **It reproduces exactly:**

```
SCENARIO 'Baseline Village':      PASS  918271=PASS, 42424242=PASS, 12345=PASS
SCENARIO 'Food Chain':            PASS  918271=PASS, 42424242=PASS, 12345=PASS
SCENARIO 'Water Survival':        PASS  918271=PASS, 42424242=PASS, 12345=PASS
SCENARIO 'Logistics':             PASS  918271=PASS, 42424242=PASS, 12345=PASS
SCENARIO 'Construction':          PASS  918271=PASS, 42424242=PASS, 12345=PASS
SCENARIO 'Conflict Resolution':   PASS  42424242=PASS, 918271=PASS, 12345=PASS
SCENARIO 'Recover Item':          PASS  918271=PASS, 42424242=PASS, 12345=PASS
WORLDLAB OVERALL: PASS
```

All 21 seed-runs report "✓ no invariant or liveness violations found". **The PR's claim is
literally true.** Everything below is about what it means, not whether it happened. Total
simulated horizon of the whole matrix: 55 scenario-days × 3 seeds = 165 world-days, with the
longest single scenario at **14 days**.

---

## 2. Previous findings — reproduce / fixed / still broken

| # | Finding | OLD (`8bea2ae`) | CURRENT (`6d8107a`) | Verdict | WorldLab detects? |
|---|---|---|---|---|---|
| P0-1 | Currency has sinks and no source | spendable 1380 → 753 (30d, 1 seed) | spendable → **733 / 949 / 731 / 868 / 712** across 5 seeds (−31% to −48%); **median 30 → 0** on 4 of 5; **20–22 of 32 cannot afford any meal** | **STILL BROKEN — worse than measured before** | **No** — see §4.1 |
| P0-1b | Robbery converts spendable wealth into inert coin items | inferred (~295 residual) | **measured directly: 403 / 272 / 507 silver converted**; coin items **65 → 468 / 337 / 572** | **CONFIRMED, UNFIXED** | **No** — the invariant counts coins as currency |
| P0-2 | Individuals starve for the whole run | Vex 31/31 daily samples (coarse) | **hourly sampling**: Skarn **712 h of 720**; Vex 434 h continuous *thirst*; **13–18 of 32 over 48 h**; 2–4 over a full week | **STILL BROKEN** | **No** — see §4.2 |
| P0-3 | Only 72-min benchmarks; shipped seed unmeasured | `SHORT_DAYS = 0.05` | WorldLab exists: 21 runs, 3 seeds, **max 14 days**; seed **1337 still in no tier** | **PARTIALLY FIXED** | n/a |
| P0-4 | Anomaly detector sees a 3 h trailing window of a compacted log | unchanged | unchanged — **and WorldLab now collects `anomalies` into every `Observation` and never asserts on them** | **STILL BROKEN** | **No** — see §4.5 |
| P1-1 | One global RNG stream | shed completion **1.44–21.17 d** under RNG-phase perturbation (14.7×) | weather forked to `world.weatherRng`; shed completion now **1.51–5.11 d** (3.4×) — but day-25 wealth spread **widened** to 653–1132 (1.73×) | **PARTIALLY FIXED** — see §5 | No check exists |
| P1-2 | Timber: 84 logs behind a 912-day regrow | 14 → 0 trees by day 5 | 14 → **8** standing at 30 d (918271), 48 log-capacity left | **STRUCTURALLY UNFIXED**, empirically less acute | No |
| P1-3 | `GRAIN_CAP` gates the wrong stage | grain pinned ~500, bread 267 → 34 | grain sawtooths **503 → 46 → 503**; bread pinned **19–50** for 20 straight days; 3466 shortage events | **STILL BROKEN** | **No** — see §4.3 |
| P1-4 | `save.ts` does not persist RNG state | unfixed | **unfixed, and now two streams are lost**; `docs/RNG_ARCHITECTURE.md` asserts "Save/load needs no change" — **falsified in §6** | **STILL BROKEN + newly mis-documented** | No |
| P1-5 | Ownership is legible but unenforced | unchanged | unchanged | STILL BROKEN | No |
| P1-6 | `mind/economy.ts` documents a feedback loop the code lacks | unchanged | unchanged | STILL BROKEN | No |
| P1-7 | `stuck_agent` fires on every long run and is normalised | ×5–6 every run | now **0 on 4 of 5 seeds, ×5 twice on seed 12345** — because the 3 h window makes it a coin flip | STILL BROKEN (now also unreliable) | No |
| P2-1 | `loc:<itemId>` / `owner:<itemId>` never written at runtime | inferred from code | **measured: 0 runtime `loc:<item>` writes across 3 seeds × 20 days**; 21–24 generated desires per run, **0 of them actionable by anyone** | **STILL BROKEN — and the new §1A/§1B feature depends on it** | **No** — see §4.6 |
| P2-2 | `Desire.reward` is never paid | unfixed | **FIXED** — `payRecoveryReward` (`core/requests.ts`), sharing `payWage`'s honest-transfer semantics; `reward_paid` event; browser spec asserts it | **FIXED (mechanism)** — but **0 `reward_paid` events in 60 unscripted world-days** | Scenario cannot fail; see §4.6 |
| P2-3 | Stockpiles / construction progress / damage unrendered | unfixed | audited and documented (`docs/RENDERING_ARCHITECTURE.md`); one slice shipped (distinct `chop` pose) | PARTIALLY ADDRESSED, honestly disclosed | n/a |
| P2-4 | HUD is omniscient about NPC goal + hit points | unfixed | **unchanged** — `hud.ts:43` still prints `goal.type` and exact `health/maxHealth` on sight | STILL BROKEN | n/a |
| P2-5 | No CI, no committed browser specs | unfixed | **FIXED** — `.github/workflows/pr.yml` + 4 committed Playwright specs + a reusable harness | **FIXED** | n/a |
| P2-7 | Food-pressure stress test cannot fail | unfixed | unchanged | STILL BROKEN | n/a |
| P2-8 | Ale invariant untested when the innkeeper is insolvent | unfixed | unchanged | STILL BROKEN | n/a |

**Genuinely fixed this pass:** unpaid recovery rewards (P2-2), no-CI / no-browser-tests (P2-5),
plus four real defects Sonnet found and fixed on its own (false-theft on authorized recovery,
ungrounded dialogue assertions, the player's timed pose never reverting, and `advanceWorld`
simulating 60× the requested time). That last one is worth calling out: it was found *by building
the harness*, which is the harness doing its job.

---

## 3. Fresh measurements

### 3.1 Economy — five seeds, 30 world-days, no player

| | 918271 | 918272 | **1337** (shipped) | **42424242** (WorldLab) | **12345** (WorldLab) |
|---|---|---|---|---|---|
| spendable wealth (start → end) | 1380 → **733** | 1380 → **949** | 1380 → **731** | 1380 → **868** | 1380 → **712** |
| drop | **−47%** | −31% | **−47%** | −37% | **−48%** |
| coin items (inert) | 65 → **468** | 65 → 274 | 65 → **471** | 65 → 337 | 65 → **572** |
| wealth + coins | 1445 → 1201 | 1445 → 1223 | 1445 → 1202 | 1445 → 1205 | 1445 → 1284 |
| tracked sink (`supply_cost_amount`) | 244 | 222 | 243 | 240 | 161 |
| **residual on wealth+coins** | **0.00** | **0.00** | **0.00** | **0.00** | **0.00** |
| spendable → inert conversion | **403** | 209 | **406** | 272 | **507** |
| Gini | 0.50 → **0.834** | 0.50 → 0.838 | 0.50 → 0.848 | 0.50 → 0.807 | 0.50 → **0.855** |
| median wealth | 30 → **0** | 30 → 1 | 30 → **0** | 30 → **0** | 30 → **0** |
| poorest-quartile share | 3.6% → **0%** | 3.6% → 0% | 3.6% → 0% | 3.6% → 0% | 3.6% → 0% |
| richest person's share | 15.9% → 23.7% | 15.9% → **38%** | 15.9% → 30.4% | 15.9% → 24.3% | 15.9% → 29.2% |
| **cannot afford ANY meal** | 2 → **20** / 32 | 2 → 21 | 2 → **22** | 2 → **22** | 2 → 21 |
| explicit currency **sources** | **none** | none | none | none | none |

**Is the ale mechanism sustained net deflation? Yes, and it is only half the story.**

`restockTavern` (`world/metabolism.ts:383`) removes `min(ALE_RESTOCK_QTY × ITEM_VALUE.ale,
innkeeper.wealth)` from the world on every restock trigger. There is no matching source anywhere
in the codebase (`grep 'wealth +='` returns only transfers). Measured: **161–244 silver destroyed
per 30 days**, i.e. 11–17% of the entire starting money supply per month, forever, with no
asymptote — the rate is set by ale consumption, not by any stock or balance.

v0.7 proved the *innkeeper's own net* is zero. That proof is correct and it is exactly the
problem: an actor whose net is structurally zero, sitting on the receiving end of every ale
purchase in the village, is a currency incinerator by construction. "Explicitly tracked sink" was
treated as equivalent to "acceptable"; WorldLab then encoded that equivalence as an invariant
(`unexplained = actualDelta + expectedSink`, warning only if *more* than the sink is lost). The
harness now certifies the deflation rather than reporting it.

**Does robbery convert spendable wealth into unspendable coin items? Yes — measured.**

`executeRobbery` (`mind/agent.ts:1544`): when the victim has no `coins` item, it does
`victim.wealth -= take.amount` and mints a **new `coins` item held by the bandit**. Every
NPC-facing purchase path reads `person.wealth`:
- `buyFoodPortion` — `Math.floor(buyer.wealth / unit)`;
- `payWage` / `payRecoveryReward` / `settleWholesale` — all `payer.wealth`;
- `laborIncentive`, `banditResourcePressure` — both `wealth`.

No NPC code path ever reads or spends a `coins` item. (Only the player's dialogue `buyItem` does.)
So robbery is a **one-way pump from the spendable money supply into an inert reservoir**: 209–507
silver per 30 days, 65 → 274–572 coin items. It also means `banditResourcePressure` stays pinned
at 1.0 no matter how successful the bandits are — the loop `mind/economy.ts` documents in prose
still does not exist.

**Net external flow, per 30 days (seed 918271):** sources 0; sinks 244 (tavern) + 403
(spendable→inert) = **647 silver of purchasing power removed from a 1380-silver economy.**

### 3.2 Individual survival tails — hourly sampling, 30 world-days

Village-wide "someone ate today" is true on every day of every run. Here is what that hides:

| | 918271 | 918272 | 1337 | 42424242 | 12345 |
|---|---|---|---|---|---|
| longest single hunger streak (≥ urgent) | **712 h** (Skarn) | 711 h | 711 h | **712 h** (Skarn) | **712 h** (Skarn) |
| people over **48 h** continuous | **13**/32 | 14/32 | **18**/32 | **17**/32 | **17**/32 |
| people over **168 h** (one week) | 4/32 | 4/32 | 3/32 | 2/32 | 3/32 |
| longest thirst streak | 434 h (Vex) | — | — | 293 h (Vex) | 361 h (Vex) |
| meals / person / day (village) | **1.27** | 1.29 | 1.29 | 1.28 | **1.24** |

**A methodological correction on my own probe.** It also printed a "never ate in 30 days" list
derived from `world.events`. That list is **not sound** and I am not relying on it:
`food_consumed` carries significance 0.1, far below `compactEvents`'s 0.5 retention floor, so most
meal events are gone from `world.events` by the end of a 30-day run. Cross-checking against the
independent physiological streaks proves the contamination — Brigid Tallow appears on the seed-918271
"never ate" list yet has a *maximum* hunger streak of 163 h, which means her streak broke, which
means she ate. The event-derived list over-reports.

This is itself a finding, and it is the same root cause as §4.5: **any per-person metric derived
from `world.events` after a long run is unreliable, because compaction has already deleted the
low-significance events that describe ordinary life.** WorldLab's `Observation.summary` inherits
this: `buildWorldRunSummary` filters `world.events` for `violentIncidents`, `robberies`,
`reportsToGuards`, `investigations`, `knowledgeTransfers`, `relationshipChanges` and
`itemOwnershipChanges` — all of which silently under-count on any run long enough to compact.
(The `runTally`-backed fields are fine; the `events.filter(...)` ones are not.) The telemetry
stream is written pre-compaction and does not have this problem.

The claims I *do* make below rest only on the hourly physiological sampling, which is independent
of the event log:

712 of 720 hours is 98.9% of the run. Vex spends **434 continuous hours** — 18 days — at ≥ urgent
thirst, in a world with two wells of infinite water. A person who ate would drop out of the
≥ urgent band (one meal restores 0.55 of a reserve whose urgent threshold is 0.65), so a
multi-hundred-hour unbroken streak is direct evidence of non-eating without needing the event log
at all. The named persistent failures recur across seeds and are structural, not stochastic:

- **Skarn, Vex (bandits)** — every seed, always the worst two; 316–712 h hunger and 230–434 h
  thirst streaks. `canHaul()` (`haul.ts:342`) excludes all hostiles from every wage path;
  `village.ts:284` skips bandits when seeding household larders; the camp has no food item; their
  schedule keeps them there. `findAccessibleFood` returns null forever and `buyFoodPortion` has
  nothing to buy. **They cannot eat, and cannot die of it.**
- **Old Wyn (herbalist)** — 150–332 h streaks in **all five** runs. Lives alone at the edge of the
  map; `knownFoodPlace` ignores distance.
- **Brigid Tallow, Dunstan Mole, Hale Dorn (guards)** — 88–163 h streaks. `canHaul()` excludes
  guards, so they have no income path at all; their schedule sends them to the tavern, whose only
  food is the abstract, unmodelled `ale`.
- **Bors Ashwood (woodcutter)** — 92–119 h streaks, and simultaneously the single actor the whole
  timber → plank → construction chain depends on.

The required intake is `(24/21)/0.55 ≈ 2.1` meals/person/day (derived from
`ENERGY_DRAIN_PER_HOUR = 1/21` and `FOOD_HUNGER_RESTORE = 0.55`, before any activity multiplier).
The village delivers **1.24–1.29**. It is under-fed by ~40% permanently, on every seed.

### 3.3 Food chain — moved at least once vs. adequate recurring throughput

The chain moves constantly. It is also in permanent deficit. Seed 918271, 30 days:

| day | grain | flour | **bread** | cumulative harvests | transforms | meals | **shortages** |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 146 | 34 | **267** | 0 | 0 | 0 | 0 |
| 10 | 253 | 44 | **34** | 136 | 69 | 467 | 420 |
| 15 | 124 | 39 | 50 | 136 | 128 | 670 | 962 |
| 20 | 61 | 72 | 30 | 136 | 182 | 858 | 1715 |
| 22 | 46 | 67 | 36 | 136 | 201 | 928 | 2074 |
| 23 | **503** | 62 | 49 | 209 | 215 | 967 | 2246 |
| 30 | 501 | 75 | **41** | 244 | 283 | 1222 | **3466** |

Three distinct pathologies, none of which any WorldLab check is shaped to see:

1. **Bread never recovers.** It falls from 267 to ~34 by day 10 and then oscillates between 19 and
   50 for the remaining 20 days. The chain is not stalled — it is running flat out below demand.
2. **Grain sawtooths against its cap.** Harvests are frozen at 136 from day 10 to day 22 while
   grain drains 253 → 46; then a burst takes it back to 503 in one day. `GRAIN_CAP = 500` gates
   the farmer's `harvest` goal on *grain* abundance, which is not evidence of *bread* abundance.
3. **Shortages accumulate at ~115/day, forever** — 3466 `resource_shortage` events in 30 days.
   Every one is significance 0.2–0.3, below `compactEvents`'s 0.5 retention floor, so none of them
   survive in `world.events`; they exist only as a `runTally` integer nothing asserts on.

The backlog is real and persistent: at every probe from day 10 onward the village holds less than
two days of bread for 32 people while 20+ of them cannot afford to buy any.

### 3.4 Resource sustainability

| | 918271 | 918272 | 1337 |
|---|---|---|---|
| trees standing (start → 30 d) | 14 → **8** | 14 → 9 | 14 → 8 |
| standing log capacity | 84 → 48 | 84 → 54 | 84 → 48 |
| stone remaining | 72 → 62 | 72 → 62 | 72 → 62 |

Better than the previous pass measured (14 → 0 by day 5), because RNG phase now lands differently
— not because anything changed. The structure is unchanged and remains the finding:

- **Total timber in the world: 14 trees × `LOGS_PER_TREE = 6` = 84 logs, ever.**
- `TREE_REGROW_HOURS = 2.5 × 365 × 24` = **912 world-days**. A `resource_regrew` event is
  unreachable in any run anyone will perform.
- **Is the woodcutter exhausting finite stock unnecessarily? Largely no — but there is one real
  overshoot, and it is a constant, not a behaviour.** Extraction is genuinely demand-gated at the
  goal level: `think()` offers `chop` only to a woodcutter whose schedule has them at the clearing,
  and `stepConstruction` pulls logs to the sawpit only while a project still needs planks. The
  woodcutter is not greedily clear-cutting. However, `saw()` stops at `PLANK_CAP = 40`
  (`world/metabolism.ts:65`) while the only project needs **16 planks** — a 2.5× standing target.
  At `SAW_RATIO` 2:3 that is ~27 logs of sawing demand against ~11 logs of real demand. Measured:
  **36 of 84 logs consumed in 30 days for one shed.** So roughly two-thirds of the timber spent was
  spent to fill a buffer nothing asked for.
- The larger point is not behavioural greed: **the world's entire lifetime timber budget is ~2.3
  sheds** at the real demand rate, and nothing anywhere reports that.
- Stone is non-renewable: 62 of 72 units are frozen forever because nothing else consumes stone.

**I do not recommend shortening `TREE_REGROW_HOURS` to make a benchmark pass.** Two-and-a-half
years to replace a felled mature tree is the realistic number and the Constitution's §64 prefers
understandable causes to convenient ones. The correct responses are (a) an invariant that states
the arithmetic explicitly so the constraint is *known* rather than discovered by a future
milestone that burns the last log, and (b) if more timber is genuinely needed, more or larger
groves / a managed woodlot — a change to the *stock*, not to the *biology*.

### 3.5 A new defect: the world manufactures ~1 phantom theft per day

`Simulation.strategic()` (`mind/agent.ts:1669`):

```ts
if (b && p.workId && w.placeAt(b.pos)?.id === p.workId && w.rng.next() < 0.3 * minutes) {
  for (const it of w.items()) if (it.ownerId === p.id && it.holderId && it.holderId !== p.id && ...)
```

`loadHaulCargo` (`logistics/haul.ts:197`) creates the in-transit cargo as
`makeItem(..., { owner: task.requesterId ?? sourcePlace.ownerId, holder: person.id, ... })`.

So a bakery's flour delivery is an item **owned by Osric Bramble and held by the hauler** — which
matches the "someone took my property" inference exactly. Measured over 20 world-days:

| seed | runtime-generated `recover_item` desires | distinct owners |
|---|---|---|
| 918271 | **24** | Osric (flour) ×12, Hobb (grain) ×9, Bors (log) ×3 |
| 1337 | **21** | Osric ×12, Hobb ×8, Bors ×1 |
| 42424242 | **22** | Osric ×11, Hobb ×8, Bors ×3 |

Every one is a false belief about a legitimate delivery. Each also:

- emits `item_missing` at significance 0.45 (below the 0.5 retention floor — compacted away);
- writes a permanent `missing:<id>` knowledge item and a permanent memory
  ("*X is gone from its place. Someone took it.*");
- spikes `emotions.anger` by **+0.4**;
- makes the NPC shout "*Where is X?! It was right here!*" — visible to any player standing there;
- appends an **unfulfillable** `recover_item` desire to `p.desires`, which is never pruned. At
  ~1.1/day for three people that is ~400 desires per person-year, iterated in `think()` every
  tick.

This is a genuine constitutional violation (§5/§6: a mind forming a confident, provenance-stamped
false belief from a broken inference), a genuine gameplay defect, and a slow unbounded leak. No
WorldLab check, invariant, or test detects it.

---

## 4. WorldLab false-negative audit

I read every file in `src/headless/worldlab/` (791 lines: `types`, `probe`, `invariants`,
`liveness`, `scenarios`, `matrix`, `scorecard`, `trace`, `report`, `cli`). What follows is
per-failure: *why did this pass?*

### 4.1 Currency: the invariant conserves the wrong quantity

`probe.ts`:

```ts
function totalCurrency(world: World): number {
  let total = 0;
  for (const p of world.persons()) total += p.wealth;
  for (const it of world.items()) if (it.type === 'coins') total += it.quantity ?? 0;
  return total;
}
```

`invariants.ts`, `currency-conservation`:

```ts
const unexplained = actualDelta + expectedSink;
if (unexplained > 0.5)  → FAILURE  (currency created)
if (unexplained < -0.5) → WARNING  (untracked sink)
```

**Why it passes:** robbery moves `wealth → coins`, which is a no-op under this metric. The tavern
sink is `expectedSink` by construction. Measured residual across all five seeds: **exactly 0.00**.
The invariant is *mathematically satisfied* while purchasing power falls 47%.

Two independent flaws:
1. **Spendability is not modelled.** Coin items are counted as currency but no NPC economic action
   can spend one.
2. **A tracked sink is treated as an acceptable sink.** The check asks "is the loss explained?",
   never "is the loss survivable?" A monotone drain with no source is exactly as fatal whether or
   not someone incremented a counter on the way out.

**Recommended checks**

- `invariant.spendable-currency-is-real` — track `spendableCurrency = Σ person.wealth` separately
  from `totalCurrency`. **FAIL** if `spendable` falls while `totalCurrency` holds steady: that is
  precisely the signature of wealth being converted into something nobody can use.
- `tail.purchasing-power` (**FAIL**) — `count(person.wealth < cheapestPurchasableMealPrice) /
  alivePopulation` must not exceed 0.25 for more than 48 continuous world-hours. Currently 0.63–0.69
  at day 30 on every seed.
- `liveness.money-supply-solvency` (**FAIL**) — extrapolate the tracked sink rate over the
  observation series; FAIL if the linear trend reaches zero within 10× the run length. A sink with
  no source is a countdown, and the harness should say so out loud.
- `invariant.no-inert-currency` (**WARNING**) — flag any growth in coin-item quantity that no NPC
  code path can spend. This is cheap and would have caught the robbery pump on day 1.
- **Architectural correction:** unify the two currency representations. Either make `coins` items
  the only currency (and give NPC purchase paths a coin-spending function), or delete the minting
  in `executeRobbery` and transfer `wealth` directly. The dual representation exists only because
  the player has coin items and NPCs have a `wealth` scalar; that is a Constitution §9 violation
  (P2-4 in the previous pass) *and* the mechanism of this leak.

### 4.2 Survival: every liveness check is village-wide "at least once"

`liveness.ts`, `hungry-population-eventually-eats`:

```ts
findStuckWindow(series, 24, o => o.alivePopulation > 0, o => o.summary.metabolism.mealsEaten)
```

**Why it passes:** the precondition is "anyone is alive" and the progress counter is the
village-wide cumulative meal count. With 32 people it takes a *total* famine for 24 straight hours
to fire. Skarn at 712 of 720 hours, and 13–18 people over 48 continuous hours, are each 1/32 of a
counter that increments ~40 times a day.

The same shape defeats `thirsty-population-eventually-drinks`,
`grain-flour-bread-chain-progresses` and `mature-wheat-eventually-harvested`. **All four are
"did the system ever act?" checks wearing the name of "is the system working?".**

**Recommended checks**

- `tail.deprivation-streak` (**FAIL**) — per person, max consecutive world-hours at severity ≥
  `urgent` for hunger / thirst / sleep. FAIL above 48 h; report the top 5 by name and occupation.
  Measured today: 712 h, and 13–18 people over the bound.
- `tail.nobody-is-excluded` (**FAIL**) — every alive, non-controlled person must eat and drink at
  least once per 48 h. **Implement this against the telemetry stream or against physiological
  state, not `world.events`** — compaction deletes `food_consumed` (significance 0.1) long before
  the run ends, which is what made my own probe's event-derived version unsound (§3.2). The
  physiological form is equally cheap and cannot be fooled: a person whose ≥ urgent hunger band is
  unbroken for 48 h did not eat.
- `invariant.nutrition-adequacy` (**FAIL**) — `food_consumed / (population × days)` ≥ the rate
  derived from `ENERGY_DRAIN_PER_HOUR` / `FOOD_HUNGER_RESTORE` (≥ 2.1). This is *derived*, not
  tuned: it self-updates if the physiology constants change. Measured: 1.24–1.29.
- `tail.reachability` (**FAIL**, structural, cheap, runs in `npm test` not WorldLab) — for every
  occupation, assert at least one reachable income path and one reachable food source exists at
  all. Six occupations fail the first; bandits fail the second. This is a static property of
  `canHaul()` + schedules + larder seeding and needs no simulation to check.

### 4.3 Production: "transforms happened" is not "throughput is adequate"

`grain-flour-bread-chain-progresses` fires only when grain **and** flour are both zero-stocked for
36 h while zero transforms occur. In a world where the mill and bakery run constantly and still
cannot keep up, the counter always advances.

**Recommended checks**

- `liveness.downstream-not-starving` (**FAIL**) — FAIL if a downstream stock (`bread`) trends
  monotonically down over ≥ 5 days while an upstream stock (`grain`) is at or near its cap. This is
  the exact signature measured in §3.3 and would fire on day ~10 of every seed.
- `tail.consumer-backlog` (**FAIL**) — `resource_shortage` events per person per day must stay
  under a small bound. Measured: ~3.6/person/day, sustained for 30 days.
- `invariant.stock-days-of-cover` (**WARNING → FAIL**) — report `bread / (population ×
  meals-per-person-per-day)` as *days of cover* at every probe. Warn under 3 days, fail under 1.
  Measured: under 2 days from day 10 onward, permanently.
- **Architectural correction:** move the production cap from the *upstream* resource to the
  *downstream* one — gate `harvest` on bread/flour sufficiency, not on grain abundance — or make
  `GRAIN_CAP` a function of downstream demand rather than a constant.

### 4.4 Construction: the check is gated on the precondition being false

`construction-progresses-with-materials-and-workers`:

```ts
const materialsComplete = Object.entries(d0.required).every(([res, need]) => (d0.delivered[res] ?? 0) >= need);
if (materialsComplete && d0.workers > 0 && d1.laborPct <= d0.laborPct) → FAIL
```

`d.workers` is `Object.keys(project.contributions).length` — the count of people who have
**already contributed labour**.

**Why it passes:** the observed stall is a *gathering* stall. In my previous pass the shed sat in
`gathering` for 20 of 22 days: `materialsComplete` was false, and `workers` was 0 because nobody
had credited any labour yet. The check requires labour to have already started before it can
report that labour is not progressing, and requires materials to be complete before it can report
that materials are not arriving. **It cannot fire during either of the two stalls that actually
happen.** It is a correct check for a state this world rarely reaches.

**Recommended checks**

- `liveness.material-deficit-shrinks` (**FAIL**) — while a project is `gathering`, its total
  material deficit must strictly decrease at least once per 48 h, **or** a finding names the
  deficient resource and whether any producer place holds stock of it. This separates "nobody is
  hauling" from "there is nothing to haul".
- `latency.project-phase-duration` (report, then bound) — record days spent in `gathering` /
  `ready` / `building`. Once a baseline exists across seeds, bound it. A project that completes on
  day 21 having spent 20 days at 0% is not a passing construction system.

### 4.5 WorldLab collects anomalies and never asserts on them

`probe.ts` calls `detectAnomalies(world)` at every probe and stores the result on the
`Observation`. **Nothing in `invariants.ts`, `liveness.ts`, `scorecard.ts` or `matrix.ts` ever
reads `obs.anomalies`.** `verdictOf` looks only at `findings`.

So the harness pays the cost of anomaly detection at every probe and discards the result. On seed
12345 my run produced two `stuck_agent` findings that contributed nothing to the verdict.

Compounding this, `detectAnomalies` itself is unchanged from the previous pass: checks 4/5/6/8 use
a **3-hour trailing window** over `world.events`, which `compactEvents(4000)` has already reduced
to the last ~4000 events plus `significance ≥ 0.5`. `resource_shortage` (0.2–0.3), `item_missing`
(0.45), `goal_changed` (0.12) and `path_failure` (0.0) are all below the floor. My five 30-day
runs produced 1614–3466 shortages and 21–24 phantom-theft events; `detectAnomalies()` reported
**none** on four of five seeds.

**Where each anomaly class belongs**

| class | today | should be | why |
|---|---|---|---|
| `dangling_cause`, `invalid_entity_reference`, `epistemic_leak` | end-of-run scan | **incremental observation** — assert at every probe, FAIL immediately | pure structural integrity; cheap; never a false positive |
| `event_spam`, `goal_churn`, `stuck_agent`, `path_failure` clustering | 3 h trailing window of a compacted log | **telemetry-based** — the `FileSink` JSONL stream is written pre-compaction and covers the whole run | the data already exists and is thrown away; this is the single highest-leverage change in this audit |
| `repeated_lethal_conflict`, `death_spike`, `repeated_arrest`, `surrender_or_custody_ignored` | trailing window | **telemetry-based**, whole-run | same |
| resource shortage rate, deprivation streaks, stock trends, currency trends, queue ages, latency distributions | not detected at all | **WorldLab time-series** | these are statements about a *series*, which only WorldLab holds |

**Architectural correction:** `detectAnomalies` should take an event *source* rather than reaching
into `world.events`. WorldLab passes the telemetry stream; the browser Inspector passes the live
log. One signature change, and every rate-based check stops being a coin flip on when the run
ended. Separately, `verdictOf` should consume anomalies — at minimum promoting the structural
integrity classes to `failure`.

### 4.6 The `recover-item` scenario cannot fail

The scenario's setup authors the ring, authors the desire, **and seeds `loc:<ringId>` directly
into a chosen witness**. Its only relevant liveness check is
`recovery-request-eventually-fulfills-and-pays`, which fires only when:

```ts
if (item && item.holderId === p.id)   // the item is ALREADY in the requester's hands
```

**Why it passes:** if nobody ever recovers the ring, `item.holderId` is never the requester and
the check is silent. A scenario named "Recover Item" reports PASS when recovery never occurs.

The browser spec has the same shape from the other direction: `recover-item.spec.ts` manufactures
the ring and desire in `page.evaluate`, then calls `movePlayerTo(page, setup.ringPos)` — walking
the player to a coordinate the *test* knows, never one the *player* could have learned. Both the
scenario and the spec skip the discovery step that the feature exists to provide.

Measured reality (`recovery-chain-probe.ts`, 3 seeds × 20 days):

- runtime-generated `recover_item` desires: **21–24 per run**;
- `loc:` knowledge naming a **person**: 1223–1245 entries;
- `loc:` knowledge naming an **item**: **1**, generation-seeded (Old Wyn / Anna's ring);
- created at runtime: **0**;
- generated desires whose owner can act on them: **0 of 24**;
- generated desires any NPC could tell a player about: **0 of 24**;
- `recovered` / `returned_item` / `reward_paid` events in unscripted play: **0 / 0 / 0**.

`locationKnowledge()` has exactly one call site (`agent.ts:124`) and it fires on perceiving a
**body**. Nothing in the codebase ever writes `loc:<itemId>`. `pickGossip` filters
`k.kind === 'event'`, so even if someone knew, they could not tell anyone. `owner:<itemId>` is
written in three generation-time places and never at runtime, so v0.8 §G's ownership label reads
"not sure whose this is" for every item but three.

The §1A authorization gate additionally requires `actor.knowledge['wanted:' + itemId]`, which is
written **only** by `DialogueSystem.hearDesire` — a player-only path. **No NPC can ever be
authorized to recover anything.**

**Recommended checks**

- `liveness.generated-desire-is-actionable` (**FAIL**) — for every `recover_item` desire the
  simulation generated itself, assert that within 72 h *someone* (the owner, or any NPC a player
  could ask) holds `loc:<targetId>` knowledge. Fails 24/24 today.
- `invariant.no-unreachable-desire` (**WARNING**) — flag any desire whose precondition
  (`loc:` knowledge) no living entity holds and no runtime path can produce.
- `metamorphic.recovery-without-seeding` — re-run the `recover-item` scenario with the
  `learn(loc:)` line removed from setup. If the verdict is unchanged, the check is not testing
  discovery.
- **Architectural corrections** (in order of leverage):
  1. Call `locationKnowledge` for **items** on perception — an unheld item in view, at a distance,
     with line of sight, is exactly as observable as a body and the function already exists.
  2. Let `pickGossip` carry `location` claims, not just `event` claims, so a location can travel.
  3. Fix the phantom-theft generator (§3.5) first, or step 1 will flood every mind with `loc:`
     entries for haul cargo.

### 4.7 Three liveness checks read end-of-run state, not the series

`haul-tasks-resolve`, `conflicts-eventually-resolve` and
`recovery-request-eventually-fulfills-and-pays` all ignore their `series` argument and scan the
live world at the end of the run. A haul task stuck for three days on day 5 that later resolved is
invisible; only "currently stuck when the clock stopped" counts. This is the endpoint blindness the
harness was built to remove, reintroduced inside the harness.

**Recommended correction:** track per-task/per-conflict age *at every probe* and report the maximum
observed, not the final. The `Observation` series already runs at the right cadence.

### 4.8 Scope and duration gaps

- **Standard tier maxes out at 14 world-days** (construction); baseline is 7, water-survival 5,
  recover-item 5. Every finding in §3 is invisible before day ~10.
- **Seed 1337 — what `main.ts` boots — is in no tier.** My run shows it is among the worst
  (−47% spendable, 22/32 unable to buy a meal, 18/32 over 48 h hungry).
- **`npm run world:soak` was never run.** The PR discloses this honestly, which is correct — but
  the 21-run PASS is then a statement about ≤ 14-day windows only, and the PR body's phrasing
  ("the village genuinely functions within those bounds") is doing a lot of work in the last three
  words.
- **`docs/WORLDLAB.md` does not exist.** `types.ts:11`, `invariants.ts:16` and `cli.ts:9` all cite
  it; `invariants.ts` cites it specifically as the place where *the invariants not yet mechanically
  checked* are disclosed. That disclosure has no home. `docs/V0_8_THE_LEGIBLE_WORLD.md` was also
  never updated to mention WorldLab at all.

---

## 5. RNG — how much coupling remains after weather separation

### 5.1 What changed

`World.weatherRng = this.rng.fork(97)` is created in the constructor, before generation consumes
`rng`, so it is deterministic from the seed. `strategic()`'s weather block is its only reader.
`tests/rng-stream-separation.test.ts` proves stream independence in both directions. This is a
correct, well-chosen first cut: weather was the channel with the longest physical reach (soil
moisture → crop growth; rain penalty → whether the woodcutter goes to the clearing; fog →
perception range → who witnesses what).

What did **not** move: yaw jitter (`agent.ts:955`, a draw per actor per physics substep while
working), the missing-possession check (`agent.ts:1670`, a draw per person per world-minute at
their workplace), work/socialise durations, anchor choice, patrol start index, wander targets,
chat-partner and small-talk selection, gossip acknowledgements, combat damage, player lethality,
robbery compliance and take size, and creature wander. Two of those draw at a rate proportional to
*how many people happen to be working*, so the total number of draws consumed by time T still
depends on agent behaviour.

### 5.2 Measured — same experiment, current head

`tools/audit/rng-coupling-probe.ts`, seed 918271, 25 world-days, differing only by *k* burned
`world.rng.next()` calls after generation:

```
burn | shed complete | ready | first plank | trees gone | extractions | wealth @d25 | supplyCost | shortages
   0 |      1.51     |  1.38 |     0.28    |   never    |      7      |     735     |    244     |   2574
   1 |      5.11     |  4.31 |     0.30    |   never    |      6      |     858     |    198     |   2750
   2 |      2.44     |  2.28 |     0.31    |   never    |      7      |     653     |    238     |   3008
   3 |      3.41     |  3.28 |     0.30    |   never    |      5      |     952     |    150     |   2365
   4 |      3.40     |  3.27 |     0.30    |   never    |      6      |    1110     |    168     |   2520
   5 |      3.58     |  3.41 |     0.30    |   never    |      4      |    1132     |    204     |   2466
```

Compared with the same experiment at `8bea2ae` (previous audit, §Part 4 there):

| quantity | OLD spread | CURRENT spread | change |
|---|---|---|---|
| shed completion day | 1.44 – 21.17 (**14.7×**) | 1.51 – 5.11 (**3.4×**) | **materially improved** |
| tree exhaustion day | 4.13 / 6.10 / never | never (6/6) | **improved / consistent** |
| extraction events | 5 – 16 (3.2×) | 4 – 7 (1.75×) | improved |
| tavern sink | 124 – 312 (2.5×) | 150 – 244 (1.63×) | improved |
| **village wealth @ d25** | 773 – 1059 (1.37×) | **653 – 1132 (1.73×)** | **worse** |
| shortage events | 2421 – 2657 (1.10×) | 2365 – 3008 (1.27×) | worse |

**Conclusion: the weather fix worked for what it targeted, and did not fix the general problem.**
Construction-timing chaos — the symptom that motivated the investigation — dropped by roughly 4×,
which is a real result and vindicates picking weather first. But the *economic* outcome spread
widened: with weather no longer dominating, agent-order coupling shows through more clearly on the
quantities this audit cares about. Six semantically identical worlds still end 25 days apart with
between 653 and 1132 silver — a 73% spread on the single number that most determines whether
anyone can eat.

Two consequences a reviewer should hold onto:

1. **Any cross-commit economic comparison is still inside the noise.** A future report claiming
   "this change reduced the wealth drain by 15%" is not measurable at one seed and one phase.
2. **The construction test's budget is now absurd in the other direction.** It still allows 35
   world-days; the shed completes at day 1.51–5.11 at that seed on this head. A ceiling ~7–23×
   above the observed distribution cannot fail for any reason short of total breakage.

The `docs/RNG_ARCHITECTURE.md` migration plan is sound and its ordering (cosmetic draws first,
then per-entity streams) is right. **It cannot safely proceed until §6 is fixed**: per-entity
streams multiply the number of stream positions lost on every save/load.

---

## 6. Save/load PRNG state — measured

`docs/RNG_ARCHITECTURE.md` states:

> "Save/load needs no change: a saved world is always reconstructed by `new World(seed)` +
> `generateVillage(world)` (see `persist/save.ts`), so `weatherRng` is deterministically
> re-derived exactly like everything else generation touches."

**This is deterministic but not continuous, and the distinction is the whole point.** Measured
(`tools/audit/save-rng-continuity.ts`, seed 918271, saved after 2 world-days):

```
main stream (world.rng)
  after 2d, live next-6:          0.4158 0.0374 0.7983 0.3942 0.2153 0.7355
  after load,   next-6:           0.1072 0.0220 0.1744 0.4620 0.4052 0.2153
  fresh post-generation next-6:   0.1072 0.0220 0.1744 0.4620 0.4052 0.2153
  loaded == live (state preserved)?  NO
  loaded == fresh (stream REWOUND)?  YES

weather stream (world.weatherRng)
  after 2d, live next-6:          0.6121 0.2647 0.7321 0.8853 0.1612 0.4480
  after load,   next-6:           0.0944 0.3908 0.5561 0.0531 0.6549 0.7102
  fresh post-generation next-6:   0.0944 0.3908 0.5561 0.0531 0.6549 0.7102
  loaded == live (state preserved)?  NO
  loaded == fresh (stream REWOUND)?  YES
```

Behavioural consequence — same seed, +1 world-day past the save point:

```
uninterrupted run  : weather=cloudy@0.00, village wealth 1271
save -> load -> run: weather=clear@0.00,  village wealth 1253
```

`world.rng` **and** the new `world.weatherRng` are both rewound to their post-generation position
on load. A 30-day world that is saved and reloaded does not continue — it re-plays the day-0
stream. The existing determinism tests pass because none of them saves mid-run.

The weather separation makes this marginally worse (two streams to lose instead of one), and it
puts a falsified claim in a committed design document. It also blocks the recommended follow-up:
per-entity streams cannot be added safely until stream state is persisted, or every load will
re-roll every person's future.

**Recommended check:** run N world-seconds → serialize → deserialize → run M more; assert the
result is identical to an uninterrupted N+M run at the same seed. **Architectural correction:**
persist each stream's internal `s` (a single `number` per stream) in the save payload, bump
`SAVE_VERSION`, and restore after `generateVillage`. `RNG` would need a `state`/`setState` pair;
that is ~6 lines.

---

## 7. What PR #12 got right

Stated plainly, because the findings above are dense and the work is not bad work:

- **The harness is architecturally correct.** Read-only, built on the same `runHeadless`/`World`/
  `Simulation` the client uses, no second simulation loop, `onSetup`/`onProbe` hooks rather than a
  fork. `Observation` is a real time series. `Finding` distinguishes invariant from liveness and
  warning from failure. `verdictOf` refuses a single opaque score. The `NOT-YET vs STUCK`
  distinction in `findStuckWindow` is exactly the right idea. **The bones are right; the checks are
  pointed at the wrong quantities.** Almost everything in §4 is a change to *what* is measured,
  not to *how* the harness works.
- **The four self-found fixes are real**, and two of them (`advanceWorld` simulating 60× the
  requested time; crop-plot targeting hitting the neighbouring cell) were found *by building the
  browser harness* — the harness earning its cost on day one.
- **`payRecoveryReward` is a correct fix** to my previous P2-2, done the right way: it shares
  `payWage`'s transfer so conservation is proven once, and it pays honestly when the requester is
  insolvent rather than manufacturing currency.
- **CI exists.** My previous P2-5 is closed.
- **The RNG investigation is honest and correct in its diagnosis**, and picking weather first was
  the right narrow cut.
- **The disclosures are unusually good.** Soak-not-run, browser-harness-not-in-CI, the
  `materializeStructure` visual gap, and the `TreeRenderer` decision are all disclosed rather than
  buried. That is the behaviour that makes this audit possible.

---

## 8. Prioritized findings

### P0 — must fix before PR #12 merges

**P0-A · The 21-run PASS does not mean what the PR body says it means.**
*Evidence:* §4.1–§4.8. Every headline failure in §3 occurs *inside* WorldLab's own seeds and
*inside* its scenario categories, with every check green.
*Why it matters:* a harness that reports PASS on this world will report PASS on the next one. The
claim "the village genuinely functions" is not supported by the evidence offered for it.
*Minimum bar to merge:* either (a) land the four cheapest true-negative-killing checks —
`tail.deprivation-streak`, `tail.nobody-is-excluded`, `invariant.spendable-currency-is-real`,
`invariant.nutrition-adequacy` — and report the resulting (failing) matrix honestly; or (b) restate
the claim as "no *structural-integrity* violation was found in ≤14-day windows", which is what was
actually tested. **(a) is strongly preferred**: all four are <25 lines each and all four fail today,
which is exactly what makes them worth having.

**P0-B · Spendable currency collapses ~40% per month with no source; the invariant certifies it.**
*Evidence:* §3.1, five seeds. Median wealth 30 → 0; 20–22 of 32 unable to buy any meal; residual on
the conserved quantity exactly 0.00.
*Code:* `world/metabolism.ts:383` (`restockTavern`), `mind/agent.ts:1544` (`executeRobbery`),
`headless/worldlab/probe.ts` (`totalCurrency`), `headless/worldlab/invariants.ts`
(`currency-conservation`).
*Check:* `invariant.spendable-currency-is-real` + `tail.purchasing-power`.
*Correction:* unify the two currency representations (§4.1). Do not "balance" the sink — the
problem is that a monotone drain with no source is structurally terminal at any rate.

**P0-C · Individuals are starving for the entire run, on every seed, and no check can see it.**
*Evidence:* §3.2. 712 of 720 hours; 13–18 of 32 over 48 h; 2–4 over a full week — measured by
hourly physiological sampling, independent of the event log.
*Code:* `logistics/haul.ts:342` (`canHaul`), `world/village.ts:284` (bandit larder skip),
`mind/knowledge.ts:329` (`knownFoodPlace` ignores distance).
*Check:* `tail.deprivation-streak`, `tail.nobody-is-excluded`, `tail.reachability`.
*Correction:* detection now; the access fix (a food source reachable from the camp; an income path
for guards) is legitimately v0.9 scope.

**P0-D · The world manufactures ~1 phantom theft per day from legitimate haul cargo.**
*Evidence:* §3.5. 21–24 false `recover_item` desires per 20 days on every seed, each with a
permanent false memory, an anger spike, a shouted line, and an unbounded desire-list append.
*Code:* `mind/agent.ts:1669` (`item_missing` inference) × `logistics/haul.ts:197` (cargo ownership).
*Why P0:* it is a false belief with provenance (Constitution §5/§6), it is player-visible, it grows
without bound, and it directly pollutes the very desire type this PR's headline feature operates
on. It is also a two-line fix: exclude items with a live `haulTaskId`, or exclude a holder who is
the claimant of an open haul task for that item.
*Check:* `invariant.no-false-theft-belief` — no `item_missing` may name an item whose current
holder is the claimant of an open haul task carrying it.

### P1 — serious architecture / harness flaw

**P1-A · `detectAnomalies` is still a 3-hour trailing window over a compacted log, and WorldLab
throws its output away.** §4.5. Change the signature to take an event source; feed it the telemetry
stream; make `verdictOf` consume structural-integrity anomalies. Highest leverage change available.

**P1-B · PRNG state is not persisted; both streams rewind on load; a committed doc says otherwise.**
§6. ~6 lines plus a `SAVE_VERSION` bump. Blocks the recommended per-entity stream work.

**P1-C · Three liveness checks read end-of-run live state instead of the series.** §4.7.

**P1-D · The construction liveness check is double-gated so it cannot fire during either observed
stall.** §4.4.

**P1-E · The `recover-item` scenario and browser spec both skip the discovery step the feature
exists to provide; 0 runtime `loc:<item>` writes across 60 world-days.** §4.6. The §1A/§1B work is
correct in mechanism and unreachable in play.

**P1-F · Food-chain throughput is in permanent deficit and the cap is on the wrong stage.** §3.3.

**P1-G · RNG coupling is reduced, not removed.** §5. Shed-completion spread under meaningless
RNG-phase perturbation fell from 14.7× to **3.4×** — a real win — but day-25 village wealth spread
*widened* to **1.73× (653–1132)**. Cross-commit economic comparisons remain unmeasurable at one
seed. Also: the construction test still allows 35 days against an observed 1.5–5.1, a ceiling that
cannot fail. Per-entity streams are the right next step and are **blocked on P1-B**.

### P2 — safe follow-up

- **P2-A · `docs/WORLDLAB.md` is referenced three times and does not exist**; the "not yet
  mechanically checked" disclosure has no home, and `docs/V0_8_THE_LEGIBLE_WORLD.md` never mentions
  WorldLab. Write the file, or remove the references.
- **P2-B · Seed 1337 is in no WorldLab tier.** One-line change to `scenarios.ts`.
- **P2-C · Standard tier maxes at 14 days.** Raise `baseline-village` and `food-chain` to ≥ 21, or
  run and report `world:soak` before merge.
- **P2-D · Timber horizon.** `invariant.renewable-horizon`: `capacity / consumption_rate >
  regrow_period`. Fails by ~2 orders of magnitude. **Do not shorten the regrow time** — 2.5 years
  to replace a felled mature tree is the realistic number and Constitution §64 prefers
  understandable causes to convenient ones. State the constraint as an invariant, and if more
  timber is genuinely needed change the *stock* (more/larger groves, a managed woodlot), not the
  biology. Separately, drop `PLANK_CAP` (40) toward real project demand (16), or make it a function
  of open project deficits — that alone would cut measured timber consumption by roughly two-thirds
  without touching regrowth.
- **P2-E · The HUD still prints any NPC's goal type and exact hit points on sight**, and the top bar
  prints the exact living population. v0.8 §G fixed item-ownership omniscience and left these.
- **P2-F · `tests/stress-benchmarks.test.ts`'s food-pressure test cannot fail** (nothing can die of
  starvation; `≥30 alive` is vacuous). Rewrite around recovery latency.
- **P2-G · The ale invariant is untested in the regime it runs in** — all four tests set
  `innkeeper.wealth = 500`; the 90-day evidence cited for the fix is `wealth = 0`, where
  `min(cost, wealth)` floors the charge to zero.
- **P2-H · `mind/economy.ts` documents a bandit-pressure feedback loop the code does not
  implement.** Either wire it or correct the comment.

### P3 — future depth

- **P3-A · Population is a constant** — no births, no non-violent deaths, no ageing. Every
  physiological chain terminates in "reduced work rate". Constitution §55's benchmark presumes
  demography.
- **P3-B · Desires are effectively authored** (two seeded + one misfiring generator). Constitution
  §37's emergent institutions need circumstance to generate goals at the desire level.
- **P3-C · Per-entity RNG streams**, once P1-B lands. The `docs/RNG_ARCHITECTURE.md` migration plan
  is sound; its ordering (cosmetic draws first) is right.
- **P3-D · Semantic prop rendering** for stockpiles, construction stages, tree growth, cargo and
  damage. `docs/RENDERING_ARCHITECTURE.md`'s direction agrees with my previous pass's Part 6.
- **P3-E · Ownership is legible but unenforced** — the player still takes a 40-unit bread stack with
  one keypress. Roadmap v0.11.

---

## 9. The five questions to ask of the next WorldLab report

1. **Which quantity does the conservation check conserve, and can anyone spend it?**
2. **Who is the worst-off individual, by name, and for how many consecutive hours?**
3. **For each liveness check that passed: what world would make it fail?** If the answer is "a
   totally dead one", it is a smoke test, not a health check.
4. **Which anomalies fired, and did any of them change the verdict?**
5. **Does it hold at seed 1337, and at 30 days?**

---

## Appendix — probes

On this audit branch only (`tools/audit/`, outside `tsconfig`'s `include`, imported by nothing in
`src/`):

```bash
npx tsx tools/audit/economy-survival-probe.ts --days 30 --seeds 918271,918272,1337,42424242,12345
npx tsx tools/audit/recovery-chain-probe.ts   --days 20 --seeds 918271,1337,42424242
npx tsx tools/audit/save-rng-continuity.ts
npx tsx tools/audit/rng-coupling-probe.ts     --days 25 --seed 918271 --burns 0,1,2,3,4,5
```

**Every number in this audit was measured against `claude/v0.8-legible-world` @ `6d8107a`**, in a
detached worktree. PR #12 was not modified. Re-running on a different commit will produce different
numbers — that is P1-G, not a bug in the probes. Compare qualitative verdicts, not digits.
