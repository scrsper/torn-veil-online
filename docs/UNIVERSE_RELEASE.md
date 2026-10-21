# Traversal release integration — October 20, 2026

Implementation `956e837` passes54 ordinary journey checks and20 same-save host
restart checks on the independently owned port7534 fixture, with zero browser,
HTTP or rejected movement-receipt errors. It retains the actual town character,
all items, earned progression, current John Smith and parked vessel through
walking, personal flight, foreign landing/reload, home return and server restart.
[Current evidence](evidence/universe-release/input-release/RESULTS.md).

[PR72](https://github.com/scrsper/torn-veil-online/pull/72) remains draft. The
original7533 host/save restart is a separate unresolved gate, and final-head CI
must pass. That original writer is idle/healthy at durable16203/checkpoint14597;
after Jacob explicitly approved graceful shutdown/restart, one retry of terminal5701
`shutdown` was rejected: approval required by policy while AskForApproval is Never.
Manual graceful stop must checkpoint its old-engine tail before upgrading.
No forced kill, duplicate writer or fingerprint bypass is permitted.

Movement now enters the existing owner WebSocket in sequence without waiting
for round-trip receipts. Received is provisional, durable means saved, and
structural commands/transitions wait for durability. No prediction, travel-speed
change, dropped simulation time or relaxed waypoint threshold.12 repeated taps
physically41–53ms move0–0.70m under the retained0.75m bound, with complete diagonal
chords observed on wire.67 affected input/API/QA checks and11 lighting/boundary
checks (overlapping groups), TypeScript and the final Babylon build pass.
Earlier receipt-wait and polling failures are preserved in the evidence history.

Night-side terrain and space silhouettes use a bounded increase to the existing
ambient sources, with daylight ground unchanged. Current screenshots were
inspected; dark clothing, sparse terrain and contact/framing gaps remain.
A separate fresh, unendowed town/Tower/combat follow-up is in progress.
Historical contact evidence remains in `UNIVERSE_CONTACT_HANDOFF.md`.

## Scope and history

The candidate integrates the original traversal checkpoints `41b783f`, `53c1f73`
and `48eddf8` with GitHub main `8a9fa58` (progression and John Smith PRs 71 and 70).
Original commits and isolated saves remain local. Publication uses a new snapshot
parented by main; it does not expose the private intermediate integration history,
rewrite the original branches or require a force-push.

World generation, flight and movement remain host-owned. Town return restores the
same Person, Body and possessions. Main's earned experience, rank vessels,
announcements and John Smith interface remain present. John Smith remains outside
attainable progression.

Both branches independently used save version 32. The integrated writer uses 33;
the reader accepts both earlier shapes and validates each present component.
Loading does not grant experience, invent quests or move an absent body into town.
The current John Smith authority disables future legacy Tower silver issuance;
historical ledger entries, paid receipts and balances remain unchanged. The
cutover initializes inside a journaled operation, before legacy reconciliation.
An old journal tail still requires checkpointing under its matching executable;
the engine-fingerprint guard is unchanged.

## Release gates and bounded limitations

- Required: focused canonical/presentation regressions, TypeScript, web and
  production bundles, all PR CI jobs, and ordinary-input departure, personal
  travel, foreign landing, return and exact-host restart on the integrated source.
- Required: inspect moving ascent/cruise and foreign-world captures from this
  revision. Root inspected the current ascent, moving side/front space flight,
  foreign landing and rendered town return; full body remains legible and clear
  of controls. Weak space contrast and dark/sparse foreign terrain remain limits.
- Current ordinary journey: **passed**, with original waypoint/departure bounds,
  durable neutral input and stable position; [54-check evidence](evidence/universe-release/input-release/acceptance.json).
- Independent7534 exact-save restart: **passed**,20 checks and final read-only
  checkpoint18240 restore. This is separate from the original7533 save.
- Original7533 exact-save host restart: **pending**. The original managed terminal rejects
  shutdown input under the current tool approval policy. Its isolated host must
  stop gracefully before restarting the same save; no forced termination or
  fingerprint bypass is an acceptable substitute.
- Final-head CI: required. Earlier published `02bb8fa` passed all four CI jobs;
  this does not certify later fixes. See PR72 for the current head's checks.
- Precision U076: historical1.05m and0.9793m failures remain preserved. Ordered
  wire admission passes12 repeated taps under the retained0.75m benchmark,
  with complete diagonal chords observed; corrected traversal/restart pass.
- Known presentation limits: left-foot contact on the sampled slope, weak boot
  contact shadows and live minimum-camera hide-threshold coverage. These remain
  explicit issues, not claimed fixes. Geometry penetration/drift/gap limits remain
  enforced; absent contact windows are recorded as missing coverage.
- Larger gameplay limits: spherical NPC/combat/door/Tower interactions require
  returning to town; survival consequences, surface resources/ecology, vessel
  acquisition/fuel/cargo and endurance acceptance remain unfinished.

## Dependencies and provenance

This is source publication, not an Atlas asset-library upload. The committed
catalog describes 1,249 compatible static models; model bytes are served only
from an existing authorized local installation selected by `TV_ATLAS_ROOT`.
Catalog hashes verify identity, not a redistribution license. See
`ATLAS_CATALOG.md`, `CHARACTER_MOTION.md` and [clean-checkout asset setup](UNIVERSE_ASSETS.md)
for source records and exclusions. [Actual destinations and travel limits](UNIVERSE_DESTINATIONS.md)
separate seeded addresses from played/content-rich worlds.
No No Man's Sky code or assets are included; public procedural-generation
research and the original implementation are documented in `UNIVERSE_RESEARCH.md`.

The already tracked Quaternius UAL source has the exact audited CC0 motion hash.
Local staging can reuse it. Optional licensed raw motion packs remain ignored;
the primary compiled launcher retains its existing dependency requirements.
Focused collision geometry must be cooked from the checked-in verified sources
before geometry-dependent tests. No personal campaign is endowed for flight;
release browser tests use a separately identified capability fixture.

## Validation record

- 73 tests in six progression, John Smith, traversal integration and journal
  recovery files passed on the initial combined source.
- 34 tests in four schema/canonical/save/journal files passed. Both version-32
  variants round-trip into version 33; malformed components remain rejected.
- Final combined-source TypeScript, production Vite bundle and Babylon web
  bundle passed. Large bundle warnings remain; this is not an optimization claim.
- 124 tests in 17 focused files passed after the production fixes, including the
  reward cutover, canonical travel/API/journal, Atlas, terrain and actual-rig
  foot-contact regressions. Test groups overlap and must not be added together.
- 45 tests in six presentation/harness/boundary files passed; three clean-source
  motion-staging tests passed.
- Four cutover tests passed after adding an explicit real-worker journal replay,
  repeated cache claim/objectives, checkpoint/JSON reload and retried travel return
  regression. Exactly one historical silver payout and one current cache remain.
- Latest combined input/API/camera/harness/web-boundary run:69 tests in six files
  passed. Final TypeScript and Babylon web bundle passed after the frame-clock
  and response-condition fixes. Test groups overlap and are not additive.
- Current browser journey on clean `4cde1b4`:53 checks pass, zero HTTP/browser
  errors. It walks the actual paving/step/slope/departure route, lifts the same
  body, spends canonical mana, flies to Vesperspire3, lands/reloads, returns home
  to its original parked vessel, then returns to the rendered town with all items.
- The live horizon gate passes across6,239 timeline frames: maximum excess
  2.98e-14 radians above90deg/s, with the unchanged0.003-radian allowance and
  zero coarse excess. No long steady-speed pose interval was captured.
- Original contact checkpoint 10649 loads read-only with Person `p_5`, Body
  `b_5`, inventory `i_1`–`i_5`, one discovery and inactive town residency.
  Its original checkpoint manifest remains unchanged.
- Integrated attempt 1 (`e278ec4`) passed 23 checks with zero browser/HTTP/asset
  errors, then stopped before flight: a distance-only watchdog treated ordinary
  turning as failed walking progress. Safe ordinary return and exact read-only
  restore of checkpoint 4713 passed, retaining all five items and earned 110 XP.
  [Preserved evidence](evidence/universe-release/first-run/RESULTS.md).

All failed attempts remain preserved: [2](evidence/universe-release/second-run/RESULTS.md),
[3](evidence/universe-release/third-run/RESULTS.md),
[4](evidence/universe-release/fourth-run/RESULTS.md),
[5](evidence/universe-release/fifth-run/RESULTS.md),
[6](evidence/universe-release/sixth-run/RESULTS.md), and the two short-tap checks
([first](evidence/universe-release/microtap-first/RESULTS.md),
[corrected timing](evidence/universe-release/microtap-second/RESULTS.md)).
Each failed live run returned safely and restored its checkpoint read-only.
Attempt6 completed travel but failed network-evidence and camera-clock checks;
attempt7 passes those corrected checks. The benchmark precision failure remains.

## Necessary next work

1. Finish this release's exact-save restart and final-head CI before readiness
   or merge. Keep the source unchanged across the restart check.
2. Finish fresh ordinary town/Tower/combat acceptance and preserve any failure
   evidence. Corrected traversal and its owned same-save restart pass; keep the
   owner/sequence fences, structural barriers and real-worker replay checks.
3. Complete left-foot slope contact, clipped slope-front framing and foreign
   source-triangle sole coverage. Improve low-contrast flight/terrain composition;
   measure steady-speed pose correctness and the actual hide/restore threshold.
4. Continue ordinary spherical interaction/combat/door/Tower integration,
   survival consequences, canonical ecology/resources and vessel acquisition,
   fuel/cargo. Add repeated view changes and a long flight/reload/warp endurance
   pass with measured memory and frame time. These are larger gameplay work,
   not capabilities established by this release's finite journey.
