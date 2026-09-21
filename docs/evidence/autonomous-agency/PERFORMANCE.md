# Deterministic food-stress performance hardening

Status: food-performance hardening passed; PR #49 remains a draft and is not merge-ready
because a theft-trace behavioral regression predates this optimization.
Neither PR is merged.

## Revisions and method

Remote state fetched and verified on 2026-09-20 (local CDT): PR #48 is open at
`709e6b5dd8698bc097f8e1dae67349a4cec4751a`; draft PR #49 is stacked on that exact
commit, with pre-optimization HEAD `93688e6a95f1c2f4f035131aca792aec2e115d3c`.
Clean detached worktrees isolate those revisions. Both use the same installed
dependencies through directory junctions. Their lockfiles, Vite configuration and
food tests are identical. Licensed assets and existing worktrees are untouched.

The existing abundance and scarcity tests in `tests/stress-benchmarks.test.ts`
run unchanged: seed 918271, 1.5 simulated days, 14,400 physical steps, original
population and food setup, original assertions and 60,000 ms timeout. Each sample
uses a fresh Vitest process, with one selected test and one worker. Three paired
rounds alternate revision/workload order; no other test run is launched concurrently.

Machine: AMD Ryzen 5 9600X (6 cores/12 logical processors), 31.14 GiB RAM,
Windows 11 Home build 26200, Node v22.23.2, Vitest 4.1.11. Background applications
remain running; no affinity, priority or power settings were changed. Host CPU
utilization ranges from 25% to 66%, so report paired samples and CPU time as well
as elapsed time. Peak RSS is the cheap process-lifetime high-water mark, including
test startup; CPU time includes worker/GC threads and can exceed elapsed time.

Primary wall/CPU measurements cover the test body, including world creation.
Full-state hashing and the save/reload continuation probe occur after that timing
boundary. Early samples put this post-processing in `afterEach`; subsequent
samples use `afterAll`. This affects reporter/process durations, not the reported
body timing. Instrumented profiling runs are separate and excluded from timing
statistics. The initial JSON reporter lost formatted timeout stacks; later hook
records confirm unchanged 60,000 ms timeout failures.

## Initial controlled timings

Seconds, ordered by sample round. Parentheses are CPU seconds.

| Revision/workload | Run 1 | Run 2 | Run 3 | Wall min / median / max | CPU min / median / max |
|---|---:|---:|---:|---|---|
| PR #48 abundance | 88.062 (110.516) | 69.791 (90.936) | 70.428 (90.422) | 69.791 / 70.428 / 88.062 | 90.422 / 90.936 / 110.516 |
| PR #49 abundance | 107.399 (136.501) | 80.376 (105.250) | 82.290 (107.234) | 80.376 / 82.290 / 107.399 | 105.250 / 107.234 / 136.501 |
| PR #48 scarcity | 57.647 (79.156) | 66.010 (88.265) | 57.549 (78.688) | 57.549 / 57.647 / 66.010 | 78.688 / 79.156 / 88.265 |
| PR #49 scarcity | 70.850 (95.172) | 76.895 (99.984) | 70.155 (94.923) | 70.155 / 70.850 / 76.895 | 94.923 / 95.172 / 99.984 |

All abundance samples time out; baseline scarcity passes twice and times out once;
feature scarcity times out three times. Completed world states have 33 living
people in every sample. Abundance bread/price is 205/1 for both revisions;
scarcity bread/price is 0/4 on baseline and 5/4 on feature. No food assertion
failure was reported. The full state digest is identical across all three samples
within each revision/workload, so the timing variation is not outcome variation.

**Attribution: A — clear PR #49 regression, on an already failing/marginal baseline.**
Feature medians increase 16.8% for abundance and 22.9% for scarcity; CPU medians
increase 17.9% and 20.2%. Every paired feature sample is slower in both measures.
Background load explains some range, particularly round-one abundance, but does
not justify attributing the consistent added CPU work to noise. The revisions
produce different histories by design; optimization equivalence must compare
PR #49 before/after, not require PR #48 and PR #49 to have the same history.

## Continuation finding present before optimization

