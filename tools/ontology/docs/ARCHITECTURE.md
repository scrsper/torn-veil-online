# Architecture and boundaries

The canonical Torn Veil simulation owns entity identity, species, age, culture, profession, class, state, equipment and all mechanical outcomes. This workspace consumes a **read-only appearance projection**. It never infers combat stats, collision, faction, class or species from a mesh. Do not send catalog edits back to simulation as authoritative mutations.

```
Canonical simulation → CanonicalAppearanceAdapter<T> → EntityDescription
  → deterministic Visual Resolver → Resolution + trace + unresolved requirements
  → AssetProvider registry → optional offline Blender preparation → glTF/GLB
  → Babylon instance
```

The renderer can be removed without changing the ontology. `src/ontology` and `src/visual` do not import Babylon, DOM or Blender. Provider metadata is also engine independent. `src/rendering` owns Babylon object lifetimes; `src/catalog` owns local inspection UI. Blender is a command-line subprocess, never part of a simulation tick.

## Data and versioning

Zod schemas in `src/ontology/schema.ts` validate external data at ingress. JSON files contain actual definitions. `schemaVersion: 1` and resolver version `1.0.0` are explicit. Resolution produces a stable sorted-key fingerprint covering the normalized entity, resolver version, species rule, state rules and selected asset metadata. This short FNV fingerprint is a **development cache label, not a cryptographic identity**. Source SHA-256 hashes identify file content. Production cache keys should include full content hashes, art profile version and resolver package version.

Seeded variation uses entity ID, appearance seed, resolver version and named channels. Adding a new channel does not consume another feature's random stream. No `Math.random()` influences appearance. State and modifier arrays are treated as unordered sets. Equipment order currently remains significant in the cache key; canonical adapters should emit slot order. Rule changes require a resolver/data version bump and migration review. The UI increments seeds deliberately; persistent NPC seeds come from simulation storage.

## Composition

Biology, personal appearance, culture, profession, class, role, faction, wealth, status, rank, state, modifiers, equipment and relationships occupy separate fields. Human + Dunmere and Orc + Dunmere are valid. Vampire is human + vampiric in the validation data. Skeleton currently names a visual body family; the production adapter should project the living species plus undead/skeletal morphology when that ancestry is known.

The resolver chooses available geometry by ID. It exposes requests for head, material, features, clothing, rig, animation and effects. **Only base geometry and uniform height are currently rendered.** Face, hair, age, body-build, culture, profession, rank, supernatural materials and modular clothing need authoring. They remain visible as unresolved requirements. Never interpret returned request IDs as proof those components exist.

## Providers

`AssetProvider` supplies list/get metadata and capabilities. Quaternius, MPFB, Local and Generated providers implement the same boundary. MPFB's geometry generation is offline; an exported result must first receive an asset/provenance record. Future Human Generator and Custom Torn Veil providers can implement this interface without changing entity definitions. Paid provider records must enforce local-only storage until redistribution rights are checked.

## Quality and review

MISSING → PLACEHOLDER → PROTOTYPE → CANDIDATE → APPROVED → PRODUCTION are explicit statuses, not automatic pipeline stages. Schema validation requires reviewer, date and reference profile for the final two. A technical pass cannot promote quality. There are no approved or production assets in this bootstrap. Unresolved composed entities remain PROTOTYPE even if a component is approved.

## Scale and lifecycle

World units are meters. glTF is Y-up; Blender works Z-up and exports Y-up. Preserve whole rig hierarchy under a normalization parent; never nonuniformly stretch skinned geometry or casually apply armature transforms. Exclude importer custom-shape helpers from bounds. The catalog grounds and centers instances, disposes stale asynchronous loads and resources on selection, and keeps floor/debug resources independent of entity geometry.

## Comparison and performance

`src/visual/comparison.ts` defines a fixed shared camera, rest pose, lighting, floor and meter scale. Full comparison UI is deferred. It must not auto-frame each character independently, since that conceals height differences.

Asset manifests have LOD slots. Future crowd rendering should pool immutable assets, share materials and animation resources, use instancing only for compatible geometry/animation strategies, reduce animation frequency with distance, stream texture tiers, simplify materials and cap equipment/detail at visual LOD. Simulation cognitive LOD and visual LOD are separate consumers of distance/importance; changing visuals must never alter canonical identity or mechanics.
