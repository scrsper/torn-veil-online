# Verified presentation journey

**51 checks passed; zero HTTP, browser, runtime or asset errors.** The ordinary-control journey flew from the open street to another world, landed, reloaded, returned home, completed a bounded camera probe, and returned the same character and inventory to the fully rendered town. The browser closed normally. The parent verified exact checkpoint **11693**, then the [separate browser restart follow-up](../restart-run/RESULTS.md) passed another **17 checks with zero errors**, including actual restored town, preview/reentry continuity and a second rendered town return.

The isolated parent-created save was `.debug/atlas-flight-qa-2026-10-20T18-45-46-729Z/world.json`, verified through host health before opening headed Chrome at 1440×900, normal quality. The character's strong flight capability was fixture-authored; no client ability grant, save edit, observer teleport or forced movement was used. No tests/build ran during frame sampling.

[Comparison gallery](comparison.html) places the prior normal-quality town/flight images beside these captures. [journey.json](journey.json) contains exact identity/items, commands, motion provenance, camera traces, lighting, assets and timing samples. The failed [first run](../first-run/RESULTS.md), [coarse-trace recovery](../resume-run/RESULTS.md), [blocked departure](../final-run/RESULTS.md), and [safe home recovery](../home-recovery/RESULTS.md) remain preserved.

## Character and camera

- Approved Wren uses hash-verified CC0 `quaternius-ual-standard`, actual `Idle_Loop`, and `Jog_Fwd_Loop` while walking, retargeted to `wren`. Pack SHA-256 is `69591853d817488edaa8fd9bf8fc1d821eaeaf789f8627b3cd23b41c4ed67997`.
- Front/side/back views and native head/hand/foot screenshot clips are included. Both full boots now clear the HUD, and the ground world marker no longer covers the body. Idle ankle/foot planting remains a visual-polish limitation; this is not a claim of solved contact IK.
- Ordinary free orbit completed a measured 360°. Wheel zoom, restored preferred distance and R recenter sent no gameplay commands and preserved canonical heading. During assisted passage, camera checks first required active navigation and actual speed above 50 m/s; free orbit/zoom preserved the active route.
- [Moving ascent](08-moving-ascent.png) shows 154 m/s. [Moving side view](10-moving-flight-side.png) shows about 852 m/s and a coherent forward-flight silhouette. Front flight is foreshortened/dark. No obvious detached limbs or waist tearing is visible at this resolution, but small/dark flight captures cannot certify fine wrist or cloth quality.
- The main passage and side samples report `ascent` relative to the current planet, not a universally required `cruise` pose. All eight side/main motion samples show that phase, total speed approximately 845–852 m/s and a radial-relative lean around 43–47°. The front sample contains two brake then six ascent samples. These are actual phase observations, not evidence that every brake transient is wrong.

The outbound trace retained **489 samples** and one nearest-world switch. Maximum camera-up change was **0.011310 rad / 0.648° per rendered frame**, and **0.152996 rad / 8.77°** across the roughly 95 ms samples. Both passed the advertised 90°/s cap with clock/engine-step tolerance. The largest instantaneous rate calculated from browser timestamps was about 92.65°/s, illustrating that tolerance; do not report an exact measured 90.00°/s bound. The earlier trace turned 59.54° over the coarse window.

No interval met the deliberately strict false-brake test's complete eligibility requirement: at least 400 ms, four distinct authoritative snapshot revisions and total-speed range at most 0.05 m/s. Accordingly, the report makes **no blanket browser claim that every false-brake case is eliminated**. Actual velocities, phases and revisions remain available, and the required invariant-speed regression is covered separately by production tests.

## Return, obstruction and residency

Foreign landing/reload and home return preserved `p_5` / `b_5`, all five inventory entries and quantities, both discoveries, and the original parked vessel. The final actual town was ready with 81 chunks, 55 focused instances, no pending instances, and the enabled controlled character at `(11314.57580171364, 1.0625, 3093.1542221293266)`.

The wall probe ran **after** the round trip. It contracted the camera from approximately 6 m to **1.7165 m**, retained live motion diagnostics and restored clear framing. This did **not** reach the 1.25 m avatar-hide cutoff, so live hide/unhide verification remains incomplete despite the sampled visibility rule passing. The reverse sidestep overshot its start by 2.10 m; that is recorded as ordinary input timing, not falsely called an obstructed reverse path. Town return still succeeded.

Across sampled views, Atlas loaded 18 distinct models and 19 placement IDs; 13 model IDs entered the camera frustum. Frustum inclusion does not prove unoccluded pixels. Peak requests were two. Largest sampled cache costs were 3,577,820 decoded GLB bytes and 57,352 triangles, with no load failures or budget rejection. These are registry costs, not measured GPU memory. The actual town projection retained 12 chunks / 56 focused instances on the spherical surface and released them in space.

Shadow samples stayed at or below **112 casters and 51,713 triangles**, within the normal 112 / 240,000 budget. Budget accounting includes the repaired instance ownership path.

| Capture | Frame p50 / p95 | Sampled draws |
| --- | --- | --- |
| Town preview | 20.9 / 41.6 ms | 847 |
| Ground default | 20.8 / 27.9 ms | 849 |
| Ground close front | 20.7 / 27.8 ms | 728 |
| Walking | 20.8 / 34.4 ms | 768 |
| Ascent sample | 13.9 / 27.8 ms | 72 |
| Moving side view | 6.9 / 7.1 ms | 27 |
| Main assisted passage | 6.9 / 7.1 ms | 11 |
| Foreign ground | 6.9 / 7.1 ms | 94 |
| Reloaded foreign ground | 6.9 / 7.1 ms | 95 |
| Returned home | 20.8 / 27.8 ms | 590 |
| Broad after-trip wall view | 20.9 / 34.7 ms | 1,367 |

Each timing sample uses 120 animation frames. Compared with the original ground sample's 13.9 / 20.8 ms and 676 draws, the corrected lighting/shadow/camera workload costs more. This is a documented visual/performance tradeoff on one machine, not a controlled claim of faster rendering. Terrain material repetition, dark small flight silhouettes, contact polish, live near-camera cutoff coverage, other bodies/seeds/capabilities, and the full asset catalog remain outside this pass's verified scope.
