# Realtime combat consolidation with wildlife main

This consolidates `codex/realtime-interaction-v0-1` with wildlife-containing main without adding gameplay. The normal merge `ee93cff15d98f1a7448d165380f4579e335c1365` has parents `b5693adeceb9750e9e7cbe1056015c1aeb318462` (combat) and `5877a720ba1e53dc0dcc9c03eb3a77c1fc6f191c` (main). Work was performed in `C:/Users/green/Desktop/projects/torn-veil-online`, with origin `https://github.com/scrsper/torn-veil-online.git`.

## Integration boundaries

- `BridgeSession.stepInteraction` advances physical and calendar time once, applies admitted movement/input, and calls `Simulation.stepScheduled`. Combat advances at 60 Hz through the existing swept-contact authority. Its slow branch invokes `Simulation.step(..., true)` at 20 Hz, suppressing a second combat advance.
- The slow simulation retains exactly one `stepWildlife` call. Ecology accumulates both elapsed clocks and consumes its existing 900-calendar-second quanta. Wildlife physiology runs through `stepEmbodiedPhysiology`; human strategic upkeep retains `stepPhysiology`. Wildlife bodies are not inserted into the living Person body index or processed by the legacy chicken controller.
- `Creature` identity, species composition, per-manifestation reserves, lifecycle, paid reproduction, natural mortality, spatial queries and resource intake are unchanged from main. Resource maintenance remains timestamped; no additional resource timer or generation path was added.
- Save version remains 24. The additive ecology version 1 component retains species, RNG, census and both pending clocks. Execution checkpoint version 1 independently retains the realtime slow cadence. Body combat actions, counters, prior-strike history and posture continue through existing validation. Creature bodies retain their paths and pose. Playable restoration calls generation with wildlife founders disabled and then restores canonical state.
- No martial-learning, human planner, Unreal source, animation or species implementation was changed by this consolidation beyond the normal merge. A combat interruption timestamp correction found during regression is described below. The separate `codex/wildlife-realtime-integration-v0-1` branch was not imported.

## Integration tests

`tests/ecology-realtime-integration.test.ts` checks single ecology advancement against the standalone stepper, save/load with a live attack and both partial scheduler clocks, and playable restoration after extinction and forage depletion. It compares canonical identities, bodies, physiology, resources, RNG and execution state.

The existing visual-counter test now checks rejection during committed startup (0.1 seconds), then verifies the original contact and untargeted-swing counters. Its old 0.5-second cooldown assumption contradicted the existing recovery-successor policy. The rejection, hit, accepted-swing and incapacity assertions remain; an additional pre-contact counter assertion was added. No combat timing or admission rule changed.

## Verification

The final integrated source and tests are committed at `b9ba86a18050571794fd5af50a723e606f306ada`. Initial focused verification passed 242 unique tests across 25 files, including the ordinary eight-world-day metabolism scenario. Typecheck, production web build and the generated interaction-spec check passed again after the source correction (hash `3d10f63ea1c309a06a02ec18011f74df23e1d4fe758ac92189624ca72cd68795`). The native Editor build succeeded with the existing target up to date; one native automation invocation passed all 10 `TornVeil.Realtime` tests, without test warnings. Native code, assets and generated specification remained unchanged afterward. Native validation used NullRHI; it does not claim new rendered or animation approval.

The single full canonical regression passed 916 of 919 tests in 92 files (1438.78 seconds). The historical motivated-life family trace passed. Three other checks failed: an embodied-economy save/load round trip, resisted robbery, and the assault social trace. All three reproduced on clean detached pre-merge combat commit `b5693ad`, with identical assertions (43.34-second focused comparison); these were not introduced by wildlife main. Raw local reports are under `.debug/wildlife-main-consolidation/`.

### Corrections exposed by regression

- **Save/load:** swept contact at 168.30 seconds interrupted a sidestep admitted at the 168.45-second endpoint. The resulting `stoppedAt`/`recoveryAt` preceded the action's start, and strict save validation correctly refused it. Interruption is now bounded by the interrupted action's start; the original contact time and injury authority are unchanged. A real swept-contact regression preserves the contact-before-defense relationship and round-trips the interrupted action. The original economy round trip passes. Save validation was not relaxed.
- **Resisted robbery fixture:** with actual evasion, both original participants exhausted themselves before the victim was subdued. A longer sword alone did not establish an ambush advantage. The fixture now uses a real confined passage: canonical walls block attempted sidesteps, which still pay normal costs. It retains the ordinary generated attributes and seeded RNG; full health, courage/aggression 1 and a weapon already ensure initial resistance without a constant global RNG stub. The victim remains defiant and armed; subdual, survival and completed theft assertions remain intact. No NPC decision or combat tuning changed.
- **Assault social fixture:** the chosen assault was known only to Tomas Reed, leaving no distinct witness perspectives to compare. The assault-only subject selection now requires an existing awake, nearby, unobstructed onlooker outside the two parties, using the harness's existing physical visibility query. Injury eligibility and social-connection ordering remain. No witness knowledge is injected and no family fixture or NPC priorities change.

