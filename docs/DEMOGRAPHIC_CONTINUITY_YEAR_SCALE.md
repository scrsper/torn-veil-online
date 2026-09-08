# Demographic Continuity and the Year-Scale Substrate

This milestone makes generations ordinary simulation state while adding the indices and history
materializations needed to run that state for years. It follows the Constitution's identity/body
distinction: death removes a person and their bodies from active indices, but never deletes the
person, lineage, events, memories, or provenance that refer to them.

## Canonical model

- `World.entities` and `byKind` remain cumulative historical registries. `livingPersons()` and
  `activeBodies()` are derived hot-loop indices maintained by `World.add`, `markPersonDead`, and
  `rebuildLivingIndices`. `livingIndexErrors()` checks the derivation against canonical life/body
  state.
- `Household` is a registered entity with stable identity, living members, an optional home, and
  conserved wealth. Household stores are ordinary `Item`s whose `ownerId` is the household. The
  existing appraisal, absence, conversation, and home-food access paths now receive real
  household identities instead of dangling strings.
- A `Person` records `birthTick`, `parentIds`, species, reproductive role, current life stage, and
  the age basis of immutable attributes. Born people are made by `makePerson` and `makeBody`; they
  have no subclass or CAST dependency.
- `Pregnancy` is durable physiology state. `stepPhysiology` charges a gestation-dependent caloric
  and fatigue cost. Daily reproductive fitness reads health, energy, and hydration continuously;
  scarcity reduces conception and survival without a famine switch.
- Calendar-day maintenance derives age and life stage. Capabilities use immutable base attributes
  multiplied by a current species age curve, preventing cumulative yearly degradation.
- Natural death is a daily sample of a species/age/condition annual hazard. All person deaths,
  including lethal combat, enter the idempotent `diePerson`/`World.markPersonDead` pipeline.

## Social continuity and property

Courtship is an ordinary goal candidate over people a mind can currently perceive. Eligibility is
based on adulthood, species/reproductive compatibility, existing partnership, family relationship,
custody, and the existing affection/trust/familiarity relationship values. It does not inspect
names, occupations, CAST keys, or global pair lists. A successful proposal uses the pre-existing
`marriage` event and canonical household membership operations.

On death, a deterministic estate policy selects a living spouse, otherwise living descendants,
otherwise the household, and finally a stable estate household. `Person.wealth` is moved rather
than minted. Every owned item keeps its identity, changes `ownerId`, and appends an `inheritance`
provenance entry linked to the canonical inheritance event. The event records heirs, amount, item
ids, and the death cause.

## Historical scale

`World.emit` applies the single significance contribution implementation in
`core/historicalSignificance.ts` to a materialized entity-score map. Reads no longer scan every
event. The full replay function exists only for controlled equivalence tests.

Chronicle detail older than `CHRONICLE_DETAIL_RETENTION_DAYS` is grouped into deterministic
`CHRONICLE_ERA_YEARS` records. Each era retains people, source event ids, external causes, event
counts, and a factual summary. The detailed Chronicle view omits represented sources; retired event
ids resolve to the era's retained canonical anchor, while live cognition and item provenance pin
their exact causal events. Repeated compaction is idempotent.

## Persistence

Save schema 19 persists generated people and bodies, households, pregnancy and lineage, the
demographic RNG stream, living-state inputs, materialized significance, Chronicle eras, the trades
people have taken up in-run, and `Conflict.downed`. Load rebuilds living indices deterministically
after the overlay. As with earlier semantic schema bumps, pre-19 browser saves are rejected rather
than silently reinterpreted.

## Epoch WorldLab

`npm run world:epoch -- --years 1|5|25 --seed <n>` runs the canonical `World` and `Simulation` at a
named one-step-per-calendar-day observation cadence. It reports raw per-year wall time and heap,
living and cumulative population/entities, births/deaths/inheritances, event and Chronicle sizes,
era count, cost per tick, and cost per tick per living person. It also reports conservation,
invariant, lineage-depth, coming-of-age, and deterministic-state evidence. This coarse cadence is
visible in every report; it is a WorldLab scale tier, not a second demographic scheduler.

The CPU-bound acceptance suite is isolated from unit tests:

```bash
npm run epoch:accept
```

It replays the five-year seed to test determinism, then runs the twenty-five-year horizon. The
ordinary `npm test` suite excludes it for the same worker-starvation reason as the causal and
adaptive long runs.

### Acceptance evidence (seed 1)

