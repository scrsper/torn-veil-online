# Refined presentation — preserved blocked departure

**This is not a successful flight run.** The refined build passed 31 checks, including verified motion provenance, free orbit/zoom, both full boots clearing the HUD, and removal of the ground marker. A near-wall probe then changed the departure position. The later ascent and assisted route remained blocked beside town geometry at 3 m / 0 m/s. The harness waited too long before recognizing that condition and stopped after its 90-second timeout. Runtime and HTTP errors were both zero, but movement acceptance failed.

The exact isolated save was `.debug/atlas-flight-qa-2026-10-20T18-28-45-152Z/world.json`. All original screenshots and [journey.json](journey.json) remain intact. Filenames containing `moving`, `ascent` or `between-worlds` reflect planned capture stages, **not observed movement**. Images 08–10 show attempted departure and cannot verify the new moving-flight pose, horizon-rate cap or foreign-world return.

The [ordinary UI recovery](../home-recovery/RESULTS.md) subsequently landed, returned the same character/items to the actual town and closed the browser. The parent verified checkpoint 12804 from this exact save.

## Ground findings

- [Front closeup](05-ground-close-front.png) and its native hand/foot/head clips show both boots fully above the HUD. Projected foot landmarks were approximately `(775,700)` and `(682,635)` in the 1440×900 viewport; conservative boot margins also cleared interface bounds.
- The ground world label no longer obscures the character. Free 360° orbit, wheel zoom, preferred-distance restoration and recenter retained canonical heading and route state without gameplay commands.
- The approved Wren mesh used verified `quaternius-ual-standard` / `Idle_Loop`; walking sampled `Jog_Fwd_Loop`. The idle limbs/clothing are visibly intact at these views.
- Normal ground p50/p95 was **20.8/27.8 ms**, with 849 sampled draw calls; preview was 20.9/34.9 ms. The previous quality ground sample was 20.6/20.9 ms, 799 draws. Corrected shadow ownership adds real work, and the timing cost is retained rather than presented as an unconditional performance improvement.

## Near-wall and harness findings

The ordinary A sidestep moved 5.526 m. Orbit views exercised camera contraction from 6 m to 2.668 m, 0.065 m and 0 m. [The final view](06-near-wall-orbit-4.png) shows the camera inside the character, with the underside of the face across the top of the image. This is a concrete remaining visual defect.

The reverse D input overshot the starting street coordinate by 2.174 m. The original report's generic “obstructed” wording is incorrect for that return: signed positions establish overshoot, not an obstructed reverse path. The subsequent walk stopped beside geometry, and the successful G command only entered powered flight; it did not prove physical ascent clearance.

The planned moving captures all retained altitude 3 m and velocity 0 m/s. Repeated canonical collision events establish blocked movement. The run exhausted most of the fixture's reserve before its timeout, leaving approximately 20.93 mana. A later ordinary-button recovery worked immediately; no save or capability edit was needed.

The reusable harness now runs the wall probe **after** the round trip, lands/returns promptly when vertical departure remains at ground height, and detects a stalled assisted departure within a few seconds. It preserves failures before the final verdict. These are harness changes; this failed evidence is not rewritten as a pass.
