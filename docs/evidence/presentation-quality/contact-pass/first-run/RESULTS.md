# Contact pass — ground evidence and safe wrap-up

The ordinary-input ground route reached flat paving, the 6.25 cm paving transition, and the authored slope, then returned. **23 checks passed before a harness departure-position assertion failed.** The recovery path returned through ordinary UI to the fully rendered town and closed the browser. No flight began. The subsequent user request to wrap up ended the remaining flight and restart acceptance scope; it does not erase the earlier assertion failure.

[Raw journey](journey.json), [ground trace](contact-ground-route.json), [comparison gallery](comparison.html), and [final town screenshot](contact-route-stopped-town.png) preserve the run. There were zero recorded HTTP, browser, runtime, or required-asset errors. The host was then shut down gracefully.

## Measured ground contacts

The trace contains 5,002 rendered frames over 112.4 seconds, 55 ready source-support patches, and at most 312 triangles per patch. Measurements use 12 actual skinned Wren boot vertices per foot, identified by source mesh and vertex, rather than ankle height. Every tenth frame was independently compared with the received source triangles: **11,687 comparisons, zero disagreements above 2 mm**, maximum numerical difference 1.25e-13 m.

| Aggregate eligible contact metric | Left foot | Right foot |
| --- | ---: | ---: |
| Eligible frames | 2,957 | 2,872 |
| Stationary frames | 2,544 | 2,514 |
| Stationary p95 absolute minimum sole gap | 0.026 mm | 0.025 mm |
| Maximum settled same-lock tangential drift | 0.298 mm | 0.257 mm |
| Longest raw penetration episode above 3 cm | 48.7 ms | 62.5 ms |

These are aggregate eligible-window measurements, dominated by flat/step coverage. **They do not establish complete slope planting.** The summary names each window by its starting stage, so the right-foot window acquired during `slope-side` also includes later slope idle. A final read-only check of the actual per-frame `slope-idle` stage found 825 frames: the left foot had **zero eligible frames**, while the right had **825 eligible frames over a continuous 20.19-second window**. The left foot repeatedly released and reacquired; its slope behavior remains unresolved (U-065). The raw frames retain the evidence for later diagnosis. Selected distal hull vertices do not certify every boot triangle or every rendered grass/underlay surface.

Close views retain both feet above the HUD. Measured rig-landmark height is approximately 346–396 px in the close captures; that is not a full-mesh pixel mask. Ground capture frame p50 was approximately 20.7–27.7 ms and p95 27.7–34.8 ms; the initial preview p95 was 41.7 ms. Capture draw counts ranged from 373 to 1,039. This is one machine and one fixture, with no concurrent build/test workload.

## Harness failure and safe result

The final departure waypoint was `(11312.5, 3095)`. Its last feedback observation was only 0.268 m away; after releasing input, waiting, and recentering, the final position was approximately `(11312.212, 3092.664)`, 2.35 m from the target. The subsequent 1 m departure assertion failed (U064). A queued input or settling tail is plausible, but the trace does not establish a collision defect. No takeoff was attempted and mana remained 320.

The recovery used the ordinary Return control and waited for actual town readiness: 81 chunks, 55 focused instances, zero pending. Identity remained `p_5` / `b_5`, with all five inventory records unchanged.

[Checkpoint 10649](checkpoint.json) was verified after graceful shutdown using engine `28105623556baaf54ee1970df52aeddaa63118d14009a730ef05074da16f7b96`: inactive expedition, body present in town at `(11311.288343251204, 1.0625, 3093.0468207969448)`, returned event `e_289`, one discovery, five inventory records, and mana 320. This verifies durable restore, not a new browser restart/reentry cycle.

## Scope retained for later

No new ascent, moving-flight silhouette, foreign landing/reload, home flight return, or browser restart acceptance is claimed for this pass. The new flight pose, altitude lighting, and framing changes therefore retain source/test evidence only. Prior successful journey evidence remains in the earlier verified-run directories. Before this run, the frozen source passed the final 56 targeted tests, TypeScript checks, and plain Vite build; actual-rig checks are documented separately in [RIG_CHECK.md](../RIG_CHECK.md).