The final standalone 25-year run completed in **56.36 s**. It produced **5 births, 7 deaths, and
7 inheritance executions**; 3 people born during the run reached adulthood. Living population
ended at 31 while cumulative people reached 42 (11 dead identities still addressable), and the
world held 246 cumulative entities.

Chronicle detail fell from a pre-retention high of 29 entries to 10 entries represented alongside
9 era records. The retained canonical event array rose to 10,359 during the initial five-year
detail window, dropped to 6,327 when the first run-era became compactable, and remained in the
6,327–8,035 range thereafter, ending at 7,834 rather than growing to the pre-fix 72,937 events.

Raw annual wall time ranged from 1.83 s in year 1 to 2.72 s in year 25. Normalized cost rose from
162 to 240 microseconds per tick per living person across the entire run; this genuine 48% rise is
reported rather than hidden. Importantly, after the five-year retention window the event array is
bounded despite another 19 years of dead identities and history. The remaining normalized rise is
therefore not an unbounded-history scan; living minds continue accumulating knowledge, memories,
concerns, and relationships, which remains a later cognition-LOD optimization target.

The same run reported zero unexplained currency delta, zero invalid item owners, no living-index
or household invariant errors, and a deterministic canonical state hash.

---

# Revision 2 — what the seed matrix showed, and what it cost to believe one seed

