# Integrated release attempt 4 — preserved steering deadband

Local `00118c9`, game source unchanged from public `2447752`, fresh fixture.
23 checks passed with zero browser/HTTP/asset errors. Escape/neutral acknowledgements
worked, and walking pulses moved 3.85 m, 4.55 m and 4.20 m. At 1.97 m remaining,
the checker oscillated between +0.2136 and -0.1464 radians around its 0.14-radian
alignment threshold. Small observed yaw increments were too coarse for that
approach; the unchanged 4.5-second progress gate stopped the run before flight.

The actual release requirement is to reach the physical waypoint, not face it
at an arbitrary angle. Replace this brittle aim-first strategy with ordinary
body-relative W/A/S/D movement chosen from the target's forward/right components.
Keep the exact same physical route, waypoint/departure tolerances, authoritative
stop acknowledgements, stable positions and timing bounds. Actual turning evidence
from these attempts remains valid; this is not movement injection or a teleport.

Ordinary return restored the rendered town with the same character and inventory.
Graceful shutdown and read-only restore passed; `restore.json` records retained
XP/John Smith/history and the unchanged checkpoint. Raw evidence remains at
`.debug/release-journey-oct20-v4`.
