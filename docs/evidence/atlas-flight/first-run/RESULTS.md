# Personal flight first browser run

2026-10-20, isolated canonical host on port 7533, headed Chrome 1440×900, lite presentation. The parent prepared a strong capability fixture with 320 mana and interplanetary flight capacity. This is an ordinary-control acceptance fixture, not a character who earned those abilities through progression. No client capability grant, direct movement injection, observer teleport, or user-save edit was used.

**Result: 16 functional checks passed; visual acceptance failed.** The character entered the actual projected town at the same position, walked, lifted under personal power, flew to Vesperspire 3, landed, reloaded, returned home, recovered access to the original parked vessel, and returned to the town UI. Identity and discovery attribution survived reload. Help suppressed travel shortcuts. Mana decreased during powered flight.

The first run found:

- `UniverseSettlements.drawGround` omitted the vertex color coverage required by the existing forest-floor material. GLSL failed at `tvForestCoverage=color.a` with an undeclared `color` attribute. Repeated shader fallback output is condensed in the JSON report.
- Foreign-ground HUD incorrectly instructed the player to return within 60 metres of a vessel located on another planet. The parked vessel itself remained correct.
- The approved character appeared with symmetrical arms about 45 degrees from the body. Diagnostics selected `unarmed/idle_neutral`, but selection alone does not prove bone motion. A following run will sample authored clip frames and joint rotations before classifying this as an animation defect.
- One HTTP 409 command response occurred. Source inspection found `brake()` always submitted `cruise:false`, including when opening controls on the ground, where that command is rejected. The repair sends cruise cancellation only when cruise is active; the maintained harness now checks opening controls and records bounded host rejection reasons.

| Capture | Frame p50 / p95 | Draw calls per sampled frame |
| --- | --- | --- |
| Town preview | 13.9 / 34.7 ms | 707 |
| Town on foot | 13.8 / 14.0 ms | 654 |
| Personal ascent | 6.9 / 7.1 ms | 16 |
| Between worlds | 7.0 / 7.1 ms | 12 |
| Foreign ground | 6.9 / 7.0 ms | 55 |
| Returned home | 13.9 / 14.0 ms | 546 |

Each timing sample contains 120 animation frames. This is one bounded presentation run on one machine, not a general benchmark. Atlas placements and models actually sampled are recorded in each JSON capture; this trip does not demonstrate the entire catalog.

The `00`–`07` images preserve the journey. `failure.png` is the blank loading frame immediately after navigation to the town URL when the error-free acceptance assertion failed; it is not evidence of a rendered town. The JSON retains identity, state, vessel, material/terrain residency, frame samples and checks while excluding generated shader program spam.

The repaired normal-quality rerun passed: [final results](../final-run/RESULTS.md).
