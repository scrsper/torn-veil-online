# Character bases — actual game loading verified; visual review and optional-resource errors remain

## Maestro browser execution — 15:13–15:19 CT
Parent independently passed32affectedtests/7files and completed build `ac29fb8d64c7ac25caa72fb1b2b40651c94669af612748329454659801116b5f`. Real headed Chrome loads actual female player and male/female NPC rigs; ordinary movement, guard/release, browser identity retention and same-save host restart identity/inventory/HP/position checks passed. Strict capture still exits failure because optional Mixamo/unarmed GLBs return404. Pixel review pending; full combat/door gates not accepted. See [parent verification](evidence/character-base-integration/MAESTRO_BROWSER_RESULTS.md) for exact evidence and scope. This supersedes earlier 'browser pending' execution status, not remaining visual/gameplay limits.

## Focused image-loading fix — 22 October 2026, 15:12 CT

The parent verified TypeScript, 56 tests/14 files and build `fe81c5d02e85701292c38784089b262056bd03f66169d57c2a03b00e699e3d5f`, then reproduced a real browser failure: Babylon rejects the original hair image URI `../textures/HairPreview_5861b9f16735.png`, so every eligible character fell back. That failed browser report remains [here](evidence/character-base-integration/browser-2026-10-22T19-53-15-036Z/results.json). Port7541 had no listener and `.debug/foundation-session.lock` was absent before this fix; both remain stopped/released. One read-only reviewer assisted; this worker was the sole writer.

The regression ran **before the staging fix**: both original pinned hair GLBs reproduce Babylon's exact URI rejection, while the full adapter test failed. [Before report](evidence/character-base-integration/image-regression-before.json). The fix completes the inherited derivation helper: staging keeps all 47 original files byte-identical and creates two separate `derived/hair/*.glb` files. Each appends the exact pinned PNG to the binary chunk and replaces only its image URI with a glTF bufferView/mimeType. Geometry, skinning, materials, extras and existing binary bytes remain unchanged. Original/derived/image SHA-256 values and transform `embed-external-images-v1` are recorded in the private manifest and [derivation receipt](evidence/character-base-integration/image-derivations.json). Source pin SHA-256 remains `26d068fc4478e4d9d54dd4005b50f3b8215ef8b9c05005f057ba41d3408a57e1`, matching the parent's prior build manifest.

The manifest selects derived hair for both sexes, retains original part pins, and validates derivation receipts. All 50 runtime files (47 originals, two derived GLBs, manifest) enter the existing private build fingerprint/output verification. Every dependency uses one path resolver: percent decoding, relative normalization, explicit-root containment and checks for redirected ancestors; absolute/network/drive paths, escaping parents, encoded escapes and Windows path aliases are rejected before reads/copies. The auxiliary DIRO mask follows the same pinned-resource contract. Other material texture metadata does not cause additional runtime requests. Babylon URL validation and failure/fallback handling remain enabled. No source GLB/pin, public allowlist, save format or fingerprint exception changed; derivation grants no additional distribution rights.

**Verification:** TypeScript passes. The final three actual-image regressions pass with zero skips, alongside 29 passing affected checks in the other six files (32 total across 7 files). [Final image report](evidence/character-base-integration/image-regression-after.json); [affected run](evidence/character-base-integration/image-fix-tests-final.json). The latter retains the superseded decode-count assertion failure; the final image report replaces those three image results. The test uses Babylon's real glTF URI/material/image loader with materials enabled and real pinned GLBs/PNGs. Its NullEngine texture backend checks PNG CRCs, inflates IDAT and reconstructs filtered pixels; it verifies all source material texture hashes, both hair previews, shared DIRO, unchanged binary geometry/scene data, and actual PNG corruption causing fallback. This is loader/CPU image-decode evidence, **not native-browser/GPU rendering evidence**. Containment, pin/derived tampering, junctions, manifest receipts, rig/instance behavior, launch/shutdown and web boundary are covered.

