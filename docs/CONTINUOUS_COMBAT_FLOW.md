# Continuous combat flow v0.3 — human playtest checkpoint

Branch: `codex/realtime-interaction-v0-1`. Base: `53901d59403750b611ca6b0dbcb8301edc98f83f`.
Implementation: `7fd8f1087bc19e59bedc59c3245616ce154fd98b`.
This is a bounded polish checkpoint, awaiting human playtest, not full milestone acceptance.

## What caused the reset

The existing transition did capture a pose, but incoming clips always began at sample zero and reached full weight in 40 ms. That exposed the clips' neutral bookends. The timeline also faded toward idle during its last 90 ms, followed by a separate locomotion handoff. Foot IK used a fixed knee pole that could change leg orientation even when its foot goal already matched. A compatible chain often never entered the locomotion graph: its visible reset was inside the incoming clip/blend.

The full existing Motifect source inspection showed a static lead-in before approximately 0.95 s, support-foot pivot/chamber from about 1.0–1.45 s, and recovery/replant continuing beyond 2.65 s. The old round-kick map compressed 1.88–2.65 s into 0.28 s and ended before the support foot settled. The source named `roundhouse_kick_left_Anim` actually supplies the right-foot strike used here; it is not mirrored.

## Implementation and preserved boundaries

`TVCombatAnimInstance` retains the last two evaluated local poses. At a new action serial it forms translation/rotation residuals against the incoming pose, including a bounded outgoing-minus-incoming velocity term. The residual starts at the outgoing pose and reaches zero with zero residual velocity before active contact. This is not an extended idle crossfade. Durations are 140 ms for punches/front kick, 180 ms for round kick, and 100 ms for steps, shortened for late authoritative observations.

Compatible attacks inherit one left support point. The leg solver preserves its evaluated knee plane, allows foot rotation/pivot, excludes the striking/rear foot, forbids limb stretching, and bounds the chain correction to 25 cm. Ordinary IK retains its 3 cm cap. The plant releases in final recovery. Steps release the attack plant for their canonical displacement. No actor/capsule or camera transform is changed by pose flow. The measured presentation-induced actor drift is zero.

The custom anim instance is retained across actions. Ordinary acknowledgment preserves the serial and cursor; a genuinely different authoritative move changes the pose target at the retained cursor. Live recovery no longer fades through idle. With no successor, the existing evaluated-pose handoff returns to locomotion.

New owned assets under `Combat/Flow/Animations`:

- `A_TV_JabChain`: source sample 0.14 → 0.30 during preparation; original 0.30–0.45 active interval; recovery ends at source 0.68.
- `A_TV_CrossChain`: source sample 0.12 → 0.30 during preparation; identical original active interval; recovery ends at source 0.68.
- `A_TV_RoundKick`: new nonuniform timing below. Chained startup begins at owned sample 0.12.

Standalone approved cross/front kick, the repaired jab/rear-foot source, walking, sprint, crouch, directional step, and hit/downed assets are unchanged. No moves were added. `bake_combat_flow.py` reproduces only the three owned derivatives. Its frame count respects the source's 30 Hz compression intervals while baking 60 Hz keys.

Canonical TypeScript still owns lifecycle, costs, commitment, collision, swept contact and consequences. New repertoire revision 2 freezes round-kick timing and uses `combatRoundMotionV2.json`, sampled from the owned right-foot active path. Revision 1 definitions/curves remain intact for saves. Interaction handshake revision is `tv-interaction-5`. One executed `priorStrike` may pass through one step, allowing jab → dodge → cross; another step, expiry or interruption ends that history. It is persisted and projected execution history, not a combo queue. The existing single buffered input and eligibility checks remain.

| Round-kick interval | Previous | Revised |
|---|---:|---:|
| Preparation | 0.32 s | 0.42 s |
| Active | 0.20 s | 0.28 s |
| Recovery | 0.28 s | 0.50 s |
| Earliest attack successor | 0.70 s | 1.08 s |
| Earliest step/movement | 0.70 s | 1.10 s |

New owned-time → source-time knots: `0→0.95`, `0.18→1.18`, `0.42→1.45`, `0.70→1.90`, `0.92→2.20`, `1.20→2.90`. These separately allocate time to pivot/chamber, strike, follow-through and replant.

The spring arm now follows resulting body yaw, including canonical commitment, rather than freely following control yaw. Mouse/right stick still requests desired facing; pitch remains view-only. Travel uses the displayed body/camera basis. Zoom, collision and positional camera lag remain. The captured committed turn measured 0° camera/body yaw difference while desired facing differed by up to 6.56°.

## Evidence

[Continuous BEFORE](evidence/combat-flow/before-continuous.mp4), [continuous AFTER](evidence/combat-flow/after-continuous.mp4), [jab → cross comparison](evidence/combat-flow/jab-cross-comparison.mp4), [front kick → round kick comparison](evidence/combat-flow/front-round-comparison.mp4), [all transition diagnostics](evidence/combat-flow/transition-diagnostics.json).

