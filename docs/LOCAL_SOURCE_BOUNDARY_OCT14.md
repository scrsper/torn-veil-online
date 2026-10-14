# Local source and asset boundary - October 14, 2026

The canonical current game is GitHub main at
`0c2b0e7fe190baea0914c2d9f60725ecf9ec0987` (PR #67). Its focused Babylon
town/forest/Tower runtime, canonical simulation and original ontology history are
integrated. The retained local workbenches and source art are **not all on main**.
This document records that boundary rather than treating a runtime merge as a
complete asset/source backup.

This follow-up preserves one 476-byte read-only timing/hash probe and publishes
the inventory metadata. It makes no change to game behavior, asset selection,
progression, motion, gaze/audio wiring or the canonical launcher.

## Verified inventory

All 536 originally inventoried files remain at their original locations and
match their SHA-256 records. A fresh Git untracked listing also matches exactly:
534 files in the active Desktop checkout, one in the Oct4 baseline worktree and
one in the Oct4 tower-polish worktree. No files were removed or staged there.

The [per-file CSV](source-audit/local-files-oct14.csv) records location labels,
relative paths, byte sizes, hashes, classification, experimental status and main
content availability. It contains metadata, not file payloads or Library URLs.
Location labels omit the PC username and absolute paths. File counts count
preserved copies; distinct hashes identify duplicate content without deleting it.

| Classification | Files | Bytes | Distinct byte hashes | Disposition |
|---|---:|---:|---:|---|
| Source code, recipes and configuration | 105 | 455,760 | 99 | Review source-only archival packages; one small diagnostic is preserved by this PR. |
| Original art or intermediates with unproven reproducibility | 29 | 400,435,329 | 28 | Preserve original editable/source files; choose immutable licensed storage. |
| Validation evidence and provenance | 401 | 345,271,055 | 388 | Preserve historical observations, captures, reviews and handoffs. |
| Reproducible generated output | 1 | 9,343 | 1 | Python bytecode cache, regenerable from its retained Python source; no cleanup performed. |
| Unrelated material | 0 | 0 | 0 | None found within this inventory. |
| Total | 536 | 746,171,487 |  | Every row has a disposition. |

The 105 source/configuration files include 89 executable `.py`/`.ts`/`.mjs`
scripts, eight HTML preview/gallery sources, three `.gitignore` inputs and five
MakeHuman foundation JSON inputs. There are 98 distinct contents after only
CRLF-to-LF normalization, including 86 distinct executable-script contents.
The five foundation JSON files match the existing
`art/source/reference-characters/hero-v006/foundation.mpfb.json` on main. The
other 100 source/configuration/markup files have 97 distinct normalized contents
absent from current main. No complete executable script matches current main.
This is whole-file equality evidence, not a claim that every line is novel.

The 29 art/intermediate files include eleven editable Blender projects, twelve
GLBs, three frozen NPZ fields, two original VRoid source ZIPs and one original
visual reference PNG. The approved-original GLB and reference PNG are inputs.
Other GLBs may be exports, but exact reproduction from complete retained inputs
has not been demonstrated. They are not classified as expendable generated
outputs. The stable-v003 Blender backup in v004 is a byte-identical preserved
copy; all copies remain intact. The ZIPs require license review before sharing.

Screenshots and videos are validation evidence even when rendered by a script:
they record a historical build, pose, camera, conditions and review. Re-running
today's code does not recreate that original observation. The single bytecode
cache is the only positively identified rebuildable output here.

## Executable source still outside main

1. **87 character-workbench scripts** plus seven HTML harnesses and three local
   ignore configurations remain under `hero-trellis-v001` through `v004`. They
   construct, export, preview, measure or package character trials. Current
   main's `src`, `scripts`, `web` and `art/tools` do not reference these versioned
   workbench paths. Their absence limits reproducing the experiments; it is not
   missing code for the selected current cast.
2. **`art/tools/arena/build_omni_candidate.py`** remains local in the Oct4
   tower-polish worktree. Its own header labels an isolated geometry candidate;
   it uses installed MakeHuman/MPFB inputs and writes under `.debug`. Recommend a
   source-only experimental archive with dependency/license provenance, followed
   by separate visual review. It is not an approved default-character recipe.
3. **`scripts/consolidation-replay-check.ts`** was a local read-only diagnostic in
   the Oct4 baseline worktree. This PR preserves its source unchanged at the same
   relative path. It creates a disposable in-memory living fixture, advances five
   world days at the fixture's 60:1 clock, and prints wall time, a SHA-256 and a
   snapshot. Its historical name does not mean it asserts replay/determinism:
   it performs one run and records evidence. It does not access a live save or
   start a server/window. Run explicitly with:
   `node --import tsx scripts/consolidation-replay-check.ts`.
4. **Four committed files** are absent from main and remain on local
   `codex/trellis-human-motion-set` at
   `233775d88a5e2bf2fe7aedd58d300b54a4f6c30a`:
   `src/web/actors/retargetedMotion.ts`,
   `src/web/actors/retargetedStrikeAim.ts`,
   `tests/web-retargeted-motion.test.ts` and
   `tests/web-retargeted-strike-aim.test.ts`.
   They implement/test the experimental rig's baked-motion player and strike
   aiming. They were intentionally not integrated into the selected shared cast.
   Main-only assistants cannot retrieve those files from main; source-only
   archival review is the recommendation, not implementing the feature to empty
   this list.

The historical Babylon comparison HTML is a validation-gallery source. Its
associated reports/captures remain evidence for a previous renderer. It does
not replace the focused-world renderer. Older MakeHuman hero-v001 through v005
are silhouette workbenches; the existing v006 foundation retains their common
input configuration.

The v003 handoff describes a stable rigged deliverable and remaining posed-surface
limitations; that does not establish approval as the canonical game cast. The
v004 handoff explicitly rejects its eye and grip trials. Preserve these source
recipes and original art with their status labels. Do not silently activate
either an earlier experimental rig or a rejected derivative.

## Remaining storage decisions

Recommended next step: review and publish source-only archives by asset version,
with preserved source hashes, acceptance/rejection status and dependency inputs.
Choose immutable private storage for original art, licensed inputs and bulky
evidence, and retain an index/hash manifest in Git. Select the destination and
verify redistribution permissions before publishing raw third-party source ZIPs
or embedded licensed motion packs. A blanket push of old binary-heavy histories
or a bulk upload is not part of this follow-up.

Current main includes the runtime code and focused shipped assets. A playable
build still needs the existing hash-verified licensed motion dependencies
described in [the integration report](INTEGRATION_OCT14.md). Main is the current
code baseline; it is not a self-contained archive of every original art input.
Directed gaze and surface-audio wiring in the focused clients remain documented
feature work, separate from source preservation.

## Validation scope

The inventory was re-hashed, checked for unique location/path keys, reconciled to
the original untracked lists and compared against main's tree/history. Source
matching also normalizes line endings. Static source review and known credential
signature scanning produced no findings; this is not a universal secrets audit.
The public inventory contains only selected metadata fields.

The preserved probe is typechecked directly with the existing TypeScript runtime
and executed once against a disposable fixture. It is not added to the default
test suite. The already completed PR #67 full suite is not repeated for inventory
documentation. Original previews and dirty worktrees remain untouched.

Direct probe typecheck passed (exit 0). Its one run completed in 21.128 seconds,
recording fixture state SHA-256
`5ea39203188409d561d9d25af118628067aa63c9fc8e2608c8031be6639f9ebd`.
Inventory validation passed for all 536 rows, byte totals, unique location/path
keys, hash correspondence, unchanged probe bytes and resolvable document links.
