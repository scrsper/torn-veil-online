# Presentation quality evidence

The reusable [ordinary-input harness](../../../scripts/world/presentation-quality-journey.mjs) checks a named isolated canonical host. It never starts a host, edits a save, grants powers or teleports a character.

Required environment values:

```powershell
$env:TV_QUALITY_ISOLATED='1'
$env:TV_QUALITY_URL='http://127.0.0.1:7533/?universe&campaign'
$env:TV_QUALITY_EXPECT_SAVE='C:/absolute/path/to/isolated/world.json'
$env:TV_QUALITY_OUTPUT='docs/evidence/presentation-quality/new-run-directory'
node scripts/world/presentation-quality-journey.mjs
```

The output directory must not already exist. Each run writes `journey.json`, native screenshots and a local `comparison.html`. The comparison embeds the earlier normal-quality flight evidence without altering images. `TV_QUALITY_COMPARE` can point to a different baseline `journey.json`.

`TV_QUALITY_MODE=restart` plus `TV_QUALITY_BASELINE=<journey.json with completed town return>` checks the exact saved world after the host has been gracefully checkpointed and restarted externally. A prior presentation or recoverable-network assertion may have failed; the prior report must still include its completed canonical return and ready town. This mode verifies town rendering, identity/inventory, discoveries, parked vessel, preview/entry continuity and a second ordinary return.

Add `TV_QUALITY_GUARD=1` to restart mode for an ordinary 3 m minimum-zoom orbit and a bounded ground-only wall probe before returning. The probe retains reached positions, camera clearance, avatar visibility and finite eye/target measurements; it states explicitly if the hide cutoff or zero clearance was not reached. Use a fresh output directory for every follow-up.

`TV_QUALITY_MODE=resume` plus `TV_QUALITY_BASELINE=<interrupted journey.json>` continues a preserved active foreign-world approach. It lands, reloads, returns home with a detailed camera trace and returns to the rendered town. It reports the coarse camera threshold separately so that a disputed visual measurement cannot prevent completing the durable recovery.

The full journey also uses a bounded ordinary sidestep toward nearby geometry, four orbit views, and an opposite sidestep back to the street. The report states whether camera contraction was actually observed; absence of a nearby obstruction is a coverage limit. Foot framing uses actual rig landmarks with a conservative boot margin against the HUD, followed by visual screenshot review. Horizon checks use elapsed time and the renderer's advertised angular-speed cap, both per rendered frame and across approximately 95 ms samples. No phase name is assumed for every flight direction; steady total velocity must not incorrectly create braking.

An HTTP 503 is classified as recovered backpressure only when the exact response says `Saving the crossing. Try again shortly.` and a later GET succeeds. Raw response and console entries are always retained. Other 503s, required asset failures and command rejections remain failures.

Results are bounded, one-machine observations. The isolated character has fixture-authored capability; none of these runs prove that a production character earned that ability.

- [First run](first-run/RESULTS.md): verified motion provenance and ordinary camera controls; stopped at the coarse camera-up threshold before foreign landing. Original failure preserved.
- [Bounded recovery](resume-run/RESULTS.md): same save landed/reloaded abroad and returned to the actual town. The full trace distinguishes fast smooth rotation from a coarse-window jump; one HTTP 503 remains recorded.
- [Refined ground pass and blocked departure](final-run/RESULTS.md): foot/HUD framing and marker fixes verified; near-wall camera clipping and stalled departure preserved. Planned flight filenames do not establish movement.
- [Safe home recovery](home-recovery/RESULTS.md): ordinary landing/return, actual town readiness and exact checkpoint 12804 verified.
- [Verified journey](verified-run/RESULTS.md): 51 checks passed, actual moving ascent/passage, foreign landing/reload, safe home/town return, capped horizon trace and zero errors. Remaining camera/pose coverage limits are explicit.
- [Exact-save restart](restart-run/RESULTS.md): 17 checks passed after checkpoint 11693, actual restored town, same identity/items/discoveries/vessel, ordinary reentry and second rendered town return.
- [Camera guard follow-up](guard-followup/RESULTS.md): 27 checks passed after the final camera guard, ordinary minimum zoom, 40.9-second ground wall probe and actual town return. Final checkpoint 18377 verified. Minimum clearance 1.29788 m did not exercise the 1.25 m hide cutoff or zero-clearance case.
