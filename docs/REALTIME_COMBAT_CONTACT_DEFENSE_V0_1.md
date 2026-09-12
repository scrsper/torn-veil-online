# Real-time combat contact and defense v0.1

Branch: `codex/realtime-interaction-v0-1`. Accepted base: `6e3af83`.
Canonical checkout: `C:/Users/green/Desktop/projects/torn-veil-online`.
Production revision: `7f2f418fe8b5d992daba74c661ca8585e315c65f`.
Verification revision: `3bc3acc419ce49d334334386565e3e7776b66b87` (perception-cadence test migration).
Status: checkpoint and stop; final acceptance is not complete.
The last full run on `3bc3acc` passed 851/852 tests across 84 files in 1622.62 seconds.
Injury knowledge arrives. The family motivated-life trace formed a care purpose, but no care
plan reached execution. No production fix has been justified.
Its original caregiver prioritized assault reporting and fleeing until the victim healed.
A pending harness-only experiment selects an awake, physically available caregiver without
an active emergency goal. It preserves all assertions and production priorities, but the focused
rerun still fails the same two care-action checks (68.79 seconds). Typecheck passes.
No subsequent full regression has been started. Both listed commits were pushed normally to
the feature branch. The unsuccessful fixture experiment remains local and uncommitted.

The subsequent budget-limited family-only investigation is recorded in
`evidence/realtime/family-causal-followup.json`. It demonstrates threat gating and competing
goals before plan selection; the exact family test still fails (69.36 seconds). No additional
source change was made. Competing priorities explain most observed decisions; the
17-world-hour delay before the selected pair's purpose formation remains unexplained.

## Production architecture

The accepted movement predictor, collision kernel, command identities, session epochs and
reconciliation ledger remain the foundation. TypeScript owns admission, physical movement,
posture, contact, injury and consequences. Unreal owns disposable predicted/interpolated
presentation. No simulation dependency on rendering was introduced.

Each manifestation can hold one current `CombatAction`; an entity still supports zero or many
manifestations. Stable action and command IDs bind predicted startup to authority. Persisted
action data includes the accepted definition, potential force, phase timing, bounded tracking,
direction/displacement, outcome/contact, interruption and causal origin. A subsequent action
replaces terminal state. Save/load preserves active execution and validates executable fields.
Random force variation is drawn once at acceptance; hit success and injury region are not.

The lifecycle emits requested, accepted, preparation, active, recovery and complete transitions.
Interruption, cancellation and miss have explicit events/state. Acceptance reports `hit:false`
and no injury. Only physical contact during the active interval reaches `Simulation.applyHit`.
Ordinary NPC attack plans use this same path; the old coarse-step loop that rewound cooldown
to manufacture several immediate blows was removed.

| Action | Preparation | Active / displacement | Recovery |
|---|---:|---:|---:|
| Strike | 300 ms | 150 ms | 300 ms |
| Sidestep | Immediate | 1.05 m over 300 ms | 300 ms |
| Backstep | Immediate | 0.85 m over 300 ms | 300 ms |
| Duck/slip | 60 ms lowering | Maintained through the 600 ms action | Last 120 ms rises |

Preparation tracks at most 90 degrees/second and 15 degrees total. Its final 100 ms and the
entire active interval are locked. Initial unarmed strikes have zero canonical root displacement;
ordinary locomotion cannot turn or translate an ongoing strike. Cancellation is allowed before
commitment. Incapacitation, weapon withdrawal and contact can interrupt; recovery still prevents
immediate action replacement.

## Contact and defenses

Six humanoid spheres represent head, torso, left/right arms and left/right legs. Shape dispatch
provides a small creature extension point. Each strike sweeps a 0.12 m sphere from 0.35 m
extension to accepted reach with a small lateral curve. High, middle and low trajectories lie
1.65, 1.12 and 0.43 m above the feet. Initial fist reach is 0.9 m; admission allows 1.2 m including
the target volume. The previous 2.1 m fist admission radius did not match visible anatomy.
Existing weapon force/reach data remains usable; weapon-specific native content is outside this
milestone's rendered unarmed coverage.

Exact relative moving-sphere tests operate in segments bounded to 1/120 second. Both attacker
and defender motion participate, preventing endpoint tunneling. Interaction remains 60 Hz;
slow world systems remain 20 Hz. The intersected volume selects injury region. Contact facts
retain limb side and map to existing coarse injury effects. Walls block contact. Contacts are
gathered before consequences and ordered by physical time and stable action ID, permitting
equal-time mutual contact.