All initial probes serialize the full world, remove only `savedAt` for hashing,
preserve array order and compare sorted-key and original-key JSON hashes. The
probe advances original and reloaded worlds another 20 steps (3 physical seconds).
All four RNG states match. Full original/reloaded hashes differ on both revisions:
cached `execution.lastTopic[*].concern.intensity` aliases detach during JSON reload.
Baseline scarcity also differs in one `goal.data._chase` field. This was found
before optimization and is not evidence of a new performance-change regression.
The report will retain both trajectories when checking before/after equivalence;
it must not hide these fields to claim complete reload equality.

## Profile: broad buckets first

One separate instrumented pass per revision/workload. V8 sampling plus opt-in
function counters; these are attribution runs, not budget samples. All four
produce exactly the matching uninstrumented full-state digest. Inclusive times
overlap: perception includes visibility/recognition, and deliberation includes
motivation/social evaluation. Do not sum inclusive function rows.

| Existing tick bucket (seconds) | Base abundance | Feature abundance | Base scarcity | Feature scarcity |
|---|---:|---:|---:|---:|
| Goal deliberation | 39.40 | 45.99 | 30.03 | 37.46 |
| Perception | 17.97 | 19.77 | 15.54 | 22.28 |
| Execution | 6.68 | 7.23 | 7.20 | 6.98 |
| Strategic upkeep | 2.29 | 2.27 | 1.97 | 2.42 |
| Event compaction | 1.33 | 2.40 | 1.08 | 1.35 |
| Creatures | 1.53 | 1.67 | 1.49 | 1.79 |
| Body physics | 0.15 | 0.14 | 0.13 | 0.16 |

The feature abundance CPU sample locates self time in `think` (13.61 s),
`SpatialIndex.query` (6.35 s) and its ordering comparator (2.30 s),
`genealogicalBeliefs` (4.57 s), `knownFoodPlace` (2.88 s), `knowsNotation` (2.33 s),
and `laborIncentive` (2.14 s). Several of these repeatedly enumerate the same
bounded, deletion-heavy knowledge dictionaries. A small synthetic dictionary
experiment corroborated the enumeration mechanism; it is not used to claim an
end-to-end speedup. An earlier temporary profiling-hook failure and a harness
syntax failure produced no accepted timing samples; the retained profiles and
samples below pass harness validation and include the unchanged replay probe.

## Work counts and suspect checks

| Work | Base abundance | Feature abundance | Base scarcity | Feature scarcity |
|---|---:|---:|---:|---:|
| Physical steps | 14,400 | 14,400 | 14,400 | 14,400 |
| Goal deliberations | 68,210 | 74,998 | 61,648 | 63,750 |
| Candidates evaluated | 895,958 | 1,015,578 | 790,813 | 819,233 |
| Visibility checks | 3,102,516 | 3,127,232 | 2,885,567 | 3,262,270 |
| Encounter recognition calls | n/a | 589,549 | n/a | 1,018,810 |
| Visible cue reconstructions | n/a | 159,448 | n/a | 275,884 |
| Retained encounter emissions | n/a | 8,839 | n/a | 11,484 |
| `learn` calls (includes refinements/no-ops) | 41,832 | 54,854 | 30,993 | 42,565 |
| Prune guard calls | 40,805 | 23,832 | 9,663 | 12,087 |
| Actual knowledge sorts | 715 | 281 | 0 | 6 |
| Memory prune passes | 30,992 | 44,974 | 22,559 | 32,261 |
| Chat attempts | 41,288 | 39,886 | 31,820 | 33,485 |
| Topic selections | 271 | 222 | 230 | 226 |
| Tell calls (includes failed reachability/no-ops) | 29,922 | 37,172 | 23,010 | 24,548 |
| Relationship adjustments | 32,051 | 37,894 | 24,708 | 23,454 |
| Events emitted | 127,086 | 150,360 | 99,473 | 111,995 |
| Compaction calls | 35 | 35 | 35 | 35 |
| Events retained at end | 43,713 | 57,041 | 37,345 | 42,659 |
| Knowledge retained at end | 11,490 | 12,311 | 9,663 | 11,841 |
| Trade batch calls | 22 | 29 | 58 | 52 |
| Logistics need-generation calls | 215 | 215 | 215 | 215 |
| Path searches (cache misses) | 6,315 | 5,328 | 7,181 | 6,451 |

Feature per-body perception evaluates 237,600 times in each workload. Recognition
costs 2.29/3.53 s inclusive; cue construction costs 0.63/1.03 s. The existing
attention gates reduce reconstruction/retention but do not eliminate encounter
invocations. They are preserved exactly.

