# Torn Veil Online v0.2 — World Engine

This document records what the v0.2 "World Engine" milestone actually built, tested, and
verified against `docs/TORN_VEIL_CONSTITUTION.md`, on branch `claude/v0.2-world-engine`
(built on the constitutional baseline commit `8fe3bd1`). It follows the Constitution's own
distinction between **designed**, **implemented**, **tested**, and **behaviorally
demonstrated** — a claim below is marked with whichever of those it has actually earned, not
the strongest one that sounds good.

The milestone's acceptance test, verbatim from the brief that commissioned it:

> I can run Ashford Vale with no player and no renderer for an extended simulated period;
> entities continue acting through generalized systems; factions, knowledge, relationships,
> conflict, and history remain internally coherent; significant events are preserved; the run
> automatically explains itself through telemetry and a chronicle; the same seed reproduces the
> same history; and none of this requires an LLM to invent canonical events.

That is **implemented and behaviorally demonstrated** for runs of the length exercised in this
sandbox (documented under Testing and Known Limitations below), and **implemented and tested**
for the underlying mechanisms at any length the architecture doesn't itself bound.

## Architecture added

**Headless execution (Parts 1–2).** `src/headless/runner.ts` runs the exact canonical
`World`/`Simulation`/`generateVillage` the browser client uses — there is no second simulation
implementation. It drives `Simulation.step(physDt, worldDt)` in a tight loop instead of from
`requestAnimationFrame`, with a deterministic fixed physical substep (default 0.15s) and the
existing `WorldClock` physical/world time-scale split left untouched. `src/headless/cli.ts` is
the `npm run sim -- --seed <n> --days <n>` entry point; it writes `summary.json`,
`chronicle.txt`, `anomalies.json`, and `telemetry.jsonl` to `.debug/headless/<runId>/`
(gitignored).

**Telemetry (Part 3).** `src/sim/telemetry/{types,recorder}.ts` subscribes to World's existing
`onEvent` stream and turns a curated subset into categorized records
(run/cognition/perception/knowledge/relationship/conflict/social/institutional/integrity). It
is structurally read-only — `TelemetryRecorder` never calls anything that mutates `World`,
`Person`, or `Faction` state, only reads events those systems already emitted for their own
reasons — and a broken sink is caught defensively so it can never disrupt the simulation.
`fileSink.ts` is the Node-only JSONL sink used headless; `MemorySink` is the browser-safe
in-memory sink also used by the headless runner itself (so a run can produce its own summary
without a file sink).

**Anomaly detection (Part 4).** `src/sim/telemetry/anomaly.ts` is a read-only scanner over
canonical state and the event log: `repeated_lethal_conflict`, `death_spike`, `dangling_cause`,
`invalid_entity_reference`, `event_spam`, `stuck_agent`, `goal_churn`, `epistemic_leak`. It
reports; it never repairs anything.

**World run summary (Part 5).** `src/sim/history/summary.ts` builds a structured
machine-readable (`summary.json`) and human-readable report at the end of every headless run:
seed, simulated duration, population, deaths and causes, violence, robberies, reports and
investigations, knowledge transfers, relationship/ownership/leadership changes, path failures,
stuck entities, goal churn, anomaly counts by type, and the most historically significant
entities and events. Every per-run count is scoped to events with `tick >= this run's own
start` — village generation authors years of backstory as ordinary `WorldEvent`s with an
explicit past tick, and an earlier version of this file didn't scope for that (see Known
Limitations for how that surfaced).

**Stable persistent identity (Part 6, carried from the prior commit on this branch).**
`Entity.slug` plus `World.getBySlug`/`bindSlug` give authored entities (Rowan, Mara, Skarn,
Ashford Vale, the Watch, ...) a generation-order-independent handle, alongside their existing
generation-order `id`. Verified deterministic across two independently generated worlds with
the same seed.