Post-correction verification passed 109 overlap checks across 12 combat/ecology/bridge files, the original economy save/load case, all four social traces, and all 12 robbery tests: 126 unique checks in 15 files. The full local suite was not repeated. The PR's unchanged CI gate supplies the next full regression on the final committed source.

Run from the Desktop repository root. Focused coverage is split to keep long simulation work sequential:

```powershell
npm test -- tests/ecology.test.ts tests/ecology-persistence.test.ts tests/ecology-boundaries.test.ts tests/ecology-realtime-integration.test.ts
npm test -- tests/realtime-combat-action.test.ts tests/realtime-combat-geometry.test.ts tests/responsive-combat.test.ts tests/combat-refinement.test.ts tests/combat-flow.test.ts
npm test -- tests/bridgeVisualState.test.ts tests/realtime-session.test.ts tests/realtime-protocol.test.ts tests/realtime-native-traces.test.ts tests/combat-foundation.test.ts tests/combat-presentation.test.ts tests/combat-practice.test.ts tests/bridgeCombat.test.ts tests/bridgeLife.test.ts tests/bridge-streaming.test.ts tests/bridge.test.ts tests/persistence.test.ts tests/determinism.test.ts tests/resource-extraction-projection.test.ts tests/human-physiology-economy.test.ts tests/world-metabolism.test.ts
npm test -- tests/robbery.test.ts tests/social-causality-trace.test.ts
npm test -- tests/embodied-economy.test.ts -t 'round-trips attributes, physiology'
npm run typecheck
npm run build
npx tsx scripts/generate-interaction-spec.ts --check
pwsh -NoProfile -File unreal/scripts/Build.ps1
```

Native automation uses the same project and compiled modules:

```powershell
$project = Join-Path (Get-Location) 'unreal/TornVeilOnline/TornVeilOnline.uproject'
$report = Join-Path (Get-Location) '.debug/wildlife-main-consolidation/native'
& 'C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe' $project -unattended -nop4 -nosplash -NullRHI '-ExecCmds=Automation RunTests TornVeil.Realtime' '-TestExit=Automation Test Queue Empty' "-ReportExportPath=$report"
```

The single canonical checkpoint uses `npm test -- --reporter=default --reporter=json --outputFile=.debug/wildlife-main-consolidation/full.json`. Specialized world-epoch, long-run acceptance, browser captures and animation baking are not part of this consolidation.

Compact validation record: `docs/evidence/realtime/wildlife-main-integration.json`.

## Preserved work and assets

The pre-existing family-trace experiment was set aside in stash `8ae8995ef4758bcd1437be05703b202fb8e78a40` so verification exercised committed canonical code, then restored with an empty Git diff against that stash (Git restored CRLF line endings). The stash remains as an additional checkpoint. Original local evidence and rejected/test animation assets were inventoried with SHA-256 hashes, verified unchanged, and kept outside the integration commits. Concurrent presentation-planning documents and their `.ai/DECISIONS.md` addition were also preserved outside these commits.

The 37 combat assets already tracked on the combat branch remain unchanged. No Fab/vendor or third-party asset changes are introduced relative to main; the engine template content remains excluded by the existing Git rules. Owned derivative sources and reproduction remain documented in `RESPONSIVE_COMBAT_REPAIR.md`, `COMBAT_CAMERA_REFINEMENT.md` and `CONTINUOUS_COMBAT_FLOW.md`. This is a scoped diff/provenance check, not a new asset-license grant.

## Remaining limits

This is not final combat polish or human playtest approval. Existing animation, latency, rendered PvP and two-controller acceptance limits remain in the combat reports. Wildlife retains the main branch's coarse endpoint simulation and existing projection/perception limitations. Hunting, predation, domestication, new species and wildlife visualization are outside this consolidation. Historical family behavior is not retuned here.
