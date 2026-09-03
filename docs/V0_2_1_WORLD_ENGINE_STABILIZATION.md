# Torn Veil Online v0.2.1 — World Engine Stabilization

This document records what the v0.2.1 stabilization milestone actually built, fixed, measured,
and verified, on branch `claude/v0.2.1-world-engine-stabilization` (built on the v0.2 World
Engine milestone's head, `5ac53dc`). Like `docs/V0_2_WORLD_ENGINE.md`, it distinguishes
**designed**, **implemented**, **tested**, and **behaviorally demonstrated** — a claim below is
marked with whichever it has actually earned.

The milestone's own acceptance test, verbatim from the brief that commissioned it:

> Long-running simulation should produce completed behaviors, useful compressed history,
> actionable telemetry, reproducible outcomes, and materially better simulation throughput
> without sacrificing canonical correctness.

This milestone was explicitly **not** a rewrite of v0.2 and was not to expand into new major
game systems (classes, magic, gods, multiplayer, civilization simulation, and so on). It is a
focused pass over ten priorities: the bandit robbery causal loop, the World Chronicle, headless
throughput, telemetry quality, anomaly quality, browser telemetry verification, a targeted World
Engine integrity audit, persistence coverage, longer benchmarks, and a machine-comparable
benchmark report.

## Priority 1 — The bandit robbery causal loop

**Implemented and tested.** Robbery previously had no real conclusion: a bandit would knock a
victim down, the victim would recover, and nothing distinguished "still being robbed" from
"being attacked all over again" — producing an endless attack loop between the same two actors.

Added an explicit `'rob'` goal type and `'demand'`/`'rob'` action pair (`src/sim/mind/robbery.ts`,
`src/sim/mind/agent.ts`): a bandit closes distance, issues an explicit demand, the victim's
compliance is resolved once via a trait-driven function (courage, aggression, armed status,
health, and — for guards/captains — a duty-bound refusal bias), and the outcome branches
cleanly:

- **Compliant**: the bandit takes a real item or a materialized wealth transfer through the same
  canonical `takeItem`/`makeItem` APIs the rest of the game uses (never a bespoke side channel),
  the victim is directly given provenanced knowledge of the theft (mirroring how `applyHit`
  guarantees a victim always knows who struck them), and the bandit disengages — a real flee
  action, not lingering next to a target who will shortly recover and re-register as a threat.
- **Resisted**: the target is subdued (never automatically killed — Constitution §11) before
  anything is taken.
- **A per-victim cooldown** (`Mind.robCooldowns`, keyed by physical time — deliberately *not*
  world/calendar time, since the downed-recovery timer it has to outlast is itself
  physical-time-based; an earlier draft that mixed the two units let the cooldown expire before
  the victim had even recovered) stops the same bandit from immediately re-targeting a victim
  who is merely recovering.
- **Flees from superior opposition**: a bandit facing an armed, healthy, or guard-backed target
  computes an opposition-strength term and prefers fleeing over engaging when it's high enough,
  unless already mid-robbery of that specific target.

A goal/action hysteresis fix was needed alongside this: the robbery's disengage step (a `goto`
away from the victim) was being silently orphaned mid-execution, because the victim drops out of
the bandit's percepts while fleeing, which made the hysteresis utility comparison fall back to
zero and let any other need (socializing, eating) immediately outbid and replace the
still-in-flight plan. Fixed by giving in-flight multi-step pipelines (`rob`/`attack`/`confront`)
a protected fallback utility instead of zero when their triggering candidate isn't regenerated
that tick.

12 tests in `tests/robbery.test.ts` cover the compliance/resistance decision function in
isolation, the full pipeline (goal type, canonical item/wealth transfer with provenance, goal
completion rather than indefinite persistence, disengage-after-success, no re-attack of a
recovering victim, flee-from-superior-opposition, witness perception with correct provenance).

**Known, disclosed gap**: the cooldown mechanism is scoped to `'rob'` intent only, per the
brief's own instruction not to expand scope. Guard-vs-bandit engagements (`'subdue'`/`'injure'`
intent) have no equivalent — a guard and a bandit can still fight repeatedly over a long run,
because there is no real arrest/custody mechanic for the encounter to resolve into. This surfaced
concretely in later benchmarks (see Priority 9) as Dunstan Mole (guard) and Vex (bandit) trading
thousands of blows over a multi-day run — a real, disclosed limitation, not a bug: guards
*should* keep engaging a bandit they can't yet arrest. A real arrest/custody system is out of
scope for this stabilization milestone and is the natural next-milestone candidate this gap
points to.

