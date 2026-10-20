# Traversal release integration — October 20, 2026

Release candidate; publication and merge acceptance are still pending. This file
supersedes the stopped local checkpoint as the current release handoff, while
preserving its evidence in `UNIVERSE_CONTACT_HANDOFF.md`.

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
  revision. Historical captures do not validate the current flight presentation.
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

## Validation record so far

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
- Original contact checkpoint 10649 loads read-only with Person `p_5`, Body
  `b_5`, inventory `i_1`–`i_5`, one discovery and inactive town residency.
  Its original checkpoint manifest remains unchanged.
- Final source checks, browser evidence and CI will be recorded below. No merge
  approval is inferred from these preliminary results.
