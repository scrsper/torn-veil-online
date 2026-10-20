# Integrated release attempt 3 — preserved pulse overshoot

Local candidate `8dc9696` (game source unchanged from public `2447752`), fresh
seed-20261017 fixture. 23 checks passed with zero browser/HTTP/asset errors; no
flight started. Turning converged from 180 degrees to -0.48 degrees by 3.93 seconds.
Newer accepted neutral requests worked, including coalesced `brake:false`.

The first waypoint then overshot: a pulse requested while 3.86 m away moved 4.87 m,
landing 1.02 m beyond the target. A minimum 100 ms reverse pulse moved 2.10 m;
further turning consumed the unchanged 18-second waypoint bound. The controller
had not accounted for the delay while an ordinary mouse-click stop completed.

Next correction: use the game's documented Escape brake immediately at pulse end,
observe actually sent movement requests and derive conservative near-target
durations from measured stopping delay. Keep accepted sequence/stable-position
checks, spatial tolerances, geometry checks and overall bounds unchanged.

Ordinary town return and graceful host shutdown succeeded. `restore.json` records
the read-only restore, same body/items/earned experience/discoveries/vessel and
unchanged checkpoint manifest. Raw evidence remains in
`.debug/release-journey-oct20-v3`; selected evidence is committed here.
