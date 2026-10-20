# Presentation quality — first run

2026-10-20, headed Chrome 1440×900, normal quality. Isolated host `7533` used the exact parent-created `.debug/atlas-flight-qa-2026-10-20T18-16-55-084Z/world.json` capability fixture. The harness checked the host save path before opening the browser. No save edits, ability grants, observer teleports or movement injection were performed.

**Incomplete: 29 checks passed, then the sampled camera-up continuity threshold failed at the interplanetary crossing.** The browser closed at the foreign approach; landing, reload, home return and exact-save restart are not covered by this run. No runtime, asset or HTTP errors were observed.

[Comparison gallery](comparison.html), [observations](journey.json), and [failure capture](failure.png) preserve the original result. The prior normal-quality screenshots are linked directly in the gallery. Both use the same viewport and seed, but camera framing, lighting, asset residency and walked positions can differ.

## Verified so far

- Actual town renderer and spherical preview share person, body and full inventory. Ordinary Explore preserves the current preview position.
- The required CC0 motion pack is hash verified. Visible idle reports `quaternius-ual-standard`, actual `Idle_Loop`, destination `wren`, SHA-256 `69591853d817488edaa8fd9bf8fc1d821eaeaf789f8627b3cd23b41c4ed67997`. Walking reports actual `Jog_Fwd_Loop`. This corrects the earlier requested-alias provenance limitation.
- Ordinary mouse input completes a measured 360° orbit. Wheel zoom and recenter work without gameplay commands or changes to canonical heading, cruise or destination. Cruise camera input also leaves the route state unchanged.
- Walking moves the canonical body, then G lifts that same body from the walked location. The vessel remains parked, personal warp is disabled and powered flight spends canonical mana.
- The route crosses the nearest-world boundary continuously in canonical state. The test then rejects a camera-up change greater than 45° between approximately 95 ms samples.

The last assertion does **not yet establish a production camera snap**. The camera intentionally smooths radial changes at 5/s; a near-antipodal change can exceed that coarse-window threshold while remaining continuous each render frame. The original harness also appended its complete trace only after the assertion, so the failed trace was not retained. That harness defect is fixed for the follow-up, which must record per-frame peaks and elapsed times before classifying the camera behavior.

## Visual observations

- Front/side/back ground captures show lowered arms and intact clothing/limbs. Native screenshot clips around actual hand, foot and head landmarks are included; these are not image transformations.
- Minimum-distance framing places one foot behind the bottom HUD. The closeup therefore cannot fully review that foot.
- `08-vertical-ascent.png` is captured after the vertical input has been released and braking has begun; the screenshot shows hover. Its 120-frame motion samples include the preceding movement. Do not describe that still as a moving ascent pose.
- `10-between-worlds` and `11-nearest-world-transition` show significant velocity, with bounded overlay phases reported as brake/descent. The hero is small and dark against space. The destination is outside the latter framing, and the world label says “landing available” at about 11.9 km. These remain presentation findings, not proof of a collision or navigation defect.
- Near-wall orbit clearance has not yet been exercised.

| Capture | Frame p50 / p95 | Sampled draw calls |
| --- | --- | --- |
| Town preview | 20.9 / 41.7 ms | 791 |
| Ground default | 20.6 / 20.9 ms | 799 |
| Ground close back | 14.2 / 20.9 ms | 768 |
| Ground side A | 14.0 / 20.9 ms | 489 |
| Ground front | 20.6 / 20.9 ms | 711 |
| Ground side B | 14.0 / 20.9 ms | 561 |
| Walking | 20.8 / 27.7 ms | 720 |
| Ascent to hover sample | 13.9 / 27.8 ms | 84 |
| Hover front | 6.9 / 13.9 ms | 124 |
| Between worlds | 6.9 / 7.1 ms | 14 |
| Nearest-world transition | 6.9 / 7.1 ms | 11 |

Each sample contains 120 animation frames on one machine. No concurrent build or test suite ran during measurement. The prior ground sample was 13.9 / 20.8 ms with 676 draws; the new light/shadow/camera workload is different, so this is a recorded cost comparison rather than a controlled benchmark.