One scoped build attempt passed staging/typecheck, then hit the known sandbox Vite/esbuild `Cannot read directory "../../..": Access is denied` error. [Build log](evidence/character-base-integration/image-fix-build.txt). This is an execution-environment limitation, not a project build failure. No retry/bypass, host, new save, migration or rendered-success claim. The existing parent build is stale for these new bytes. The two old browser 404 messages contain no resource URLs, so their exact resources remain unknown until the corrected capture runs; it now records HTTP URLs/request failures and clicks **Begin journey** before movement. Harness syntax check passes.

Parent completion commands, in this checkout after this worker exits:

```powershell
# Already restaged here; this command is repeatable and must preserve the existing pin.
node scripts/foundation/stage-character-bases.mjs --source C:/Users/green/Documents/Codex/2026-10-22/task/source-current/public/assets
node node_modules/typescript/bin/tsc --noEmit
$env:TV_REQUIRE_CHARACTER_BASES='1'
node node_modules/vitest/vitest.mjs run tests/character-base-runtime-images.test.ts tests/character-base-staging.test.ts tests/character-base-adapter.test.ts tests/character-base-studio-rig.test.ts tests/foundation-launch.test.ts tests/foundation-shutdown.test.ts tests/web-boundary.test.ts
node scripts/foundation/build.mjs
node scripts/foundation/play.mjs --acceptance --no-open
# In a second terminal, only once that fresh owned host is ready:
node .debug/character-base-scratch/capture.mjs
# Then type shutdown in the owned launcher and retain its exact new save path.
```

All older QA worlds remain intact and unmigrated. No source publication/upload/storage/workflow/global configuration changes or vault writes. Parent owns vault logging. Git metadata is outside the writable checkout (`torn-veil-online/.git/worktrees/torn-veil-foundation`), so no commit/staging is claimed; inherited unrelated dirty files remain unstaged.

## Earlier adapter handoff — historical verification scope

22 October 2026, 14:48 CT. The private foundation now has a real Babylon loader for covered female and male characters, per-rig CC0 retargeting, source-aware eye/hair materials and independent actor instances. **Both actual rigs are loaded and posed in tests. No fresh game bundle, GPU shader acceptance or screenshots were produced:** Vite/esbuild cannot read its parent directory in this sandbox. Existing foundation work and saves remain intact.

This replaced the selection-only handoff. Unfinished adapter/staging code was already present at takeover and was completed here. One delegated reviewer was read-only; no concurrent writer was spawned. Port7541 was idle, the foundation lock absent and inherited adapter timestamps stable before edits. Windows denied process command-line inspection; prior-writer completion relies on Jacob's explicit handoff. The named `character-base-integration-task.txt` was not found in accessible checkout/task locations; the latest direct request and corrected contracts governed this work.

## Provenance

Jacob said **“Original work from another computer I work on.”** These assets are **user-attested original work; authorship and licence history were not independently audited**.

Read-only source: `C:/Users/green/Documents/Codex/2026-10-22/task/source-current/public/assets`, supplied `scrsper/veil-media-studio@d05e112e5a6d646301cb6472ee5caefef95cf8a0`. No source, transfer marker, remote, workflow, paid storage, save or vault changes. Parent owns vault logging. No upload or publication.

## Actual composition and staging

| Base | Covered parts | Head and hair |
| --- | --- | --- |
| Female | `Veil_Female_BaseBody.glb`, `BasePants`, `BaseBoots` | `Veil_Female_Head_039.glb`, `hair/Veil_Female_Hair_001.glb` |
| Male | `Veil_Male_BaseBody.glb`, `BasePants`, `BaseBoots` | `Veil_Male_Head_005.glb`, `hair/Veil_Male_Hair_001.glb` |

These are the source's default head choices. **OriginalSkin, Underwear and SkinFull are excluded.** OriginalSkin is the unclothed preview branch, not a layer beneath this outfit. Earlier head001 inspection is historical, not the selected runtime head.

