# Integrated release attempt 2 — preserved observer failure

Game/harness source `2447752`, fresh seed-20261017 capability fixture.
23 ordinary-control checks passed with zero browser/HTTP/required-asset errors.
The third turn pulse stopped before flight because the observer required an
all-zero `brake:true` request. The existing input queue can coalesce it with the
100 ms timer's all-zero `brake:false` release. Both are neutral on the surface.
The character stopped; a later explicit Brake was acknowledged. This is a
measurement mismatch, not proof that every stop and departure now works.

The correction must accept either boolean flag only with all axes zero and a
sequence newer than the last yaw request, then retain the accepted-response and
stable-position gates. No direct movement command or relaxed waypoint tolerance
is permitted. Raw reports/traces are retained locally in
`.debug/release-journey-oct20-v2`; public summaries are in `acceptance.json`.

Ordinary Return restored the same rendered town character and inventory, browser
closed, and graceful host shutdown wrote checkpoint 4699. Read-only restore
retained the five item IDs, 110 earned XP, Normal stage, John Smith record, home
discovery and original vessel. `restore.json` confirms the manifest was unchanged.