**Historical significance (Part 7).** `src/sim/history/significance.ts` computes significance
from the causal event log — explicitly not power tier, not cognitive fidelity, not player
proximity. A weighted event-type table means combat scores highly but is not the only path:
`heal`, `gift`, `investigation`, `rumor`, and a causal-centrality bonus (events with many
downstream effects) all contribute, so a healer or witness can outscore an idle bystander (unit
tested directly, not merely asserted).

**Cognitive Level of Detail — foundation (Part 8).** `src/sim/core/cognition.ts` defines
`'aggregate' | 'lightweight' | 'full' | 'deep'` and implements the *mechanism*: changing an
entity's fidelity only ever touches `mind.thinkInterval`, is reversible, and never alters what
they already know (memories/knowledge/relationships untouched — verified by snapshotting and
comparing before/after in `tests/cognition-lod.test.ts`). `rebalanceCognitiveLOD` keeps the
player, nearby entities, historically significant entities, and anyone mid-urgent-goal at
`'full'`; everyone else drops to `'lightweight'`. `'aggregate'` and `'deep'` are **designed and
typed, not implemented** — nothing in v0.2 assigns or depends on them, per the brief's explicit
instruction not to fake a civilization-scale population system prematurely.

**Factions as institutions (Part 9).** Carried from the prior commit: `Faction.leaderId`,
`factionType`, and `Faction.knowledge` (institutional memory, distinct from any member's
personal knowledge). This milestone adds the institutional *process* on top:
`src/sim/history/factions.ts`'s `syncFactionInstitutionalKnowledge` promotes only the leader's
own sufficiently-confident knowledge into `faction.knowledge` — a rank-and-file member's private
knowledge never leaks in just because they belong to the faction (Constitution §37, directly
unit tested). `checkLeadershipVacancies` promotes the most historically significant alive
member on a leader's death, or leaves the faction explicitly leaderless if none remain.

**Generalized motivations / resource pressure (Parts 10, 12 — partial).** `src/sim/mind/
economy.ts`'s `banditResourcePressure` gives bandit robbery utility a real causal input (the
bandit faction's aggregate wealth against a baseline) rather than existing purely because the
occupation is `'bandit'` — one working causal loop, as the brief asked for, not a full economy.
Part 10's full "traits + needs + beliefs + memories + relationships + faction obligations +
opportunities + motivations = goal candidates" reasoning structure is **not** implemented in
this milestone beyond what already existed pre-v0.2; see Known Limitations.

**Conflict intent (Part 11, carried from the prior commit, corrected in this one).**
`ConflictIntent` (`avoid|threaten|rob|defend|subdue|arrest|drive_off|injure|kill`) threaded
through `Goal.data` → `Action.data` → `Simulation.attack`/`applyHit`. Only an explicit `'kill'`
intent can end a life; every other intent downs instead. This milestone found and fixed two
follow-on correctness bugs in that system while actually running it headless for real (see
"Fixed while building this milestone" below): a downed target still registering as an active
threat, and a lawful arrest being indistinguishable from a crime to other witnesses.

**World Chronicle (Part 14).** `src/sim/history/chronicle.ts` is a deterministic historical
*selection* layer: it selects real events already in `world.events` (history-category always,
everything else above a significance threshold) and formats them as `"Day N — <the event's own
canonical summary>"`. Nothing is invented — every entry carries the real event id and its
recorded causes; `causalAncestry()` walks the full causal chain behind any entry.

**Automatic browser dev-session logging (Part 18).** `src/main.ts` now starts a
`TelemetryRecorder` at game construction and flushes it to `localStorage` (via the new
`browserSessionSink.ts`, capped at 5 retained sessions, defensively try/caught exactly like the
existing save system) on the same cadence the game already autosaves — no manual marker
required. See Known Limitations for why this is disclosed as implemented-but-not-browser-tested.

### Fixed while building this milestone (not in the original 20-part list, but load-bearing for it)

Actually running the headless engine for real — not just typechecking it — surfaced three bugs
that made a multi-day run behaviorally pathological and, combined, made it never finish inside
any reasonable wall-clock time. All three are fixes to code from the *prior* commits on this
branch, not new v0.2 systems, and are covered by the existing 31-test suite staying green plus
new regression coverage:

