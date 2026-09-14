# Real-time interaction and prediction v0.1 — runnable checkpoint

**This is a partial milestone, not completion of the requested live-combat outcome.**
The command/movement checkpoint is implemented. Live canonical preparation/contact/recovery,
sidestep/backstep/duck, cue-driven NPC defense and the playable combat arena remain unimplemented.
Existing attacks still resolve immediately when their canonical handler runs. Existing choreography
still presents the resulting history. Do not describe this checkpoint as responsive live combat.

## Starting state and ownership

- Canonical checkout: `C:/Users/green/Desktop/projects/torn-veil-online`.
- Origin: `https://github.com/scrsper/torn-veil-online.git`.
- Starting branch/HEAD: `astra/emergent-combat-choreography-v0-1`,
  `3c1c876e7544b8ce56b61e2ac30bdba86044ff9e`; clean, endpoint present.
- Feature branch: `codex/realtime-interaction-v0-1`, stacked on the unmerged choreography
  and humanoid/PCG milestones. No merge/rebase/reset/stash or main changes.
- MCP confirmed the live project as
  `C:/Users/green/Desktop/projects/torn-veil-online/unreal/TornVeilOnline/TornVeilOnline.uproject`.
  No editor was connected initially; one editor was subsequently started.
- Root owns production architecture, TypeScript/native implementation, integration and fixes.
  Worker A owns protocol tests/initial latency harness and independent final review.
  Worker B owns native/reference tests and serialized live-editor acceptance.
- The older Documents checkout and the sibling GameAnimationSample are untouched.
  No vendor/owned content assets are changed by this checkpoint.

Relevant constitutional rules consulted: canonical reality and provenance (§4–6),
manifestation identity/player equivalence (§8–9), renderer independence and clocks (§46–47).

## Architecture and actual coverage

`interactionSpec.json` is the shared versioned data. `prediction.ts` is a pure disposable
movement evaluator; `interactionMovement.ts` is its canonical adapter. `TVInteractionPrediction`
is the small equivalent native evaluator. The generator produces a native header from JSON;
the handshake compares revision and SHA-256 of normalized data. Native build checks generated
data freshness. Cross-language fixtures bound numerical agreement rather than claiming bitwise
determinism. No Mover/plugin/compiler/runtime-generative dependency was introduced.

TypeScript owns body state, capabilities, terrain, doors, costs, items, history and saves.
Native confirmed state, predicted state and render correction are separate. Reconciliation
restores the confirmed movement state, removes resolved samples and reevaluates the remaining
samples. That evaluator cannot emit history, purchase anything, spend resources or apply damage.
Only `ATVCharacter::Tick` applies the resulting player transform. Stock CharacterMovement remains
disabled so it cannot fight this adapter; its disabled status is not a ban on disposable prediction.
NPC rendering retains the existing interpolation path. Origin rebasing remains a coordinate conversion.

| Input category | Implemented feedback / authority policy | Remaining limit |
|---|---|---|
| Camera/aim/selection/UI | Existing immediate local controls | No new UI system |
| Movement/sprint | Fixed samples predicted locally, confirmed/replayed independently of snapshots | Current ordinary body movement; no action displacement |
| Start/stop | Native axes change immediately; samples applied on interaction ticks; no held server input in v2 | Frame scheduling and bounded pending history still apply |
| Pickup/consume/drop/resource interaction | Immediate attempt text; correlated authoritative confirmation/rejection; duplicate command commits once | No speculative inventory |
| Ordinary doors | Authority performs existing automatic door opening at the movement footprint; prediction waits for actual geometry update | Dynamic updates arrive over TCP |
| Attack | Uses general v2 command receipt when available; canonical resolver remains immediate | No predicted progression or live contact phases |
| Sidestep/backstep/duck/cancel | Unsupported-command rejection | Not implemented |
| Dialogue/mechanism/person actions/save/debug | Existing v1 handlers | Not yet migrated to scheduled v2; some results/presentation remain snapshot-dependent |
| Transfers/crafting/purchases/damage/knowledge | Authoritative commitment only | No blanket prediction claim |

