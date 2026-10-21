# Presentation quality — bounded recovery

This run resumed the exact active isolated save from the [first run](../first-run/RESULTS.md), using ordinary controls. It preserved the first failure and wrote a new evidence directory. No production source changes occurred while the host was live.

**The canonical return completed: 14 checks passed, foreign landing/reload succeeded, and the original body/inventory returned to the fully rendered town.** The final zero-error assertion failed because one `GET /realms/universe` returned 503 during home landing. Its browser console message and HTTP route remain in [journey.json](journey.json). No command rejection or asset failure was observed. The response body was not retained, so the exact server reason must be established from host diagnostics; do not call this a zero-error run.

The camera threshold was recorded without aborting recovery. There was one nearest-world switch. The largest up-vector change over approximately 95 ms was **1.039158 rad / 59.54°**; the largest change between consecutive render frames was **0.103355 rad / 5.92°**. This supports a fast smooth turn rather than the coarse test's implied whole-frame snap. The complete coarse trace and a bounded list of per-frame peaks are retained. The first peak-list implementation stopped collecting after 60 increasing peaks, so its final entry is not the overall maximum; the separately maintained `maxFrameAngle` is the maximum across the whole route.

## State and presentation evidence

- Foreign landing and reload retained `p_5` / `b_5`, all five inventory entries and quantities, and the original parked vessel. The HUD correctly named the vessel's actual world.
- [Moving return side view](17-return-cruise-side.png) shows approximately 324 m/s, with actual motion phase `ascent`. The hero has a coherent horizontal flight silhouette, but is dark and small; it does not establish detailed wrist/cloth quality.
- [Home landing](15-returned-home.png) restored vessel access and `canReturn:true`. Home pre-return mana was about 86.66; both discoveries remained.
- [Actual returned town](16-returned-town-ready.png) was ready with 81 chunks, 55 focused instances, no pending instances and the enabled controlled `b_5`. Canonical position was `(11313.487925510628, 1.0625, 3093.1195690374416)`.
- Inventory remained Threshold atlas ×1, Travel provisions ×3, book-well ×1, book-ward ×1, Isolated flight acceptance focus ×1.

The browser closed after town readiness. The parent then gracefully stopped and verified checkpoint **9898** from this exact save: inactive expedition, present `p_5` / `b_5`, all five inventory entries, two discoveries, original vessel and returned event. `endUniverse` in the report is deliberately the home snapshot immediately before the return command; `endTown` records the actual post-return renderer. A subsequent browser restart/reentry remains separate coverage.

Read-only code review classified the 503 as expected save backpressure by inference. `RealmUniverseApi` returns 503 for either its temporary `busy` fence or a latched host failure; this same host immediately recovered, accepted return and restored checkpoint 9898, which rules out the latched failure branch. The GET busy branch returns “Saving the crossing. Try again shortly.” The original response body was not captured, so that text is established from code, not claimed as an observed response. The next harness records the exact reason and accepts backpressure only when that specific message is followed by a successful GET; raw console/HTTP entries remain retained.

| Capture | Frame p50 / p95 | Sampled draw calls |
| --- | --- | --- |
| Foreign ground | 6.9 / 7.1 ms | 107 |
| Reloaded foreign ground | 6.9 / 7.1 ms | 107 |
| Moving return side view | 6.9 / 7.1 ms | 41 |
| Returned home | 14.0 / 20.9 ms | 363 |

Each sample contains 120 animation frames, with no concurrent test/build suite. Camera framing differs from the prior comparison. The same closeup/HUD overlap, dark-space silhouette and near-wall coverage limitations from the first run remain open.
