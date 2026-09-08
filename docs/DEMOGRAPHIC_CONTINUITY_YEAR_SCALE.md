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

Save schema 18 persists generated people and bodies, households, pregnancy and lineage, the
demographic RNG stream, living-state inputs, materialized significance, and Chronicle eras. Load
rebuilds living indices deterministically after the overlay. As with earlier semantic schema bumps,
pre-18 browser saves are rejected rather than silently reinterpreted.

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
