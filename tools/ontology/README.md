# Torn Veil · Visual Ontology

Reference-guided work: read [reference evidence](docs/REFERENCE_ANALYSIS.md) and [Human milestone status](docs/HUMANOID_MILESTONE.md). The catalog now includes male/female Human studies, fixed gameplay views and a local reference gallery. This is PROTOTYPE work; the visual-quality goal remains open. `npm run human:build` rebuilds the authored Human family and provenance.

A local appearance and asset-authoring companion for Torn Veil Online. Canonical simulation owns identity; the ontology describes it, a deterministic resolver interprets it, licensed source artwork supplies geometry, Blender prepares it and Babylon renders it.

## Launch

```powershell
Set-Location (Join-Path $env:USERPROFILE 'Desktop/projects/ontology')
npm ci
npm run catalog
```

Open **http://127.0.0.1:5173**. This bootstrap workspace already has dependencies and downloaded assets. `npm ci` is only needed after a fresh checkout or dependency change. Use `?webgl` to explicitly request WebGL; WebGPU is preferred when supported.

Browse twelve validation identities, search/filter, inspect ontology/resolution/provenance, orbit/zoom/reset, toggle wireframe/skeleton, and browse actual source files. Animation selection is available on the UAL demonstration rig. Missing geometry remains visibly unresolved. Seed changes update deterministic requests; detailed appearance variants need authoring.

## Useful commands

| Command | Result |
|---|---|
| `npm run build` | Type-check and build catalog |
| `npm test` | Focused ontology/resolver/registry tests |
| `npm run assets:verify` | Khronos glTF validation and source hashes |
| `npm run test:browser` | Browser acceptance and screenshots; catalog must be running |
| `npm run blender:probe` | Verify Blender + MPFB in background |
| `npm run entity:build -- human_001` | Normalize and export a registered source through Blender |
| `npm run entity:render -- human_001` | Five rendered review views |
| `npm run entity:validate -- human_001` | Geometry/rig/texture report |
| `npm run assets:polyhaven` | Fetch only curated 1K materials/HDRIs |

## Workspace map

- `ontology/`: 230 original terms, multi-label classification, species/archetypes, twelve examples, independent culture/state/equipment data and unset art profile.
- `src/ontology`, `src/visual`, `src/assets`: portable schemas, read-only simulation adapter, deterministic resolver, provider interfaces.
- `src/rendering`, `src/catalog`: Babylon viewport and local inspection application.
- `assets/source`, `assets/imported`: original archives and extracted artwork; local/ignored.
- `assets/provenance`: tracked machine-readable licenses, hashes and derivation chains.
- `blender/scripts`: reproducible import/normalize/inspect/render/export backend and safe component helpers.
- `public/assets`: local licensed staging; ignored, never automatically published.
- `references/`: future user art direction; see [reference guide](docs/ART_REFERENCE_GUIDE.md).
- `generated/validation/bootstrap`: inspected screenshots and browser report. Other generated folders contain Blender views, reports and manifests.

## Fresh-checkout asset recovery

Download free official Standard archives with `node scripts/download-quaternius.mjs`. Extract them safely into `assets/imported/quaternius/<pack-slug>/`, preserving archive paths; `node scripts/extract-assets.mjs` performs safe extraction and CRC checking with existing Python. Then run `npm run assets:polyhaven`, `node scripts/prepare-assets.mjs` (also stages the neutral HDRI), `npm run entity:build -- human_001`, and `node scripts/public-provenance.mjs`. Source archives are not stored in Git. Acquired-byte hashes are recorded; upstream may change downloads, so review provenance changes before accepting replacements.

## Read next

[Architecture](docs/ARCHITECTURE.md) · [Ontology](docs/VISUAL_ONTOLOGY.md) · [Art pipeline](docs/ART_PIPELINE.md) · [Licenses](docs/ASSET_LICENSES.md) · [Environment](docs/ENVIRONMENT.md) · [Torn Veil integration](docs/INTEGRATION_WITH_TORN_VEIL.md) · [Roadmap](docs/ROADMAP.md) · [Validation](docs/VALIDATION.md).

This is a functioning foundation, **not production character art**. No public remote or push is configured. The sibling Torn Veil repository is unchanged.
