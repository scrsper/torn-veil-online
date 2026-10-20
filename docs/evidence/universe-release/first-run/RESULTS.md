# Integrated release attempt 1 — preserved failure

Source `e278ec4`, 20 October 2026, isolated seed-20261017 capability fixture.
23 ordinary-control checks passed with no browser/HTTP/required-asset errors.
The first ground waypoint stopped before flight: its 4.5-second translational
no-progress timer expired while ordinary steering was still rotating the body.
Every pulse received an accepted neutral command and a stable position sample;
turning through the initial opposite heading took longer than that timer.

The harness used ordinary Return, verified the original Person, Body and full
inventory in a rendered town, and closed the browser. The host then checkpointed
and exited normally. Checkpoint 4713 is retained; no save was edited.
Read-only restore then verified the exact town position, all five original item
IDs, unchanged earned 110 XP/Normal stage, current John Smith record, one discovery
and the original parked vessel. `restore.json` records the unchanged manifest.

The checker needs separate evidence of angular progress while turning and bounded
translational progress while walking. Waypoint tolerances, real movement input,
overall bounds and contact geometry gates must remain strict. This attempt does
not validate departure, moving flight, landing or a complete integrated journey.

`acceptance.json` retains commands' sequence/acknowledgement observations, route,
contact summaries, final identity and checkpoint metadata. Raw traces and all
screenshots remain in the local `.debug/release-journey-oct20` folder. The public
`returned-town.png` shows the safe ordinary recovery.
