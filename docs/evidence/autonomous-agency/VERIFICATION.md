# Autonomous agency v0.1 — verification and evidence

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