Feature social-evidence queries cost 0.445/0.333 s over 224,141/159,851 calls;
interpretation costs 0.081/0.078 s. Topic selection costs 0.085/0.100 s, while
tell costs 2.09/1.44 s inclusive. Appraisal and relationship adjustment are each
under 0.06 s. Knowledge pruning costs 0.431/0.138 s inclusive, and memory handling
0.425/0.342 s. Increasing a prune threshold is neither justified nor part of this fix.

Trade batch cost is under 0.008 s; logistics need generation under 0.019 s.
The `progressHaul` control helper is not used by this NPC execution path; actual
haul production remains visible in the existing run tallies. The full profiles
include those tallies and path/spatial candidate counts. Capability practice is
never invoked by these two workloads, so it cannot explain their regression.
`inspectAgency` is called zero times. Its callers remain the explicit bridge
developer snapshot and WorldLab report, outside the ordinary tick.

Added cognition increases the amount of subsequent deliberation/history work,
not just time inside newly added functions. Abundance candidates increase 13.4%
and retained history 30.5%; scarcity retains 14.2% more history and 22.5% more
knowledge. This explains why changing no economy code does not establish absence
of an economy-workload performance regression. No attempt is made to attribute
every changed decision to a single new function.

## Semantics-preserving changes

1. `knowledgeItems` builds a fresh own-key-ordered value array using `Object.keys`
   and indexed reads. V8's slow `Object.values` path for deletion-heavy dictionaries
   dominated several measured deliberation scans. There is no retained cache,
   dirty flag, new knowledge representation, altered filter, scoring or cadence.
   New evidence, replacement, deletion and refinement are visible on the next call.
   Snapshot ordering and object references remain unchanged.
2. `SpatialIndex` memoizes broad-phase candidate arrays by queried cell rectangle.
   Actual bucket/oversized membership changes clear the cache. Movement within a
   cell remains visible through live entity references and the existing exact
   distance/bounds checks in callers. Results preserve insertion ordering and
   return detached arrays. FIFO eviction caps the cache at 256 rectangles per
   index. Candidate counters count the same work on hits. Nothing is serialized.
3. `World.placeAt` keeps at most 512 exact point answers, keyed by position object
   and checked against its current x/y/z. Bounds changes (all six coordinates),
   replacement and newly added places invalidate answers. This preserves height,
   overlap and insertion-order tie behavior; cached undefined answers invalidate
   too. Logical spatial candidate counts remain comparable. Position motion does
   not rely on the object retaining immutable coordinates.
4. Genealogy goal construction reuses its fresh list only when inference made no
   writes. Successful inference refreshes the list, including any resulting prune.
   It can still offer a newly inferred fact in that same deliberation, and later
   forgetting is immediately visible. No snapshot survives the function call.
5. The hunting-resource proposal loop checks its existing person-level labor,
   wealth and hunger prerequisites before scanning resource nodes. Those fields
   do not change while that loop builds candidates. Eligible people see the same
   nodes in the same order and produce the same goals.

The second profile was justified by the first optimization pass's narrow margin:
abundance 57.321/57.495/58.021 s (min/median/max), scarcity
51.000/51.090/51.492 s, all six passing with exact state/continuation equality.
It measured 502,664 fresh knowledge snapshots in abundance, 1.55 s sampled self
time in `placeAt`, and 2.16 s in `locationKnowledge`. V8 position ticks identified
the hunting-resource scan as 1,225 of 4,937 samples attributed to `think`.
These measurements motivated changes 3–5; no sensory cadence was reduced.

Final instrumented runs retain the feature's full-state hashes and work counts.
Deliberation takes 26.18/27.49 s and perception 13.45/17.32 s (abundance/scarcity).
Fresh knowledge snapshots fall from 502,664 in the intermediate abundance profile
to 440,797, because unchanged genealogy inference no longer requires a second
scan. Final spatial queries take 0.612/0.640 s over 1,109,065/1,027,499 calls;
exact place hits avoid entering the spatial index while preserving its logical
candidate diagnostic. These profiles have additional nested counters, so use
the uninstrumented repeated samples for the speedup claim.

The final emit counter distinguishes successful transmission events from tell
attempts: 35,714/21,436 `told` events, versus 37,172/24,548 calls. It records
38/40 resource deliveries and 12/26 resource transformations. The raw evidence
contains all event counts, including failures. `inferGenealogy`'s exported wrapper
is no longer called by goal construction; inference still runs through the shared
private helper, and scarcity still emits its one genealogical inference.

