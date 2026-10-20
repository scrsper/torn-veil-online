# Radial contact and flight readability acceptance plan

This is a plan and read-only geometry inspection, not a browser pass. Prior verified evidence and checkpoint 18377 remain unchanged. Use a fresh isolated fixture, a new `first-run` output directory, normal quality and 1440×900 headed Chrome. Start only after source freeze, successful checks/build and an explicitly ready isolated host. No user save, capability grant through the client, teleport or debug movement is permitted.

The maintained harness is `scripts/world/presentation-quality-journey.mjs`, with helper `presentation-contact-qa.mjs`. Set `TV_QUALITY_CONTACTS=1` and the usual isolated URL/save gates; set `TV_QUALITY_COMPARE=docs/evidence/presentation-quality/verified-run/journey.json`. Each contact phase writes a separate bounded raw JSON trace, referenced by the main `journey.json`. Patches are deduplicated by ID, with at most 256 patches and 12,000 rendered frames / 180 seconds per trace. Every tenth frame independently checks the actual sole points against the exact patch identified by `__tvUniverse.footSupport.id`; diagnostics still retain every sampled frame. No browser action has been performed merely by preparing this plan.

## Reachable ground route

The source `focusedTownPlan(20261017)` spawns at `(11312.5, 1.0625, 3113.7)`. The following route was queried read-only against verified source triangles. All 284 samples, spaced at most 0.1 m, had support and admitted a radius 0.525 m, height 1.8 m capsule through `StaticGeometry.fits`. This does not yet establish live controller traversal or resident avoidance.

| Point | Planar X | Planar Z | Canonical support Y | Purpose |
| --- | ---: | ---: | ---: | --- |
| Spawn | 11312.5 | 3113.7 | 1.0625 | Original pose and flat idle baseline |
| Flat path | 11312.5 | 3128 | 1.0625 | Sustained locomotion across paving |
| Paving exit | 11312.5 | 3133 | 1.0 | Actual 6.25 cm downward step; reverse path tests upward step |
| Forest entry | 11312.5 | 3138 | 1.1240604 | Gentle authored slope |
| Slope side | 11316.5 | 3138 | 1.2667619 | Approximately 6.0° local slope |

Use ordinary turn keys and W, with feedback from canonical position/heading, for forward locomotion. Free camera orbit must not steer the body. The fresh body's initial heading is toward decreasing chart Z; walking toward the forest requires an ordinary half-turn. A/D may be used for the short lateral segment. Stop and report a blocked route rather than forcing a position or extending the search. Current fixed surface speed is 7 m/s, so describe measured movement as jogging-speed locomotion rather than claiming a slow walk.

After the ground sequence, reverse the route and walk to the previously successful clear street at approximately `(11312.5, 1.0625, 3093–3096)`. Prior verified locomotion ended at Z 3095.6025; actual takeoff occurred at Z 3092.8183. Do not launch beside the forest canopy or the wall probe. Keep minimum departure progress and collision checks; brake, descend and return safely if the route stalls. Ground recovery must leave enough reserve before the flight route.

## Contact measurements

Use the bounded host-provided support-triangle window and its reference/coordinate contract. `UniverseSettlements.groundHeight` is a lowered rendering underlay mask, not a foot-contact oracle. Canonical capsule support also takes the maximum of a wider footprint over paving stones; its height alone does not prove each sole touches a triangle.

Expected diagnostics are measured skin-transformed distal-foot sole vertices, support point/normal/source, frame origin/up, contact/lock/weight/release state, and reset reason. Ankle joints alone cannot establish boot contact. Keep the actual subset size and selection method in evidence. Transform all measured vertices into one absolute frame before comparing consecutive frames; changing camera origin must not masquerade as foot movement.

Retain every frame from idle, locomotion, step transition, slope idle, takeoff and landing. Derive signed support gaps independently from the received triangles where possible. Evaluate stable contact only when support is available, weight is at least 0.98, the foot is not releasing, and lock/source identity is unchanged. Preserve excluded samples and durations; no eligible window is a coverage limit, not a pass.

Provisional visual targets, to be checked against the actual measured sole subset before final assertions:

- No sustained penetration deeper than 3 cm for more than 100 ms.
- During settled stationary contact, per-foot minimum sole gap has p95 absolute error at most 4 cm; an unsupported gap above 8 cm lasting more than 100 ms is a defect candidate.
- At least one eligible same-lock interval of 100 ms per foot on flat ground and the slope. Measure tangential displacement of the actual corrected sole relative to its fixed support, with a 3 cm drift target; the stored anchor's own unchanged coordinates alone are insufficient proof.
- Do not require every sole vertex to lie on one plane: toe roll, heel lift, thickness and discontinuous paving can legitimately yield different gaps. Preserve minimum, median and maximum values.
- Takeoff clears locks and disables ground correction while airborne. Landing returns to bounded support without a one-frame limb or root jump; quantify the full transition before deciding whether any transient is a failure.

The thresholds are presentation targets, not changes to physics, support selection or saved body state. Report raw measurements and screenshots even if a target fails. Do not turn a small authored stance difference into a claim of canonical collision failure.

## Visible framing and flight

Capture front and side views at each stationary ground sample, plus a short moving sequence. Use actual sole points to project a foot-and-ground crop with visible ground below both boots, outside the HUD; include full-frame screenshots. A screenshot containing only ankle nodes cannot prove contact. Native screenshot clips are allowed; do not paint, retouch or rescale source images.

After returning to clear ground, use ordinary G/E ascent and require actual speed above 50 m/s for moving captures. Once navigation establishes outbound heading, press R, then capture recentered, front and side views. Record actual projected body size and whether limbs/clothes are readable; a dark or tiny body remains a limitation even if pose diagnostics pass. Preserve free orbit/zoom and canonical heading/cruise assertions.

Record the new flight pose and lighting diagnostics: phase, total speed, pitch, reach, altitudeFill, fillIntensity and environmentIntensity. Vertical ascent and planet-relative assisted passage need not share one phase name. The expected refined pose is hands above the head during strong vertical ascent and a stronger forward lean/reach during forward passage; evaluate those against actual motion rather than requiring all high-speed travel to say `cruise`.

Complete the ordinary foreign landing/reload/home return with the same person, body, complete inventory, discoveries and parked vessel. Wait for the actual town renderer, close the browser, then verify the exact save after graceful checkpoint/restart. A later bounded restart/reentry/return uses its own new evidence directory. Preserve any failed attempt and safe recovery separately.

## Recorded outcome

The ground pass ended with ordinary town recovery after a departure waypoint assertion. The user then requested wrap-up; no new flight or restart cycle was started. See [first-run results](first-run/RESULTS.md) for measured contacts, the slope acceptance limit, and verified checkpoint 10649.