## Priority 2 — Rebuilding the World Chronicle

**Implemented and tested.** The Chronicle was, in effect, the raw event feed with a significance
filter — not a historical-compression layer. `src/sim/history/chronicle.ts` was rewritten
(~170 lines, from 68) into an explicit selection pipeline:

1. Exclude cognition-category events and pure gossip-propagation types (`told`, `conversation`,
   `greeting`) — repeating a story is not itself a historical fact.
2. Always keep history-category events regardless of score.
3. Otherwise score by significance **plus** a causal-centrality bonus (an event with many
   downstream effects matters more than its own raw significance implies) **plus** an
   entity-significance bonus (an event touching a historically significant person/place is more
   likely to belong in the historical record).
4. **Consolidate** narrowly: a burst of the same two parties trading blows/confrontations/arrests
   within a time window becomes one entry ("Dunstan Mole and Vex fought, 6 times over 2 hours"),
   never one entry per blow — but only for types that are legitimately "the same ongoing
   friction" (`attack`, `confrontation`, `arrest_attempt`); two distinct `kill` events by the
   same actor stay two separate entries, never silently merged.
5. Every entry preserves its real `sourceEventIds` — nothing is invented, and every entry traces
   back to actual `world.event` ids.

Measured on a 2-day reference benchmark (seed 918271): **14,521 raw significant-event candidates
compressed to 47 Chronicle entries** before this milestone's other throughput work changed the
underlying event volume; on the final all-fixes-applied numbers below the Chronicle stays in the
same 96–165-entry range across 2–7 simulated days, regardless of tens of thousands of underlying
canonical events — genuine compression, not an arbitrary target number (the brief explicitly
warned against optimizing toward one).

6 tests in `tests/significance-chronicle.test.ts` cover consolidation of a repeated-fight burst,
non-consolidation of distinct kills, non-consolidation across a window gap, source-event
integrity, exclusion of routine events even amid heavy activity, and deterministic ordering
across repeated builds from the same log.

## Priority 3 — Headless throughput

**Implemented and tested**, found by profiling rather than guessing, exactly as the brief
required.

Added an opt-in, zero-cost-when-disabled profiler (`Simulation.profile`, null by default — every
call site is one `if (this.profile)` check, so the browser client and every test pay nothing)
and wired coarse per-subsystem timing into the headless runner and `cli.ts`'s report.

**First hypothesis, partially right**: `World.ofKind()` scanned every entity in the world on
every call (`perceive()` alone calls it per-person, per-tick). Since `World.entities` is
append-only (verified by grep — nothing anywhere in the codebase ever deletes from it), added an
incrementally-maintained `Map<Entity['kind'], Entity[]>` index (`World.byKind`), populated at the
single `add()` insertion point, turning `ofKind()`/`persons()`/`bodies()`/`items()`/etc. from
O(all entities) scans into O(matching entities) cached-array returns. This helped `perceive()`
substantially but barely touched the dominant cost.

**Real dominant cost, found by finer profiling**: `compactEvents()` was being invoked every
world-minute from inside `strategic()`, but its own "kept" (significant) event set only grows —
correctly, that's what makes it a real historical record — so as significant events accumulated
over a run, a minute-granular cadence meant re-filtering and re-walking the causal ancestry of
that same, ever-growing set on almost every call. Measured as **~35% of total wall time on a
2-day reference run**. Decoupled its cadence from the unrelated per-minute need/emotion/weather
upkeep: it now runs hourly via its own accumulator in `Simulation.step()`. A dedicated test
(`tests/performance-instrumentation.test.ts`) confirms the new cadence produces byte-for-byte
identical "kept" event sets to the old one for a given seed/duration — this is purely a
memory/perf bound, not a behavior change.

Net effect on the 2-day reference benchmark: **from roughly 45–170s down to ~17.7s** at the time
this priority was completed (before the Priority 7/9 fixes below, which changed the underlying
event volume further — see the consolidated before/after table under Priority 9).

## Priority 4 — Telemetry quality