No world duration, seed, food, population, test assertion, timeout, cognition
cadence, retention policy, capability, progression or gameplay rule changes.

## Post-fix verification

| Workload | Run 1 (CPU) | Run 2 (CPU) | Run 3 (CPU) | Wall min / median / max | CPU min / median / max |
|---|---:|---:|---:|---|---|
| Abundance | 50.770 (68.875) | 50.421 (69.079) | 50.230 (69.641) | 50.230 / 50.421 / 50.770 | 68.875 / 69.079 / 69.641 |
| Scarcity | 45.141 (63.500) | 46.497 (65.218) | 44.695 (63.718) | 44.695 / 45.141 / 46.497 | 63.500 / 63.718 / 65.218 |

**Six of six pass the unchanged budget and assertions.** Feature wall medians
improve 38.7%/36.3%; CPU medians improve 35.6%/33.0%. The slowest final samples
leave 9.230/13.503 seconds below 60. Scarcity meets the preferred sub-50-second
median; abundance misses it by 0.421 seconds. No claim of a sub-50 abundance
median is made. Host utilization is 26.1–32.3% in final samples, overlapping the
quieter initial samples. Against those quieter pre-fix abundance samples alone
(80.376/82.290 s), the improvement remains substantial.

Peak process RSS: final abundance 514.45–546.97 MiB, scarcity 446.83–486.68 MiB.
Pre-fix feature ranges are 467.07–541.92 MiB and 376.80–440.81 MiB. These are
process-lifetime peaks under V8/OS collection behavior, not retained-world sizes;
there is no claim of a memory reduction. The two new caches have explicit entry
bounds and retain existing object references, not copies of world facts.

All six final samples have the same source digest (including new source/test
files): `229470a1c72711fc4fd66df5462abfa5f7d7e3383184b7b6f6fe43d5e7491355`.
They were measured in the working tree based on `93688e6`; the evidence records
HEAD, status and diff hash as well. Source changes stopped before these samples;
the measured implementation and harness are committed as
`e20a27f9099dff69e99c30e45dbe29a6fd21a75f`.

## Deterministic equivalence

Full saved state, with only `savedAt` omitted, matches pre-fix feature in **all six**
final samples, including original JSON property order. Arrays are never sorted
for normalization. Both separate continuation trajectories also match pre-fix:
uninterrupted-to-uninterrupted and reload-to-reload. All world, weather,
demographic and ecology RNG states match before and after continuation. Food
results, retained counts, path diagnostics, logical spatial candidates and run
tallies match exactly. No fields are removed to hide the existing reload issue.

| Workload | Feature before/after full-state SHA-256 |
|---|---|
| Abundance | `93f934ed6c247275a1006b540763cc9ab5d04b6edf02002425df794c2574a8ea` |
| Scarcity | `6233a6e5a6bfcfa9a5532baea021b9bcc5616e96a345e580163d7e844369e59c` |

The checkpoint alias discrepancy described above remains: original and reloaded
cached conversation snapshots differ on both baseline and feature. This narrow
performance slice preserves that pre-existing behavior, rather than changing
persistence semantics or excluding the discrepancy from the full-state check.
It is distinct from the agency WorldLab's exact save continuation, which is also
verified separately. There is no schema/version change or migration. New caches
are derived runtime state and start empty after load.

Raw samples, profiles, environment, counts and all boolean equivalence checks:
[performance-samples.json](performance-samples.json). Reproduction commands and
measurement boundaries: [harness README](../../../scripts/food-performance/README.md).

## Scaling and final validation

Fresh knowledge traversal remains O(K); no lifetime belief cache is introduced.
Spatial query hits avoid collection/sorting but exact caller filters remain O(M).
At most 256 candidate arrays per spatial index add O(256 × M) references in the
worst case. Exact place lookup adds at most 512 records per world. Highly mobile
populations that invalidate broad-phase membership often may see smaller gains;
no thousand-person or century-scale throughput claim follows from this village
workload. No cognition, retention or historic significance policy is weakened.