## Protocol and acknowledgments

Native opts into interaction protocol 2 using `X-Torn-Veil-Interaction-Protocol: 2`.
Legacy native clients and fixtures remain supported. Server `hello.interaction` contains a fresh
connection epoch, controller ID, explicit body ID, spec revision/hash and fixed sample duration.

Commands contain version/type, epoch, controllerId, bodyId, sequence, commandId,
specRevision, clientTimeMs, and bounded typed command parameters. Client positions, hit outcomes,
damage and elapsed durations are never accepted. The server admits at most 16 queued commands,
retains 256 receipts and permits at most one movement sample per canonical interaction step.
Up to eight ordered discrete/expired entries can resolve in a turn without discarding an input interval.

`command_receipt.status = received` means validated/enqueued, **not applied**.
The controlled schedule returns `applied` or `rejected` with the same identity. Duplicate identities
return the stored receipt without re-executing. Rejections resolve that specific pending command.
The native immediate-attempt label is confirmed only by its own command sequence, not by an
unrelated movement acknowledgment. Supported synchronous hand operations complete on application;
there is no invented long-action completion acknowledgment.

`local_state` includes the authoritative movement state, simulation tick, controller epoch and
resolved sequence frontier. The frontier never crosses an earlier queued command. Rejected entries
may advance it once all earlier inputs are resolved. It is distinct from world combat event sequence.
The old snapshot `ack` was last-received; it is now the v1 applied frontier. Protocol 2 uses its own
`local_state.ack`; neither combat sequence nor a packet receipt is a replay frontier.

Disconnect clears the connection ledger and held input; a new binding gets a new epoch.
Withdrawal invalidates the explicit body binding. Pending prediction stops when the local state is
older than 250 ms and is cleared on reconnect. One controller plus observers remains the actual
server topology: this is **not** two-body PvP validation. Arbitrary possession transfer remains future work.
The withdrawal test covers command rejection after binding invalidation. It does not establish a
complete zero-body/respawn presentation flow; existing general snapshot assumptions in that path
still need migration before claiming manifestation replacement acceptance.

## Timing, geometry and collision

- Canonical coordinates: metres, Y up, yaw in radians, forward `(-sin(yaw), 0, -cos(yaw))`.
- Native evaluator uses these same canonical coordinates; display conversion is centimetres,
  Unreal XY horizontal/Z up, subtracting the current region origin. Capsule display offset is 90 cm.
- Duration is seconds. A sample is exactly 1/60 second; clients cannot buy longer elapsed time.
- Movement normalizes diagonal input, uses the server-supplied local capability speed and
  the shared sprint multiplier, sweeps in at most 0.1 m increments, and breaks ties X then Z.
  This remains immediate velocity intent, with no invented acceleration/inertial model.
- A 9×9 local collision window contains canonical floors, walkability and occupied height cells.
  Unknown columns block prediction. Footprint radius/standing height/stair tolerance come from data.
- Collision windows are hashed from current canonical geometry; changed windows accompany the
  urgent local state. Decorative PCG/mesh collision is not part of gameplay collision.
  The authority reevaluates real terrain/doors on every sample; an old client window cannot
  authorize walking through a closed door. Moving obstacles beyond existing voxel geometry are deferred.
- Render correction is bounded to 25 cm and decays separately; corrections ≥30 cm snap.
  Render offsets never mutate canonical coordinates.

The monotonic scheduler targets 60 Hz interaction with 20 Hz accumulated population/cognition work
and 10 Hz general replication. It advances the canonical clock once. `Simulation.stepScheduled`
persists fractional slow cadence in the existing execution checkpoint so save/load cannot discard it.
The scheduler catches up at most four steps per turn, retains remaining debt and reports overruns.
It does not skip collisions or secretly replace the canonical clock with elapsed wall time.

**Late-input policy:** receive-time execution, no backdating/rewind. Client time is monotonic
diagnostic data, not authority. Queued commands older than 250 ms reject. This cannot make a late
defense valid and does not implement historical contact validation.