`scripts/foundation/character-bases.pin.json` pins **47 files / 110,314,218 bytes**: ten GLBs, their direct texture dependencies, and `textures/T_Hair_03_DIRO.png`. Hair mask: 4,249,970 bytes, SHA-256 `a915d85d93b95fcd041be2673f9330e3f2358fc4ad2e762ff119457863a7c973`. Every existing pin stayed unchanged when this shader dependency was added.

Copies live only in ignored `.private-assets/character-bases/`. Staging verifies source/copy bytes, rejects changed pins and unpinned extras. **Staging is the local opt-in**: when present, the foundation build copies the exact files into `dist-foundation/private-character-bases/`. There is no `--private-character-bases` flag. Private files join the existing source/assets/runtime fingerprint and output manifest; no fingerprint bypass. Public allowlist, `web/public`, general release path and save checks stay unchanged. Existing exact Babylon core/loaders9.28.0 are used; no dependency install/lockfile change.

## Runtime behavior

- `studioBases.ts`: strict private manifest, sequential loading, partial-failure cleanup, required-bone validation, awaited hair decoding/error propagation, explicit fallback status and reusable containers.
- `studioBaseRig.ts`: independently clones every covered part, links overlapping bones to the actor's canonical joints, adopts head-only face and toe joints under their canonical parents, and aliases the Bip001 rig for existing motion, foot contacts, gaze and equipment. All eight skin influences remain present.
- Entities own nodes, skeletons, morph managers, mutable materials, texture wrappers and AnimationGroups. Underlying GPU images may be reference-counted/shared. Disposal releases owned resources while preserving other actors and templates.
- `ArenaAssets.registerRig` / `riggedInstance`: bake each sex's own rest pose. Verified **CC0 Quaternius UAL** supplies idle/walk/jog/sprint; existing **CC0 KayKit** supplies mapped guard/attack/hit/death fallbacks in the local foundation. Supplied GLBs contain zero animations.
- `studioMaterials.ts`: Babylon PBR plugin interprets iris masks (UV scale.40), AO/tear masks and DIRO hair. Hair is linear, V is halved exactly once, alpha uses `pow(mask.a,.66)`, cutoff.18. Plugins attach after cloning. Hair/eye overlays are excluded from incompatible shadow-mask casting. Skin uses Babylon PBR with modest translucency. Full studio lighting, skin-normal/cosmetic and anisotropy parity are **not claimed**; GPU compilation and appearance still require browser acceptance.
- `SharedCharacters`: player and projected residents use the same eligible adult human/elf route. Existing +Z-to-canonical-minus-Z rotation, metre normalization, actual motion and equipment paths are reused. No canonical physiology, progression, save schema or outcomes were invented.

Only human population currently exists in the town. Elf routing is supported as an input contract; no elf NPC, physiology or pointed-ear artwork is claimed. Children/adolescents/unknown age or sex/unsupported species stay outside adult studio eligibility. One face/hair/outfit per sex is integrated. The deterministic identity seed remains available; broad facial/body customization is not implemented.

Inspect `window.tvRealms.inspect().controlledLook.characterBase` and `.residentLooks[].characterBase`: actual base, composition, missing bones, provenance and fallback reason are reported.

## Verification

**Final TypeScript passes. 56 tests in 14 files pass, zero failed/skipped.** Evidence: [final-verification-tests.json](evidence/character-base-integration/final-verification-tests.json). Includes held-input, foundation launch/shutdown, web boundary, selection, shared cast/motion, retarget and actual studio rig checks. `TV_REQUIRE_CHARACTER_BASES=1` makes absent staging fail this acceptance run. Clean checkouts may skip the private-asset test because binaries are not distributed.

Test-first: three new regressions failed for material sharing, malformed manifest exceptions and false acceptance of incomplete rigs; all fixed. The staging test fixture's attempted escaped file write was corrected without weakening the rejection assertion. The texture-disposal assertion was corrected to inspect owned wrappers/source disposal instead of assuming source-container textures remain registered in the scene. Earlier failed reports remain historical.

