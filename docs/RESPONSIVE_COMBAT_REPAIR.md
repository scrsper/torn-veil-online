# Responsive combat and animation repair — human playtest checkpoint

2026-09-12. Branch `codex/realtime-interaction-v0-1`; base `31051ec`.
This bounded repair extends the accepted movement and live combat architecture.
It is not full milestone acceptance. No family investigation or full regression ran.

## Behavior and boundaries

- LMB/light punch and RMB/heavy unarmed kick work with no selection, a distant or lost
  selection, or an obstructed target. Startup checks actor capability, commitment,
  equipment and effort. Selection supplies only the existing bounded aiming hint.
  Active relative sweeps still enforce walls, contact eligibility and once-only damage.
- Space samples the remapped movement keys/stick immediately in camera space, applies
  a 0.2 dead zone, normalizes diagonals and freezes that direction. Neutral Space retreats.
  Forward/diagonal requests move canonically; the closest body-relative cardinal clip is
  selected. Moving before dodging can turn the body, so a camera-right request can use
  the forward performance. No invulnerability was added.
- Steps travel 0.65 m (directional) or 0.55 m (neutral retreat) with smooth acceleration
  over 0.24 s, followed by 0.12 s recovery; effort is 0.035. Collision constrains travel.
  Duck uses an authored entry, lowered hold and recovery over 35/60 s.
- Attacks retain 0.30 s preparation, 0.15 s active contact and 0.30 s recovery. A new
  attack may replace recovery at age 0.48 s; a step at 0.51 s. Steps may transition at
  0.24 s. Duck and interrupted actions retain their recovery gate. One replacing input
  may wait up to 0.25 s; an overly early press clears the older pending input. Every new
  startup revalidates eligibility and charges once. Cancellation/reset clears pending input.
- Local input sends the sequenced command immediately and starts prediction or the one
  follow-up without waiting for confirmation. Authority binds the existing cursor and
  reports its pending command identity. Save/load validates and retains the canonical
  pending action deterministically. Movement replay still has no combat consequences.
- The six coarse hurt volumes remain authoritative. Versioned authored knuckle/foot
  samples define unarmed contact paths; head displacement samples define duck posture.
  TypeScript owns evaluation at 60 Hz with relative sweeps split at most every 1/120 s.
  Unreal reads generated matching constants; it never decides contact. Future motion
  revisions must preserve saved action definitions, rather than replacing their meaning.

## Animation provenance and repair

Final assets are `/Game/TornVeil/Combat/Repair/Animations/A_TV_` plus the names below.
The full-body derivatives, selected intermediate animations and owned retarget rigs are
delivered; vendor packages were not modified. Four named GameAnimationSample animations
and their two skeleton/mesh dependencies were temporarily made available for authoring.
Those six reference packages are local only, not a wholesale content migration.

| Final name | Selected source / purpose |
|---|---|
| `Jab` | Motifect `jab_left_Anim`, left knuckle `middle_01_l` |
| `Cross` | Motifect `cross_right_Anim`, right knuckle `middle_01_r`; legacy variant ID `hook` |
| `Kick` | Motifect `front_kick_Anim`, right foot `foot_r` |
| `StepLeft`, `StepRight` | Motifect `dodge_left_Anim`, `dodge_right_Anim` |
| `StepBack`, `StepForward` | Manny `MF_Unarmed_Walk_Bwd`, `MF_Unarmed_Walk_Fwd`, trimmed and retimed |
| `Duck` | UEFN `M_Neutral_Transition_Stand_to_Crouch`, `M_Neutral_Crouch_Idle_Loop`, `M_Neutral_Transition_Crouch_to_Stand` |
| `Sprint` | UEFN `M_Neutral_Sprint_Loop_F` |

The existing hit reaction remains `/Game/TornVeil/Characters/Animations/A_TV_HitReact_Front`.
Walking/jogging retain `BS_Idle_Walk_Run` and its existing speed mapping. Sprint originally
failed to select because exerted speed (about 520–550 cm/s) fell below the 610 cm/s gate.
It now follows sprint intent/canonical run pose, timed to actual speed; movement speed did
not change. The source sprint reference is 700 cm/s.

Source pose samples, retargeted poses and final native motion isolated three distortions:
the source legs are `leftleg/leftshin/leftfoot` (and right), not `leftupleg`; copying the
source hips into Manny root applied hip transforms twice; positional Python `Rotator`
arguments applied pitch when an authored yaw was intended. The owned rig now checks chain
endpoints, disables that root-motion operation, and uses explicit yaw. Fixed authoring yaw
aligns each punch with actor-forward before baking its contact path; it never follows a target.
Motifect's `dodge_back` candidate was rejected as a stationary slip.

Non-attack live choreography now has full motion weight. Pelvis-only duck and foot-directed
punch IK were removed. Foot IK is capped at 3 cm, clips carry full-body articulation, and
canonical displacement owns root travel. Compatible transitions briefly blend from the
previous pose instead of forcing idle. Existing style profiles, FX, reaction and LOD remain.
The exact trims, timing knots and effectors are in [the manifest](evidence/responsive-combat/animation-manifest.json).
Authoring scripts: `retarget_combat_repair.py`, `retarget_combat_sample.py`, `bake_combat_repair.py`
under `unreal/scripts`; then run `npx tsx scripts/generate-interaction-spec.ts`.

## Arena and controls