## Transport and instrumentation

The bridge remains loopback-only WebSocket/TCP. Urgent receipts/local state are sent before general
snapshots and bulk chunks. Queued bytes cannot be overtaken; there is no separate action connection.
Action backpressure closes the controller above 256 KB; inputs remain bounded. V2 allows 160 action
messages/second and a separate 80 presentation acknowledgments/second; 4 KB inbound payload bounds remain.
Legacy action rate remains 80/sec. These are abuse bounds, not evidence of congestion tolerance.

`/metrics` exposes event-loop p50/p95/p99, scheduler debt/overruns and process memory.
Native `realtime_diagnostics()` records bounded distributions for predictor CPU work,
input-callback-to-engine-state, applied receipt RTT, and correction distance. Native state timestamps
use FPlatformTime; bridge/harness use monotonic process clocks. Clock probes estimate offset with
RTT/2 uncertainty; no unrelated process clock is subtracted without that qualification.

Harness impairment is **ordered application-message delay**, split 1/3 uplink and 2/3 downlink,
with declared asymmetric jitter. It traverses the actual custom bridge. It is not TCP packet loss,
retransmission, bandwidth congestion or Unreal network emulation. Frame submission, display
presentation, GPU time and physical input-to-photon are unmeasured unless separately recorded.

Measurements and exact configurations are in `docs/evidence/realtime/`. Failed calibration runs
were corrected for receipt/application confusion, a pre-probe input epoch and callback scheduling;
they are not performance evidence. Final report entries below identify retained measurements.

## Commands and human checks

From the Desktop repository:

```powershell
npx tsx scripts/generate-interaction-spec.ts --check
npm run bridge:playable
./unreal/scripts/Launch.ps1
```

For disposable checks, set `TORN_VEIL_SAVE` to a disposable absolute file and use the playable
server. Do not overwrite an ordinary world save. The old Ashford server sends a 543,755-byte
unchunked scene, exceeding the native 262,144-byte limit; its live startup failed with code 1009.
That existing legacy-path issue was not concealed by raising limits; live acceptance uses the
normal playable world and bounded regional stream.
Existing WASD, mouse camera, LeftShift sprint, E interaction, consume/drop/menu bindings remain.

```powershell
npx vitest run tests/realtime-protocol.test.ts tests/realtime-native-traces.test.ts tests/realtime-session.test.ts
$env:TORN_VEIL_LATENCY_COUNT='240'
$env:TORN_VEIL_LATENCY_DELAY='60'
$env:TORN_VEIL_LATENCY_JITTER='8'
npx tsx src/headless/bridge/realtimeLatency.ts
```

Native automation: `TornVeil.Realtime.MovementPrediction`; actual PIE input capture:
`unreal/scripts/verify_realtime.py`, after starting exactly one PIE session.
Capture scripts use automated native key dispatch, not a human playtest.
Standalone probe: launch the built Development editor binary with the project and map,
`-game -windowed -ResX=1280 -ResY=720 -TVRealtimeProbeExit`
and `-ExecCmds="t.MaxFPS 60,t.IdleWhenNotForeground 0,TV.RealtimeProbe"`.
It uses ordinary native input, writes `docs/evidence/realtime/native-standalone.json`, then exits.
Run against a disposable playable bridge save after stopping heavy test/build workloads.

Human script: walk/sprint and release, turn the camera while moving, approach a wall/door,
pick up an available item once, disconnect/reconnect, and verify the world resumes without old
movement or duplicate items. Watch correction diagnostics. Combat counterfactuals cannot yet be
performed with this checkpoint; there is no new live-contact arena and Jacob has not approved feel.

## Acceptance status and next checkpoint

The automated movement/command tests prove applied-frontier semantics, bounded queue/expiry,
duplicate rejection, explicit binding checks, collision boundaries, replay purity, one-time pickup,
reconnect cleanup, fractional scheduler persistence and retained catch-up debt.

