# Torn Veil humanoid presentation

Every visible canonical bodyId uses ATVCharacter: NPCs, the controlled manifestation,
and multiple bodies owned by one entity. UTVBridgeSubsystem binds controlledBodyId
with Possess and adopts only an unbound startup pawn. Cleanup removes exactly the
absent body actor. No player species or separate NPC representation was introduced.

FTVHumanoidVisualState validates identity, position, velocity, yaw, pose and activity.
Invalid identity/transforms emit a diagnostic and skip the row. Optional appearance
and counters degrade safely. Existing inventory/knowledge/HUD fields retain their
existing projection paths.

Per-body attackSeq/hitSeq deltas queue up to four pending one-shots of each kind.
The initial snapshot establishes a baseline; older values cannot rewind it. Loaded
clip durations control replay, hits take priority between clips, and terminal state
overrides locomotion/combat. Overflow or terminal cancellation remains counted in
read-only diagnostics; the tested three-event burst replays fully.

The mesh is SKM_Manny_Simple on SK_Mannequin. See [animation paths](art/ANIMATION_CATALOG.md).
BS_Idle_Walk_Run uses X=direction and Y=speed in cm/s. Forward samples use X=0,
with actual canonical horizontal velocity on Y. This corrects the former speed-on-X
wiring, which selected idle samples while transforms moved.

CharacterMovement stays disabled, with no capsule collision. NPCs interpolate
0.1-second snapshots; the controlled presentation reconciles using at most 0.1 second
of canonical velocity. Local transforms never feed simulation outcomes. WASD/Shift
and attack bindings send existing canonical intent requests. Coarse cube clothing,
hair and occupation proxies are hidden to expose the skeletal silhouette; real
equipment and appearance work remains deferred.

Canonical knock-downs now survive NPC replanning while recovery/subdual holds them
down, fixing an observed one-tick overwrite by wait. Canonical death currently sets
present=false, so its actor disappears immediately. A retained terminal body selects
the collapse clip; this phase introduces no persistent corpse or delayed withdrawal.

## Reproduce the isolated acceptance

1. Build TornVeilOnlineEditor with UE 5.8 in the canonical Desktop checkout.
2. Save and stop the normal bridge. Run
   `npx tsx src/headless/bridge/humanoidFixtureServer.ts` on loopback 8787.
   This disposable fixture never reads/writes the user's save.
3. Open /Game/TornVeil/Tests/Humanoid/L_HumanoidAcceptance. Its floor represents
   the fixture's explicit canonical flat terrain patch.
4. Through MCP execute_python, run unreal/scripts/start_pie_acceptance.py then
   unreal/scripts/run_humanoid_acceptance.py. Disable editor background throttling
   for timed capture and restore the preference afterward.
5. Inspect [native acceptance](evidence/humanoid/native-acceptance.json) and per-stage
   JSON/PNGs: actual animation, Blend Space state, foot separation, possession,
   movement mode, canonical state and replay counts.
6. End PIE, stop the fixture and restore the normal saved-world bridge.

The separate `npx tsx src/headless/bridge/humanoidAcceptance.ts` exercises the
canonical socket path on port 8799; it does not replace live native acceptance.

Generic forward attack/hit/collapse clips, forward locomotion samples and simple
interpolation are v0.1 limitations. Starts/stops, pivots, stride/orientation warping,
trajectory history and Motion Matching remain future upgrades. No traversal,
new movement authority, weapon redesign or persistent corpse system was added.
