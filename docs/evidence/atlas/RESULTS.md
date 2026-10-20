# Atlas renderer presentation review — 2026-10-20

The bounded browser review loaded and instanced **42 distinct real Atlas GLBs** across the older sphere observer and Tower floors 4, 20 and 60. **13 distinct asset IDs intersected the camera frustum** in the recorded views. The captures recorded no browser exceptions, model verification failures, GLB parse failures, or shader errors. The peak number of concurrent model requests was two.

This was an automated, headed Chrome presentation review at 1440 × 900 using the explicitly unsaved `/?world&lite` observer and its survey controls. It was not a canonical campaign journey, a human playtest, or visual approval of the whole library. No user save or Atlas source model was changed.

## Coverage and evidence

The cooked catalog revision was `6ee7426147577c9f38a95b2b0dba14514a7e080f110162f64fad4730a8691b0c`. Its 1,249 compatible static models are a pool for placement, not a count loaded into one scene. The review exercised 42 of those models; the complete observed IDs are in [coverage.json](coverage.json).

The renderer's counters distinguish:

- `queriedPlacements`: deterministic candidates returned by the shared placement generator.
- `loadedIds`: distinct GLBs verified and parsed during the renderer's lifetime.
- `instances`: currently resident placements, including objects fading out.
- `visibleIds`: wanted placements whose enabled meshes intersect the camera frustum. This does not measure occlusion or prove that every pixel of the object is visible.

| Recorded view | Queried placements | Resident placements | Distinct IDs in frustum | Decoded GLB cache bytes | Instance triangles |
| --- | ---: | ---: | ---: | ---: | ---: |
| Home, east of settlement | 27 | 17 | 4 | 3,029,784 | 59,996 |
| Silver willow close-up | 27 | 18 | 4 | 3,124,564 | 61,042 |
| Landmark region 2 | 22 | 16 | 3 | 1,765,016 | 27,996 |
| Tower floor 4, targeted view | — | 1 | 1 | 163,292 | 2,248 |
| Tower floor 20, targeted view | — | 3 | 1 | 770,036 | 9,344 |
| Tower floor 60, targeted view | — | 5 | 3 | 1,375,952 | 9,576 |

[Silver willow close-up](02-real-flora-closeup.png) shows the actual `atlas:nature:tvn_flora_005` model, “Silver willow · single-stem juvenile,” with its native 3.8382 m height. [Tower floor 4](04-tower-4-prop.png) shows `atlas:local:item-TV-080` on the generated support. [Tower floor 60](04-tower-60-prop.png) shows native prop geometry on a support, with three distinct model IDs in that view's frustum. Native scale and pivots are preserved; the canonical placement already supplies its ground-offset translation.

Full positional diagnostics and errors are preserved in [presentation.json](presentation.json) and [tower-review.json](tower-review.json). The original Tower entrance capture had one loaded instance but zero Atlas models in the camera frustum; targeted support views were captured before claiming Tower visual coverage.

## Timing and budgets

Each row below samples 120 animation frames. Frame intervals use `requestAnimationFrame`; draw counts are the per-frame delta of Babylon's draw-call counter. These are short observations on this machine, not GPU timings or a cross-device benchmark.

| View | Frame interval p50 | p95 | Median draw calls/frame |
| --- | ---: | ---: | ---: |
| Matched home view, Atlas disabled | 20.8 ms | 131.9 ms | 7,534 |
| Home view, Atlas enabled | 20.9 ms | 118.1 ms | 7,707 |
| Silver willow close-up | 20.9 ms | 27.9 ms | 7,729 |
| Landmark region 2 | 20.9 ms | 27.8 ms | 7,368 |
| Tower floor 4, targeted | 7.0 ms | 7.1 ms | 12 |
| Tower floor 20, targeted | 6.9 ms | 7.1 ms | 53 |
| Tower floor 60, targeted | 7.0 ms | 7.1 ms | 94 |

The matched no-Atlas observation is in [baseline.json](baseline.json). The older wide sphere scene already has roughly 3,000 active meshes and about 7,500 draws per frame. Its initial sampling spike also occurred with Atlas disabled. These samples do not isolate the cause of that spike or establish a statistically significant performance difference.

Surface lite mode limits the cache to 16 models, 32 MiB of decoded GLB file cost and 600,000 cached triangles, with at most 40 placements, 850,000 instance triangles and 320 mesh instances. Its query range is 192 m. Normal mode uses 28 models, 64 MiB, 1.2 million cached triangles, 80 placements, 1.8 million instance triangles, 640 mesh instances and a 256 m range. Tower presentation supplies its own lower triangle and byte budgets. Pending requests reserve their costs; at most two requests/parses and two scene instantiations are allowed at once/per frame respectively.

The byte counter is the sum of decoded GLB file lengths. It is **not** measured JavaScript or GPU allocation; decoded textures and renderer overhead are not represented by that number. Nearby placement queries run at most every 0.5 seconds unless the observer moves 10 m or changes context. Fade and camera-origin updates continue each frame.

## Verification and resolved defects

`npx tsc --noEmit` passed. The targeted run of `tests/atlas-renderer.test.ts` and `tests/web-boundary.test.ts` passed **13 tests**. Renderer tests cover verification before parse, response byte bounds, external-resource and unstaged decoder rejection, native handedness, request reservations, cache eviction, camera-origin placement with Babylon vectors, disposal during late parse completion, and rejection of geometry exceeding cooked costs.

During implementation, the initial east/up/north transform was identified as a reflection. Renderer and collision now agree on a proper rotation, preserving asymmetric native meshes. Visibility diagnostics were also corrected to distinguish resident models from camera-frustum candidates. The first development pass's accumulated draw counter and resident-only visibility labels are excluded from these results.

Browser model loading uses the local allowlisted hash URL and verifies the decoded SHA-256 before Babylon parses it. It rejects external model dependencies and decoder extensions without a staged local decoder. Missing or rejected geometry is reported; the renderer does not create substitute collision boxes.

## Remaining findings and next work

1. The older sphere observer's existing mesh/draw volume deserves a separate optimization pass. Reproduce at the home east survey view with `?world&lite&atlas=0`; batch existing static geometry before attributing its cost to streamed Atlas models.
2. [Landmark region 2](03-landmark-region.png) shows an existing raised roof/block in the focused landmark dressing. That geometry is separate from the streamed Atlas placement list. Inspect the landmark generator and its terrain support before changing placement logic.
3. Canonical campaign collision, identity persistence, ability-gated personal flight, and settlement traversal require the separate host acceptance journey. The observer review and these screenshots do not certify those behaviors.
4. Forty-two loaded models are a bounded sample of 1,249 compatible static entries. Additional authored scene, biome, extreme pivot, and material coverage remains useful. Static compatibility does not confer art approval, interaction semantics, NPC behavior or animation readiness.
5. Cache byte estimates do not measure actual GPU memory, and there are no authored mesh LODs in this change. Distance selection, bounded instancing and opaque screen-door fades control streaming. GPU memory profiling and staged local compressed-geometry/texture decoders remain future work.

The local Vite review host used port 7535 with HMR disabled to keep concurrent implementation edits from invalidating captures. A prior development capture interrupted by HMR was rerun; it is not reported as a product failure.