Counterfactuals 1–5, 8 and the live combat portions of 7/10/11 remain unmet. Counterfactual 6 has
movement-only coverage; 9 has canonical hand-commit coverage; 11 has movement/session coverage.
There is no mid-attack persistence/contact proof, continuous combat video, two rendered clients,
defense-fairness measurement, bandwidth-congestion test or representative streaming/autosave stall
acceptance. Existing content is preserved; prior asset evidence is not relabeled as new acceptance.

The next smallest milestone is the shared canonical attack lifecycle and contact evaluator,
including all NPC/browser/headless callers and coarse-time `exchangeBlows`, before binding any
predicted attack animation. It must persist action commitment/contact identity, derive anatomical
contact regions, admit genuine post-cue defenses and update choreography to the live clock.
The JSON contains reserved attack/defense tuning for that work; those entries do not implement actions.
Do not expand cosmetic combat or claim high/low variation is equivalent until the geometry exists.

## Final verification record

Implementation slices: `95b3406` (canonical command/movement), `bae3d3e` (native prediction,
generated parity and input capture). The final evidence/handoff commit follows these on the
feature branch; it adds the standalone test probe and does not change canonical production source.

Reference machine: AMD Ryzen 5 9600X, approximately 31.1 GiB RAM; before PIE, 17.5 GiB free and
23% CPU load. Headless bridge measurements ran without Unreal/compilation/full-suite competition.
Their workload is the ordinary Ashford simulation (36 residents), 240 fixed movement samples,
approximately 59.9 commands/sec, seed 918271, snapshots/ordinary systems enabled, no save triggered
during the short capture. These are steady transport samples, not streaming/autosave acceptance.
Native PIE used the normal seven-settlement/127-resident playable world and existing streamed assets.

| Measurement, ms | n | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| Starting `3c1c876`: packet-result RTT (receipt only) | 240 | 0.275 | 2.216 | 4.631 |
| Starting `3c1c876`: first advancing snapshot ack age (last-received proxy) | 33 | 17.055 | 52.193 | 108.970 |
| New loopback authoritative application RTT | 240 | 30.722 | 32.578 | 38.823 |
| New 30 ms RTT + 8 ms jitter application-delay proxy | 240 | 62.898 | 78.661 | 92.229 |
| New 60 ms RTT + 8 ms jitter application-delay proxy | 240 | 93.929 | 109.921 | 123.308 |
| New 120 ms RTT + 8 ms jitter application-delay proxy | 240 | 157.093 | 171.980 | 185.775 |
| Native predictor CPU, including command serialization/send | 1931 | 0.0500 | 0.0686 | 0.0786 |
| Native input callback → engine predicted state | 60 | 0.1518 | 0.1905 | 0.2196 |
| Native command → applied receipt, PIE | 1931 | 37.802 | 54.825 | 72.528 |
| Standalone startup: native predictor CPU | 215 | 0.0515 | 0.0700 | 0.0812 |
| Standalone startup: input callback → engine predicted state | 20 | 0.1482 | 0.2306 | 0.2624 |
| Standalone startup: command → applied receipt | 221 | 51.636 | 119.634 | 201.610 |

The starting version was measured from a read-only `git archive` of the exact starting source,
with the same real WebSocket harness; it was not reset into the working branch. It has no applied
receipt, so baseline authoritative application RTT is **unmeasured**, not zero. Empty distributions
in that JSON have `count:0`; do not compare them as 0 ms latency or call its received frontier confirmed.
The native-before input-to-state/display path was not measured. Before/after sample counts and
definitions differ where the old protocol lacks an equivalent metric.

All 960 v2 commands applied, with zero rejects or sequence regressions. Loopback server queue
p95 was 31.589 ms; event-loop p95 17.809 ms at a requested 10 ms monitor resolution. Four scheduler
overruns occurred in that short run. Timing quantization and sample backlog remain relevant; the
30 ms application target **misses** both headlessly (32.578 ms) and in PIE (54.825 ms). The 2 ms
local predictor CPU target passes in this capture. No displayed-response target is claimed.
Nominal impairment values are configured delay, not an assertion that timers deliver exact RTT;
the reported result includes measured callback scheduling, asymmetric jitter and bridge work.