Sidestep and backstep use the canonical collision predictor. A blocked attempt still costs
effort once and cannot open a route or pass a wall. Duck lowers head/torso by 0.50 m, arms by
0.52 m and legs by 0.08 m. Appropriate high trajectories miss; low trajectories can hit the
lowered body. There are no invulnerability frames.

## Prediction and live choreography

The native input callback creates predicted startup, sends the sequenced command and starts
permitted presentation immediately. Snapshots and receipts do not gate startup. Confirmation
binds by command ID without restarting animation. Rejection cancels startup; authoritative
position/posture and the existing pending movement ledger reconcile prediction. Replay invokes
only disposable prediction, never stamina, damage, events or contact effects.

Urgent `combat_frame` updates expose current physical action state alongside local corrections.
Remote actors interpolate the timeline; the owner retains its predicted visual cursor. Style
profiles, owned motion primitives, trails, FX, foot IK and presentation LOD remain. Live actions
bypass retrospective result queues. Migrated result records carry action IDs and cannot replay
as legacy choreography. Contact effects use canonical positions, deduplicate IDs and discard
notifications older than 250 ms. The live path applies no target-directed root warp. Hand/foot
IK follows the physical trajectory with stretching disabled; duck lowers the skeletal pelvis.

## NPC perception and controller parity

A bounded policy observes preparation, facing, distance and line of sight. It stores one
working-memory cue with witnessed event ID, observation time, position, direction and trajectory,
then offers sidestep to the ordinary action plan after 100–200 ms according to dexterity.
Existing commitments can prevent a response. It never reads future contact or outcome.
Controlled minds receive the same cue; autonomous planning alone offers a defense.

Internal phase notifications remain canonical history without each becoming a social belief or
memory. Actual contact and miss consequences still use ordinary event memory. This follows the
Constitution's distinction between world history and selective remembered history. The first
implementation exposed every phase to generic cognition, producing 18,732 memories in a
half-day abundance profile versus 1,556 at the accepted base. The correction removes that
unintended transcript without changing stress timeouts or social provenance assertions.
A subsequent CPU profile found repeated genealogy belief scans and full-body object copies
inside hurt-volume construction. Reusing the belief list within one goal-offering call and
passing only shape/transform reduced half-day elapsed time from 19.95 to 18.38 seconds; combat
processing fell from 0.934 to 0.197 seconds with identical simulation tallies. These changes
introduce no persisted cache or alternate knowledge authority. See `combat-cognition-profile.json`.

Player→NPC, NPC→player and NPC→NPC tests use the same mechanics. Two independently bound
controllers can issue simultaneous attacks at protocol/canonical level. Two rendered clients
were not exercised; rendered PvP is not claimed.

## Deterministic counterfactuals

Run `npx tsx src/headless/bridge/combatAcceptance.ts` to regenerate
`docs/evidence/realtime/combat-counterfactuals.json`. Pairs use seed 123, identical positions,
force draw and 60 Hz steps. Only the stated intervention changes.

| Case | Result |
|---|---|
| A: no defense | Head contact at 410 ms; injury |
| B: sidestep after 100 ms | 1.05 m lateral displacement; miss |
| C: sidestep after 390 ms | Already moving before contact; head hit at 413 ms |
| D: blocked backstep | Retreat clipped to 0.0472 m; head hit |
| E: timely backstep | 0.85 m retreat; short strike misses |
| F: duck versus high | Miss |
| G: duck versus low | Lowered torso contact; injury |
| H: target leaves after commitment | Locked strike misses without facing change |
| I: timely NPC response | Perceived cue, shared sidestep, miss |
| I: delayed NPC response | Same initial attack contacts before sufficient separation |

Active save/load produces identical contact and history. The blocked-prediction regression
predicts an open retreat and corrects to the wall-constrained result; duplicate command replay
changes neither effort nor canonical event counts.

## Latency investigation

Accepted applied acknowledgment p95 was 32.578 ms headless, 54.825 ms PIE and 119.634 ms during
standalone startup/streaming. New instrumentation records command arrival, first eligible tick,
application, serialization, socket send/flush and native receive. Clock probes estimate the
offset and uncertainty between process clocks. These are software timings, not physical
input-to-photon measurements.

Initial headless RTT p95 was 31.680 ms, serialization 0.009 ms and socket flush 0.766 ms, with
zero queued socket bytes. Refreshing the scheduler deadline alone did not help materially
(31.866 ms). Native startup showed a movement-command backlog: roughly 78–84 ms between
arrival and application despite sub-millisecond outgoing delivery. Combat now passes queued
movement at the next eligible tick. Movement order, one sample per tick and the contiguous
acknowledgment frontier remain intact. An earlier interaction such as pickup is an ordering
barrier, so an attack cannot jump the action that changes its equipment.

