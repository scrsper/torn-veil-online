# Integration with Torn Veil (future only)

Read-only inspection of the authoritative checkout confirmed elevated orbit defaults in `src/web/game/cameraRig.ts`: 8 m and 0.5 rad pitch; `bindings.ts` defaults to 62 degrees FOV. The catalog copies these into a versioned preset with a declared fixed 1.65 m review pivot. World obstruction, smoothing and shake remain client behavior. The MPFB game_engine skeleton needs a retarget adapter before consuming Quaternius locomotion; the broad humanoid_standard family label does not guarantee bone compatibility. No Torn Veil files were changed.

No Torn Veil source, assets, world state or renderer were modified. This companion matches its installed Babylon core/loaders version **9.28.0**. It adds no Three.js dependency.

The read-only audit found existing canonical appearance tokens in `src/sim/core/appearance.ts`, appearance projection in `src/bridge/appearanceProfile.ts`, client interpretation in `src/web/actors/appearanceMap.ts`, and provider-independent slot requests in `src/foundry/manifest.ts`. The existing client already treats its realization as cosmetic and does not feed mesh decisions back into the world. Preserve and extend that boundary; do not replace it with a competing identity system.

## Proposed integration seam

1. Extract this project's engine-independent schemas, seeded channels, resolver contracts and asset metadata into a shared TypeScript package after tests and art direction stabilize.
2. Implement `CanonicalAppearanceAdapter<T>` over Torn Veil's projected appearance DTO. Explicitly map canonical IDs, persistent appearance seed, species, presentation/body tokens, projected age, culture, profession, rank, state and equipment. Preserve presentation independently from biological sex: do not infer sex from feminine/masculine clothing tokens. Do not reconstruct unknown biological facts from client kits.
3. Map canonical colors/morphology tokens from `sim/core/appearance.ts` to appearance requests. Preserve its existing projected-age ownership. Keep palette and stature semantics compatible rather than silently replacing them with bootstrap defaults.
4. Reconcile `foundry/manifest.ts` required/preferred/forbidden/relax slot rules with provider tags. Trace every relaxation. A requirement such as child fitting or compatible skeleton cannot silently degrade to adult geometry or an incompatible rig.
5. Adapt `web/actors/appearanceMap.ts` to consume the shared resolution, behind a feature flag. Reuse Torn Veil's Babylon scene, lighting, WebGPU engine, asset manager and entity lifetime; do not create a second renderer/engine in the game.
6. Feed vetted GLBs/manifests into its existing asset build process. Source tools remain offline. Gameplay drives position, locomotion and combat; animation/root motion only visualizes authorized simulation state.
7. Add canonical fixture snapshots proving stable appearance across save/load, restarts and server/client projection. Validate silhouettes under the actual world camera before replacing any current production content.

## Contract checklist

Version DTOs and provider manifests. Keep unsupported concepts explicit. Use content hashes and profile versions in caches. Record units, pivots, orientation, skeleton map, socket names, clip semantics, root-motion policy, bounds, LODs and material tiers. Appearance bounds must not become canonical collision truth. Library asset availability must not determine whether an entity exists.

Spawn-in-Torn-Veil is intentionally not wired during bootstrap. A future action should send an explicit command through Torn Veil's authorized simulation API, then render the returned canonical entity; it must not instantiate gameplay truth from a selected catalog mesh.

Comparison mode should reuse the same camera/lighting/pose contract in both catalog and client. LOD, animation LOD, pooling and shared immutable resources can be introduced behind the renderer interface without modifying entity identity.