1. **`core/world.ts` event compaction was keeping the entire event log.** The compaction filter
   unconditionally retained every `'world'`-category event forever — but `'world'` is the
   *default* category for ordinary events (meals, work shifts, door state) as well as important
   ones (attacks, kills), not a "this matters historically" marker (that's `'history'`). Once a
   run's event count crossed the compaction threshold, compaction became a near no-op and kept
   re-running its full O(n) pass on an ever-growing array. Fixed to judge `'world'` events by
   significance/recency like everything else, with causal ancestors of significant events still
   preserved.
2. **A downed (subdued/arrested) body was still eligible to register as an active threat**, so
   the moment it recovered (or even before, in the same encounter), whoever downed it would
   immediately re-engage — extending the downed timer forward on every hit and producing an
   endless attack loop between the same two actors instead of the encounter ever concluding.
   Fixed by excluding downed bodies from threat assessment.
3. **A lawful arrest/subdual was indistinguishable, to any other witness, from an actual
   crime.** `isCrime()` didn't look at the attacker's own recorded intent, so a guard's lawful
   force was learned as a fresh crime by anyone who saw it — including other guards, who would
   then independently "discover" and arrest the arresting guard, producing an unbounded mutual-
   arrest spiral. Fixed by threading `ConflictIntent` into the knowledge claim and excluding
   `subdue|arrest|defend|avoid|drive_off` from `isCrime`.

These are documented in detail in the "Fix correctness bugs surfaced by real multi-day headless
runs" commit on this branch, including the concrete before/after event-volume numbers that led
to diagnosing each one.

## Explicitly not implemented yet

Everything below remains aspirational, exactly as the Constitution frames it and as the
milestone brief's "DO NOT BUILD YET" list required:

- Real multiple worlds/universes, procedural planets or galaxies, Ready-Player-One-style world
  traversal, or any world/region namespacing beyond the identity system leaving room for it.
- John Smith as an orchestrating LLM agent, or any LLM-driven canonical decision-making. No LLM
  call sits anywhere in the canonical simulation path in this milestone.
- Astral Kings, Astral Beings, playable gods, a complete class system, a complete power-ranking
  system, or a complete magic system.
- Population-scale `'aggregate'` cognition, or `'deep'` cognition — both are typed and reserved,
  neither is assigned or exercised by any code path.
- A full economy: `banditResourcePressure` is one causal loop, not supply/demand, pricing, or
  production chains.
- Part 10's full generalized-motivation reasoning structure (traits+needs+beliefs+memories+
  relationships+faction-obligations+opportunities → goal candidates) — the existing utility/goal
  system from before v0.2 is unchanged in this milestone beyond the conflict-intent and
  resource-pressure work described above.
- Faction membership changes at runtime (`factionMembershipChanges` is honestly reported as a
  flat `0` in every summary, with a code comment explaining the gap, rather than omitted).
- A robbery/subdual "conclusion" mechanic (item actually transferred, bandit flees/disengages
  afterward) — see Known Limitations below for why this matters more than it might sound.
- Multiplayer, mining, crafting expansion, another major settlement, or any renderer
  replacement.

## Testing

Ran from this sandbox (see Known Limitations for the specific, disclosed sandbox constraints
this ran under):

- **`npm test`: 62/62 passing** (31 pre-existing + 31 new). New files:
  `tests/cognition-lod.test.ts` (3), `tests/factions-institutional.test.ts` (5),
  `tests/significance-chronicle.test.ts` (8), `tests/telemetry-anomaly.test.ts` (11),
  `tests/headless-benchmarks.test.ts` (4, covering Part 16's Benchmarks A/B/C plus the
  world-time clamping fix). No pre-existing test was modified or weakened.
- **Typecheck: clean** over `src/sim/**`, `src/headless/**`, `tests/**` (the actual surface
  this milestone changed) via a sandbox-scoped tsconfig — see Known Limitations for why this is
  not the repo's own `npm run typecheck`.