From the repository root:

```powershell
pwsh -File unreal/scripts/Start-CombatArena.ps1 -Port 8791
```

WASD move; Shift sprint; mouse orbit; wheel zoom; Tab select; LMB punch; RMB kick;
Space + movement direction dodge (neutral backstep); Left Ctrl duck.
F1 passive target; F2 repeated incoming attacks; F3 reset/recover, including when downed.
The HUD labels scripted practice, readiness, phase and last contact/rejection. The arena
camera and HUD leave the whole stance visible. Reset retains the last historical contact label.
Repeated practice approaches and attacks through ordinary canonical movement/combat; it is
explicitly a practice controller, not a new NPC cognition policy.

For a reproducible automated ordinary-input recording, use a server-only arena in one
terminal (close any existing rendered client), then the probe in another:

```powershell
pwsh -File unreal/scripts/Start-CombatArena.ps1 -Port 8791 -ServerOnly
pwsh -File unreal/scripts/Run-ResponsiveCombatProbe.ps1 -Port 8791 -Output .debug/combat-repair-probe -Capture
```

Omit `-Capture` for the uncaptured timing run. It exits after the bounded sequence and
writes `probe.json`; screenshot timestamps must be preserved when encoding video.

Controller: left stick move, right stick camera, RB punch, RT kick, B dodge, LB duck,
left-stick click sprint; D-pad left/right passive/repeat; Menu reset. Semantic actions/axes
are remappable through Unreal Input Settings. Hardware controller playtesting is pending.

## Focused evidence

[Normal-speed gameplay](evidence/responsive-combat/gameplay-normal-speed.mp4), 19.5 s, shows
free/distant-selection punching; right → right → left → punch → punch → backstep;
light → light → heavy; repeated incoming attacks, duck and reactions; walk/sprint and reset.
All 14 requested actions appeared, no long follow-up queue remained, and choreography moved
the actor by 0 cm. The first incoming punch missed after duck; the next hit the standing player.
The captured run uses actual screenshot-request timestamp intervals, not fixed-fps speedup.
Screenshot work reduces cadence to roughly 10–11 fps; this video is not a smooth-60-fps claim.
Jab, kick, duck and sprint stills accompany it. See [curated results](evidence/responsive-combat/results.json).

One uncaptured ordinary-input run had frame intervals p50/p95/p99 16.65/17.27/17.56 ms.
Input dispatch to first observed startup for the seven unbuffered actions was 16.67–26.44 ms.
Callback → predicted attack/defense p95 was 0.0418/0.0464 ms (4/3 samples).
Buffered input → startup p50/p95 was 133.66/183.58 ms; this is intentional commitment waiting.
Buffered transition lateness p95 was 10 ms, within the 60 Hz step.
Observed successive step/step/step/punch gaps were 249.76/250.05/250.04 ms; punch chains
482.99–483.69 ms; attack → backstep 516.46 ms. All seven chain pairs had zero idle frames.
Whole-run gap percentiles include deliberate pauses and must not be interpreted as chaining delay.

Combat applied round-trip p95 18.02 ms (7 samples); received-contact → presentation p95
0.64 ms; clock-aligned contact decision → presentation p95 5.19 ms (5 contacts, clock
uncertainty about 0.35 ms). Combat correction p50/p95/p99 was 0/0/~0 cm (1,138 samples);
one nonzero settle sample was 15.51 ms. This loopback sequence does not establish a broad
blocked-correction distribution. The focused collision/replay tests cover that wrong prediction.
These are engine observations and software timing, not hardware input-to-photon or human approval.
The timing run preceded the arena camera widening and an added contact guard for an already-deceased owner; its living-actor input and contact paths were unchanged.

## Verification and open work

85 focused TypeScript tests across nine files passed at their latest relevant runs:
`responsive-combat`, `combat-practice`, `realtime-combat-action`, `realtime-combat-geometry`,
`combat-foundation`, `combat-presentation`, `realtime-session`, `realtime-protocol`, `bridgeCombat`.
Coverage includes free/entering-target contact, once-only costs and effects, buffer replacement,
expiry/interruption, collision, frozen diagonals, duck vs high/kick, save/load, pickup,
movement/sprint and epochs. Obsolete admission assertions moved to active miss/contact assertions.
An autonomous wall-test defender legitimately dodged; that physical fixture now explicitly
controls the target. Save/load comparison uses a complete restored population baseline.
No production NPC priority change or unrelated assertion weakening was made.

`npm run typecheck`, `npm run build`, generated-spec check and Unreal Development Editor
build pass. Eight `TornVeil.Realtime` native tests pass. The last native source edit only widens
the arena camera; its subsequent build and rendered probe pass. Raw focused logs remain under
`.debug/repair-*`; summarized provenance is in `verification.json` beside the video.

Remaining: human judgment of stance, weight transfer and transitions; dedicated diagonal
clips and a purpose-built retreat instead of the retimed walk candidate; controller hardware
exercise; smoother external video capture; broader network/two-rendered-client acceptance.
No full regression ran. The last full suite remains **851/852**, with unresolved family care:
injury knowledge arrives, no care plan executes, competing priorities explain most decisions,
and the 17-world-hour purpose-formation delay is unexplained. No family production fix is justified.
Its uncommitted experiment and prior raw evidence are preserved. No merge or PR.

Next action: human playtest this bounded repair before any further implementation milestone.
