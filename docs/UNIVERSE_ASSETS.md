# Universe release assets and setup

This release adds code, metadata and evidence, **no new binary model or animation
files**. The Atlas catalog describes 1,249 static-compatible models; those models
are not bundled by this change. Existing character/focused-world assets and their
credit files remain in place.

## Clean-checkout campaign setup

From the repository root, install dependencies and cook the tracked focused pack:

```powershell
npm ci
node scripts/web/cook-focused-assets.mjs
node scripts/web/stage-human-motion.mjs
```

The focused cook verifies the source manifest and writes its ignored collision
output. Human-motion staging uses the already tracked
`tools/ontology/public/assets/library/quaternius-ual/model.glb`; no external motion
download is needed. Its 7,618,436-byte SHA-256 is
`69591853d817488edaa8fd9bf8fc1d821eaeaf789f8627b3cd23b41c4ed67997`.
`TV_HUMAN_MOTION` or `TV_REALMS_ASSETS` may supply the same verified bytes. A different
existing staging target is preserved and refused. The campaign launcher also runs
this staging step. See [motion provenance and limitations](CHARACTER_MOTION.md).

For Atlas scenery, point `TV_ATLAS_ROOT` to an existing authorized Atlas install
whose `public` directory contains the catalogued revision, then launch:

```powershell
$env:TV_ATLAS_ROOT = 'D:/YourAuthorizedAtlasInstall'
npm run universe:campaign
```

Without that override the host checks `TornVeilAtlas` under the current user's home
directory. This is an install root, not the `public` subdirectory. No Atlas download,
copy into Git or permission grant is performed. Missing or changed models return
503 and are reported as asset failures; canonical collision proxies are independent
of rendering, so an absent install is **not a complete visual/play acceptance
configuration**. Do not describe missing scenery as intentionally empty terrain.

Use `TV_REALMS_SAVE` only to select the intended campaign and `TV_REALMS_PORT` for a
free local port. Ctrl+C asks the host to checkpoint and close; wait for completion.
Creator staging is a separate existing entry point (`npm run web:creator`) when
using the creator/UI that requires it. It does not stage the separately restricted
female VRM, and this release neither changes creator selection nor grants rights
to redistribute local models. Full `play:build` still has its existing audited
private motion dependencies; the campaign's CC0 fallback does not remove them.

## Provenance and portability boundaries

- UAL Standard is Quaternius CC0. The checked-in source predates this release;
  staging and runtime both verify its exact content hash. See the
  [author's pack page](https://quaternius.com/packs/universalanimationlibrary.html).
- Ranger/Wren retain their existing MPFB/MakeHuman and garment credit obligations
  in [CREDITS.md](../web/public/arena/people/CREDITS.md), including the existing
  CC-BY clothing credits. Their source geometry and textures are not replaced.
- The Atlas cook considers 3,007 records, measures 1,850 unique decoded models,
  and marks 1,249 static-compatible. Compatibility is not license clearance or
  proof every asset has appeared on screen. Source statements remain provenance;
  the local collection still requires its owner's authorization. The NCSoft/Aion
  and native-buffer exclusions remain. Counts, exclusions and reproducible cook
  commands are in [ATLAS_CATALOG.md](ATLAS_CATALOG.md).
- The model endpoint serves only catalogued hashes from the installed realpath
  root. It checks transport/decoded hashes and size; it does not fetch remote model
  dependencies or install a runtime CDN decoder. The source cook excludes 51
  rebuilt models with unresolved relative texture sidecars.

The CI gate cooks focused collision and stages the hash-verified tracked UAL input
before running the actual imported-rig tests and both client builds.
Atlas render acceptance requires the authorized external install. Manually running
local imported-rig tests without staging can still skip them; a green suite is
not proof that all 1,249 models were loaded. The existing verified journey sampled
18 distinct loaded Atlas models and 19 placement IDs, documented in its
[report](evidence/presentation-quality/verified-run/RESULTS.md).

## Publication audit, 20 October 2026

The pre-release local ancestry had 90 commits not reachable from origin, including
earlier history explicitly recorded as private in `.ai/STATE.md`. Preserve that
local history and publish a new release snapshot parented by current public main;
do not infer publication permission for historical metadata from a clean final
tree. This avoids rewriting or force-pushing the preserved work.

Bounded read-only screening found no strong credential patterns in 522 reachable
text blobs and no restricted-model/private-key filename matches among 677 newly
reachable blobs. No blob exceeded 50 MiB; the largest was the 27.8 MB contact trace.
The feature commits' blobs total about 232 MB before Git compression, mostly visual
evidence. These checks are not a blanket licensing certification or a guarantee
that heuristic secret detection can find every secret. No raw private asset or
credential was printed, copied, uploaded or granted new permissions by this audit.