- **`npm run build`: not achievable in this sandbox** — fails, as expected, on the sandbox's
  stub `three` package and the repo's real `tsconfig.json` not declaring Node types (this
  sandbox cannot `npm install` the real `three`/`@types/node`). Not a code defect; see Known
  Limitations.
- **Benchmark A (Player Absent):** `runHeadless` completes with no player and no renderer
  involved anywhere in the loop; `detectAnomalies` reports zero `dangling_cause` /
  `invalid_entity_reference` findings; every faction's leader (if any) resolves to a real
  entity; telemetry, chronicle, and summary are all non-empty automatically. Tested at a short
  duration in the suite (fast, deterministic) and manually demonstrated at 2 simulated
  world-days (below).
- **Benchmark B (Deterministic Replay):** two `runHeadless` calls with the identical seed and
  duration produce byte-identical event type/summary sequences, an identical `summary` object,
  identical chronicle text, and identical final person state (alive/wealth). Tested directly.
- **Benchmark C (Divergent Seed):** a second seed completes, remains internally valid (same
  integrity checks as Benchmark A), and is not required to (and in practice does not) match the
  first seed's outcome. Tested directly.

### A real manual run

```
$ npm run sim -- --seed 918271 --days 2
```

completed in this sandbox in **67 seconds of wall-clock time** and produced:

```
Torn Veil Online — headless world run summary
Seed 918271 · requested 2 day(s) · simulated 2 world-day(s)
Population: 33 -> 33 (0 death(s): none)
Conflict: 2403 attack(s), 0 theft(s)
Social/institutional: 103 report(s) to guards, 0 investigation(s), 1074 knowledge transfer(s),
  222 relationship change(s), 0 item-ownership change(s), 0 leadership change(s)
Integrity: 24 path failure(s), 1 stuck entit(y/ies), 0 goal-churn incident(s), 51 anomal(y/ies) total
  by type: event_spam=50, stuck_agent=1
```

