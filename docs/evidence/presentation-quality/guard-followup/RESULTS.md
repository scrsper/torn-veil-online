# Minimum-zoom and wall guard follow-up

**27 checks passed; zero HTTP, browser, runtime or required-asset errors.** The browser used the exact `.debug/atlas-flight-qa-2026-10-20T18-45-46-729Z/world.json` save, after checkpoint **12963** had been verified and the camera guard had been added. All 14 camera regressions, TypeScript and the final Vite build passed before this run. No build or tests ran during the browser measurements.

The ordinary controls restored the actual town, opened its spherical preview, entered on foot, reached the supported 3 m minimum zoom, completed a stationary 360° orbit, and then performed a bounded ground wall probe. No flight command, debug movement, capability grant or save edit was used.

The stationary orbit retained canonical position, heading and route state and sent no gameplay commands. All four sampled eye/target/up vectors were finite, and eye and target remained distinct. The ground wall probe took **40.9 seconds**, retained three reached positions and 24 orbit observations, and moved 10.50 m from its start before an ordinary reverse sidestep. Minimum actual lens clearance and eye-target separation were **1.29788 m**. The camera remained finite and nondegenerate; animation source and joint diagnostics remained available throughout.

**Coverage limits:** the bounded probe did not reach the 1.25 m hide threshold or zero clearance. `observedHidden` is false. The character was visible again at the wider final view, but because no hidden sample was observed this is not proof of a live hide/unhide cycle. U057 remains open as browser coverage. U060's exact zero-clearance case is covered by the source regression; this browser run verifies ordinary minimum zoom and nearby obstruction without reproducing that exact geometry.

After the probe, ordinary Return rendered the actual town with enabled `b_5`, person `p_5`, the same five inventory records, 81 loaded chunks, 55 focused instances and zero pending instances. The preview also retained the two discoveries and original parked vessel. Final town position was `(11315.619689170117, 1.0625, 3093.174595222661)`. The browser closed normally.

The host then shut down gracefully, and exact checkpoint **18377** was verified under engine `27352c8a3dbffe0c544073291a1ea73b88525dde979f87a10d483c7d9ea8c8b7`. The [checkpoint proof](checkpoint.json) records the inactive expedition, present returned body, unchanged inventory, both discoveries, original parked vessel and return event `e_340`.

Selected p50/p95 frame observations were 20.7/27.7 ms on reentry, 14.0–20.9/27.8–34.7 ms across minimum-zoom directions, and 20.7/27.7 ms in the final wider ground view. These are brief samples on one machine and do not extend the previous full flight route's coverage.

[Raw observations and attempted positions](journey.json), [minimum-zoom side view](guard-minzoom-orbit-1.png), [final wider view](guard-near-wall-restored.png), [actual returned town](03-restored-town-ready.png) and [local gallery](comparison.html) preserve the evidence.
