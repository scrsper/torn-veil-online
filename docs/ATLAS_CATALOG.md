# Atlas runtime catalog

Cooked on 2026-10-20 from the existing `TornVeilAtlas/public` catalogs. No source
model was edited, copied into Git, reduced, or replaced with newly generated art.

## Coverage and exclusions

| Catalog | Source records considered | Unique decoded models | Static compatible models |
| --- | ---: | ---: | ---: |
| Original architecture | 500 | 500 | 438 |
| Original nature | 500 | 500 | 400 |
| Mob workshop | 230 | 230 | 0 |
| Rebuilds | 589 | 1 | 1 |
| Additional local library | 1,188 | 619 | 410 |
| Total | 3,007 | 1,850 | 1,249 |

“Static compatible” means the complete active model is available, self-contained,
within the authored per-model budget, and measurable with the supported GLB
pipeline. It does not mean the model has been rendered in this game, approved as
final art, or certified for arbitrary placement or indoor traversal. Runtime
placement and rendering impose additional fit, clearance, biome, memory and
draw-cost limits.

The compatible pool contains **438 complete scenes, 401 nature assets, 396 props
and 14 modules**. Exact decoded hashes eliminate 44 duplicate payload references.
Duplicate source identities remain in the exclusion ledger and point to the
retained model. Static fauna and character models remain drafts: the catalog
never creates a living Person, NPC or animal from a mesh.

The rebuild catalog contains 52 model records and 537 still-only records. Of its
52 models, **51 refer to separate texture files**; this cook excludes them instead
of attempting partial rendering or unrestricted resource fetches. These relative
sidecars could be verified and packaged in a later offline pass. Their exclusion
does not mean they were malicious or that their geometry was absent.

Across all inputs, the ledger records 894 still-only entries, 166 non-runtime
source files and two models with no renderable geometry. Among decoded unique
models, 538 are fauna/character drafts, 197 require a rigged/animated pipeline, and
63 exceed the static model budget. These latter reasons overlap. Static budgets
are at most 300,000 rendered triangles, 512 primitive instances, 32 MiB decoded
GLB, 250 metres high and 500 metres from native origin in plan.

## Measured geometry and collision contract

The cook scans actual accessor positions through every active scene-node
transform. Source metadata is not used as an axis conversion or scaling shortcut.
All output is native glTF **Y-up metres at scale 1**. `groundOffset` is
`-bounds.min.y`; X/Z origins remain literal. `footprintRadius` encloses the native
origin, including off-centre models. The scene triangle/primitive count charges
every node instance; mesh/material counts identify distinct resources.
`textureBytes` measures embedded encoded image bytes, not decoded GPU memory.

Collision data is independent of renderer loading: each mesh node contributes a
conservative transformed AABB. At most 64 boxes are retained; models beyond that
limit receive an explicitly labelled overall bounds proxy. In the compatible pool,
997 have node boxes and 252 have overall bounds.

Distinct post and lintel nodes retain their open gap, and floor boxes retain their
actual shallow vertical extent. A single combined node containing a doorway,
staircase or hollow interior can still conservatively close that space. **Node
boxes are not an interior navigation certificate.** Scenes with coarse proxies
must not be presented as walkable interiors; precise triangle or authored parcel
cooking remains a separate requirement. These proxies also create no floor
support, resource stock, item ownership or gameplay reward.

## Reproduction and source integrity

Run:

```powershell
node scripts/world/cook-atlas.mjs --root C:/Users/green/TornVeilAtlas
node scripts/world/cook-atlas.mjs --root C:/Users/green/TornVeilAtlas --check
```

The default root is `TV_ATLAS_ROOT` or the current user's `TornVeilAtlas` folder.
Output is `src/sim/world/atlas/catalog.json`; `--out` selects a different output.
`--check` compares exact bytes and does not rewrite the catalog. No timestamps or
machine-specific absolute paths enter the output. The revision hashes the entire
canonical metadata payload, including source hashes, bounds, proxies, eligibility
and exclusions, because those fields affect deterministic placement and collision.

Each runtime model records both decoded SHA-256/length and, for gzip transport,
compressed SHA-256/length. Path resolution refuses escapes and real paths outside
the Atlas root. Models with external image/buffer URIs, unsupported decoder
extensions, invalid vertex/index ranges or forbidden source metadata are rejected.
The existing NCSoft/Aion/native-buffer exclusions remain in force. Raw source
statements and readiness labels are retained as provenance, not silently promoted
to a new art or licensing approval.

Revision: `6ee7426147577c9f38a95b2b0dba14514a7e080f110162f64fad4730a8691b0c`.
Catalog size: 5,821,180 bytes of metadata, with no model payloads.

Verification: eight targeted tests pass for real GLB fixtures, world-space bounds,
native pivots, repeated-node costs, separated doorway/floor proxies, malformed
indices, external dependencies, decoder rejection, hash deduplication and registry
immutability. An independent second full cook reproduced the checked-in bytes.
