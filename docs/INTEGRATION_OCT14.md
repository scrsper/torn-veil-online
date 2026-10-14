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

## Behavior audit after draft review

This audit compares file contents and callers, not only Git ancestry. The earlier
sanitized baseline `e7678bf` differs from `fc7bfc9` in four documentation files
only; their production trees match. The connected-realms, creator-fit, expedition
and visual-polish implementations were incorporated there, then modified by the
45 focused-world commits. Their older branches remain useful provenance, not
alternative current runtimes to merge wholesale.

| Source/subsystem | Evidence and disposition |
|---|---|
| Ontology `dc9e07c`: foot planting, attention, sound | `footPlant.ts`, `projectedAttention.ts`, `sharedGaze.ts`, `audio.ts`, `footfalls.ts`, `atmosphere.ts` and their five behavior test files are byte-identical to the branch tip. `SharedVisual` still calls gaze, springs, plant and footfall processing. **Scope limitation:** focused `realms/client.ts` and `ascent.ts` pass no environment callbacks or lookAt targets; surface-sensitive footfall audio and directed gaze are wired in the older viewer, not fully wired in the focused game. This is retained implementation, not full feature parity. |
| Human kit/gait `679ce9a` | Garment recipes, validation recipe, Brann/Wren GLBs, credits, gaitPhase and gait tests are identical. Later animation code replaces weight-six leg layering with explicit `applyLegs`, samples canonical actions in seconds, and blends upright walk/jog/sprint. No imported rig replacement is implied. |
| Camera/forest `a097d62` | Springs, structures, bridge regions and their tests remain identical. Later focused forest/camera work replaces cone proxies, supports metric bodies, imported local-space architectural cutaways and camera-relative movement. |
| Orbit `e853410` | Disconnect release, wheel clearing, middle-drag ownership, buffered action updates, target cutaways and obstruction easing are present. Three regression tests had been omitted during the earlier consolidation; this follow-up restores them alongside newer free-cursor tests. |
| TRELLIS motion `233775d` | Experimental `RetargetedMotionPlayer`, two-bone strike aim and their tests are **not integrated**. They target the preserved TRELLIS rig, whereas the selected runtime uses the shared credited cast and per-rig authored clips. Preserve that branch and source artifacts for a separate rig-adoption review; do not claim equivalent strike-aim behavior. The punch-contact/pelvis recovery correction from `98b16b2` is retained in the fallback animator. |
| Tower and world | Shared canonical catalogues, finite rewards, persistent floor identities, migration/replay, creator equipment, shield carrying and current 100-floor generation supersede the older client score implementation. Tests verify current mechanics; hours-to-Silver and Gold rarity still need ordinary-input play evidence. |
| Unreal/instructions | Unreal tree matches the prior GitHub main. Intentional instruction deletion remains. No dirty source worktree was reset or checked out. |

The follow-up runs 64 motion/attention/footfall/input regression tests in eight
files successfully. CI now cooks the hash-verified focused collision data before
running the full suite; an ignored local collision cache must not be a hidden
test prerequisite.

Recommendation: consolidate the verified focused runtime as the shared baseline,
and track focused gaze/surface-audio wiring plus experimental TRELLIS adoption as
explicit follow-up work. Do not substitute an older whole renderer to obtain
those features. Source/art exclusions listed above remain local or on their
existing branches; a main merge is not a claim that every asset is uploaded.

No new product choice is needed to reconcile these two source histories under
the confirmed focused-game direction. Human visual approval, several-hour Silver
pacing and actual Gold rarity remain acceptance work, not established benchmark
results. Preserve the current gates until a representative climb supplies
evidence for tuning. Do not merge into main merely because an older lab has more
features; the shared canonical runtime remains authoritative.
