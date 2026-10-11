# Connected realms: observed verification, October 8, 2026

This records the independent realm-foundation checkpoint **before** the authorized Tower handoff was integrated.
It is the `codex/connected-realms` candidate based on `caeec71`, using the existing Babylon client and
canonical World/Simulation. Screenshots and video are actual rendered gameplay, not generated concepts or
retouched reference images. They show the bounded foundation, not finished megacity fidelity.

## Checks

| Check | Result |
| --- | --- |
| Focused realm/web boundary checks during implementation | 15 tests passed. |
| Realm/persistence/bridge-streaming/web-structures checkpoint | 30 tests across five files passed. |
| Schema 26 with explicit schema 24/25 legacy compatibility | 16 tests across realm/persistence files passed. The old hardcoded version-25 assertion was deliberately updated for the schema change; migration assertions were added. |
| Full default `npm test` | Initial run: 187/193 files passed; 1,879 tests passed, 8 failed, 30 skipped. Five harness files hit sandbox `uv_os_get_passwd ENOMEM`; the sixth failure was the ecology test's outdated schema-25 expectation, corrected to 26. |
| Final affected-file retry, plus realm/persistence tests | **57/57 tests passed across eight files**, zero failed/skipped, with normal reviewed Windows profile access. Together with the full run this covers all **1,917 default-suite tests**. No budgets or behavior assertions were relaxed. |
| `npm run web:build` | Passed, including TypeScript and the production Babylon bundle. The first sandbox attempt could not read ancestor directories for esbuild config resolution; the identical build passed with normal reviewed access. |
| `Play Torn Veil.cmd -CheckOnly` | Passed with the actual launcher invocation. |
| `node scripts/web/realms-journey.mjs` | Passed, zero console/page errors. Actual ordinary keys/buttons, no teleport or world-mutating browser test API. |
| Final aperture correction | 15 realm/boundary tests passed and production build passed. Windows/bands were removed from the actual entrance aperture after the close-up art review. The journey measurements above predate this small facade correction. |

The journey opened and entered the Tower's real doorway, returned to the square, canceled portal travel,
crossed to Cinderveil, traversed more than 95 metres across a streaming boundary, returned to Aether,
saved/reloaded, and made two further crossings. It compared the same Person/rank/inventory on each transition
and after reload, and confirmed the opened Tower door survived. All seven captured views had 81 chunks loaded
and zero queued chunks. Canonical tests additionally cover seed/order reproducibility, continuous road borders,
cache eviction, persisted edits, wall collision/shared navigation, duplicate transition rejection and canceled
disconnect/reload choices. These are automated checks, not a human gameplay or balance acceptance.

The full run took 1,970.81 seconds. Its log is `.debug/realms/full-tests.log`; the final targeted report is
`.debug/realms/final-retry.json`. Retry files were `live-alpha-server`, `web-differential`, `web-gateway`,
`checkpoint-encoder`, `dialogue-live`, `ecology-realtime-integration`, `realms` and `persistence`.
The realm retry includes the final added assertion that a saved raw voxel edit survives regeneration and
changes canonical navigation height. Ordinary realm interaction does not expose general voxel editing.

## Inspected captures

- [Aether portal](06-returned-aether.png): sci-fi street and the working portal after a round trip.
- [Cinderveil street](04-streamed-brass-street.png): a traversed fantasy/steampunk avenue beyond the initial chunk.
- [Cinderveil portal](03-cinderveil.png): arrival through the same portal mechanism.
- [Tower landmark](07-tower-landmark.png): exterior in the square, framed through normal look/move input.
- [Tower atrium](02-tower-atrium.png): physical entry, pillars, side rooms and return aisle.
- [Character panel](05-shared-character.png): the shared character and ordinary inventory after return.

[Before lighting](before-lighting.png) is the **first visual implementation pass of this new feature**, not a
baseline screenshot of the older Veil client. It documents the dark lighting/sign issues corrected during this
task. Final captures also verify the sky dome clipping and floating spire fixes. Viewpoints/time differ, so
these images are not a controlled material A/B or a quantified fidelity comparison.