Actual-file tests verify both sexes, required aliases, face/toe linkage, eight influences, boot-skin motion and instance isolation, independent morphs, boot sole geometry, metre bounds, sampled upright idle/walk poses, finite CC0 guard/attack/hit/death tracks and disposal. Material/texture success and failure paths use controlled NullEngine fixtures. The real-rig test disables material decoding: this is **not GPU shader or gameplay evidence**.

`node scripts/foundation/build.mjs` cooked46 focused sources, verified/staged motion/private assets and typechecked, then Vite/esbuild failed:

```text
Cannot read directory "../../..": Access is denied.
Could not resolve .../scripts/foundation/vite.config.mjs
```

No permission changes or alternative-host/fingerprint bypass. Lock released normally. Final texture-readiness/shadow corrections were tested/typechecked after this attempt; a fresh parent build remains required. No new host/save/screenshots/death view or same-save host restart acceptance. Old builds/evidence are not relabelled.

Scoped `git add` failed at `C:/Users/green/Documents/projects/torn-veil-online/.git/worktrees/torn-veil-foundation/index.lock`: Permission denied. Index stays empty; no local commit or push and no unrelated prior dirty work staged.

## Exact parent-terminal exercise

Use one Node runtime in this checkout. Finish source edits before launching; preserve old saves/acceptance markers.

```powershell
# Optional restaging; does not rewrite the existing pin.
node scripts/foundation/stage-character-bases.mjs --source C:/Users/green/Documents/Codex/2026-10-22/task/source-current/public/assets
node node_modules/typescript/bin/tsc --noEmit
$env:TV_REQUIRE_CHARACTER_BASES='1'
node node_modules/vitest/vitest.mjs run tests/character-base-adapter.test.ts tests/character-base-studio-rig.test.ts tests/character-base-staging.test.ts tests/character-base-selection.test.ts tests/shared-cast.test.ts tests/retarget-ownership.test.ts tests/retarget-posture.test.ts tests/retarget-sample.test.ts tests/shared-human-motion.test.ts tests/radial-footplant-import.test.ts tests/realm-held-input.test.ts tests/foundation-launch.test.ts tests/foundation-shutdown.test.ts tests/web-boundary.test.ts
node scripts/foundation/build.mjs
node scripts/foundation/play.mjs --acceptance --no-open
```

Once that owned host is ready, run in a second parent terminal:

```powershell
node .debug/character-base-scratch/capture.mjs
```

This **syntax-checked but unrun** local Playwright harness opens headed Chrome, verifies current source/build fingerprint and acceptance-save location, and captures player/NPC, walk, guard/release, requested attack, orbit and browser-reload views with JSON under timestamped `docs/evidence/character-base-integration/browser-*`. It does not directly mutate canonical state, grant equipment, force encounters or fake death. Inspect images for both sexes, covered geometry, face/hair/skin, seams, foot contact, yaw and independent NPC motion. It requires an eligible observed NPC but does not guarantee both sexes are currently perceived. Ordinary navigation/orbit may be needed. No screenshot is claimed until it actually runs and images are reviewed.

Browser reload is not host restart. Type `shutdown` in the owned launcher, wait for checkpoint/normal exit, then use only its newly printed path:

```powershell
$env:TV_FOUNDATION_SAVE='<exact fresh .debug/foundation-acceptance/.../world.json>'
node scripts/foundation/play.mjs --continue --no-open
```

Verify identity, equipment, actual base and canonical state retention, then stop gracefully. Combat contact/damage and death still require ordinary simulation-driven acceptance. Automated input is not a human playtest. No full browser suite or `play:build` is required for this scope.

## Pending daily entry for parent (not written to vault)

> [Codex, 22 Oct 2026, 14:48 CT] Completed private clothed male/female Babylon loading, CC0 retargeting, source-aware materials and isolated instances; 47 pinned files. Jacob attests original authorship; licence history is not independently audited. TypeScript and 56 tests in 14 files pass. Sandbox access blocked bundling and Git staging, so rendered screenshots and restart acceptance remain for the parent terminal. No push, supplied-source changes or vault writes. Handoff: torn-veil-foundation/docs/CHARACTER_BASE_INTEGRATION.md.