Everything above this line was measured on **seed 1**. Re-measured across the seed matrix the
other WorldLab tiers use (`headless/worldlab/scenarios.ts`'s `baseline-village`, plus seed 1), the
flat-cost claim did not hold. This section records what was measured, what changed, and — more
importantly — what turned out to be wrong with the instrument itself.

## 1. The flat-cost claim failed on the canonical project seed

Measured over five simulated years before any change in this pass:

| seed | ms/tick/living, yr1 → yr5 | change | retained events yr1 → yr5 |
|---|---|---|---|
| 1 (the seed the section above was written from) | 527 → 504 µs | **−4.4 %** | 6,474 → 10,359 |
| **918271 (the canonical project seed)** | **527 → 1,092 µs** | **+111.2 %** | **8,382 → 19,276** |

918271 is the seed every other WorldLab tier, every trace CLI and the Adaptive/Causal acceptance
runs use. Running a scale tier on one hand-picked seed is how a scale claim gets made about a
world that happened to be quiet, so `EPOCH_SEEDS` now names the matrix and
`tests/epoch-continuity-longrun.test.ts` runs the whole of it.

## 2. Root cause: a fight's ENDING was the only cadence-dependent thing in the simulation

`sim.strategic.conflict` was 14.1 s of 50.9 s on 918271. The growth term underneath it was
`attack` events: 421 in year 1, 5,657 by year 5, with seven people locked in fights that never
ended. That is the pathology `docs/V0_2_2_SCALE_READINESS_AUDIT.md` named for this seed, and it
had a specific and narrow cause.

Every extended act in this simulation carries a duration and consumes however much of it the
caller's step covers — building, hauling, milling, sleeping. Combat did not. `act`'s attack
handler threw exactly **one blow per call**, however much time the call represented, while the
strategic pass healed the target for the whole of that same interval. And the only thing that ever
stopped an attacker was an *instantaneous* observation of `Body.pose === 'downed'`, a state that
lasts **45 physical seconds** before `bodyPhysics` stands the body back up at 30 % health.

At play cadence a step is a fraction of a second, somebody always looks inside the window, and
fights end. At the epoch tier's **one step per calendar day** (1,440 physical seconds), a fighter
landed one blow per simulated day against a target recovering a day's worth of health between
blows, and nobody ever observed a downing. So the fight could not end — and every blow refreshed
`Conflict.lastMeaningfulInteraction`, so `maintainConflicts` never saw a stale fight either.

**A canonical outcome must not depend on how often the world is observed** (Constitution invariant
I, §46). Two changes, neither of which alters play-cadence behaviour:

- `Simulation.exchangeBlows` — the number of swings a call delivers follows the physical seconds
  the call covers, bounded by the target going down and by the attacker's exertion capacity
  (`WORK_CAPACITY_FLOOR`, the same floor heavy labour uses). At play cadence a step covers less
  than one swing interval, so it delivers exactly one blow and nothing changes.
- `Conflict.downed` + `social/conflict.ts`'s `recordDowning` — "I put them down" becomes a durable
  canonical fact on the conflict rather than a 45-second pose, and `act`'s stop condition reads it.
  Cleared when the downed party strikes back, so it is not an immunity.

`recordDowning` deliberately does **not** end the conflict itself. Doing so was implemented and
measured: at play cadence it cut fights shorter than the existing lifecycle would have, and
`npm run causal:accept`'s deepest causal walk stopped existing — a real loss of world behaviour
for no gain at either cadence. The fight still ends the way it always did, by the attacker
stopping and `maintainConflicts` finding the conflict stale.

An exhaustion-driven break-off (a fighter below `WORK_CAPACITY_FLOOR` disengaging) was also tried
and **rejected on measurement**: it produced start/disengage/resolve/re-engage churn — 520
conflicts and 12,224 attack events on 918271 over five years, against 48 and 8,652 without it.

### Measured after

Five years, per seed, retained events and the deterministic working-set trend:

| seed | retained events yr1 → yr5 | events / living / year | working set / living, change |
|---|---|---|---|
| 918271 | 8,870 → 18,312 | 67.4 | +50.1 % |
| 918272 | 10,786 → 26,568 | 116.0 | +78.5 % |
| 1337 | 8,389 → 17,935 | 66.3 | +53.0 % |
| 42424242 | 8,716 → 12,808 | 30.1 | +18.0 % |
| 12345 | 9,106 → 18,651 | 70.2 | +52.1 % |
| 1 | 6,685 → 13,810 | 52.4 | +53.2 % |

Growth inside the first five years is **expected and is not the flatness claim**: nothing compacts
until `CHRONICLE_DETAIL_RETENTION_DAYS` has elapsed, so that window is the retention buffer filling
on purpose. The flatness claim lives past it, and there it holds:

| seed | retained events yr6 → yr25 | working set / living, yr6 → yr25 | eras |
|---|---|---|---|
| 1 | 6,570 → 8,492 | 346 → 456 | 9 |
| 918271 | 11,279 → 17,289 | 617 → 909 | 9 |
| 918272 | 23,303 → 17,544 | 1,091 → 1,042 | 9 |

Era count grows rather than sitting at the five the seeded pre-history produces.

## 3. The assertions are on a deterministic quantity, not on wall time

`trend.normalizedChangePercent` is milliseconds per tick per living person. It is the honest end
measurement and it is also the noisy one: the same five-year run of seed 1 was measured at 24 s and
at 54 s on the same machine minutes apart. A bound loose enough to be stable on it would have
passed the +111 % regression. So the tier now also reports `mindStateItems` and
`workingSetPerLiving` — the retained event log plus everything the per-tick cognition loops walk
(knowledge, memories, relationships, concerns, pursuits), per living person. That number is
identical on every machine for a given seed, and it is what the cost is actually proportional to.
The acceptance suite asserts on it; wall time stays reported as evidence.

## 4. THE FINDING THAT MATTERS MOST: this tier is not observing the same world

The claim in the section above — "a WorldLab scale tier, not a second demographic scheduler" — is
**false in effect**, and it invalidates most of what this tier has been used to conclude about
demographics.

At one step per calendar day, a person completes at most one plan action per day, while physiology
drains a full day between two of them. Measured on 918271, every day of a full year:

```
day  30: n=33 energy=0.000 hydration=0.000 sleepDebt=15.03 health=1.000 zeroEnergy=33/33
day 365: n=33 energy=0.000 hydration=0.000 sleepDebt=14.55 health=1.000 zeroEnergy=33/33
```

Every person in the world sits at **zero caloric reserve and zero hydration for the entire run**,
in perfect health, because deprivation has no physical consequence anywhere in the model — health
changes only through combat and healing. Tallying what born-in-run people actually do across
twenty-five years, on seed 1:

```
Norrin Hollis:  eat=657  drink_water=214
Sorrel Vance:   eat=657  drink_water=164
Talwyn Vex:     eat=657  sleep=68  drink_water=58  idle=9
```

Nobody in the world ever forms a goal other than eating, drinking, sleeping and fighting. No work
is done, no trade is practised, no lesson is given, no shortage is noticed. This is also the real
answer to "demographics is near-inert on 918271": `physiologicalFitness` reads health, health is
pinned at 1.0, and `annualMortalityHazard` for a cast averaging 39 years old integrates to roughly
0.05 expected deaths per year across 33 people. **Zero deaths in five years is the correct output
of the curve for that cast** — not a shallow hazard and not a young cast, but a world in which
nothing except a killing blow can kill anybody.

Finer cadences do not fix it on their own — measured at 5, 20 and 60 physical seconds per step,
31–33 of 33 people are still at zero energy by day 30 (the v0.8 audit found the same thing on seed
1337: "22/32 unable to buy any meal by day 30"). What changes below ~60 s/step is that health
starts to degrade, because fights start resolving again.

**Three questions follow, and they are the project's to answer, not this pass's:**

1. Should sustained deprivation damage the body? It is the missing mechanism behind inert
   demographics, and adding it to a village that already lives at zero reserve would kill most of
   Ashford in every existing scenario — which may be the honest outcome (§64/§71 prefer a real
   constraint to a convenient fake) or may mean the economy is the thing to fix first.
2. Should the epoch tier's cadence be brought inside the physical model's validity envelope, or
   should the substrate be made cadence-invariant? The first costs ~24× per step; the second is a
   milestone in its own right.
3. Until one of those is answered, the epoch tier is a **regression tripwire for accumulated-state
   growth** and nothing more. It should not be read as evidence about demography, economy or
   behaviour.

## 5. Generational continuity: `coming_of_age` now has a consumer

`coming_of_age` was emitted, weighted 0.45 for historical significance, and read by nothing. A
person born during a run kept `occupation: 'child'` and `workId: null` for life, so
`mind/schedule.ts` gave them a child's day — breakfast, play in the square, play again — at
twenty-three.

`sim/mind/livelihood.ts` is the consumer, and it is a READING in the shape of
`mind/vocation.ts`'s `recogniseClass`, never an assignment. Four canonical inputs:

- **taught** — a `technique` belief with a real teacher on it (`mind/apprenticeship.ts`);
- **practised** — proficiency that only ever rose through real successful batches;
- **done** — `WorkStint`s: batches actually got out of this place;
- **opportunity** — a household that works this trade, and room at the work (the post is going
  unserved, or everyone still holding it is at the end of their working life).

Acquired basis is a hard gate on *holding* a trade: being the miller's son buys nothing without
instruction, proficiency or batches. Household proximity gates only being at the work at all, which
is the door instruction comes through. Recognition writes `workId` and the place's own `workers` —
the canonical record `world/labor.ts` reads — and the occupation label last, as a summary; nothing
in the labour path reads it. A new `livelihood_taken_up` event carries the evidence and the causal
ancestry back to the lesson.

Coming of age itself now has an immediate consequence: a grown person with no trade stops being
called a child and gets an adult day (`'villager'` — the summary of a real state, not a station).

**What is proven, and how.** The whole chain — being at the household's work, being shown the
trade, the trade being recognised, a real batch of flour that did not exist before, a novice's
batch measurably worse than the settled tradesman's — is asserted end to end in
`tests/generational-livelihood.test.ts` (16 deterministic tests), together with the negative
assertions that carry the weight: no trade from household alone, none in an adolescent body, none
while the trade's holder is fit and in his working years, none from an occupation string, and two
people with the same history read identically whatever they are called.

**What is not proven.** The work order asks for this chain inside a 25-year epoch run. It is not
reachable there, for the reason in §4: nobody in that world ever forms a work goal. Measured on
seed 1 over 25 years, three people born in the run reach adulthood and none of the five is born
into a mill or bakery household in the first place — Ashford has exactly two `TradeProcess` posts,
and the trades those children grow up around are farming, innkeeping and banditry. The epoch
acceptance therefore asserts the part that does hold — they come of age, and none of them is still
on a child's day — and says plainly that the rest is proven elsewhere.

## 6. Hot-path scans removed

- `livingDescendants` re-scanned the whole append-only person bucket once per BFS node on every
  death — O(cumulative people × descendants). One pass now builds the parent → children index the
  walk needs.
- `generatedName` walked the same bucket per iteration of a retry loop, per birth, against 25 given
  names. The taken-name set is built once, and the pool is 120 names — 25 was not a naming scheme,
  it was a collision generator.
- `World.markPersonDead` rebuilt `livingPeople`/`livingBodies` with `.filter()` on every death; it
  splices in place now. (Note that this one was O(living), not O(cumulative) — the array is the
  derived hot index, not the historical bucket.)

## 7. Test-suite flake

`tests/world-metabolism.test.ts`'s eight-day chain was consuming ~115 s of a 120 s budget alone and
failing on a bad draw beside the rest of the suite. The budget is now 300 s. Its assertions are
untouched: the fix for a test that is close to its budget is a budget with headroom in it.