The local recording is `.debug/realms/verified-journey/traversal.webm`: 104.56 seconds, VP8, 1440 x 900,
20,855,581 bytes, checked with ffprobe. It remains local/ignored to avoid adding video weight to source history.
The unabridged observed buffers are beside it in `results.json`; this directory commits their compact
[measurement summary](measurements.json). Reproduce with `TV_REALMS_EVIDENCE` set to a new directory and
`npm run realms:journey` against the local host. Never use a user's live save for QA.

Rendered media and private delivery receipts remain local. No user reference image or third-party source asset was uploaded.

## Observed cost, not a megacity benchmark

Headed Chrome, WebGL 2 through ANGLE/D3D11, 1440 x 900, balanced quality, native video recording. The actual
GL renderer identified **AMD Radeon RX 6650 XT**. Ryzen 5 9600X / 32 GB RAM / 8 GB VRAM are the supplied machine
target, not independently verified memory-capacity measurements. WMI hardware reads were unavailable. The
full simulation regression suite continued in the background during capture. This is a development-host
measurement with recording and uncontrolled other workloads, not an isolated production-build benchmark.

| Observed buffer at capture | Samples | Median | p95 | p99 / maximum |
| --- | ---: | ---: | ---: | ---: |
| Settled frames at streamed Cinderveil street | 3,600 | 8.0 ms | 10.2 ms | 11.5 / 14.7 ms |
| Settled frames after reload/crossings/exterior view | 458 | 10.2 ms | 14.7 ms | 16.6 / 18.4 ms |
| Frames while loading, before reload | 293 | 9.1 ms | 32.4 ms | 247.1 / 297.5 ms |
| Chunk uploads, before reload | 293 | 0.8 ms | 5.1 ms | 9.5 / 251.9 ms |
| Simulation steps at the return/journal view | 600 | 0.30 ms | 0.48 ms | 0.64 / 2.71 ms |

Frame numbers are render-loop wall intervals, not GPU timestamp queries. Settled-frame samples explicitly
exclude frames with queued chunks; loading costs are separately reported rather than hidden. Buffers overlap
between capture rows and reset on browser reload; do not add their sample counts. Simulation step samples
exclude descriptor projection, transport and save serialization and cover only **four residents plus player**.

First authoritative realm state to all 81 chunks resident: 2.489 s on first visit and 1.682 s after reload.
Four subsequent portal streams took 0.852, 0.714, 0.955 and 0.817 s. These intervals exclude earlier page/module
loading and begin after the host has accepted the crossing. Initial uploads still stall around a quarter second;
one-chunk-per-frame upload does not yet provide a hard frame-time budget. Worker generation/upload splitting
and shader/material warmup are required before claiming seamless city streaming.

Observed JS used-heap snapshots ranged from approximately 155 to 249 MiB. Final host RSS was 259.6 MiB and
host used heap 133.5 MiB. These are process/JS observations, **not GPU memory/VRAM**. After both material/body
sets warmed, 209 textures and 175 materials remained at the checked crossings; visible chunk residency remained
81. This bounded journey is not a long soak or a proof that memory never grows.

## Limits and next milestone

The cities remain visibly repetitive, with sparse residents, flat streets, no functioning city economy or flying
traffic, mostly decorative upper floors and unfinished lighting. The Tower atrium is enterable; expedition ascent
and world-Person progression binding are pending the separately authorized Tower handoff. Current shared bodies
are placeholders; the user's rejection of their quality is not treated as acceptance. General voxel remodelling
is not exposed and its live facade projection is unfinished. These limits are visible in the evidence.

Next: accept the Tower's stable authorized commit, implement the host-owned identity/receipt/return contract,
adopt the character owner's validated assets, author richer structural/street/interior kits, connect inhabited
places to canonical economy/knowledge systems, then profile longer traversal and production builds. The versioned
seed/realm/district/building hierarchy and bounded projection provide an expansion path; they do not prove a
finished world at the reference's scale. See `../../CONNECTED_REALMS.md` and `../../CONNECTED_REALMS_INTEGRATION.md`.