Both captures use ordinary input callbacks and one buffered successor. The first six four-second segments show jab → cross → jab; jab → cross → front kick; front kick → round kick → jab; dodge → jab → cross; jab → dodge → cross (BEFORE selects jab after dodge); movement → attack → movement. AFTER adds a four-second actual shoulder-camera check. The six action segments use the same side verification camera with feet visible. The first BEFORE capture includes an extra action without a probe-recorded press in the tail of segment two; it is retained in the raw sequence record and video, and is not used for either required comparison. This pass does not claim the cause of that isolated input.

| Comparable rendered measurement | Jab → cross BEFORE / AFTER | Front kick → round kick BEFORE / AFTER |
|---|---:|---:|
| First observed body angular RMS | 33.37° / 4.23° | 48.95° / 4.29° |
| Largest frame angular RMS, first 200 ms | 36.67° / 21.17° | 45.83° / 29.34° |
| Largest support-foot frame movement, first 200 ms | 24.29 / 1.86 cm | 7.80 / 0.24 cm |
| Largest pelvis frame movement, first 200 ms | 12.87 / 4.28 cm | 16.72 / 4.09 cm |
| Weighted inspected neutral lead-in samples | 3 / 0 | 4 / 0 |
| Inserted locomotion frames | 0 / 0 | 0 / 0 |

AFTER native evaluation additionally measures the exact handoff: body angular RMS, pelvis/root translation and support-foot displacement are zero to the recorded precision in all captured compatible handoffs. Raw incoming mismatch remains measurable (25.50° jab → cross; 17.05° front kick → round kick); the residual carries it instead of snapping to it. These exact native metrics were added after the baseline and must not be confused with the comparable viewport-frame measurements above.

The 200 ms windows include natural motion, outgoing step motion and capture frame stalls; they are not pure discontinuity or latency measurements. Step-related foot motion is larger because a step releases the plant. The complete JSON includes every observed pair, pelvis/root angular motion, frame intervals and transition durations. Neutral counts refer to inspected source bookend ranges and requested pose weight, not a general bone-based idle classifier.

BEFORE has 548 captured frames over 24 seconds; AFTER has 631 over 28 seconds, approximately 23 captured fps. MP4s use recorded wall-time intervals at a 30 fps delivery cadence, including repeated frames; neither side is sped up. Raw BMPs and full logs remain ignored under `.debug/flow-*`. No new latency benchmark or input-to-photon claim is made.

## Verification and playtest

72 unique focused TypeScript tests passed across the affected runs: seven files initially passed 71 tests, then the final five-test flow file passed with one added malformed-history case. The affected files are `combat-flow`, `combat-refinement`, `responsive-combat`, `realtime-combat-geometry`, `realtime-combat-action`, `combat-presentation`, and `combat-practice`. Typecheck, web build, generated-spec check, native Editor build and all 10 `TornVeil.Realtime` native tests pass. Native testing initially caught floating-point cancellation near the residual endpoint; the polynomial was factored and the test passed without weakening its tolerance. No full suite was run.

From `C:\Users\green\Desktop\projects\torn-veil-online`:

```powershell
pwsh -File unreal/scripts/Start-CombatArena.ps1 -Port 59414
```

W/S forward/back; A/D strafe; mouse yaw desired facing, pitch look; wheel zoom; Shift forward sprint; LMB punch; RMB front kick, then one timely RMB round-kick successor in the arena; Space plus direction dodge, neutral Space backstep; hold Left Ctrl crouch. F1 passive; F2 repeated incoming; F3 reset (retains mode); F4 Practice Recovery/Normal Physiology. Each press supplies one action; no automatic combination.

Controller: left stick move/strafe, right stick face/look, RB punch, RT or Y kick, B directional dodge, LB hold crouch, left-stick click sprint; D-pad left/right passive/repeated incoming, up physiology; Menu reset.

For reproduction, launch the server with `-ServerOnly`, then `Run-ResponsiveCombatProbe.ps1 -Port 59414 -Flow -Capture -Output .debug/flow-review`. Run `python scripts/combat-flow-evidence.py BEFORE_DIR AFTER_DIR OUTPUT_DIR` with ffmpeg on PATH to encode at recorded wall time.

Human approval and the absence of every perceptual foot artifact remain unverified. The 25 cm support constraint is intentionally bounded, not a general foot-placement or Motion Matching system. The first source pose is carried, but later motion still has finite angular change. No rendered PvP, wildlife, family, martial-learning, PCG validation, full regression, merge or PR was undertaken. The historical full-suite checkpoint remains 851/852 with the unresolved family trace; this pass does not close it. Existing unrelated tracked/untracked work is preserved locally.

Next step: human playtest these six sequences at normal speed, especially round-kick weight, step → punch footing, and the constrained shoulder camera. Further tuning should follow that feedback.
