# Camera-facing combat refinement — bounded playtest delivery

2026-09-12. Feature branch `codex/realtime-interaction-v0-1`; base
`947761b7fabaace442ed1920f123d008495db28f`. This extends the accepted prediction,
canonical contact and reconciliation architecture. It is not full milestone acceptance.
Implementation and owned assets: `f0b2b79f48052b15895254a8da820cf9a207df9d`.
The task-owned server was stopped after verification; the launch command starts current source.

## Controls and arena

From `C:/Users/green/Desktop/projects/torn-veil-online`:

```powershell
pwsh -File unreal/scripts/Start-CombatArena.ps1 -Port 53636
```

The task's isolated server uses port 53636. Earlier servers on 8791 and 8793 were
left alone. An older server rejects the new interaction specification; use a free
port if restarting elsewhere. One rendered client/editor at a time.

- Mouse/right stick: desired facing and camera; pitch affects only the view.
  WASD/left stick: forward, backward, strafe; diagonals normalize. Shift/left-stick
  click: forward sprint. Backward/sideways travel retains directional locomotion.
  Wheel zoom and camera collision remain.
- LMB/RB: Light; RMB/RT or Y: Heavy. The trigger fires at 0.65 and rearms below
  0.25. First Heavy selects the retained front kick. Another Heavy after its legal
  recovery gate selects the new round kick only in the labeled arena repertoire.
- Space/B with movement direction: frozen directional dodge; neutral: backstep.
- Hold Ctrl/LB: crouch; release: stand when clearance permits. Slow movement is
  allowed. Attacking or stepping first uses a 0.22-second standing transition.
- F1/D-pad left: passive; F2/D-pad right: scripted incoming; F3/Menu: reset/recover,
  preserving the selected mode with a two-second opponent countdown.
  F4/D-pad up: Practice Recovery / Normal Physiology.

The countdown delays the scripted opponent; the player can practice immediately.
This is a practice controller, not a claim of complete autonomous fighting intelligence.

## Canonical mechanics and timing

Facing is optional bounded intent in the shared TS/native movement kernel (720 degrees/s).
Omitting it preserves NPC travel-facing defaults. Committed attacks retain their existing
tracking limits. All displacement, hurt geometry, active relative sweeps and consequences
remain TypeScript-owned at 60 Hz, with contact intervals divided at most every 1/120 s.

| Move | Preparation / active / recovery (seconds) | Next attack | Step | Movement |
|---|---|---|---|---|
| Previous unarmed timing | .30 / .15 / .30 | .48 | .51 | .75 |
| Jab | .26 / .15 / .27 | .43 | .47 | .49 |
| Cross | .28 / .15 / .29 | .47 | .49 | .53 |
| Front kick | .30 / .15 / .30 | .63 | .65 | .65 |
| New round kick | .32 / .20 / .28 | .70 | .70 | .70 |

Gate times are ages from startup. The kick gates leave time to replant the support stance.
Steps retain .24-second travel and .12-second recovery, chaining after travel; distance
remains .65 m directional / .55 m neutral retreat. No invulnerability or increased world
movement speed. Sprint source root displacement measures exactly 1400 cm over 2 s;
700 cm/s remains the cadence reference. Lower capability can still slow actual movement.

`combatRepertoire.json` records supported source/destination gates, support/recovery
conditions and resulting stance; its move definitions generate the native table. The
coarse support check requires grounding, with authored phase gates providing replant time;
this is not a dynamic balance solver. Light selects jab/cross deterministically. Exactly
one expiring/replacing follow-up is allowed, at most .25 s before a legal gate. All checks
run again at startup. No automatic sequence, randomized kick choice or technique grant.

New actions carry semantic `moveId` and repertoire revision 1. Original baked contact data
and timing constants remain for older saved actions lacking that revision. Round geometry
is separate immutable revision 1 data, sampled from `foot_r`, not a reused front-kick ray.
Future changes must retain these versions instead of silently reinterpreting saved actions.

Held posture stores only the canonical amount on the body. A disposable .25-second input
lease is refreshed by sequenced movement heartbeats; release, interruption, focus loss,
reset, reconnect and lease expiry release intent. Queued crouch release clears its queue.
Holding costs .012 once on entry, not a dodge each frame. Hurt volumes move continuously
with posture. The collision kernel checks footprint clearance before growing the posture;
the fractional-clearance TS/native test explicitly exercises the kernel, while the current
arena's whole-metre voxels provide limited low-ceiling arrangements. No blanket duck immunity.

## Motion provenance and transitions

Owned derivatives are under `/Game/TornVeil/Combat/Refinement/`:

- `A_TV_JabRefined`: retains the approved jab's body/left-foot tracks. The right-foot
  orientation was already distorted in the retargeted/baked stage. Its derivative uses
  the source rear-foot pivot relative to Manny's neutral sole orientation. The live layer
  releases the right-foot constraint; remaining foot IK is bounded to 3 cm.
- `A_TV_RoundKick`: installed Motifect `roundhouse_kick_left_Anim`. Despite its filename,
  the actual striking effector is **right foot**, with left support/pivot. Fixed authoring
  yaw and source trim .78–2.65 s produce the .80-second non-spinning body sweep. No mirroring.
- `A_TV_CrouchEnter`, `CrouchIdle`, `CrouchMoveF/B/L/R`: selected UEFN standing transition,
  idle and four crouch loops. The guard overlay retains the source hips/knees/spine/neck.