Final build/typecheck passed (166 bundled modules). The focused regression passed
**110 tests across 15 files in 35.24 s**, covering agency, capability, recognition,
social behavior, retention, combat replay, traversal/cache invalidation, lineage,
locality, determinism, persistence and knowledge. WorldLab seed 741 again reports
zero invariant errors, exact save continuation, persisted capability and the
explicit near-threshold fixture's advancement; digest
`3d17fd7994903493386801a03c7c2f778333d51c0208d24f832f7acba29aca10`.
The one final broad regression run completed in **1,670.39 s**: **115 files passed,
1 failed; 1,121 tests passed, 1 failed, 1,122 total**. No tests were skipped and no
timeouts occurred. The unchanged food tests passed again inside the broad run:
abundance 46.879 s, scarcity 40.365 s; all seven stress-benchmark tests passed.
World metabolism, KMSI determinism, physiology/economy, embodied economy, living
universe, logistics and the full motivated-lives traces passed.

The sole failure is `social-causality-trace.test.ts` / `theft: Theft / missing
property`, at 75.634 s under its 180-second budget. At the observation endpoint,
the trace finds zero living knowers of the root matter, so its propagation,
significance-spread and differing-grounded-lines assertions fail. This is not a food timeout.

Sequential isolated rechecks use the unchanged test and fixture:

| Revision / context | Theft result | Test duration |
|---|---|---:|
| PR #48 `709e6b5`, isolated exact selector | Pass | 83.303 s |
| Pre-fix PR #49 `93688e6`, isolated exact selector | Fail, same three zero-knowledge assertions | 112.906 s |
| Optimized PR #49 `e20a27f`, full suite | Fail, same three zero-knowledge assertions | 75.634 s |

The two isolated commands select `tests/social-causality-trace.test.ts -t 'theft:'`;
the other three tests in that file are intentionally unselected. The full run skips
nothing. Do not compare these single-run theft durations as controlled speedup
statistics: file context and warmup differ. The assertion evidence establishes a
**PR #49 behavioral regression relative to PR #48, already present before the
performance change**, not an unchanged baseline failure and not a new optimization
failure. Its deeper cognition/fixture cause is not established by these rechecks.
No assertion is weakened and no social behavior is changed to hide it.

Exact per-test results, failure excerpts, revisions and commands are retained in
[regression-results.json](regression-results.json). Build and focused commands:

```sh
npm run build
npm test -- tests/agency-frontier.test.ts tests/capability-advancement.test.ts tests/autonomous-social.test.ts tests/encounter-recognition.test.ts tests/agency-worldlab.test.ts tests/knowledge-retention.test.ts tests/realtime-combat-action.test.ts tests/knowledge-view.test.ts tests/spatial-index.test.ts tests/place-lookup.test.ts tests/individual-lineage.test.ts tests/locality.test.ts tests/determinism.test.ts tests/persistence.test.ts tests/knowledge.test.ts
npm run agency:worldlab -- 741
npm test -- --reporter=default --reporter=json --outputFile=.debug/food-performance/full-regression.json
```

Independent review found no actionable implementation defects in mutation
invalidation, ordering, genealogy refresh or the prerequisite hoist. A separate
evidence audit verified the reported arithmetic and equivalence claims against
the retained JSON and found no factual inconsistencies.

## Remaining failures and merge readiness

- **Baseline/pre-existing:** PR #48 itself breaches the initial food budget in
  four of six controlled samples. The shared optimizations resolve the final
  feature's food-budget failures. The conversation-cache reload alias discrepancy
  exists on both original revisions and remains documented; no persistence
  semantics changed. The final feature's economy/living-world suites pass.
- **PR #49:** the theft trace's three behavioral assertions fail on pre-fix and
  optimized feature, while the same unchanged test passes on PR #48. This is the
  sole final broad-suite failure and the exact merge blocker.
- **Timing variance:** no final broad-suite timeout, and six of six final controlled
  food samples pass. Abundance's 50.421-second median misses the preferred target
  by 0.421 seconds; its worst sample still has 9.230 seconds of budget headroom.

**Is PR #49 performance-safe and merge-ready after PR #48 lands?** Food performance
is safe under the measured conditions, with full before/after saved-state and
continuation equivalence. **Merge-ready: no.** Resolve the attributed theft-trace
regression before changing that disposition. The smallest next slice is diagnosing
why the ordinary theft trace loses all living knowers of its root matter, while
preserving evidence-based perception, bounded retention and its original checks.
No new gameplay, automatic merge, history rewrite or PR #48 modification is part
of this follow-up.