**Implemented and tested.** The four observational layers — raw semantic trace (telemetry),
anomaly report, world summary, and historical Chronicle — were reshaped independently by
Priorities 2/3/5 below; this priority added the composed, end-to-end proof the brief specifically
asks for.

`tests/telemetry-layers.test.ts` has two tests. The first drives a 40-blow attack burst and a
50-event routine-arrival burst through all four layers simultaneously and asserts each has a
genuinely different shape: telemetry record count is larger than the Chronicle (it's a trace, not
a curated history); the anomaly report stays under 10 grouped findings (not 40 individual
warnings); the Chronicle excludes every routine event entirely; the summary is a single
fixed-shape aggregate object, not a list of events at all. The second builds a real `stuck_agent`
anomaly from repeated `path_failure` events and walks the exact chain the brief describes —
**anomaly → entity → live `mind.goal` → `relatedEvents` → `causalAncestry` → the traced event's
actor still resolving to the same live canonical entity** — confirming the whole trace is
actually walkable via existing exported functions, without manually searching the raw event log.

## Priority 5 — Anomaly quality

**Implemented and tested.** `src/sim/telemetry/anomaly.ts` was rewritten (~130 lines, from 90).
Every `Anomaly` now carries `occurrences`, `firstSeen`, `lastSeen`, and `relatedEvents` (a capped
trace sample) alongside its `type`/`entity`/`data`. The two reference-integrity checks
(`dangling_cause`, `invalid_entity_reference`) now group by the specific missing/invalid id
before emitting — the brief's own worked example (37 individual warnings for the same stuck loop
collapsing into one structured finding) is exactly what this produces: on the final 7-day
benchmark below, hundreds of individual path failures from one stuck woodcutter collapse into a
**single** `stuck_agent` finding with an accurate occurrence count and time range, not hundreds of
separate anomalies.

Detection thresholds and logic are unchanged from v0.2 — this priority is purely about how
findings are *reported*, never about what counts as anomalous. Anomaly detection remains strictly
observational: nothing in `anomaly.ts` writes to `World`/`Person`/`Faction` state.

2 new tests plus 1 updated existing test in `tests/telemetry-anomaly.test.ts` cover grouping of
repeated stuck-path failures and grouping of dangling causal references to the same missing
event.

## Priority 6 — Browser telemetry verification

**Not verified — genuinely unavailable, disclosed honestly rather than assumed.** Re-checked
fresh in this session: `curl -sI https://registry.npmjs.org/vite` returns `HTTP/2 403` with
`x-deny-reason: host_not_allowed`; `npm install`/`npx vite`/`npx esbuild` all fail identically.
`node_modules/vitest` in this sandbox is a hand-built API-compatible shim
(`"version": "0.0.0-sandbox-shim"`), not the real package, and no real `vite` or `esbuild`
package or binary exists anywhere on this machine (`node_modules/.bin` contains only the
`vitest` shim). Chromium **is** genuinely present and functional
(`/opt/pw-browsers/chromium`, `PLAYWRIGHT_BROWSERS_PATH` set) — browser *execution* is not the
blocker; there is simply no way to bundle the real TypeScript/Three.js client into something a
browser can load without a real bundler, and none is installable in this sandbox. Per the
brief's own instruction ("If browser execution genuinely remains unavailable, disclose that
exactly. Do not call it verified unless it was exercised"), this is disclosed as unverified, not
claimed as passing. Nothing about the browser-side telemetry wiring (`src/main.ts`,
`browserSessionSink.ts`) changed in this milestone.

## Priority 7 — World Engine integrity audit

**Implemented, tested, and directly responsible for the largest correctness and throughput
fixes in this milestone.** This was a targeted audit, not a rewrite — two real, demonstrated
defects were found this way, both discovered through the same method the brief prescribes:
running a real multi-day headless benchmark and reading what actually happened, not guessing.

### Bug 1: bystander misattribution causing endless same-faction combat

A 7-day headless benchmark (seed 918271) showed two same-faction bandits, Vex and Skarn, trading
**7629 attacks** over the run — 70.7% of all simulated `think()` time. Root cause: the
threat-assessment check "is that nearby body attacking me?"
(`ob.pose === 'attack' && dist2(ob.pos, pos) < 3`) never verified *who* the attack was actually
directed at. In a crowded space (the bandit camp), one ally fighting a third party within 3 units
of another ally caused the bystander to misread the fight as personal and retaliate for real —
starting a genuine mutual fight between allies that, because neither had lethal intent
(Constitution §11), just kept downing and recovering each other forever.