`chronicle.txt` had 14,521 entries; `telemetry.jsonl` 20,000 records (`MemorySink`'s cap);
`anomalies.json` 51 findings. Re-running the same seed and duration reproduces this exactly
(Benchmark B, above) — the 2403 attacks are not noise, they're the same deterministic history
every time. See Known Limitations for what that specific number is actually telling us.

## Known limitations

Be specific, per the brief's own instruction:

1. **A cornered, un-fled victim can generate a large volume of repeated combat with the same
   attacker.** The `seed 918271 --days 2` run above logged 2403 `attack` events, most between a
   handful of repeat pairings (e.g. one bandit and one villager). This is not the mutual-arrest
   bug fixed in this milestone (that was verified fixed — no guard-vs-guard spiral remains); it
   is a real, undesigned gap: `'rob'` intent downs a victim but never actually concludes the
   robbery (no item/wealth transfer, no flee-afterward behavior), so a bandit standing next to a
   just-recovered victim has every reason to attack again and none to stop. The Part 4 anomaly
   detector is working exactly as intended here — it flagged this pattern as `event_spam`
   (50 of the run's 51 anomalies) — but the underlying behavioral gap itself is not fixed in
   this milestone. Recommended next milestone, below, names this directly.
2. **Headless throughput is slow in this sandbox: roughly 1 simulated world-day per 30–35
   seconds of wall-clock time** for Ashford Vale's ~37-person population, dominated by the
   volume of events from (1) above and this sandbox's lack of any real optimization pass. A
   `--days 30` run would take on the order of 15–20 minutes here. The architecture itself
   imposes no duration limit — Benchmarks A/B/C all pass at any tested duration — but this
   throughput was not tuned in this milestone, and a properly provisioned (non-sandboxed)
   environment, or a coarser default physical substep for headless-only runs, would very likely
   do meaningfully better. Not verified either way in this session.
3. **`npm run build` and an actual browser smoke test could not be run in this sandbox.** This
   sandbox has no network access to the real npm registry (confirmed via direct `curl` against
   `registry.npmjs.org`, returning `403 host_not_allowed` on every request, independent of
   sandbox flags), so the real `three`/`vite`/`@types/node` packages the repo depends on could
   never be installed here. Verification in this session substituted a hand-built local stub
   package for `three` and a hand-built vitest-API-compatible test shim (both live only under
   the gitignored `node_modules/`, never committed) to genuinely run the real test suite and a
   scoped real typecheck, rather than fabricating results. Part 17's manual browser smoke test
   (New World, Continue/save, movement, dialogue, combat, trading, doors, F3/F4) is therefore
   **not verified this session** — the `src/main.ts` telemetry-wiring change (Part 18) was
   reviewed by hand against the file's existing conventions and is additive/narrow, but has not
   actually been exercised in a browser.
4. **Faction membership is static.** `factionMembershipChanges` is always `0` in the summary; a
   person's `factionId` never changes at runtime in this milestone.
5. **Part 10's generalized-motivation reasoning structure is not implemented** beyond the
   pre-existing utility/goal system plus this milestone's conflict-intent and resource-pressure
   additions.

## Recommended next milestone (not implemented here)

Close the gap in Known Limitation #1 first — give `'rob'` (and, more generally, any
non-lethal conflict intent) a real conclusion: an actual item/wealth transfer on a successful
robbery, and post-encounter behavior (the bandit disengaging/fleeing, the victim fleeing or
seeking help) so encounters resolve instead of repeating. That single change would likely also
substantially improve headless throughput (Known Limitation #2), since it directly addresses
the dominant source of event volume observed in the manual run above — worth measuring before
reaching for a throughput-only fix like a coarser substep. After that: Part 10's full
generalized-motivation structure, and faction membership changes at runtime (joining/leaving/
expulsion) as the natural extension of the institutional-knowledge work already done in Part 9.
Do not chase the full Torn Veil universe yet — this remains an engine milestone.

## Constitutional compliance review (Part 19)

Checked against `docs/TORN_VEIL_CONSTITUTION.md` directly, not against this milestone's own
brief:

- **§11 (hostile ≠ lethal):** implemented and tested, and the one place it was still violated
  in practice (the downed-target re-threat bug) was found and fixed in this milestone — see
  above.
- **§19–20 (significance is not power):** implemented and directly tested (a non-combat healer
  outscores an idle bystander).
- **§21–27 (Cognitive Level of Detail):** the *mechanism* is implemented and tested against all
  six invariants the Constitution lists (identity/power independence structurally can't be
  violated since CLOD touches nothing but `thinkInterval`; knowledge-preservation and
  reversibility are directly tested; significance/proximity influence and urgent-involvement
  override are both exercised in `tests/cognition-lod.test.ts`). The civilization-scale system
  itself is correctly left unbuilt.
- **§36–37 (factions as institutions, epistemic isolation):** implemented and directly tested —
  the specific failure mode the Constitution calls out ("one member knows something must not
  mean all members instantly know it") is exactly what the leader-only-promotion test asserts.
- **§50 (stable identity):** implemented and tested (carried from the prior commit, unchanged
  here).
- **§51 (causal history):** the compaction bug found and fixed in this milestone was a direct
  violation of this section's spirit (a mechanism meant to bound memory while preserving causal
  paths was instead failing to bound memory at all); it's now fixed and covered by the existing
  causal-integrity test plus this milestone's own anomaly-detection tests.
- **§52 (World Chronicle):** implemented and tested as a selection layer with no invention,
  exactly as specified — not attempted as a story-writing system.
- **§53 (telemetry must be observational-only):** implemented and directly tested (a sink that
  throws cannot disrupt the simulation; the recorder subscribes to events, never causes them).

No area was found where this milestone's implementation *claims* to satisfy a constitutional
goal it does not actually meet. Several constitutional goals (the full power ontology, gods,
civilizations, multiverse, John Smith) remain entirely and deliberately unaddressed, as
required by the brief.
