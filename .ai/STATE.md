# Playable Seeded World v0.1

Current branch: `codex/playable-bridge-startup-fix`, from merged main `09cf24d`. No PR or merge. Original milestone report: `docs/PLAYABLE_SEEDED_WORLD.md`; detailed journey evidence: `docs/playable-world-acceptance.json`.

## Startup reliability

- Actual Desktop checkout loaded a stale September 7 DLL: native close 1009 at 1 MiB, caused by the 2.60 MB initial region frame preceding the snapshot. Launch now runs incremental UBT and validates bridge prerequisites/checkout diagnostics.
- Canonical hello/scene/snapshot precede lazy center-first presentation. Regional protocol 2 uses acknowledged <=128 KiB messages, <=4 MiB assembly, separate origin/residency updates and independently applicable regions. Native receive callbacks defer application; transport, snapshot freshness and streaming are distinct.
- Existing-save native PIE reached LIVE, rendered nine regions, and held native WASD bindings changed canonical position with local movement disabled. Same-editor PIE restart reacquired the same body; controller ownership was released on stop. World/save preserved.
- Validation: 12 focused + 44 additional relevant regression tests passed; live socket acceptance passed; typecheck/bundle and UE builds passed. Full world suite not repeated for this bridge-only change. See `docs/PLAYABLE_STARTUP_FIX.md` and `docs/evidence/startup/`.

## Implemented

- One 24.576 km square seeded world with seven settlements (127 generated residents plus an ordinary avatar for seed 918271), a shared clock/registry, locally seeded terrain, rivers, resources and suitability/cost-derived settlement sites and roads.
- 256 m regions with pure generated substrate, dense inhabited patches and canonical historical modifications. Body-driven resource relevance is independent of rendering. All NPC systems still step; no distant simulation LOD.
- Native `/scene` manifest plus regional geometry/semantic updates. Nine presentation regions stream around the avatar; canonical coordinates remain stable while Unreal rebases its presentation origin. Body-specific avatar visibility, explicit developer truth and evidence-gated mechanism offers.
- Generic `TornVeilWorld.umap`, modular Quaternius structure assembly, Poly Haven materials/grass, non-authoritative PCG grass/bush dressing, instanced canonical resources/crops/items/structures and basic semantic changes. Ashford is preserved with an explicit launch option.
- Shared canonical movement fixes: one-metre descent, door opening, footprint-safe path smoothing and release of completed external action scheduling. Browser emergency resurrection/teleport is removed.
- Save schema 24 preserves world specification, edits, resource lifecycles, knowledge/history and scheduler state. Older saves are explicitly rejected, not deleted. A running server continues without Unreal; stopped-server time is not silently advanced.

## Evidence

- Focused canonical checkpoint: 49 checks passed. Movement fixes: 2 checks passed. Final projection/menu/privacy: 11 checks passed.
- Detailed 0.1-second A→B→A journey: 10.510 km, 20,238 steps, 118 presentation unloads. Same depleted tree and introduced identity on return. B did not magically know the avatar. Energy/hydration fell and fatigue increased through existing physiology. Save/reload/reconnect preserved the same clock and alteration.
- Typecheck, production bundle (123 modules), and UE 5.8 editor target build passed. Full suite: 787 passed, two stress timeouts; both passed unchanged in isolation with Unreal stopped. No assertion/time limit changes.
- Actual PIE captures cover A, wilderness and B in the generic map: nine resident regions, 34–41 total actors, 212–4,249 canonical instances and 3,779–6,673 decorative instances. All sampled PCG regions generated and instance collision was disabled. Native region build max 26.04 ms; region-frame apply max 90.29 ms. Captures are explicit developer relocations, separate from the canonical movement evidence.

## Limits

This is a functioning continuous-world foundation, not an all-conditions showcase PASS. Starting settlements have primitive technical education and wind boundaries, with no guaranteed finished mechanism. The menu is verified using the existing disclosed workshop. Full human keyboard-driven regional PIE travel and every activity/repair/combat animation have not been visually accepted. Terrain/water, modular roofs/interiors, component geometry and item/crop presentation remain prototypes. No ecology/hydrology, bridges, shipping package, simulation LOD, multiplayer or offline catch-up.

Next: Regional Life and Interaction Acceptance — natural technical history/artifacts, procurement/construction access, complete live Unreal survival/mechanism journey, stronger region/material/facade rendering and recorded animation/performance evidence. Do not manufacture prosperity or disable distant systems for a demonstration.