The cross, front kick, walking, existing steps, sprint, hit and downed assets are unchanged.
Vendor content and GameAnimationSample were read only. Four additional crouch reference
packages were copied locally for authoring; they are not part of this commit. Owned
intermediates and the focused `refine_combat_motion.py` script reproduce the derivatives.

The live graph snapshots the evaluated starting pose, blends into the full-body motion,
and returns to the actual directional locomotion/posture. Clip sample-time mapping tightens
the punch startup/recovery while preserving active contact samples. Canonical actor motion
is never extracted from clips or doubled by blending. Presentation cannot manufacture a hit.

## Practice physiology

Costs were applied once at canonical acceptance; no duplicated replay charge was found.
The arena profile scales accepted combat effort to 40% for both participants and recovers
fatigue at .035 per authoritative second after 1.5 s without a hit/action, while still and
out of an active action. NPC rest clears stale velocity. HUD shows both fatigue values,
mode, readiness and the conditional quiet recovery rate. Normal Physiology has original
costs and no arena recovery. Profiles are disposable world adapters and are not saved.
Recovery does not heal injuries, alter hunger/hydration/sleep, or advance world time.
F3 remains the explicit reset that heals the practice fixture. Long-term fatigue still
serves as combat effort; a future separate short-term exertion design may be warranted.

## Verification and limits

Focused coverage currently totals 116 TypeScript tests across combat refinement, responsive
combat, practice, contact lifecycle/geometry, foundation, interaction, session and protocol.
Typecheck and web build pass. Native build and nine targeted `TornVeil.Realtime` tests pass.
The ordinary-input probe covers movement/strafe, frozen steps, light/light/heavy,
heavy/heavy/light, punch-to-step, held crouch/movement/release, released queued crouch,
camera turning during commitment, incoming practice/reset and physiology toggles.

Continuous capture and final callback/pose measurements are recorded alongside this report
in `docs/evidence/combat-refinement/`. Raw frames, probes and logs stay under `.debug/`.
Capture uses an external verification camera, with a front oblique to avoid opponent
occlusion, plus side and rear views. Human playtest approval is still required.

The three videos contain about 24 continuous seconds each, at 9.01/9.15/9.15 captured
frames/s respectively. FFmpeg preserves the recorded wall-clock frame durations; no speedup
or synthesized frames. The 60.08-fps uncaptured run records native input callbacks alongside
evaluated mesh samples: six immediately eligible inputs changed the evaluated effector pose
in 18.37–18.66 ms (median 18.50 ms). Observed action-state delay was 1.83–11.40 ms. Five
buffered transitions had 10.0 ms median / 13.33 ms p95 lateness beyond their legal gate;
their total callback-to-observed-state waits were 102.8–185.9 ms, including commitment.
These are engine mesh observations, not physical input-to-photon or a statistical latency
benchmark. Evidence encoding overlapped part of that run; measured game FPS is disclosed.
The previous checkpoint reported input-to-state function timing, which is not comparable
to this new callback-to-evaluated-pose measurement. Its original .30/.15/.30 phase timing
is the explicit gameplay baseline above.

Final small-run combat applied-ack p95 was 10.72 ms (5 samples); contact-decision-to-native
presentation p95 1.12 ms (3). Combat correction distance p50/p95/p99 was effectively zero
(1128 samples); two settle samples were 14.88 and 123.13 ms. Full distributions/counts are
in `live-summary.json`. This does not replace wider transport or adverse-network acceptance.

The diagnostic that compares this frame's action age with the last evaluated foot can show
up to 38.5 cm error on the fast round kick. Comparing the evaluated foot to the preceding
frame's requested pose reduces that to a 3.02 cm mean / 8.09 cm maximum (12 active samples),
consistent with the one-frame evaluation delay. Both measurements are retained; this is
coarse contact geometry, not exact surface alignment. Cross/front-kick assets are preserved.

Final follow-up tests also check charging a new crouch after a stale lease expires and
matching the exhausted HUD threshold to the opponent's actual rest gate. The videos precede
those two small TS fixes; their affected 24 tests and typecheck pass afterward.

Reproduction:

```powershell
npm exec -- vitest run tests/combat-refinement.test.ts tests/responsive-combat.test.ts tests/combat-practice.test.ts tests/realtime-combat-action.test.ts tests/realtime-combat-geometry.test.ts tests/combat-foundation.test.ts tests/interaction-coherence.test.ts tests/realtime-session.test.ts tests/realtime-protocol.test.ts
pwsh -File unreal/scripts/Run-ResponsiveCombatProbe.ps1 -Port 53636 -Refinement -Capture -Output .debug/refinement-capture
pwsh -File unreal/scripts/Run-ResponsiveCombatProbe.ps1 -Port 53636 -Refinement -Output .debug/refinement-live
```

No full-suite command was executed. The eventual authorized full regression can be saved with
`npm test *> .debug/combat-next-full-regression.log` from the repository root.

No full regression ran. Historical full-suite status remains 851/852, with the unresolved
family trace unchanged: injury knowledge arrives, no care plan executes, competing priorities
explain most decisions, the 17-world-hour purpose-formation delay remains unexplained, and
no production fix has been justified. Caregiver experiments and earlier evidence stay local.
No learning/wildlife work, full mastery system, extra kicks, swords, anatomy or networking
rewrite is included. Rendered two-client PvP and broader milestone acceptance remain open.
