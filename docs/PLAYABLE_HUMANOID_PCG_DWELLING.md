# Playable humanoid and PCG dwelling phase

## Repository

Canonical checkout: C:/Users/green/Desktop/projects/torn-veil-online.
Branch: astra/playable-humanoid-pcg-dwelling-v0-1.
Starting HEAD: 410a0a7781b995cd3008ab40dcd425dd354749b7, merged asset-pack PR #36.
Origin: https://github.com/scrsper/torn-veil-online.git.
A fresh fetch confirmed starting HEAD equalled origin/main before branching.

The older Documents checkout (6ebb93f) was inspected only during identity resolution,
including its existing untracked art inventories. Implementation and compact catalogs
use only the canonical Desktop checkout. GameAnimationSample remains separate/read-only.

## Parallel ownership and integration

Worker A handled native humanoid code, parser/tests and acceptance scripts.
Worker B handled PCG recipe/graph scripts, owned graph assets and the isolated level.
Root owned canonical counters/bridge, shared contracts, integration, tests and Git.

The workers prepared non-conflicting code concurrently. B held the first exclusive
editor-write lease, followed by A for native verification. After worker usage limits
ended their work, root completed native fixes, rewrote the dwelling into real PCG
construction, measured it and ran final live acceptance. One editor and one binary
asset writer were used at a time. No vendor packages or Ashford assets were saved.

## Bridge contract

[HumanoidVisualState](../src/bridge/visualState.ts) is a renderer-neutral projection
shared by ordinary/developer snapshots. Ordinary visibility remains perception-gated,
with explicit present checks and bodyId manifestation identity.

- attackSeq counts accepted physical swings on the attacking body, including untargeted
  swings. Rejected attacks do not increment it.
- hitSeq counts applied hits on the receiving body. Direct hit application never
  invents a swing. Protected/dead targets do not increment.
- Counts advance in canonical shared combat resolution. Events carry both body IDs
  and the resulting counts. New saves preserve counters across event-log compaction.
- Legacy v24 saves lacking counters establish zero baselines; compacted history cannot
  reliably recover manifestation counts. Invalid saved counters are rejected.
- lastAttackAt/lastHitAt remain useful for canonical recovery and recency.
- speed means actual horizontal velocity magnitude in metres/second. sprintMultiplier
  was removed from both visual projection paths: Unreal only needs actual movement.

No animation paths, cognition, AI goals, hidden intentions or Unreal state were added.

## Humanoid result

The same ATVCharacter represents possessed and NPC manifestations. Typed validation
precedes projection; possession follows controlledBodyId, and removal uses bodyId.
Manny Simple uses the existing SK_Mannequin family and project idle/walk/jog Blend Space.
Its direction/speed axes are now wired correctly. Native movement authority remains
disabled; transform interpolation and brief canonical-velocity reconciliation are
presentation only. Native input sends existing simulation intent requests.

Canonical attack/hit counters drive bounded four-event replay queues, with explicit
overflow/cancellation diagnostics and clip-duration playback. Downing overrides
locomotion; a canonical NPC action bug that prematurely erased downing was fixed.
Two owned animation derivatives bake the additive hit onto idle and extend the short
death lead-in into a held prone pose. Bone evaluation continues outside the camera;
live diagnostics measure the terminal pose as well as the selected clip.
Death currently withdraws the canonical manifestation, so the actor is removed
immediately; persistent corpses remain deferred.

See [humanoid implementation and reproduction](HUMANOID_PRESENTATION.md),
[animation catalog](art/ANIMATION_CATALOG.md) and
[live native evidence](evidence/humanoid/native-acceptance.json).

## PCG result

Graph family: /Game/TornVeil/PCG/Buildings/TV_Dwelling_6x8_S01 through S05.
Level: /Game/TornVeil/PCG/Tests/Dwelling/L_PCG_Dwelling_6x8.

All five seeds construct Quaternius floors, ceiling, walls, one entrance, windows,
pitched roof and supports. One/two AdvancedVillagePack barrels provide pantry dressing.
Every construction instance comes from native PCG graph output. Variants contain
52/51/52/51/52 instances and differ in door/window arrangement, floor and storage.

Canonical footprint 600 × 800 cm; generated horizontal bounds 640 × 820 cm.
Maximum excursion is 20 cm, matching the explicit 20 cm allowance; roof overhang
is 20 cm X and 10 cm Y. Full height is 508 cm. Same-seed actual mesh/transform
signatures match after observed cleanup to zero instances, regeneration and graph
package disk reload. All five local signatures differ. No standalone construction
actors substitute for PCG; the separate display slab is excluded from measurement.

See [PCG details, hashes and reproduction](art/PCG_DWELLING_6X8.md),
[asset catalog](art/ASSET_CATALOG.md) and [acceptance evidence](evidence/dwelling/acceptance.json).
During development a vendor material auto-dirtied on load; its changes were discarded
without saving. Final verification found no dirty vendor package.

