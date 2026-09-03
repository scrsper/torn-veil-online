# v0.2.2 Scale-Readiness Audit

**Scope:** engineering audit plus targeted fixes on top of v0.2.1 World Engine
Stabilization (HEAD `643d37b` at the start of this pass). No v0.3 implementation
work is included here. Branch: `claude/v0.2.2-scale-readiness`.

**Method:** every finding below was produced by running the real headless
engine (`npm run sim`, same canonical `World`/`Simulation`/village generation
the browser client uses) at fixed seed `918271`, reading the actual source,
and where relevant capturing a real V8 CPU profile — not guessed or inferred
from code shape alone. All 111 tests pass throughout; typecheck is clean
except pre-existing, unrelated gaps documented in Phase 7.

---

## Primary Objective — five questions, answered

**1. Is knowledge bounding semantically safe?**
Yes, as of this pass. v0.2.1 introduced a hard `MAX_KNOWLEDGE=400` cap with a
flat confidence×significance-minus-age score, which was not semantically
sound on its own — it would have eventually let calendar-time age outscore a
foundational, never-refreshed backstory fact (a village-generation "your
neighbor lives here" claim, `source.type: 'prior'`). Phase 1 replaced the
scoring with four tiers — foundational (pinned), durable relational/
institutional-core (a floor added *before* age decay, not blended into a
value that can cross zero), and ordinary/rumor (decays fastest) — verified by
9 targeted tests including "foundational facts survive 3 simulated years of
pure age plus 1000 rumors of pressure" and "a real relationship reliably
outlasts the same fact about a stranger." Identity, family/relationship, and
faction-leadership facts were confirmed to never be `Person.knowledge`
entries at all (they live in direct `Person` fields, `relationships[].tags`,
and `Faction.leaderId`), so they were never at risk from cap eviction —
documented, not "fixed," since there was nothing to fix.

**2. Why does simulation runtime still become superlinear over longer runs?**
Two distinct, independently-confirmed causes, not one:

- *(Fixed this pass, Phase 2/3.)* Three real hidden per-tick/per-call costs
  that grew with accumulated state: `Mind.investigated` was an unbounded
  `.includes()`-scanned array; `compactEvents()` re-derived causal ancestry
  and cloned the full event index on every hourly call, including for
  already-permanent events that could not have changed; and
  `pruneKnowledge()`'s O(N log N) sort ran on *every single* `learn()` call
  once a mind was at capacity, not just when meaningfully over. Fixing these
  (Set-based lookup, skip-if-unchanged causal walk, batched pruning) cut
  measured 4-day headless wall-clock at seed 918271 from 62.4s to 46.0s
  (~26% faster), with byte-identical canonical outcomes.
- *(NOT fixed — the dominant cause, and a genuine design gap, not an
  implementation bug.)* `Relationship.fear`/`grudge` only ever increase
  (`adjustRel` in `mind/relationships.ts` has no decay term anywhere). Once
  two entities fight, the psychological drivers of further fighting never
  fade short of an actual terminal outcome (death, or a real arrest/custody
  resolution that doesn't exist yet — see Phase 5/Constitution note on the
  guard-arrest gap already flagged in v0.2.1). Directly inspected: by
  simulated day 4 at seed 918271, a guard/bandit pair (Dunstan Mole vs. Vex)
  had traded 159+ retained attack events, the guard's fear/grudge pinned at
  0.99/0.998, the bandit at 1.4/110 health, still unresolved — and a days=8
  run at the same seed was killed after 340+ seconds of wall time still
  mid-simulated-day-7/8, non-convergent, per the brief's own explicit
  "don't wait on a pathological run" guidance. This means **event-generation
  rate itself grows over calendar time**, not just per-event processing
  cost — no per-tick algorithmic fix can address this, because the
  *workload*, not the per-unit-of-workload cost, is what's growing.

**3. Are Chronicle/telemetry/significance/factions/CLOD accumulating state
pathologically?**
Mixed, itemized in the Phase 4 table below. Telemetry (`MemorySink`) is a
capped ring buffer — fine. Chronicle/significance are *recomputed* on demand
rather than accumulated, so they aren't stateful accumulation risks in
themselves, but `computeHistoricalSignificance` is a full O(events.length)
rescan called every simulated hour against an `events` array whose
permanently-retained (significant/history-category) portion is unbounded by
design — a real, confirmed O(N²)-ish cost over a long enough run (Phase 6).
Faction institutional knowledge (`Faction.knowledge`) has no cap or eviction
anywhere — new finding, not yet a demonstrated bottleneck but the same shape
as the bugs already fixed. CLOD does not accumulate state at all; it's a
two-field flip (`cognitiveLOD`, `mind.thinkInterval`) recomputed fresh every
maintenance pass from current significance/distance/urgency (Phase 5).

**4. Any remaining hidden O(N²)/O(history) operations blocking year-scale
simulation?**
Yes, itemized fully in Phase 4/6 below. The two most severe: `World.entities`/
`byKind` are permanently append-only by explicit design (stable-id safety),
and `Simulation.step()`'s hottest per-tick loops iterate the *entire* bucket
every physical substep with only a per-element `!p.alive` skip — cost rides
on cumulative population turnover since world start, not living population,
once births/deaths actually occur over a long run (population stayed exactly
33 with 0 deaths in every run this session, so this wasn't exercised, but
it's real and unaddressed). And the significance-recompute issue from Q3/
Phase 6. Both are documented, not fixed, in this pass — see "Why not fixed"
in their respective sections below.

**5. Is v0.2.1 truly ready as the substrate for v0.3 progression/metaphysics?**
See **Recommendation** at the end: **NO — ONE MORE FOUNDATION PASS REQUIRED**,
with a specific, short, high-leverage punch list — not a re-litigation of
everything in this document.

---

## Phase 1 — Knowledge Retention (semantic soundness of the bound)

Covered fully in Q1 above. Implementation: `src/sim/mind/knowledge.ts`
(`knowledgeScore`, `FOUNDATIONAL_SCORE`, `DURABLE_BASE`/`relationalWeight`,
`isActivelyRelevant`, the new `knowledge_forgotten` event). Tests:
`tests/knowledge-retention.test.ts` (9 tests: foundational-survives-pressure,
foundational-survives-3-years, low-value-evicted-first,
durable-relational-outlasts-stranger, unresolved-crime-survives,
deterministic-eviction, provenance-preserved, no-accidental-omniscience,
graceful-degradation-on-evicted-live-reference). Commit `2607127`.

## Phase 2/3 — Performance Forensics and Targeted Fixes

Covered fully in Q2 above. Method: day-doubling sweep (1/2/4d) at seed
918271 with the existing coarse `Simulation.profile` buckets, then a
single-process V8 `--cpu-prof` capture (routing through `npx` double-profiles
the launcher instead of the simulation — invoking `node` directly on tsx's
loader was required to get a real capture). Fixes: `Mind.investigated` array
→ `Set`; `compactEvents()` reference-reuse + skip-unchanged causal walk;
batched knowledge pruning (`PRUNE_MARGIN=40`). Commit `86b63bb`.

Before/after (headless, seed 918271, coarse timing buckets):

| days | before | after | subsystem share (after) |
|---|---|---|---|
| 1 | 4.4s | 4.2s | perceive 28%, act 22%, think 22% |
| 2 | 17.5s | 15.0s | think 42%, act 26%, perceive 17% |
| 4 | 62.4s | 46.0s | think 44%, act 30%, perceive 13% |
| 7-8 | *(pathological — killed, non-convergent)* | *(same — root cause is Q2's unfixed conflict-escalation loop, not addressed by these fixes)* | — |

## Phase 4 — State-Growth Audit

| system | collection | growth mechanism | bound? | compaction? | risk |
|---|---|---|---|---|---|
| World events | `World.events`/`eventIndex` | `emit()` pushes every event | Partial — recent window (`keep=4000`) + any `significance>=0.5`/`category==='history'` event kept forever | Hourly, drops low-value old events | Known/expected by design ("real historical record") |
| Causal refs | `WorldEvent.causes`/`.effects` | rebuilt from currently-kept events each compaction | Rides on events bound | Yes, every compaction | Low |
| Person.memories | `mind/memory.ts` | `remember()` | Yes, `MAX_MEMORIES=60` | Immediate | None |
| Person.knowledge | `mind/knowledge.ts` | `learn()`/`locationKnowledge()` | Yes, `MAX_KNOWLEDGE=400`+`PRUNE_MARGIN=40`, batched | Yes, semantic scoring (Phase 1) | None |
| Person.relationships | `mind/relationships.ts` | `getRel()` lazy-creates per distinct entity met | Implicit — bounded by population, not time | None needed | Low |
| Faction.knowledge | `history/factions.ts` | `syncFactionInstitutionalKnowledge()`, hourly | **None found** | None | **New — Medium/High.** One entry per distinct crime a leader ever knew of, forever |
| Historical significance | `history/significance.ts` | recomputed fresh each call, not stored | N/A (not stored) | N/A | Compute cost rides on events bound — see Phase 6 |
| World Chronicle | `history/chronicle.ts` | recomputed fresh each call, not stored | N/A | N/A | Called once per run — not a scaling problem (Phase 6) |
| Telemetry (MemorySink) | `telemetry/recorder.ts` | `write()` | Yes, ring buffer `cap=20000` | Immediate | None |
| Telemetry (FileSink) | JSONL on disk | append per record | No cap, but disk not RAM | N/A | Low — same category as events-forever-retained |
| Anomaly detection | `telemetry/anomaly.ts` | stateless, rebuilt from events/persons each call | N/A | N/A | Rides on events bound |
| Item.provenance | `core/types.ts`, pushed throughout `mind/agent.ts` | one entry per hand-change (pickup/theft/trade/gift/robbery) | **None found** | None | **New — Medium/High.** A heavily-traded coin stack grows one entry per transaction it's ever part of, forever; fully re-serialized on every save |
| Ownership history | — | (no distinct structure; same as provenance) | — | — | Same as above |
| Goals/plans | `Mind.goal`/`Mind.plan` | replaced wholesale on completion | Yes, transient/overwritten | Implicit | None |
| Navigation | `physical/nav.ts` `findPath()` | per-call locals only | Yes, no cross-call cache | N/A | None |
| **World.entities/byKind** | `core/world.ts` `add()` | every person/body/item/place ever created, never removed (stable-id safety, explicit design) | **None** | None | **New — High.** `Simulation.step()`'s hottest loops (`for (const p of w.persons())`, `for (const b of w.bodies())`) scan the full bucket every physical tick; cost rides on *cumulative* population turnover since world start, not living population — not exercised this session (0 deaths in all test runs) but real once births/deaths occur over a long run |
| Mind.investigated | `mind/agent.ts`/`core/types.ts` | `.add()` per resolved investigation | Lookup now O(1) (Phase 3), but *size* still uncapped | None | Low/Medium — memory/save-size only, not CPU, after Phase 3's fix |
| Person.desires | `core/types.ts`, pushed on theft | `fulfilled=true` set but entry never removed | **None** | None | **New — Medium.** Scanned in full every `think()` tick; grows one dead entry per theft ever suffered, for a person's whole life |
| lastToldAt/robCooldowns | `mind/agent.ts`/`robbery.ts` | new key per distinct entity | Implicit — population-bound | None needed | Low |
| knowledge.sharedWith | `mind/knowledge.ts` | pushed per listener told | Implicit — population-bound, reset on refinement | Self-limiting | Low |

**Why the "New — Medium/High"/"New — High" rows aren't fixed in this pass:**
none of them are demonstrated as an *actual current* bottleneck the way
`investigated`/knowledge pruning were (population stayed constant with 0
deaths in every run this session, so the entities/byKind risk in particular
was never exercised) — and each would need the same kind of careful semantic
design Phase 1 did for knowledge (what's safe to cap/evict without losing
real institutional memory), not a five-line patch. Documented and ranked
here for the recommendation below rather than rushed.

## Phase 5 — CLOD Architecture Audit

Verified by direct code inspection plus the existing
`tests/cognition-lod.test.ts` (byte-identical knowledge/memories/
relationships across a `full → lightweight → full` cycle):

- Tiers: `'aggregate' | 'lightweight' | 'full' | 'deep'`
  (`core/types.ts`); only `full`/`lightweight` are ever assigned.
  `rebalanceCognitiveLOD` (`core/cognition.ts`) sets `full` if a person is
  near the player, historically significant, or mid-urgent-goal; otherwise
  `lightweight`.
- Upgrade never fabricates knowledge/memories/relationships; downgrade never
  destroys them. `setCognitiveLOD` touches exactly two fields
  (`cognitiveLOD`, `mind.thinkInterval`).
- `cognitiveLOD` is never read by `significance.ts` or any combat/stat code
  — coupling is one-directional (significance → LOD tier), confirmed by
  `significance.ts`'s own doc comment ("explicitly NOT power tier").
- `lightweight` is a real, measured 5× reduction in `think()` call
  frequency (`LOD_THINK_MULTIPLIER`), not a no-op label — but `perceive()`
  and `act()` run every tick for everyone regardless of tier, and `think()`
  itself does no cheaper/simplified computation per call. So it's a partial
  (think-rate-only) mechanism, not a full cognitive-fidelity gradient.
- No civilization-level aggregation exists; `'aggregate'`/`'deep'` are
  unused scaffolding, exactly as expected/fine per the brief.

**No corrections made** — the design holds up under inspection; nothing here
rises to a "small foundational correction," and the brief explicitly says not
to expand CLOD substantially.

## Phase 6 — Chronicle/History Incrementality

`buildChronicle()` (`history/chronicle.ts`) is a full rescan of `world.events`
but is only ever called **once**, at the end of a run — appropriate, not a
scaling problem. `computeHistoricalSignificance()` (`history/significance.ts`)
is also a full O(events.length) rescan, but is called **every simulated
hour** via the maintenance pass (`headless/runner.ts`) — the exact "every
summary: recompute from all history" pattern this phase asks about, and,
combined with `events.length`'s unbounded growth (Phase 4), a real long-run
scaling risk (confirmed, not hypothetical).

**Not rewritten as incremental this pass.** The causal-centrality term
(`effects.length > 2` boosting an event's actor) depends on how many *later*
events cite an event as their cause — unknowable at the event's own creation
time, since `effects` is populated by subsequent `emit()` calls. A naive
"process each event once, at creation" cache would silently under-count
every witnessed event (the common case — each witness's `perceived` event
cites the original as a cause) as soon as more witnesses arrive after the
first scan. A correct incremental version needs to hook `effects.push()`
itself inside `emit()`, not just cursor over new events in `world.events` —
real, achievable work, but a distinct piece of restructuring, with its own
correctness risk, from what's safe to land in this pass. A regression test
(`tests/significance-chronicle.test.ts`, "a call site cannot cache
significance at an event's creation time...") locks in this exact property
so a future incremental rewrite doesn't reintroduce a silent undercount.
Commit `5dad903`.

## Phase 7 — Real Toolchain Verification

Performed, not claimed beyond what actually ran:

- `npm test` (vitest): **real**, 111/111 passing throughout this pass.
  Vitest vendors its own private `vite`/`esbuild`, so this works even though
  the top-level `vite` package (needed for an actual browser bundle) is not
  installed.
- `npm run typecheck` (tsc): **real**, runs against the actual source. Clean
  for everything touched this pass. Pre-existing, unrelated gaps: a handful
  of `THREE` namespace and `node:`-builtin-type errors in
  `src/game/**`/`src/headless/cli.ts`/`src/sim/telemetry/fileSink.ts` —
  confirmed these predate this session's changes (none of the touched files)
  and stem from `@types/three` not being installed and an incomplete
  `@types/node` resolution in this sandbox, not from any code defect.
- `npm run build` (vite build): **attempted, failed** — `vite` is absent
  from `node_modules` at the top level, and `npm install` returns
  `403 Forbidden` from `registry.npmjs.org` in this sandbox (confirmed via a
  direct `npm install --prefer-offline` attempt, not assumed). No amount of
  retrying or alternate-registry workaround was attempted, per this
  environment's network-restriction handling policy.
- **No actual browser/client smoke test was performed** — there is no way
  to produce a bundled client without `vite`, and per this phase's explicit
  instruction, browser verification is not claimed when it wasn't done. All
  verification in this document is headless-engine verification, which
  exercises the same canonical `World`/`Simulation` code the browser client
  imports, but does not touch rendering, input, or UI code at all.

## Phase 8 — Longest Practical Benchmark

Seed 918271, post-Phase-3-fixes, clean run, reproduced twice for determinism
(state hash `6bc93cbd` both times):

| metric | 2-day | 4-day |
|---|---|---|
| wall-clock | 15.0s | 46.0s |
| simulated days | 2 | 4 |
| canonical event count (retained) | 11,662 | 28,796 |
| Chronicle entries | 95 | 88* |
| anomaly groups | event_spam, stuck_agent, goal_churn (32 total) | event_spam=30, stuck_agent=1, goal_churn=3 (34 total) |
| avg/max knowledge per person | 152 / 400 | 187.1 / 440 |
| avg/max memories per person | 44.5 / — | 52.4 / 60 |
| population (start→end) | 33→33 | 33→33 |
| deaths | 0 | 0 |
| conflicts (attacks) | 1,347 | 3,827 |
| robberies | — | 6 |
| pathfinding failures | — | 402 |
| top historical significance | (see day-2 run) | Maud Penny 1046, Skarn 898, Vex 855, Rowan Ashford 717 |
| state hash | — | `6bc93cbd` (reproduced identically across 2 independent runs) |
| top subsystem share | think 42%, act 26%, perceive 17% | think 44%, act 30%, perceive 13% |

*Chronicle entry count is not monotonic with days — it's a consolidated
view, and denser fighting in the 4-day run collapses more raw events into
fewer consolidated entries, which is correct/expected behavior, not a bug.

**8-day run: attempted, killed as pathological**, per this phase's explicit
instruction not to wait out a pathological run. After 340+ seconds of wall
time it was still mid-simulated-day-7/8 (the 4-day run above took 46s in
comparison) — non-convergent, consistent with the Q2 root cause
(relationship fear/grudge escalation driving event-generation rate itself
upward over calendar time, not just per-event cost). 30/60/90-day runs were
not attempted; there is no reasonable expectation they would complete, and
attempting them would only have burned quota to confirm what the 8-day
result and Q2's direct inspection of the Dunstan-Mole/Vex encounter already
demonstrate.

## Phase 9 — Recommendation

### Remaining structural risks, ranked

- **CRITICAL:** Unbounded conflict escalation (`Relationship.fear`/`grudge`
  never decay; no real combat-resolution/custody semantics beyond a single
  robbery-specific cooldown). This is the demonstrated cause of the 7-8-day
  pathological non-convergence at seed 918271 and is very likely to recur at
  any seed with sustained combat — which is not an edge case for this
  simulation, it's ordinary content (guards, bandits, disputes all exist by
  design). Blocks year-scale simulation outright, independent of any
  algorithmic optimization.
- **HIGH:** `World.entities`/`byKind` permanently append-only, scanned in
  full by `Simulation.step()`'s hottest per-tick loops. Not exercised this
  session (population never changed), but on any run with real population
  turnover over a long timescale, this is a second independent source of
  cost growing with *cumulative* history rather than live state.
- **HIGH:** `computeHistoricalSignificance` — full O(events.length) rescan,
  called hourly, against an events array whose significant/history portion
  is retained forever by design. Confirmed real, not yet a measured
  bottleneck only because no run has been long enough to make it one.
- **MEDIUM:** `Faction.knowledge`, `Item.provenance`, `Person.desires` — all
  unbounded, all the same append-only-forever shape that made
  `investigated`/`knowledge` real bugs before they were fixed. Lower urgency
  because none are in as hot a path as the HIGH items.
- **LOW:** CLOD's `perceive()`/`act()` being fully unthrottled by tier
  (Phase 5) — a real gap in an otherwise-sound mechanism, but not a
  correctness or scaling risk on its own.

### Recommendation: **NO — ONE MORE FOUNDATION PASS REQUIRED**

v0.2.1 plus this pass's fixes is meaningfully more solid than it was —
knowledge retention is now semantically sound and tested, three real hidden
performance costs are gone, and CLOD/save-integrity/state-growth have all
been audited with evidence rather than assumed. But the explicit target this
audit was measured against — "can the artificial-world substrate safely
support the next layer... [at] year-scale simulation" — is not met, and the
gap is not a rounding error: this session's own testing shows the engine
becoming non-convergent well *before* even a single simulated week, at a
seed with nothing unusual about it (ordinary guard/bandit conflict). Adding
progression/metaphysics on top of a substrate that cannot yet run for a
simulated month without the world's conflict state monotonically escalating
would mean building v0.3 on ground that's still moving.

The path back to "YES" is short and specific, not a re-audit of everything
above: (1) give `Relationship.fear`/`grudge` a real decay or resolution
mechanic — this alone is the highest-leverage fix, since it addresses the
demonstrated root cause of the pathological long-run behavior, not just a
symptom of it; (2) bound `World.entities`/`byKind` iteration to living
entities in the hot per-tick loops (doesn't require removing entities from
the map, just skipping stale ones cheaply — e.g. a maintained "alive" index
alongside the existing `byKind` one); (3) make
`computeHistoricalSignificance` incremental, now that (1) makes long runs
actually reachable and the cost would start to matter for real. All three
are scoped, targeted, and testable the same way this pass's fixes were —
this is not a call for a rewrite, just the next honest increment.