Bulk projection also blocked the event loop: the first 518,687-byte region took 240.01 ms
synchronously. Projection now yields under a shared 3 ms per-turn budget after urgent traffic.
The measured first region took 173.97 ms of work across 54 slices, with a largest slice of
9.07 ms including final assembly/serialization. Revision changes invalidate partial work.
Acknowledged chunks and bounded assembly remain unchanged. All nine initial regions and
eight dynamic transfers were acknowledged in each matched experiment. No second socket or
network-stack rewrite was necessary. Native libwebsockets polling changes from 30 to 120 Hz.

| Measurement (ms) | n | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| Native callback → predicted attack | 30 | 0.0142 | 0.0165 | 0.0166 |
| Native callback → predicted duck | 30 | 0.0149 | 0.0180 | 0.0210 |
| Native input → animation setup | 60 | 0.313 | 0.363 | 7.980 |
| Native combat command → applied receipt | 60 | 18.438 | 18.686 | 18.773 |
| Contact decision → native presentation | 30 | 4.774 | 11.789 | 12.615 |
| Remote action publication age | 2048 | 4.635 | 11.701 | 12.301 |
| Arena command arrival → application | 40 | 15.498 | 16.302 | 29.299 |
| Headless playable synchronous bulk: combat terminal RTT | 40 | 16.227 | 30.655 | 205.697 |
| Headless playable sliced bulk: combat terminal RTT | 40 | 16.333 | 21.560 | 83.178 |

The isolated native arena run alternated 30 low strikes and 30 ducks. Both attack sequence and played-attack
count ended at 30. Prediction timing starts at the Character input callback. Animation setup
includes one 7.98 ms prewarm outlier. Contact timing has estimated clock uncertainty of 0.584 ms.
Remote age means action publication age, not elapsed time since action startup. Frame-level
metrics use the bounded most-recent 2,048-sample diagnostic window; the 60 input/receipt and
30 contact measurements cover all corresponding actions in this run.

The arena transport run applied all 1,870 movement plus 40 combat commands with zero sequence
violations. Each playable run received 1,910 terminal receipts, including one combat rejection;
the RTT table includes that rejection. Sliced projection applied 1,887 commands and rejected 23;
synchronous projection applied 1,863 and rejected 47. These are admission outcomes, not packet loss.

For accepted combat in the sliced run, arrival→next tick p95 was 15.731 ms and arrival→application
16.161 ms. Receipt serialization p95 was 0.005 ms and socket flush 3.432 ms; queued socket bytes
were zero. Native all-command arrival→application p95 of 83.580 ms includes movement backlog
and is not combat latency. Remaining playable stalls reached 687 ms scheduler debt; movement
RTT p95/p99 under bulk load was 217.571/562.319 ms. This reduces interference but does not prove
a hard real-time world deadline. Native after-values above are from the isolated arena; a matched
new PIE/standalone regional-streaming measurement was not recorded. They must not be read as
an apples-to-apples replacement for the old startup/streaming native values. The matched
headless bulk experiment preceded the separate phase-memory
correction. The native software prediction target is met; whole-world worst-case latency remains
an explicit limitation.

Committed evidence lives in `docs/evidence/realtime/`: `combat-transport-checkpoint-summary.json`,
`combat-transport-stage-summary.json`, `native-combat-checkpoint-summary.json` and
`native-live-combat-repetitions.json`. Original transport records and repeated frame diagnostics
remain local and uncommitted, including `native-live-combat-repetitions.raw.json.gz`.
The summaries retain source identifiers/hashes; curation adds no new measurements.

## Corrections and rendered evidence

| Correction measurement | n | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| Stationary attack/duck distance (cm) | 2048 | 0 | 0 | 0 |
| Stationary attack/duck CPU (ms) | 2048 | 0.0182 | 0.0277 | 0.0439 |
| Late sidestep distance (cm) | 101 | 0 | 0 | 17.5 |
| Late sidestep CPU (ms) | 101 | 0.0136 | 0.0261 | 0.0516 |

The late sidestep's single nonzero visual correction settled in 65.324 ms. Its authoritative
defense was active before head contact interrupted it. The timely no-capture sidestep began
58 ms after visible preparation and escaped with full health. Its callback-to-predicted-sidestep
sample was 0.0119 ms; the late sidestep sample was 0.0184 ms. These are small scenario samples,
not a population estimate. The actual native local-state handler also passes a blocked-retreat
test: stale geometry predicts 0.85 m, authority permits 0.0472 m, producing an 80.278 cm correction
in 0.007 ms. Repeated state produces 0 cm additional correction and preserves contact deduplication.
Large corrections apply immediately.

