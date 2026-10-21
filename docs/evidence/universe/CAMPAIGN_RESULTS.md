# Canonical campaign iteration — October 19, 2026

The Astral Sea now has a route through the existing saved realm character and
RealmJournal: `Play Torn Veil Journey.cmd` / `/?universe&campaign`. Entry and
return preserve the same Person, Body and carried items. Town residents keep
advancing on the existing world clock while the owner travels. The standalone
explorer route remains separate.

## Automated verification

- TypeScript: `npx tsc --noEmit` passed.
- **177 tests in 28 files passed**:

  ```powershell
  npx vitest run tests/universe tests/world-sphere tests/realms.test.ts tests/realm-expedition.test.ts tests/realm-journal.test.ts tests/realm-shared-controller.test.ts tests/canonical-tower.test.ts tests/focused-journal.test.ts tests/persistence.test.ts tests/ecology-realtime-integration.test.ts tests/web-boundary.test.ts --maxWorkers=2
  ```

- Vite web bundle passed (3,478 modules). Used plain `vite build --config
  vite.web.config.ts --outDir ../.debug/universe-bundle`; no full browser suite or
  `play:build`.
- Actual RealmJournal worker test recovered committed flight ticks without a final
  checkpoint, matched replayed state/controller continuation, neutralized input
  on disconnect and recovered the last durable state after injected append failure.
  The original JSON import remained byte-identical.
- HTTP tests cover owner replacement during body read/save, stale sequence,
  malformed/oversize input, durability fencing, write failure and durable contact.
- Canonical tests cover identity/items/quests, retained Tower history, NPC motion
  and events, duplicate transition continuation, absent-body validation, and safe
  return around occupants without crossing walls.
- Terrain tests cover nearest-ground LOD under the same 32-upload budget, all
  12 cube-face texture joins, partial-load world hopping, coverage and disposal.
- Launcher was started against the isolated checkpointed save on port 7531,
  reached healthy/ready, then accepted `shutdown` and exited 0 after checkpoint.
  The writer lock was released. No live user campaign was migrated.

An earlier regression run found a remaining schema-31 assertion and two missing
ignored collision-fixture failures. The assertion now expects schema 32.
The local collision cook was restored from the existing main checkout and
verified against its catalog hash
`c3ad74f50784f8709a648dec03fd256c7aeb873c101ca1d02feebfab4271252f`.
The 54 MB ignored artifact is not included in this commit.

## Browser journey: failure and recovery

Used ordinary keyboard/buttons in automated Chrome, read-only diagnostics and
host inspection. Isolated save:
`.debug/universe-campaign-test/world.json`; host on loopback 7531. No debug
movement or save editing.

**First run: 18 checks passed, then town return timed out.** Boarding, launch,
travel to Nacrefall 2, landing, discovery attribution, browser reload and the
flight back to Cinderveil preserved the same character/items. The host remained
healthy. A resident occupied the original town anchor, so `canReturn` stayed
false for 30 seconds. That run also logged one uncategorized HTTP 503; it is not
reported as an error-free pass. Original report:
`.debug/universe-campaign-evidence/journey.json`.

The return resolver now checks deterministic nearby positions, requires clear
body space and a valid static movement sweep, and records requested/actual
arrival in the event. No valid point within three metres means no transition.

**Recovery run: 23 checks passed in 16.6 seconds.** After gracefully checkpointing
the failed run and restarting with the fix, recovery resumed the same home-landed
character with both discoveries. Return restored the same body/items in town
exactly one metre from its original anchor, clear of nearby residents.
Reopening boarding kept controls hidden and the campaign label stable across
120 rendered frames.

Three artificially delayed 1.2-second reads had at most one request in flight.
One deliberately aborted old read could not mark the newer accepted target
offline or revert it. There were **zero unexpected browser/runtime/HTTP errors**
in recovery; the single expected injected network failure is recorded separately.
The test ended with the original body present in town and the expedition inactive.
Report: `.debug/universe-campaign-recovery-evidence/journey.json`.

These are complementary runs, not a claim that a fresh full journey was rerun
after the final return fix. The last harness-only adjustment to dismiss the
town welcome overlay before a screenshot was syntax-checked but not rerun.

## Screenshots

- [Destination after reload](campaign-destination.png): the landed desert and
  retained canonical identity/discoveries from the first journey.
- [Recovered home return](campaign-home-return.png): the saved return is now
  available after the arrival fix.
- [Boarding after recovery](campaign-boarding.png): correct character/items,
  stable label and hidden flight/chart controls.

## Remaining limits

This is an explicit town/astral gateway. It does not place the town, pagoda or
population on the spherical ground. The traveler does not yet receive ordinary
body physiology/combat while absent from the planar domain. The vessel is a
traversal fixture, with no acquisition/fuel/cargo/damage model. Surface economy,
ecology, interactions, caves and continuous interstellar flight remain absent.
The host pauses when no controller is connected.

No human/controller acceptance, exhaustive browser coverage, long-session soak
or target-device streaming-performance guarantee is claimed. Repeat-mount
coverage for pointer-listener cleanup remains open. The ordered next work and
all concrete defects are in [UNIVERSE_ISSUES.md](../../UNIVERSE_ISSUES.md).
