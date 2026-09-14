# Foundational Gameplay Presentation v0.1

Status: investigation and synthesis complete; implementation stopped at required gates on 2026-09-13.

## Outcome

The current repository already contains strong foundations for canonical realtime movement/combat, semantic hand interactions, persistent items, regional projection, decorative PCG, and persistent wildlife ecology. It does not yet contain one coherent native game shell, canonical containers/equipment, or an Unreal wildlife projection.

Implementation was intentionally not started because the work order's stop conditions are active:

1. `origin/main` does not contain the accepted realtime combat, realtime wildlife integration, and realtime martial integration branches.
2. The production checkout contains active uncommitted/unpushed work on the realtime branch, so switching or integrating there would risk collision.
3. No redistribution-cleared roe deer mesh, skeleton, or animation set is available.
4. Physical containers and equipment do not exist canonically; fabricating UI state would violate the authority boundary.

Accordingly, no milestone branch was created, no shared Unreal asset was written, no source implementation was changed, no commit/PR/push was made, and no acceptance or quality claim is made.

## Permanent architecture selected

```text
canonical TypeScript fact/action
        ↓ renderer-neutral bridge DTO / semantic intent
disposable Unreal projection and local prediction
        ↓
camera, animation, widgets, VFX, sound, decorative PCG
```

- Movement, facing outcomes, contact, damage, inventory, item location, container/equipment state, wildlife behavior, ecology, and persistence remain TypeScript-owned.
- Unreal may smooth, blend, warp meshes within explicit bounds, and predict locally only when disposable and reconciled.
- The native UI reads snapshots and sends semantic/opaque intent IDs; it never grants an action.
- Presentation actors are keyed by canonical `bodyId`/item identity. Region unload removes presentation, not canonical identity. Dead and withdrawn are different states.
- PCG uses canonical substrate as input and produces tagged, noninteractive decoration only.

## First coherent implementation sequence after unblock

1. Create `codex/foundational-gameplay-presentation-v0-1` from the newly consolidated `main` and record exact base.
2. Add focused bridge contracts/tests for movement presentation telemetry, richer item descriptors, semantic prompts, and body-keyed wildlife residency.
3. Implement camera plus start/stop/pivot continuity without root authority; verify zero presentation-induced actor drift.
4. Replace the player-facing Canvas surface with a thin CommonUI/UMG HUD/prompt/inventory shell; keep Canvas debug diagnostics.
5. Design and implement the smallest canonical physical-container model and transfer action, with persistence and shared NPC/player semantics.
6. Decide whether explicit equipment slots are required for v0.1. If required, add them canonically before the equipment view; otherwise label the view deferred rather than faking it.
7. Acquire or create a cleared roe deer rig/animation set, record provenance, then implement the body-keyed wildlife projection and transitions.
8. Tune one existing PCG biome slice, integrate exploration/combat shell transitions, and run the save/reload walkthrough.

## Planned focused verification

- TypeScript: hand eligibility/projection, pickup round trip, inventory DTO, container transfer, equipment projection if added, wildlife identity/activity/residency, resource nonduplication, save/load.
- Static/integration: typecheck, production build, generated-spec check.
- Native: focused camera/locomotion drift, CommonUI input/focus/cancel, bridge parsing, actor residency/dead-vs-withdrawn, and existing combat regressions.
- One broader regression only after the coherent slice is stable.
- Human playtest and normal-speed capture only after ordinary startup supports the full acceptance sequence.

## Evidence

- Information declaration: `docs/FOUNDATIONAL_GAMEPLAY_INFORMATION_DECLARATION.md`
- Reference matrix: `docs/FOUNDATIONAL_GAMEPLAY_REFERENCE_MATRIX.md`
- Existing architecture/evidence: `.ai/STATE.md`, `.ai/DECISIONS.md`, `.ai/REPO_MAP.md`, `docs/CONTINUOUS_COMBAT_FLOW.md`, `docs/EMBODIED_WILDLIFE_ECOLOGY.md`, `docs/PLAYABLE_SEEDED_WORLD.md`, `unreal/ASSET_PROVENANCE.md`

## Human playtest

Not available for this milestone because no implementation branch was safely created. Existing combat/world commands test earlier checkpoints only and are not evidence for this requested vertical slice.
