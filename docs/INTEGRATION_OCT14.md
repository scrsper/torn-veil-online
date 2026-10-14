# Focused-world source reconciliation — October 14, 2026

This candidate combines the original histories of local main `6114afe` and the
published ontology branch `dc9e07c`. Merge `a0c8692` resolves 25 conflicting files
and has the exact same source tree as `6114afe`: the ontology work had already
been incorporated and subsequently repaired through the earlier consolidation.
This is a history reconciliation, not a replacement game. It does not claim that
GitHub main has been updated.

## Resolution by subsystem

| Subsystem | Retained behavior and reason |
|---|---|
| World and authority | The focused Babylon town, forest and physical Tower use one canonical World/Person/Body. Retain leased movement, command receipts, disconnected-input expiry and identical writer/replay geometry. |
| Human motion | Keep calibrated metre imports, authored upright travel, separate walk/jog/sprint, weapon-aware contact timing, per-rig clips and bounded foot IK. Preserve gaze, footfall and spring work already incorporated from ontology. Reject the older slumped relaxed clips and weight-six Babylon leg blending. |
| Camera and interaction | Preserve camera-relative movement, immediate wall pull-in, eased release, imported local-space cutaway rays and stable inventory action controls. |
| Tower | Preserve shared simulation progression/catalogues, finite and idempotent rewards, migration recovery, 100-floor geometry, earned Silver/Gold gates and existing save identity. Do not reinstate duplicate client score thresholds or empty-cast advancement. |
| Rendering and equipment | Preserve creator rig bakes, metric held weapons, fitted grips/shields, confirmed hit/block/wall/expiry VFX, bounded lights and geometry-matching effect footprints. |
| Historical implementations | Keep the arena labs clearly labeled and retain Unreal unchanged. Preserve both source parents, rather than rewriting or deleting older work. |
| Agent instructions | Retain the intentional deletion in `3bdf16f`; the user explicitly requested resetting custom overrides. Do not restore old instructions. |

## Verification and fresh-checkout requirements

TypeScript and the production Babylon build passed on the reconciled runtime.
The focused integration selection passed **241 tests in 32 files** in 117.31 s.
It covers Tower growth/checkpoints, replay, migration, actual focused geometry,
movement ownership, camera/cutaways, metric character imports and animation.

Initial verification exposed missing generated geometry in the new worktree and
two stale fixtures. Run `node scripts/web/cook-focused-assets.mjs` before tests
requiring focused geometry. It rebuilt 998,530 triangles from 46 verified sources,
with SHA-256 `c3ad74f50784f8709a648dec03fd256c7aeb873c101ca1d02feebfab4271252f`.
The journal test now uses an existing OS temporary directory rather than assuming
an ignored parent folder exists; the presentation fixture uses the real metric
import adapter before constructing SharedVisual. Production behavior and test
assertions were not relaxed.

Build with `node scripts/web/build-current.mjs` from a clean checkout. It stages
the hash-verified existing motion dependencies and creator assets, cooks missing
collision data and records the exact served commit. The two licensed raw motion
packs remain external dependencies; Git source alone is not permission to
redistribute those packs. No live save or game preview was used for this audit.

## Source and asset storage

The local inventory found 536 untracked files, 746,171,487 bytes. 204 match blobs
already preserved in local history. They are not all new gameplay code:

- 97 source recipes/preview harnesses (446,866 bytes): retain in reviewed archival
  Git branches with their intended asset/version and status. Do not wire rejected
  experiments into the canonical launcher.
- 26 editable art/models/intermediates (370,516,689 bytes): retain immutable,
  versioned source artifacts or licensed Git LFS objects; track hashes, licenses,
  recipes and runtime selection in Git. GLBs are not assumed rebuildable unless
  all required inputs and deterministic export recipes are retained.
- 277 renders/videos (327,637,654 bytes): immutable evidence artifacts, with a
  concise manifest and selected review images in Git.
- 133 metadata/evidence records (19,585,368 bytes): source/provenance/acceptance
  records belong in Git; bulky raw measurements can accompany the artifact.
- Two third-party source ZIPs (27,975,567 bytes): retain privately pending license
  verification, not a public code commit. One .pyc is rebuildable bytecode.

The v004 visual handoff explicitly rejects its eye and grip trials; stable v003
remains the art deliverable described there. Neither replaces the current game
cast in this integration. The existing TRELLIS branches and untracked local
changes remain preserved, not silently adopted or declared synchronized.

Generated `dist-web`, collision cache and staging receipts are rebuild outputs.
Source GLBs, editable Blender files, original licensed clips and source provenance
must not be discarded merely because an export can be regenerated.

## Remaining acceptance

No new product choice is needed to reconcile these two source histories under
the confirmed focused-game direction. Human visual approval, several-hour Silver
pacing and actual Gold rarity remain acceptance work, not established benchmark
results. Preserve the current gates until a representative climb supplies
evidence for tuning. Do not merge into main merely because an older lab has more
features; the shared canonical runtime remains authoritative.
