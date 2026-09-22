# Autonomous agency v0.1 — verification and evidence

## Theft social-causality repair and integration onto main, 2026-09-22

The branch is now merged with `main` (`5ab3177`: PR #48 Character Foundry and PR #50 Ashford
garments). The only overlap was `package.json`, where each side adds one script. It merged
without conflict.

### What "zero living knowers" actually was

Traced over world time at seed 918271, tracking every holder of the theft key, the
owner's `missing:` inference and each situation event, plus every deletion. **No mind ever
held the theft, on either branch. Nothing was learned and then lost.** Pruning,
compaction, confidence and death played no part.

1. The harness chose its subject (the smith) and then waited up to six hours for an
   onlooker. On this branch the smith was robbed by a bandit during the wait, fought back,
   and was arrested for it. Custody for an attack lasts three days. The theft was then
   staged at a workplace nobody watched, against an owner who could not return inside the
   40-hour window. Its only other route is the owner's own "my property is gone" inference,
   which needs the owner at his workplace, so no legitimate route could carry it.
2. On PR #48 the same robbery, fight and arrest came after the trigger. `applyContributors`
   attaches any `arrest_attempt` that touches a situation's subject or actor, so guards
   confronting the smith and later the thief about separate attacks joined the theft's
   property matter. The "26 knowers" were witnesses of those arrests. None held the theft.
3. The onlooker test ignored facing. On #48 a bystander counted as an onlooker with their
   back to the spot and never perceived the theft.

The harness now chooses the theft subject the way it already chose the assault subject:
at liberty, and with a watched workplace. That choice is re-evaluated at every step of the
same bounded wait. The trace starts at the theft, and the onlooker test uses perception's
forward cone. No assertion changed. With a real eyewitness, four defects stopped the theft
from travelling. Each has a regression test in `tests/theft-social-knowledge.test.ts`,
and each of those tests fails on the unfixed branch:

