# Autonomous agency v0.1 — verification and evidence

Date: 2026-09-19. Windows, repository Node/npm runtime, Vitest 4.1.11; the normal suite uses the existing single-worker configuration. No network or LLM is involved in canonical tests.

## Repository

- Feature: `codex/autonomous-agency-social-inference-v0-1`.
- Stacked base: PR #48, `codex/character-foundry-real-assets-v0-1`, `7eb6b6666459c4d92ecb16b23be3fca57a18469c`.
- Main at synchronization: `fba11534c3c6cd7e6eec300df2b726a2ff2f916d`.
- PR #47 contributes no unique patch: both commits are marked `-` by `git cherry` against #48. No merge or cherry-pick was performed.
- The isolated worktree leaves the original checkout's edits and licensed/ignored assets untouched. No binaries are part of this change.

## Focused verification

| Command / scope | Result |
| --- | --- |
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

Earlier focused social/crime/frontier checkpoint: 57 tests passed across four files. These counts overlap and must not be summed as distinct coverage.

## Broad regression

The single final normal regression (`npm test`) is in progress while this draft is prepared. Its results and any focused rechecks will be recorded here before task completion. This paragraph is not a passing claim.

The run exposed an existing unsupported replay fixture: saving a two-person scratch grid reconstructs the authored village on load, introducing placeholder residents. New encounter events made the resulting event-ID divergence observable. The combat test now uses a production-generated world, keeps its complete population offstage, and preserves all health/action/event replay assertions. Production persistence was not rewritten to accommodate a test grid.

Several older social tests directly called `tell` across rooms or from remote locations. Their witnesses/listeners now physically meet before the call. Their knowledge, reporting and relationship assertions were preserved.

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
- Digest: `1d47d0999f5cdbc721f6ebd738cc24d5030542c55814487345083c08700010f3`.

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

## Performance and scope limits

No all-pairs social scan or broadcast was added. Existing spatial neighborhoods feed perception. Social goal inputs look up eight belief keys; appearance attention uses one/three physical seconds, while initial retained encounter history uses sixty/three-hundred world seconds with continuous-observation gating. KMSI's knowledge target and 60-memory cap remain authoritative. New per-skill causal samples are capped at sixteen; recent experience is capped at 96 records and 256 consumed IDs. Source markers prevent duplicate credit after recent-record eviction.

Developer inspection may scan history and is explicitly outside the simulation tick. Existing causal ancestry can retain more than the direct sample count. No thousand-person/century-scale benchmark or native Unreal visual acceptance is claimed.

A bounded seed-918271 six-hour profile found 4,592 retained encounter events before the routine re-encounter gate, versus 3,220 afterward (about 30% fewer). Elapsed times were 7.93 s and 7.62 s while the broad test process was also active; these timings do not establish an isolated speedup. Once familiar, unchanged re-encounters now allocate at most hourly, and established acquaintances receive the existing reusable-identity retention priority. A new pressure test fills the knowledge budget with 600 routine episodes and verifies retained recognition and the unchanged cap.

The appearance attention interval was subsequently moved to the existing physical perception clock; a world-time interval shorter than one accelerated step did not actually rate-limit reconstruction. The same six-hour probe then retained 3,212 encounters (8,200 total retained events), taking 7.56 s with 2.97 s in perception. These are bounded diagnostic measurements, not a population-scale guarantee. A regression exercises the clock distinction explicitly.

Remaining cognition gaps: sensory acuity/attention, mistaken cross-person matching, competing identity hypotheses and legacy canonical selectors. Social gaps: explicit role/workplace disclosure and broader institution exchanges. Progression gaps: more paid-action adapters, mentorship paths and concrete post-Iron mechanics. Control gaps: multiplayer connection/account ownership beyond the existing independent leases. Presentation gap: a native inspector UI; the detached debug contract is available.

Smallest next slice: evidence-backed occupation/workplace disclosure replacing legacy role shortcuts in conversation and reporting selection.