## Changed files and assets

- Canonical: body type/factory, shared combat resolution, empty-swing path, persistence.
- Bridge: visualState.ts, session projection, bridgeVisualState.test.ts.
- Native: TVCharacter, TVBridgeSubsystem, TVHumanoidVisualState and automation tests,
  plus the existing native held-key acceptance command.
- Fixtures/scripts: canonical socket fixture/acceptance, native PIE creation/capture/run,
  PCG creation/recipe/verification/capture.
- Owned assets: five PCG graphs, two isolated acceptance maps and two combat animation derivatives.
- Docs: this report, humanoid guide, compact art/animation/PCG catalogs and JSON/PNG evidence.

No vendor mesh, skeleton, animation, existing map, Ashford asset or main history changed.

## Verification

Targeted canonical regression: 71 tests across eight bridge/combat/persistence/embodiment
files passed. The dedicated visual test covers repeated attacks/hits between snapshots,
same-timestamp hits, monotonicity, JSON round-trip, save/resume/input reset, rejected
attacks, legacy saves, actual speed, body-specific withdrawal and held knock-down.

Canonical socket acceptance passed ten stages. UE 5.8 editor target build passed;
native Parser and EventQueue automation passed. Final results follow.

Live native acceptance passed 19 checks, including actual Blend Space input: idle=0,
walk=340 cm/s, run=527 cm/s, stop=0. Component-space foot separation changed from
43.68 cm at idle to 19.58 cm during the captured walk and 85.50 cm during the run. Native NPC strides, canonical
combat, all three batched attacks/hits, downing and exact body removal are captured.
The harness waits for observed locomotion state when screenshots delay a game tick.

Closer visual inspection found two issues that asset-selection checks missed:
the source hit was additive and the death clip was only a pre-ragdoll lead-in.
Owned derivatives now provide a full-pose flinch and a 1.7-second keyframed collapse.
Always-refresh bone evaluation prevents offscreen reactions from freezing. The final
native check additionally requires elapsed clip time and head/pelvis below 45 cm.
The supplementary `downed-side` capture uses a fresh disposable fixture, side camera
and hidden HUD. It records the held 1.7-second endpoint with head/pelvis at
11.80/21.27 cm, and visibly confirms the body on the floor.

Independent reviewer: one finding, normal/developer snapshot incapacity disagreement
for surrender/custody/subdual while pose is standing. Both paths now use the same
canonical conditions, with a focused regression covering entry and release. No further
PCG findings. The reviewer did not modify assets or run another editor.

The initial full regression finished with 798 passing tests and two motivated-life
trace failures. Both traces passed on starting revision 410a0a7, so they were confirmed
regressions rather than attributed to the baseline. Diagnosis found that the initial
knock-down guard unnecessarily stopped the wait action's clock. The final fix stays
inside the existing wait handler: preserve the unexpired physical pose while allowing
normal action scheduling and body physics. A 32-test focused pass proves that waiting
starts/completes while the body stays downed; typecheck passed afterward. No trace
assertions, time limits, seeds or cognition policy were changed.

After that correction, all four unchanged motivated-life traces passed (288.94 s),
the final eight-file bridge/combat/persistence/embodiment pass was 71/71 (9.76 s),
and canonical socket acceptance passed all ten stages again. Native acceptance was
refreshed against the final simulation source and corrected clips, passing all 19 checks. The
24-minute full suite was not repeated after these focused regression resolutions.
See `docs/evidence/humanoid/regression.json` and `baseline-motive-regression.json`.

Final environment: PIE ended; the editor displays the isolated dwelling level, has
no dirty content packages, and background throttling is restored. The normal saved
world server is running again: seed 918271, seven settlements, 127 residents and
ordinary controlled manifestation p_128/b_128. The disposable fixture never writes saves.

## Limits and next slice

GameAnimationSample starts/stops, pivots, warping, trajectory history and Motion Matching
are not migrated. Forward locomotion and generic attack/hit/collapse clips remain basic.
Coarse appearance proxies are hidden; no real equipment/customization pass was added.
Death follows canonical withdrawal. Replay queues bound visual backlog and account for
overflow. No Mover, CharacterMovement authority, traversal or multiplayer redesign.

The PCG generator accepts one explicit 6 × 8 m archetype and compiles seed-specific
graphs. Other dimensions, richer interiors, runtime graph parameters and settlement
integration remain deferred. Open entrances/windows and minimal pantry storage are
intentional. No gameplay collision/navigation truth is generated by PCG.

Smallest next slice: connect this validated archetype to one canonical building's
existing entrance/door semantics in an isolated playable scene, retaining the measured
envelope and shared humanoid input path before any Ashford integration.