| Defect | Evidence | Fix |
| --- | --- | --- |
| `conversationBodies` required one clear centre-to-centre line between heads (#49) | People 1.3–1.7 m from a guard round the guardhouse corner post were refused 345–474 times per trace. #48 refused 0. | Speech bends round small obstacles on a two-leg path of at most 5 m. A wall still blocks every short path, and a bend point inside a block is rejected. |
| The report action recorded "delivered" even when `tell()` refused (#49) | Record said "told the watch"; the watch knew nothing. | `tell()` returns whether it was heard. A refused report is a failed attempt. |
| The report target was re-picked on every think (pre-existing) | The eyewitness flipped from Dunstan to Brigid in ten minutes. `setGoal` counts each switch as an errand that did not land, so back-off sent him home untold. #48 survived only because its third guard happened to be in sight. | Someone on their way to tell a guard keeps going to that guard while they are still untold. |
| `Goal.key` (type + target) ignored which crime a report carries (pre-existing) | After one crime was delivered, a second crime for the same guard kept the old goal and rebuilt its plan. The first crime was re-told every few seconds, e.g. ×1,218 on `main` and ×1,333 here, pinning residents at the guard's side. | A report carrying a different crime replaces the old goal. |

An intermediate attempt treated every retarget as "the same errand". It removed the only
limit on chasing guards, and the motivated-lives family trace failed because a spouse
spent 5.5 hours on one report. A bisect found it, and the target hysteresis above replaced it.

After the repair, the theft trace's three living knowers are exactly those who hold the
theft itself: the eyewitness (1.0), the guard he told in person (1 hop, 0.67) and the
owner by inference (0.9). No unrelated arrest events are needed. No pair re-tells a report
more than five times.

### Verification in this environment

Linux container with 4 cores. On it, `main`'s own food tests take about 2× their Windows
times. Unreal checks do not apply to this simulation-only change.

| Scope | Result |
| --- | --- |
| `npm run typecheck` | Clean |
| `tests/theft-social-knowledge.test.ts` (new) | 12/12. The 4 defect tests fail on unfixed #49; the other 8 pass on both. |
| `tests/social-causality-trace.test.ts` and `tests/motivated-lives-trace.test.ts` | 4/4 and 4/4 |
| Focused agency set (21 files: autonomous-social, encounter-recognition, knowledge-retention, knowledge, knowledge-view, crime-flow, causal-society, agency-worldlab 741, agency-frontier, capability-advancement, capability-continuity, persistence, determinism, interaction-coherence, social-causality, place-lookup, spatial-index, individual-lineage, realtime-combat-action, locality, theft-social-knowledge) | 220/220, 44.5 s |
| Food harness, 2 samples each, one at a time | Abundance **55.7 / 55.8 s**, scarcity **54.9 / 55.7 s**, all passing the unchanged 60 s budgets. Same box: unfixed #49 96.0 / 85.5 s; `main` 114.3 / 88.4 s. The earlier optimisation survives, and removing the re-tell loop saves roughly another third. |
| Food determinism | Two samples per workload give identical full-state digests, four RNG streams and food outcomes (abundance 205 bread at price 1, scarcity 5 at price 4). RNG matches after reload. Continuation differs only in the known `execution.lastTopic[*].concern.intensity` alias. |
| 2-day same-seed determinism (`knowledge-memory-skills-intent`) | Equality holds (identical `avgHunger` and cognition). Its 180 s timeout is environmental here: it also times out on `main` (221.6 s) and unfixed #49 (199.8 s). |
| `npm run build` | Passed; 166 modules |
| Full suite, `npx vitest run` | **1,133 passed / 2 failed**, 117 files, 1,989 s. The unfixed branch took 3,032 s here, with 9 timeouts. Both remaining failures are environmental timeouts that also time out on `main`, run alone in the same container. `living-universe` "three settlements diverge": `main` 34.3 s, unfixed #49 34.6 s, final 31.3 s, limit 30 s. `playable-vista`: `main` 5.25 s, final 5.40 s, limit 5 s. It passed once on unfixed #49 under 5 s, and neither branch touches it. No failure is caused by this PR. |

## Food-stress hardening, 2026-09-20

This follow-up preserves gameplay, all stress fixtures, seeds, assertions and timeouts.
Three controlled samples per revision/workload establish that PR #49 added a measurable
regression on the already marginal PR #48 baseline. Five measured traversal/lookup
optimizations reduce feature medians to **50.421 s abundance / 45.141 s scarcity**;
all six final samples pass, and full saved state, ordered JSON, four RNG streams and
both separate continuation trajectories match pre-fix PR #49 exactly.

Final build/typecheck passes. The focused pass is **110 tests / 15 files, 35.24 s**:
`agency-frontier`, `capability-advancement`, `autonomous-social`, `encounter-recognition`,
`agency-worldlab`, `knowledge-retention`, `realtime-combat-action`, `knowledge-view`,
`spatial-index`, `place-lookup`, `individual-lineage`, `locality`, `determinism`,
`persistence`, and `knowledge`. WorldLab seed 741 again passes all reported invariants
and exact save continuation with its unchanged digest. The one final broad run completed
in **1,670.39 s: 1,121 passed / 1 failed, 115 files passed / 1 failed (116 total)**,
with no skipped tests or timeouts. Its food checks pass at 46.879 s / 40.365 s.

The sole failure is the theft social-causality trace: zero living knowers at the endpoint
fail its propagation, differing-significance and grounded-lines checks. The unchanged
isolated test **passes on PR #48** (83.303 s) and **fails identically on pre-fix PR #49**
(112.906 s); optimized full-suite duration is 75.634 s. It is a PR #49 regression that
predates this optimization, not a baseline failure. **Food performance is resolved;
PR #49 remains a draft and is not merge-ready until that behavioral blocker is resolved.**

The food probe separately exposes an original-versus-reloaded conversation-cache alias
discrepancy on **both** PR #48 and pre-fix PR #49. The optimization preserves both
trajectories; this is not reported as complete food-world reload equality.

Full timings, CPU/RSS, profiles, counters, reproducible harness, deterministic evidence
and final readiness disposition: [PERFORMANCE.md](PERFORMANCE.md).
The original milestone record below is retained as history, not the latest status.

Date: 2026-09-19. Windows, repository Node/npm runtime, Vitest 4.1.11; the normal suite uses the existing single-worker configuration. No network or LLM is involved in canonical tests.

## Repository

- Feature: `codex/autonomous-agency-social-inference-v0-1`.
- Stacked base: PR #48, `codex/character-foundry-real-assets-v0-1`; created from `7eb6b6666459c4d92ecb16b23be3fca57a18469c`, updated to its documentation-only `709e6b5dd8698bc097f8e1dae67349a4cec4751a` during final synchronization. Neither PR is merged; the foundation update was merged into the feature branch without rewriting published history.
- Main at synchronization: `fba11534c3c6cd7e6eec300df2b726a2ff2f916d`.
- PR #47 contributes no unique patch: both commits are marked `-` by `git cherry` against #48. No merge or cherry-pick was performed.
- The isolated worktree leaves the original checkout's edits and licensed/ignored assets untouched. No binaries are part of this change.

## Focused verification

| Command / scope | Result |
| --- | --- |
| Final: `npx vitest run tests/agency-frontier.test.ts tests/capability-advancement.test.ts tests/autonomous-social.test.ts tests/encounter-recognition.test.ts tests/agency-worldlab.test.ts tests/knowledge-retention.test.ts tests/realtime-combat-action.test.ts` | **7 files, 81 tests passed, 14.63 s** |
| `npm run build` (includes TypeScript no-emit check) | Passed; 165 modules bundled |
| `npx vitest run tests/capability-advancement.test.ts tests/agency-frontier.test.ts tests/autonomous-social.test.ts tests/encounter-recognition.test.ts tests/agency-worldlab.test.ts` | 5 files, 46 tests passed, 13.47 s |
| `npx vitest run tests/realtime-combat-action.test.ts tests/capability-advancement.test.ts` after replay-fixture repair | 2 files, 28 tests passed, 5.83 s; before adding the later fresh-labor regression |
| `npx vitest run tests/capability-advancement.test.ts` after Chronicle assertion | 1 file, 9 tests passed, 5.03 s |
| `npx vitest run tests/autonomous-social.test.ts tests/agency-frontier.test.ts` after projection identity gating | 2 files, 32 tests passed, 6.52 s |
| `npx vitest run tests/causal-society.test.ts` after local-conversation fixture correction | 1 file, 29 tests passed |
| `npm run agency:worldlab -- 741` | Zero invariant errors; exact save continuation; capability persisted; explicit near-threshold fixture reached Iron |
| `git diff --check` | Passed |
| `npx vitest run tests/encounter-recognition.test.ts tests/autonomous-social.test.ts tests/agency-worldlab.test.ts` after retention correction | 3 files, 14 tests passed, 6.99 s |
| `npx vitest run tests/encounter-recognition.test.ts tests/autonomous-social.test.ts tests/agency-worldlab.test.ts tests/capability-advancement.test.ts` after physical attention cadence correction | 4 files, 24 tests passed, 10.96 s |
| `npx vitest run tests/living-universe.test.ts tests/realtime-combat-action.test.ts tests/agency-frontier.test.ts tests/capability-advancement.test.ts tests/autonomous-social.test.ts tests/encounter-recognition.test.ts tests/agency-worldlab.test.ts` | 7 files, 79 tests passed, 104.94 s; before the later obligation-retention regression |
| `npx vitest run tests/autonomous-social.test.ts` after obligation evidence priority | 1 file, 9 tests passed, 2.36 s |
| `npx vitest run tests/knowledge-retention.test.ts tests/agency-worldlab.test.ts` after obligation evidence priority | 2 files, 12 tests passed, 7.01 s |
| `npx vitest run tests/knowledge-retention.test.ts tests/autonomous-social.test.ts tests/agency-worldlab.test.ts` after awake-handover regression and score precomputation | 3 files, 22 tests passed, 6.76 s |

Earlier focused social/crime/frontier checkpoint: 57 tests passed across four files. These counts overlap and must not be summed as distinct coverage.

## Broad regression

The broad checkpoint (`npm test`) completed in **3,367.71 s**: **102 files passed, 11 failed; 1,099 tests passed, 16 failed, 1,115 total**. It began before the later fixes and retained earlier transformed modules while newer regression assertions were added. It is explicitly a checkpoint, not a clean final-code pass. Fresh affected-file rechecks are recorded below. The full suite was not repeatedly rerun during stabilization.

Seven failures were unchanged runtime budgets: embodied economy (193.205 s / 180 s), human physiology/economy (272.772 s / 180 s), KMSI two-run determinism (216.978 s / 180 s), world metabolism (727.017 s / 600 s), and three food-stress probes (87.520 s, 101.852 s, 98.557 s / 60 s each). No budget or assertion was relaxed.

Six failures exercised superseded behavior covered by fresh focused checks: combat scratch-world replay, public identity gating, two no-op/reused-labor credit checks, physical attention cadence, and reusable encounter retention. Two living-universe checks expected baking before the old observation cutoff; their fresh full-file run passes.

The favor trace's actual nine-hour warmup selected a sleeping recipient. Hearing the gift did not identify its giver, so no gift obligation formed. The earlier zero-warmup diagnostic used an awake recipient and was insufficient to isolate this cause. The handover fixture now selects awake participants structurally; it does not wake anyone by fiat or restore magical target-event witnessing. Its source check now explicitly requires `self` or `witnessed`, and its obligation lookup selects `was_given` rather than an unrelated work obligation toward the same person. A focused asleep/awake regression passes. Separately, the audit found that retained obligation bases lacked retention priority; the new bounded-priority test covers both preservation and eventual eviction after the ledger reference disappears.

Fresh long-run rechecks:

| Command / scope | Result |
| --- | --- |
| `npx vitest run tests/embodied-economy.test.ts tests/human-physiology-economy.test.ts tests/knowledge-memory-skills-intent.test.ts tests/world-metabolism.test.ts tests/stress-benchmarks.test.ts -t 'benchmark run shows\|food scarcity raises\|same seed produces\|8 world-day run\|losing stored food\|food abundance\|food scarcity \(stored'` | 6 passed, 1 timeout, 132 skipped; 4 files passed, 1 failed; 1,014.90 s. The eight-day metabolism, embodied economy, physiology/economy, KMSI determinism, stored-food loss and scarcity checks passed. Abundance took 67.076 s against 60 s. |
| `npx vitest run tests/motivated-lives-trace.test.ts tests/living-universe.test.ts -t 'favor:\|living universe integration'` before the awake-participant correction | 9 living-world checks passed, favor failed, 5 skipped; 246.01 s. This diagnosed the sleeping-recipient fixture, subsequently corrected. |
| Final: `npx vitest run tests/motivated-lives-trace.test.ts tests/stress-benchmarks.test.ts -t 'favor:\|food abundance'` | **Full 72-hour favor trace passed; two food-stress timeouts remain; 8 skipped; 298.77 s.** The pattern also selects the scarcity case through its enclosing describe title. |

**Unresolved:** final abundance took **76.770 s / 60 s**, and scarcity **64.238 s / 60 s**. Vitest reported timeout failures, with no assertion failures in these cases. Scarcity had passed the preceding recheck. The new score precomputation did not establish a wall-clock improvement; there is no claim of a clean full suite or merge readiness. Budgets and assertions remain unchanged. These timing failures require profiling under controlled execution conditions, not a higher timeout or reduced simulation window.

The updated PR #48 evidence independently records pre-existing living-universe failures and a food-abundance assertion failure on the unchanged main simulation. See [the upstream Foundry validation](../foundry-real-people/REAL_ASSET_VALIDATION.md). This is supporting baseline evidence, not a claim that this feature cannot introduce regressions.

The run exposed an existing unsupported replay fixture: saving a two-person scratch grid reconstructs the authored village on load, introducing placeholder residents. New encounter events made the resulting event-ID divergence observable. The combat test now uses a production-generated world, keeps its complete population offstage, and preserves all health/action/event replay assertions. Production persistence was not rewritten to accommodate a test grid.

Several older social tests directly called `tell` across rooms or from remote locations. Their witnesses/listeners now physically meet before the call. Their knowledge, reporting and relationship assertions were preserved.

The living-universe probe produced/delivered mechanical flour inside its original fixed 30-minute window, but autonomous needs/social choices postponed the baker's next work period. A fixed 40-minute diagnostic produced 30 loaves with mechanical ancestry. The fixture now observes that full window and its replay continuation is adjusted consistently; production, ancestry, conservation and control-case assertions remain unchanged. It never runs until a desired outcome appears.

## Deterministic WorldLab results

Full detached diagnostics: [agency-seed-741.json](agency-seed-741.json).

- Initial label: `an unfamiliar person`.
- A direct introduction gave Resident A a claimed identity with an appearance anchor.
- One canonical attack was seen by A and C. B heard it behind the partition but did not visually witness it.
- A autonomously transmitted the event to B. B's attributed belief is `told`, from `p_38`, acquired at `e_234`, one hop, confidence `0.6162500000000001`. The original attack occurred at `e_145`; occurrence time remains distinct from acquisition time.
- B also received the introduction indirectly at `e_375`.
- A resident chose flight through the ordinary planner; the report retains decision reasons, belief inputs and causes.
- Human-controlled movement took the stranger out of A's visible percepts and back. The returning person was `identified`.
- Same-seed runs match. Three further simulated seconds after save/reload produce an identical canonical digest.
- Digest: `3d17fd7994903493386801a03c7c2f778333d51c0208d24f832f7acba29aca10`.

The scenario fixes favorable initial needs, workshop resources, personalities, partition geometry, human introduction/combat/departure/return inputs and elapsed durations. It does not inject NPC goals, disclosures or a required final story.

Capability evidence: [capability-seed-912.json](capability-seed-912.json).

- Four paid fitting attempts changed crafting from `0.95` to `0.9501816918735619`; unrelated skill entries were unchanged.
- Every credited experience references its actual paid work event. The natural actor remained Normal.
- Save/reload preserved skills and the experience ledger.
- A separately disclosed synthetic history begins just below readiness. Further real fitting crosses the practice condition; recovered attributes, technique provenance and three dated evidence samples also matter.
- The reference transition spends energy/hydration, adds fatigue and modestly changes conditioning. Chronicle entry `e_45` retains the actual practice and instruction causes. This is not a claim that four repairs produce Iron.

## Invariant coverage

The new tests cover stranger identity isolation; introductions; recognition/re-encounter; physical visibility and hearing; witnessed versus relayed provenance/confidence/time; false identities and uncertain accusations; belief-driven goal choice; two independent human control connections; an awake second body; detached projection/debug copies; memory/experience save continuity; scoped RNG isolation; duplicate/no-op/reused-labor credit rejection; relevant skill growth; timed shared breakthrough action; recovery/instruction gates; compaction retaining bounded source samples; and blocked later stages. Existing architecture tests and the production build continue to enforce the simulation/presentation import boundary.

## Independent review

The reviewer examined epistemics, boundedness, determinism, persistence, controller equality and progression. It suggested hiding dead/downed target bodies from perception. That suggestion was rejected: incapacitated victims and corpses remain physically visible; consciousness gates the observer, not whether a target can be seen. The focused follow-up reported no additional actionable findings.

Parent integration additionally fixed no-op dismantling/graph-operation credit, paid-progress reuse after failed fitting, multi-body speech origin, and a public projection field that could otherwise expose a stored name before visual identification. Regression assertions cover these boundaries. No review finding requires a merge or approval exception.

The reviewer also checked the acquaintance/obligation retention, physical attention cadence and gift-obligation report selection after stabilization, and reported no actionable findings. The later pruning optimization evaluates the same pure score once per entry instead of repeatedly inside the stable sort; focused retention, social and replay regressions cover the resulting order and outcomes.

## Performance and scope limits

No all-pairs social scan or broadcast was added. Existing spatial neighborhoods feed perception. Social goal inputs look up eight belief keys; appearance attention uses one/three physical seconds, while initial retained encounter history uses sixty/three-hundred world seconds with continuous-observation gating. KMSI's knowledge target and 60-memory cap remain authoritative. New per-skill causal samples are capped at sixteen; recent experience is capped at 96 records and 256 consumed IDs. Source markers prevent duplicate credit after recent-record eviction.

Developer inspection may scan history and is explicitly outside the simulation tick. Existing causal ancestry can retain more than the direct sample count. No thousand-person/century-scale benchmark or native Unreal visual acceptance is claimed.

A bounded seed-918271 six-hour profile found 4,592 retained encounter events before the routine re-encounter gate, versus 3,220 afterward (about 30% fewer). Elapsed times were 7.93 s and 7.62 s while the broad test process was also active; these timings do not establish an isolated speedup. Once familiar, unchanged re-encounters now allocate at most hourly, and established acquaintances receive the existing reusable-identity retention priority. A new pressure test fills the knowledge budget with 600 routine episodes and verifies retained recognition and the unchanged cap.

The appearance attention interval was subsequently moved to the existing physical perception clock; a world-time interval shorter than one accelerated step did not actually rate-limit reconstruction. The same six-hour probe then retained 3,212 encounters (8,200 total retained events), taking 7.56 s with 2.97 s in perception. These are bounded diagnostic measurements, not a population-scale guarantee. A regression exercises the clock distinction explicitly.

Pruning now evaluates each entry's unchanged retention score once per pass, then stably sorts the scored entries. This reduces repeated weight calculation from comparison count to entry count, preserves ties/order and the existing knowledge cap, and creates no persisted cache.

Remaining cognition gaps: sensory acuity/attention, mistaken cross-person matching, competing identity hypotheses and legacy canonical selectors. Social gaps: explicit role/workplace disclosure and broader institution exchanges. Progression gaps: more paid-action adapters, mentorship paths and concrete post-Iron mechanics. Control gaps: multiplayer connection/account ownership beyond the existing independent leases. Presentation gap: a native inspector UI; the detached debug contract is available.

Smallest next slice: profile the existing deterministic food-abundance/scarcity workload and remove the measured bottleneck until both fit their unchanged budgets. Preserve the simulation duration, assertions, cognition and replay semantics before adding further features.
