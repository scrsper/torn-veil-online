# Martial learning parallel safety record

Recorded before the sole Astra martial-learning worker begins.
Canonical combat checkout: C:/Users/green/Desktop/projects/torn-veil-online
Combat branch: codex/realtime-interaction-v0-1
Martial checkout: C:/Users/green/Desktop/projects/tvo-martial-learning
Martial branch: astra/martial-learning-techniques-v0-1
Starting checkpoint: 31051ecbfc3dc50e2e0e331c804028342566e75d
Combat thread inspected read-only: 01a0917d-3e35-7311-a140-5a187ccd08a4. No message or interruption sent.

## Observed active modifications

Treat these paths as hot; avoid editing them. Reserve all Unreal, bridge combat/contact/prediction, realtime tests/evidence and assets to combat.
 M src/bridge/combatArena.ts
 M src/bridge/combatState.ts
 M src/bridge/commands.ts
 M src/bridge/session.ts
 M src/headless/motive/trace.ts
 M src/sim/persist/combatAction.ts
 M src/sim/physical/combat.ts
 M src/sim/physical/combatAction.ts
 M src/sim/physical/combatActionTypes.ts
 M src/sim/physical/interactionSpec.json
 M src/sim/physical/melee.ts
 M unreal/TornVeilOnline/Config/DefaultInput.ini
 M unreal/TornVeilOnline/Source/TornVeilOnline/TVBridgeSubsystem.cpp
 M unreal/TornVeilOnline/Source/TornVeilOnline/TVBridgeSubsystem.h
 M unreal/TornVeilOnline/Source/TornVeilOnline/TVCharacter.cpp
 M unreal/TornVeilOnline/Source/TornVeilOnline/TVCharacter.h
 M unreal/TornVeilOnline/Source/TornVeilOnline/TVCombatAnimInstance.cpp
 M unreal/TornVeilOnline/Source/TornVeilOnline/TVCombatAnimInstance.h
 M unreal/TornVeilOnline/Source/TornVeilOnline/TVCombatChoreography.cpp
 M unreal/TornVeilOnline/Source/TornVeilOnline/TVCombatChoreography.h
 M unreal/TornVeilOnline/Source/TornVeilOnline/TVCombatPresentationComponent.cpp
 M unreal/TornVeilOnline/Source/TornVeilOnline/TVCombatPresentationComponent.h
 M unreal/TornVeilOnline/Source/TornVeilOnline/TVGameMode.cpp
 M unreal/TornVeilOnline/Source/TornVeilOnline/TVInteractionSpec.generated.h
 M unreal/TornVeilOnline/Source/TornVeilOnline/TVLiveCombat.cpp
 M unreal/TornVeilOnline/Source/TornVeilOnline/TVLiveCombat.h
?? docs/evidence/realtime/combat-counterfactuals.json
?? docs/evidence/realtime/combat-transport-after.json
?? docs/evidence/realtime/combat-transport-before.json
?? docs/evidence/realtime/combat-transport-final.json
?? docs/evidence/realtime/combat-transport-playable-after.json
?? docs/evidence/realtime/combat-transport-playable-before.json
?? docs/evidence/realtime/native-combat-duck-high-rendered-server.json
?? docs/evidence/realtime/native-combat-duck-high-rendered.json
?? docs/evidence/realtime/native-combat-duck-low-rendered-server.json
?? docs/evidence/realtime/native-combat-duck-low-rendered.json
?? docs/evidence/realtime/native-combat-timely-rendered-server.json
?? docs/evidence/realtime/native-combat-timely-rendered.json
?? docs/evidence/realtime/native-live-combat-late-nocapture.json
?? docs/evidence/realtime/native-live-combat-repetitions-server-after.json
?? docs/evidence/realtime/native-live-combat-repetitions.raw.json.gz
?? docs/evidence/realtime/native-live-combat-timely-nocapture-server-after.json
?? docs/evidence/realtime/native-live-combat-timely-nocapture-server-at-z.json
?? docs/evidence/realtime/native-live-combat-timely-nocapture.json
?? src/sim/physical/combatTransitions.ts
?? unreal/TornVeilOnline/Content/TornVeil/Combat/Repair/
?? unreal/TornVeilOnline/Content/TornVeil/Tests/Repair/
?? unreal/scripts/retarget_combat_repair.py
?? unreal/scripts/retarget_combat_sample.py

## Expected integration overlap

These paths changed during the combat milestone before the checkpoint. They are conservatively reserved, not all currently dirty. In particular reserve src/sim/core/types.ts, src/sim/mind/agent.ts, src/sim/persist/save.ts and shared .ai state/map/decisions. Use isolated modules or TypeScript module augmentation where appropriate; document final hookup patches. Do not duplicate canonical truth to avoid a shared file.
.ai/DECISIONS.md
.ai/REPO_MAP.md
.ai/STATE.md
src/bridge/combatArena.ts
src/bridge/combatPresentation.ts
src/bridge/combatState.ts
src/bridge/commands.ts
src/bridge/regions.ts
src/bridge/scheduler.ts
src/bridge/server.ts
src/bridge/session.ts
src/bridge/streaming.ts
src/bridge/transportTiming.ts
src/headless/bridge/combatAcceptance.ts
src/headless/bridge/realtimeLatency.ts
src/sim/core/types.ts
src/sim/mind/agent.ts
src/sim/mind/combatReaction.ts
src/sim/mind/genealogy.ts
src/sim/persist/combatAction.ts
src/sim/persist/save.ts
src/sim/physical/combat.ts
src/sim/physical/combatAction.ts
src/sim/physical/combatActionTypes.ts
src/sim/physical/combatFacts.ts
src/sim/physical/combatGeometry.ts
src/sim/physical/input.ts
src/sim/physical/interactionMovement.ts
src/sim/physical/interactionSpec.json
src/sim/physical/melee.ts
src/sim/world/combatArena.ts
tests/bridge-streaming.test.ts
tests/bridgeCombat.test.ts
tests/bridgeVisualState.test.ts
tests/browser/specs/combat-intent.spec.ts
tests/combat-foundation.test.ts
tests/combat-presentation.test.ts
tests/determinism.test.ts
tests/realtime-combat-action.test.ts
tests/realtime-combat-geometry.test.ts
tests/realtime-protocol.test.ts
tests/robbery.test.ts

## Worker contract

- Work only in the martial checkout. Set absolute workdir explicitly on every shell call; default workspace is an older Documents checkout.
- Execute the complete NEXT_ASTRA_PROMPT.md. Setup is done. Do not recursively delegate or launch additional workers. Exactly one worker is explicitly gpt-6-astra.
- Reuse existing skills/development/apprenticeship/knowledge/physical records/goals.
- Isolate goal/action providers, persistence helpers and technique-use evidence adapters; final registration in hot central files may be deferred with tested callable interfaces and precise integration notes.
- Recheck canonical status read-only before editing ambiguous shared files. No edits in canonical checkout.
- No Unreal, PCG, vendor, LFS pulls or family regression work; no full regression suite.
- Commit coherent slices and push this branch normally. Never force push, merge, edit main or discard unrelated work.
- Ask parent for an independent final review after implementation and targeted tests; do not spawn another reviewer.
Snapshot UTC: 2026-09-12T04:25:05.3568743Z