Native input capture passed movement and stopped-tail assertions: 589 frame samples over 9.812 s,
14.387 m cumulative travel, maximum frame displacement 8.592 cm. Nonzero-frame average was
approximately 61.7 FPS and maximum frame delta 32 ms. Editor background CPU throttling was disabled
transiently and t.MaxFPS set to 60; defaults were restored before closing. Earlier 3 FPS background
captures correctly hit the 250 ms prediction stale guard; they are not accepted responsiveness evidence.
Prediction correction p50/p95/p99 was 0 cm over 1934 samples in this ordinary movement capture.
This does not establish behavior for unseen moving blockers or contested combat.
The PIE Python recorder requested diagnostic distributions each frame; its observer overhead is
included in frame/transport results. The standalone probe samples positions each frame and requests
the distributions once at completion. Neither capture is an uninstrumented performance claim.

The separate standalone `-game` capture passed 10 movement/sprint bouts and released-tail
stopping, with 30 native key dispatches and 215 frame samples (7.889 m cumulative travel).
Frame-delta p50/p95/p99 was 16.623/18.154/38.392 ms over 214 non-initial samples;
correction p50/p95/p99 was 0 cm over 228 samples. It used the same 127-resident world at
1280×720 with a 60 FPS cap. The machine had 17% CPU load and 17.8 GiB free before launch;
compilation and the full suite had finished. This short capture includes game startup and
regional streaming, not a settled shipping workload. Its application RTT p95 of 119.634 ms
is a further target miss. It runs a standalone world in the Development editor binary, not
a packaged Shipping build. Engine Toolset Python plugins also emitted startup errors in
`-game`; the native bridge and probe still completed. No display timestamp claim follows.

- Targeted regression: 35/35 tests across protocol, session, bridge, movement and persistence,
  after fixing a test fixture that incorrectly expected a tiny saved grid to survive village regeneration.
  Final strengthened realtime/parity group: 13/13 passed.
- TypeScript typecheck and production build passed (124 modules).
- UE 5.8 Development editor target built. Six native automation tests passed: three choreography,
  two humanoid parser/queue, one movement predictor. After strengthening the common JSON trace
  assertions, the predictor test passed again at 0.00001 m/radian tolerance. A test-only uninitialized
  pointer compile diagnostic was corrected before that pass.
- Native automation runs used NullRHI; this does not move canonical authority into Unreal.
- Actual native automated input passed in PIE. Hand interaction dispatch is recorded, but that
  native trace does not prove pickup; once-only pickup/rejection is established by session tests.
- Existing humanoid/PCG assets are unchanged. Their prior full visual/PCG evidence remains baseline;
  five-seed PCG and full 19/93-scenario visual suites were not rerun. No human playtest/approval,
  displayed-frame timestamps or continuous video was captured. Standalone rendered `-game`
  engine-state latency was captured separately as described above.
- Full canonical suite: **821/821 tests in 82/82 files passed**, 1,372.14 seconds,
  `npm test -- --maxWorkers=1 --reporter=dot`, with Unreal and benchmark workloads stopped.
  Final typecheck and generated-spec freshness check also passed.
- Worker A performed one independent final correctness review after testing. It reported a
  medium-risk presentation discrepancy at automatic doors: canonical movement opens the door,
  but prediction stops until updated geometry arrives. Root retained this as the explicit
  conservative door policy, rather than predicting traversal through server-closed geometry.
  The resulting short stop/correction is a known limit, not a parity pass for dynamic doors.
  The review reported no other findings. No production source changed after the full suite.

Remaining delivery limits are the live-combat milestone itself, the acknowledgment target misses,
legacy Ashford scene framing, additional ownership/possession cases, actual congestion/failure
testing, and representative long streaming/autosave load. No full milestone completion claim is made.