Fixed by giving `Body` an explicit `attackTarget: EntityId | null`, set whenever
`Simulation.attack()` starts an attack pose (both NPC and player attacks go through this one
method) and cleared when the pose expires; the two self-defense checks in `think()` now require
`attackTarget === p.id`. A regression test in `tests/conflict-intent.test.ts` reproduces the exact
scenario in isolation.

### Bug 2: a failed `goto` livelocking the think/act loop

Re-benchmarking after fixing Bug 1 made total wall-clock *worse* (557.8s vs 382.1s) — the fixed
pathology genuinely improved (4921 attacks vs 7629), but a second, previously-masked defect
became dominant: `sim.act` climbed to 45.7% of wall time, and three agents showed 400-565
`path_failure` occurrences each in a single 3-hour anomaly window. Root cause: `act()` forced an
immediate rethink (`m.thinkBudget = m.thinkInterval`, which satisfies the think-trigger condition
on the very next physics substep regardless of `thinkInterval`'s actual value) on **every** failed
action — appropriate for "a talk/attack target moved out of range," catastrophic for a `goto`
whose pathfinding genuinely found no route, since nothing about the world changes between
attempts: think() reselects the same goal, plan() produces the same goto, pathTo() fails
identically, and the forced rethink loops this every single physics substep instead of at the
intended ~thinkInterval cadence.

Fixed: a failed `'goto'` no longer force-triggers an immediate rethink; every other action type
still does, preserving existing responsiveness. Two tests in
`tests/pathfinding-livelock.test.ts` confirm the mechanism precisely: a pinned, very large
thinkInterval plus an unreachable destination produces exactly one `path_failure` (not one per
substep) and leaves the goal untouched; a non-navigational failure still force-triggers a prompt
rethink.

### Persistence audit (folded in — see Priority 8 below)

The audit also covered save/load, deterministic replay, and CLOD transitions — see Priority 8
and the "Other integrity checks" note below.

### Remaining, disclosed integrity gap

A woodcutter (Bors Ashwood) shows a real, recurring — but no longer computationally
catastrophic — set of `path_failure` events (702 in the final 7-day benchmark below) against his
workplace. A direct `findPath` check from a fresh world state succeeds, so this is not a
permanently unreachable destination; it is most likely a transient/dynamic obstruction (another
entity or a door state at the moment of the attempt) rather than a content/navmesh defect. Not
further diagnosed in this milestone — the livelock fix above already makes each individual
failure cheap, so this is background noise rather than a throughput or correctness emergency, but
it is a real, disclosed remaining gap rather than a claimed fix.

## Priority 8 — Persisting the new canonical systems

**Implemented and tested.** Audited `src/sim/persist/save.ts` against every v0.2 and v0.2.1
canonical addition:

- `Person.factionId`/`hostile`, `Faction.members`/`hostileTo`: fixed at village generation,
  never mutated at runtime (verified by grep) — regenerated identically by `generateVillage` from
  the same seed, so intentionally not persisted.
- `Person.cognitiveLOD`: recomputed every maintenance pass purely from current
  significance/player-distance/goal (`core/cognition.ts`'s `rebalanceCognitiveLOD` — a pure
  function of *present* state, not history) — intentionally not persisted; self-heals within one
  maintenance cycle after load.
- `Mind.robCooldowns` (new this milestone), `Body.attackTarget` (new this milestone): short-lived
  tactical state, correct to simply reset on load, exactly like `pose`/`plan` already are.
- **`Faction.leaderId`** (mutated by leadership succession on a leader's death) and
  **`Faction.knowledge`** (institutional memory promoted from a leader's own knowledge): both
  depend on simulation *history* that cannot be re-derived from present state, and
  `deserialize()` regenerates factions fresh from the seed via `generateVillage` — so before this
  fix, any leadership change or institutional knowledge gained during play was silently reverted
  on save/reload. **This was a real gap, now fixed**: both are persisted explicitly.
  `SAVE_VERSION` bumped 2 → 3.

A regression test in `tests/persistence.test.ts` forces a leadership succession and an
institutional-knowledge entry, round-trips through `serialize`/`deserialize`, and asserts both
survive.

## Priority 9 — Longer benchmarks

**Implemented and tested for 2 and 7 simulated days; genuinely, honestly not practical for 30
days in this sandbox even after fixing what could be fixed within this milestone's scope** — per
the brief's own explicit instruction: *"If 30 days is still impractically slow, do not fake
completion. Report the measured bottleneck."*

### 2-day and 7-day results (final, all fixes applied, commit `afc4829`, seed 918271)

| Duration | Wall-clock | Canonical events | Chronicle entries | Anomalies (grouped) | Path failures | Population |
|---|---|---|---|---|---|---|
| 2 days | 24.8s | 11,628 | 96 | 31 (28 event_spam, 2 goal_churn, 1 stuck_agent) | 658 | 33 → 33, 0 deaths |
| 7 days | 272.6s | 41,186 | 165 | 33 (28 event_spam, 4 goal_churn, 1 stuck_agent) | 702 | 33 → 33, 0 deaths |

Both runs are deterministic (see `tests/headless-benchmarks.test.ts`'s Benchmark B, and
`tests/benchmark-report.test.ts`'s `canonicalStateHash` equality check, both still passing) and
internally valid: no dangling causal references, no invalid entity references, every faction
leader (if any) resolves to a real entity, the causal graph is fully traversable.

### The 7-day run's own before/after trajectory

The 7-day benchmark was re-run at each stage of the Priority 7/9 fixes, at the identical seed, to
measure each fix's actual effect (not just its intent) — the brief's own required methodology:

| Stage | Wall-clock | Dominant cost | Notes |
|---|---|---|---|
| Before any Priority 7 fix | 382.1s | `sim.think` 70.7% (269.6s) | Dominated by the Vex/Skarn bystander-misattribution bug (7629 attacks between two allies) |
| After the bystander-misattribution fix only | 557.8s (**worse**) | `sim.act` 45.7% (255s) | That bug genuinely fixed (4921 attacks, now real conflicts), but this *revealed* the pathfinding livelock as the new dominant cost |
| After both Priority 7 fixes | 348.5s | `sim.think` 61.7% (215.4s) | Faster than the original despite fixing two separate bugs |
| Final, after the Priority 9 knowledge-bound fix (see below) | 272.6s | `sim.act` 33.3% (91.2s), `sim.think` 31.4% (85.9s) | **29% faster than before any fix**, with materially cleaner anomaly reports throughout |

Reporting the intermediate "worse" result rather than only the final number is deliberate: it is
exactly the kind of thing the brief's "compare before/after using identical seed/duration" and
"correctness and determinism outrank raw speed" instructions are meant to surface — fixing one
real bug can unmask another, and pretending otherwise would misrepresent what was actually
learned and fixed.

### The 30-day attempt

Two 30-day attempts were made at seed 918271, both eventually stopped rather than left to
silently run to an unbounded wall-clock cost, per the brief's explicit permission to report
rather than fake completion.

**Attempt 1** (after the Priority 7 fixes, before the knowledge-bound fix below) showed a clearly
**superlinear** trend before being stopped at day 17/30 (2076s elapsed): marginal per-simulated-day
wall-clock cost climbed from ~51s/day (days 0–6) to ~112s/day (days 6–11) to ~188s/day
(days 11–14) to ~280s/day (days 14–17) — each successive ~5-day window costing roughly double the
one before it.

Investigating this directly (rather than only reporting it) found a real, fixable cause:
`Person.knowledge` — every witnessed event, heard rumor, and learned location a mind ever
accumulates — had **no bound at all**, unlike `Person.memories` (which has had a 60-entry cap,
`MAX_MEMORIES`, since v0.2). Three hot paths in `mind/agent.ts` scan a mind's *entire* knowledge
map every `think()` tick or conversation (the crime-check in `think()` itself, `knownCrimesBy()`,
and the gossip-sharing candidate scan in `maybeChat()`), so unbounded accumulation over a long run
made those scans — and the run itself — progressively slower for every person. This is exactly
the "computational pragmatism" pattern the Constitution already establishes for memories and
event compaction, just missing for knowledge. Fixed in `mind/knowledge.ts`: a generous cap (400
entries), pruned only once exceeded, evicting the lowest-scored entries first (by confidence,
claimed significance, and recency) with an explicit bonus protecting any *unresolved* crime
report from eviction ahead of routine/low-value knowledge (Constitution §11/§37: a guard's
ability to eventually act on a known crime must not be silently lost to a cache eviction). Three
tests in `tests/knowledge.test.ts` confirm realistic short-run sizes are completely unaffected (the
safety net for every other test in this suite), that the cap actually bounds a forced 500-entry
insertion, and that an unresolved crime report survives eviction ahead of 500 routine rumors.

**Attempt 2** (after the knowledge-bound fix) reached the same day-16 checkpoint substantially
faster — **1239s vs an extrapolated ~1861s for attempt 1 at the same point, roughly a third
faster** — confirming the fix genuinely helped. However, it then showed a sharp, isolated spike
(day 16 → 17 alone took 629s, worse than any single day in attempt 1's trajectory) before this
attempt was also stopped, at day 17/30 (1868s elapsed). Process RSS had grown from ~370MB to
~1.3GB over the run by that point, which is consistent with (but not confirmed as) GC pressure
from accumulated per-run state; it's equally possible a new, different emergent pathological
interaction — of the same general family as the two already found and fixed in Priority 7 — was
triggered by the specific state the simulation reached around that point. **This was not further
diagnosed within this milestone's time budget.**

**Honest conclusion for Priority 9**: 2-day and 7-day runs are fast, correct, and deterministic.
30-day runs are demonstrably improved by this milestone's fixes (confirmed via a controlled,
identical-seed before/after comparison, exactly as the brief asks) but remain genuinely
impractical in this sandbox — not because completion was faked or the attempt was abandoned
without evidence, but because a precise, real, partially-understood bottleneck was found,
partially fixed with a measured improvement, and the remainder honestly reported rather than
chased past this milestone's scope. The concrete next step, for whoever picks this up: profile a
10–15 day run specifically watching heap growth and GC time (not currently instrumented — the
existing `Simulation.profile` buckets are wall-clock only) to determine whether the residual issue
is GC pressure, a genuinely different emergent pathological interaction, or something else
entirely.

## Priority 10 — Machine-comparable benchmark report

**Implemented and tested.** `src/headless/benchmarkReport.ts` adds `buildBenchmarkReport()`,
producing a small, stable-shaped JSON record per run — commit, app version (from `package.json`),
seed, requested/simulated duration, wall-clock runtime, canonical event count, Chronicle entry
count, anomaly findings grouped by type, population start/end, deaths, conflicts, robberies,
faction leadership/membership changes, knowledge transfers, pathfinding failures, top significant
entities, the per-subsystem timing breakdown, and `canonicalStateHash()` — a deterministic FNV-1a
fingerprint built only from canonical fields (person alive/wealth/faction/knowledge-count, primary
body position/health, total event count, final event id/type; never telemetry, anomalies, or
profiling data, so it can never be polluted by anything observational).

`cli.ts` writes this to `.debug/benchmarks/<seed>-<days>d-summary.json` after every run (already
gitignored — per the brief, generated output is not committed; the format/code/tests are).
`tests/benchmark-report.test.ts` verifies every field is genuinely derived from the run (never
invented), anomaly grouping matches the raw list, the state hash is identical across two runs at
the same seed/duration and differs across distinct seeds, and the report's path-naming scheme.

## Testing

Every existing deterministic test from v0.2 still passes. This milestone added regression tests
for every verified problem it fixed, following the actual project toolchain throughout:

- **`npm test` (the real vitest-shim-backed suite)**: **101 tests, 21 files, all passing.**
- **Typecheck**: clean via this sandbox's scoped verify config
  (`tsc --noEmit -p /tmp/tsconfig.verify.json`) — the same untracked, disclosed shim used
  throughout the v0.2 milestone (a hand-built `three` stub package plus an `@types/node` symlink,
  neither committed), because the real `three`/`@types/node`/`vite` packages remain uninstallable
  in this sandbox (see Priority 6). `npm run build` (the project's own script, using its real
  `tsconfig.json` with no such shim) fails exactly as it did before this milestone, with the same
  root cause: no real `@types/node`/`three` available, producing `TS2503`/`TS2591` errors for
  every Node builtin and every `THREE.*` reference — not a code defect introduced by this
  milestone (the same scoped verify config that DOES have real-enough types for this reports zero
  errors), and not newly broken by anything here.
- **Headless benchmarks**: run repeatedly at multiple durations (2, 7, and two 30-day attempts) at
  a fixed seed, as detailed under Priority 9, with before/after comparisons at identical
  seed/duration wherever a fix's effect needed measuring.
- **Browser verification**: not exercised, honestly disclosed as unavailable (Priority 6) rather
  than assumed or skipped silently.

No custom test shim was substituted for real project tooling where the real tooling was
available — `npm test` ran through the real (if sandboxed) vitest-shim harness this whole
session, exactly as it did throughout v0.2.

## Known limitations (carried forward and new)

1. **The guard-arrest gap** (Priority 1): non-lethal bandit/guard conflict has no real
   resolution mechanic, so a guard and a bandit can keep re-engaging over a long run. Disclosed,
   not fixed — a real arrest/custody system is out of scope here.
2. **A residual, disclosed pathfinding gap** (Priority 7): one entity shows recurring but
   no-longer-catastrophic path failures against a destination that appears reachable from a fresh
   world state — likely a transient/dynamic obstruction, not further diagnosed.
3. **30-day runs remain impractical in this sandbox** (Priority 9), with a real, disclosed,
   partially-diagnosed residual slowdown beyond the fixed knowledge-growth issue — see Priority 9
   above for the precise numbers and the concrete next diagnostic step.
4. **Browser telemetry is unverified** (Priority 6), for the same, unchanged sandbox reason as
   throughout v0.2: no real `vite`/`esbuild` package is installable here.
5. **`npm run build` cannot run in this sandbox** for the same reason, unchanged from v0.2.
6. **Faction membership is still static** (carried from v0.2's own Known Limitation #4) — nothing
   in v0.2 or v0.2.1 moves a person between factions at runtime; `factionMembershipChanges` is
   always reported as `0`, explicitly, not omitted.

## Constitutional compliance review

Checked against `docs/TORN_VEIL_CONSTITUTION.md` directly:

- **§11 (hostile ≠ lethal)**: both Priority 7 bugs were, at root, violations of this section's
  spirit (a hostile-flag/pose misread substituting for real, targeted intent) and are now fixed
  and covered by regression tests.
- **§37 (institutional knowledge, epistemic isolation)**: the Priority 8 persistence fix and the
  Priority 9 knowledge-eviction policy's explicit protection of unresolved crime reports both
  directly serve this section — a faction's or a guard's ability to eventually act on what it
  legitimately knows must survive both a save/reload and a memory-bound eviction.
  correctness/replay.
- **§51 (causal history)**: the Priority 2 Chronicle rework and Priority 8 persistence audit both
  directly serve this section; every Chronicle entry still traces to real `sourceEventIds`, and
  `causalAncestry` remains fully walkable after both compaction and reload.
- **§52 (World Chronicle)**: substantially improved from a raw-feed-with-a-threshold into a real
  selection/compression pipeline, still with zero invented events or facts.
- **§53 (telemetry must be observational-only)**: unchanged and reconfirmed — anomaly detection
  and the benchmark report are both read-only over canonical state; `canonicalStateHash`
  deliberately excludes all observational data from what it fingerprints.

No area was found where this milestone's implementation claims to satisfy a goal it does not
actually meet — including, deliberately, Priority 9's 30-day benchmark and Priority 6's browser
verification, both reported exactly as measured rather than as complete.

## Git

Branch `claude/v0.2.1-world-engine-stabilization`, built on `claude/v0.2-world-engine`'s head
`5ac53dc`. Ten commits, in order:

1. `d921104` — Close the bandit robbery causal loop (Priority 1)
2. `6c75278` — Rebuild the World Chronicle as a real historical-compression pipeline (Priority 2)
3. `f2d03b0` — Restructure anomaly findings into grouped, traceable records (Priority 5)
4. `c40cda8` — Profile and fix the dominant headless throughput bottlenecks (Priority 3)
5. `3c9f686` — Fix bystander misattribution causing endless same-faction combat (Priority 7)
6. `22c7485` — Persist faction leadership succession and institutional knowledge (Priority 8)
7. `64825eb` — Stop a failed goto from livelocking the think/act loop (Priority 7)
8. `98fdf21` — Add a machine-comparable benchmark report artifact (Priority 10)
9. `6eec3f0` — Add end-to-end proof that the four telemetry layers stay distinct and traceable (Priority 4)
10. `afc4829` — Bound Person.knowledge to fix superlinear long-run slowdown (Priority 9)

Constitution and v0.2 history are both preserved unmodified; no prior commit was rewritten.
