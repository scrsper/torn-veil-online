# Torn Veil presentation quality evidence

The [verified journey](verified-run/RESULTS.md) passed **51 ordinary-control checks with zero HTTP/browser/asset errors**: actual moving ascent and assisted passage, free orbit/zoom while navigating, foreign landing and reload, home return, original vessel recovery, and actual town rendering. The [exact-save restart](restart-run/RESULTS.md) passed **17 more checks with zero errors**. Verified checkpoints **11693** and **12963** prove durable replay before and after that restart/reentry/return sequence. The final [camera guard follow-up](guard-followup/RESULTS.md) passed **27 checks with zero errors**, returned to the actual town and closed normally. Exact [checkpoint 18377](guard-followup/checkpoint.json) then verified the returned body and complete saved journey under the final engine.

The [comparison gallery](verified-run/comparison.html) links original normal-quality town/flight images beside the new full captures and native head/hand/foot clips. Both use headed Chrome at 1440×900; positions, camera framing, resident assets and light/shadow workloads may differ. The character's strong capability is explicitly an isolated test fixture, not earned progression.

## What changed and what the evidence establishes

- Motion now has actual source provenance: verified CC0 Quaternius UAL bytes, `Idle_Loop` and `Jog_Fwd_Loop`, retargeted to Wren. This replaces the earlier unsupported inference from a requested animation alias.
- Both boots clear the close-view HUD; the ground world marker is absent. Ordinary 360° orbit, wheel zoom and recenter preserve gameplay heading and commands. Cruise checks require actual speed above 50 m/s and active navigation.
- Moving side flight is visible at about 852 m/s. The source pose is planet-relative ascent during those samples, not an assumed universal cruise label.
- The nearest-world camera-up transition is slower: the coarse recorded turn fell from about 59.54° to 8.77° per roughly 95 ms window. Per-frame and coarse checks passed the advertised 90°/s cap with stated engine/browser timing tolerance.
- Shadow samples stayed within 112 casters and 51,713 triangles. Atlas sampled two concurrent requests, 18 loaded models / 19 placements, no load errors, and bounded cache costs. Frustum counts do not establish unoccluded visibility or complete catalog review.
- Actual ground presentation costs more: p50/p95 20.8/27.9 ms versus the original 13.9/20.8 ms, with changed lighting/shadows/camera workload. Space and foreign-ground samples remained about 6.9/7.1 ms. No build or test workload ran during sampling.

## Preserved failures and corrections

| Evidence | Observed result and correction |
| --- | --- |
| [First run](first-run/RESULTS.md) | 29 checks before a coarse camera-up threshold failed. That measurement could not distinguish a fast smooth turn from a frame snap; its full trace was initially lost because the harness saved it after asserting. |
| [Bounded recovery](resume-run/RESULTS.md) | Foreign landing/reload and actual town return succeeded. The preserved full trace showed a fast smooth turn; one transient GET 503 was identified by code-backed inference as save backpressure. Exact checkpoint 9898 restored. |
| [Refined ground / blocked departure](final-run/RESULTS.md) | 31 checks, corrected foot/HUD framing, then an ill-placed preflight wall probe led to a blocked departure. Planned moving filenames actually showed 0 m/s at 3 m. The timeout drained reserve; this is explicitly a failed flight test. |
| [Safe recovery](home-recovery/RESULTS.md) | Ordinary Brake/Descend/Return restored the same body/items to town. Exact checkpoint 12804 restored. The harness now probes walls after the trip and safely lands/returns promptly on stalled departure. |
| [Verified journey](verified-run/RESULTS.md) | 51 checks, complete actual trip and actual town return, zero errors. Checkpoint 11693 restored. |
| [Restart](restart-run/RESULTS.md) | 17 checks, actual restored town/reentry/second return, zero errors. Checkpoint 12963 restored. |
| [Camera guard follow-up](guard-followup/RESULTS.md) | 27 checks after the zero-clearance guard, ordinary minimum zoom and bounded wall orbit, actual town return, zero errors. Final checkpoint 18377 verified. Closest observed clearance 1.29788 m; exact hide/zero-clearance cases were not reached. |

## Remaining limits and follow-up

- **U048 — radial feet/contact polish:** current ankle/foot planting is not a solved contact-IK claim. The captures verify visibility and intact geometry, not perfect stance on every slope.
- **U057 — live hide cutoff unexercised:** the verified after-trip wall probe reached 1.7165 m; the final bounded ground follow-up reached 1.29788 m, still above the 1.25 m avatar-hide threshold. Generic visibility rules passed, but neither demonstrated an actual hide/unhide cycle. The earlier near-wall inside-head failure remains preserved.
- **U059 — space readability:** the small, dark front view and upright-looking recentered flight silhouette remain visual limits. The side view clearly shows forward travel; fine cloth/wrist inspection is inconclusive.
- **Strict steady-speed pose eligibility:** no browser interval met all of 400 ms, four authoritative revisions and total-speed range at most 0.05 m/s. Actual phase/speed samples are retained; there is no blanket live claim eliminating every false-brake case.
- **U060 — zero-clearance camera target guard:** the narrow fallback is implemented; 14 camera regressions, TypeScript and the final web build passed. The short post-fix exact-save reentry/minimum-zoom/wall/return sequence passed with finite, distinct eye and target samples. The browser did not reach zero clearance, so exact-case coverage comes from the regression rather than a live reproduction.

One machine, one generated system and one endowed character were sampled. These reports do not certify all world seeds, abilities, bodies, collisions, assets or hardware. Raw traces are kept in their original run directories rather than duplicated.