Three continuous captures contain 19–20 distinct native renderer frames over about two seconds,
with recorded timestamps. Readback is approximately 10 Hz and affects timing, so latency uses
separate runs without capture. Duck lowers the measured head/pelvis by 50 cm. High misses;
low hits the lowered torso. The miss has no target-directed root warp.

- [Timely sidestep](evidence/realtime/native-combat-timely-rendered.mp4)
- [Duck versus high](evidence/realtime/native-combat-duck-high-rendered.mp4)
- [Duck versus low](evidence/realtime/native-combat-duck-low-rendered.mp4)

Representative screenshots use the same video stems with `.png` extensions.
Curated probe results and server observations are in `native-combat-checkpoint-summary.json`;
the original per-frame streams remain local. Reproduce with
`unreal/scripts/Run-CombatProbe.ps1`; encode frames with `unreal/scripts/Encode-CombatCapture.ps1`.
These are automated rendered checks. No human playtest approval is claimed.

## Human playtest arena and controls

Build and launch from the canonical checkout:

```powershell
pwsh -File unreal/scripts/Build.ps1
pwsh -File unreal/scripts/Start-CombatArena.ps1
```

The launcher starts a separate unsaved arena on port 8789 and opens the native game. It refuses
to rearrange another world on that port. Controls: **WASD** move, **Shift** sprint, mouse orbit,
wheel zoom, **Tab** target, **LMB/X** high strike, **R** low strike, **Z/V** left/right sidestep,
**Space** backstep, **Left Ctrl** duck. **E** interact, **C** eat and **Q** drop retain their bindings.

Use a second terminal for scenarios, then focus the game:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8789/arena/idle
Invoke-RestMethod -Method Post http://127.0.0.1:8789/arena/incoming
Invoke-RestMethod -Method Post http://127.0.0.1:8789/arena/incoming_low
Invoke-RestMethod -Method Post http://127.0.0.1:8789/arena/blocked
Invoke-RestMethod -Method Post http://127.0.0.1:8789/arena/npc_defense
```

For time to refocus, prepend `Start-Sleep -Seconds 2` to the incoming request. `npc_defense`
enables the partner's ordinary defense policy; initiate the strike yourself.

## Verification, changed files and limits

Production TypeScript build, generated interaction-spec check, the browser live-attack check,
ten deterministic arena cases and twelve native automation tests pass. Native coverage comprises
seven realtime checks, three choreography checks and two humanoid checks. The 11 bridge combat
tests pass after waiting for the normal perception sample following delayed contact; the assertion
now requires knowledge of the specific hit event. The armed-backup robbery fixture holds its
stationary guards/villager through existing external idle control, keeping the bandit autonomous
and preserving the original flee/no-theft assertions. The unresolved family trace and paused
final-regression status are recorded above; this report does not claim completed acceptance.

Exact production/test/script paths are in `evidence/realtime/combat-production-manifest.json`.
Root owns implementation; Worker A supplied canonical/protocol regression and independent review;
Worker B supplied native/live checks and measurements. Final focused review found no defects.

Changed production areas:

- Physical lifecycle/contact: `src/sim/physical/combatAction*.ts`, `combatGeometry.ts`, `combat.ts`,
  `combatFacts.ts`, `melee.ts`, `input.ts`, `interactionMovement.ts`, `interactionSpec.json`.
- Persisted action validation and core types: `src/sim/persist/`, `src/sim/core/types.ts`.
- Perceptual response and action execution: `src/sim/mind/agent.ts`, `combatReaction.ts`, and the per-call scan optimization in `genealogy.ts`.
- Protocol, combat projection, scheduler, streaming and arena API: `src/bridge/`.
- Arena and measurements: `src/sim/world/combatArena.ts`, `src/headless/bridge/`.
- Native predictor, bridge, inputs, choreography, pose/IK and arena: `TVLiveCombat*`,
  `TVBridgeSubsystem*`, `TVCharacter*`, `TVCombat*`, `TVGameMode.cpp`, generated spec header,
  and `Config/DefaultEngine.ini` under `unreal/TornVeilOnline/`.
- Regression/acceptance tests, three arena/probe/capture scripts, repository state/map/decisions
  and this report's evidence. No PCG, vendor or binary game assets or dependencies changed.

The coarse model is not full anatomy. No sword content, parry mastery, skill books/progression,
armor, severance, bleeding overhaul, magic, rank durability or Motion Matching was added.
Rendered coverage is unarmed. Rendered two-client PvP and physical input-to-photon remain unmeasured.

Next recommended milestone: **Two-controller rendered combat and prediction hardening v0.2**.
Exercise two real native clients, repeated moving defenses under measured latency/jitter, and
correction behavior during sustained streaming before expanding weapon content.
