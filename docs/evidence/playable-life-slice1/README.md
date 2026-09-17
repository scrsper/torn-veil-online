# Playable life — Slice 1 restoration checkpoint

2026-09-16. Branch `codex/playable-life-slice-1`, based on `b4dc26e` in
`C:/Users/green/Desktop/projects/torn-veil-online-foundational`.
No merge or human approval. This is a restoration checkpoint, **not acceptance of
the settlement's overall playable quality**. No later frontier slice was started.

## Actual world and failing boundaries

The running Unreal editor and port 8787 belonged to this checkout, not the initially
supplied Documents checkout. The existing `.debug/playable-world.save.json` contains
a seven-settlement procedural world, seed 918271, 128 people including player
`p_128` / body `b_141`. The walked settlement is **Fenwick**, not the authored Ashford
fixture. That save was continued, never replaced with a fresh world. The pre-existing
dirty `TornVeilWorld.umap` is excluded from this change.

* Missing humans: people, bodies, regions and positions existed. Bridge projection
  incorrectly used the mind's short-range, facing-limited perception set as actor
  residency. At the initial player position the nearest NPC was about 38 m away.
  The new spatial-index query projects nearby canonical humanoids through canonical
  line of sight. It does not teach names or expand interaction admission. Range is
  96 m, reduced to 32 m in fog. Names, speech and combat details retain perception gates.
* Broken gait: frames without an executed 60 Hz prediction step reported zero speed;
  filling the pending-input queue also erased that frame's motion sample. GASP
  repeatedly restarted its transition. Velocity now uses executed simulation time
  and holds its last sample between steps. Stops/collisions still resolve to zero;
  stale authority, ineligibility and new bindings clear it.
* Loaded-history stalls: each mind scanned the same event history twice for recent
  meals/water. One world-step cache now shares those exact derived lookups, including
  same-step appends and backdated cutoff barriers. Cognition cadence, decisions,
  event history and offscreen existence are unchanged.
* Actual dialogue exposed overflowing replies, missing numeric selection, an
  unsupported west-road greeting, and introduced names being pruned. Replies wrap
  and scroll, shortcuts select current opaque options, and strangers make no
  invented arrival claim. Introduction establishes only minimal directional
  familiarity. Identity claims participate in relationship retention and outrank
  individual familiar-person episodes as reusable knowledge. False names remain
  claims with their evidence; repetition does not manufacture friendship.
* A null-controller crash during editor simulation/unpossession is guarded.
* The visible crowd exposed an existing arrival/anchor failure: path followers
  ignored the arrival tolerance, then resting bodies snapped to one shared anchor.
  Arrival now completes through the existing event/observation path. Rest positioning
  uses existing body reservations and nearby physical occupancy, walking to a clear
  reachable cell within the existing three-metre approach area. The action and place
  destination remain unchanged; already-overlapping saved bodies recover in play.

## Evidence and limits

Raw captures, saves and profiles are local under `.debug/playable-life-slice1/`;
licensed source assets and large private world files are not committed.
Selected review images are checked in beside this report: [baseline](baseline.png),
[residents after repair](residents.png), [dialogue](dialogue.png), and
[walking frame sequence](walk-contact.jpg). The video remains the motion evidence.

| Claim | Evidence |
| --- | --- |
| Actual human population restored | `baseline00000.png`, `final-dialogue.png`, ordinary PIE actor/state traces; 13 other canonical body IDs in the final 20-second capture |
| Skeletal walking restored | `final-walk.mp4`, 22 seconds / 983 captured frames (44.68 fps average), plus `final-walk.json`, 1,356 per-frame samples over 20 seconds |
| Gait has continuous playback | During seconds 0.8–4.6: 256 player samples, zero false zero-speed samples, all locomotion blendspace; phase spans 0.006–2.494 s, foot forward range -67.30 to 35.97 cm. Player traveled 16.26 m over the full recording. `final-walk-contact.jpg` is a visual supplement, not the animation evidence itself. |
| Real dialogue | `dialogue-ui.mp4` / `dialogue-ui.png`: native E interaction, numeric Who are you option, wrapped introduction, escape back to world; canonical speaker IDs remain stable |
| Existing save continuity | Menu saves, bridge restart, ordinary Play, same player/body and 127 other residents. `persistence-summary.json` records final comparison. |
| Saved crowd physically separates | `restored-crowd.mp4`, 25 s / 1,125 frames (45 fps); `restored-crowd.json`, 1,584 samples. Seven settled residents have minimum body-centre separation 81.40 cm, all stationary at the end. Player walks 6.65 m. `crowd-observation.png` shows the group after turning back toward it. |
| Narrow computation improvement | Same saved input, 120 ticks: 7,990.96 ms before, 1,038.39 ms after; p95 tick 308.28 → 41.09 ms. Complete resulting canonical saves identical after removing `savedAt`. `indexed-before/after` JSON, saves and CPU profiles retained locally. |

Only existing approved Epic Manny/GASP resources and already-installed environment
assets were used. No replacement crowds, fresh saves, teleports or spawned animals.
Movement recording uses ordinary controller key input (existing `TV.TestMoveKey`),
not canonical position writes. The recorder only reads per-render-frame state.

The measurement above does **not** establish 60 fps sustained performance, polished
foot locking, the full directional/combat repertoire, or finished NPC activity
choreography. Early window-title video captures could be stale; the final recording
uses the foreground desktop viewport and was checked for actual frame changes.

## Verification

* Relevant bridge regression: 39 tests across six files passed; wildlife projection
  2 passed. Later focused cache/presence/dialogue/pathfinding integration: 12 passed.
  After the final rest-position change, all seven relevant bridge/projection files
  were rerun together: 41 passed (`bridge-final-regression.log`).
* Final identity-retention/dialogue tests: 13 passed, including pressure from 1,000
  witnessed episodes about a closer acquaintance and false-name provenance.
* Relevant needs/persistence cases: 4 passed (61 unrelated cases skipped).
* Final TypeScript typecheck and production build passed. Native editor build passed.
* Native realtime and presentation regressions passed; final changed native tests
  `TornVeil.Realtime.PredictionVelocitySampling` and
  `TornVeil.Presentation.CommonUIProjection` passed after the last native changes.
* Navigation/arrival/rest/identity/dialogue integration: 26 tests passed, including
  three and twelve already-overlapping bodies, unchanged destinations, bounded
  physical movement, walls and inaccessible surfaces.
* After the rest-position change, actual sleep recovery, severe sleep pressure and
  physiology persistence: 3 passed (43 unrelated cases skipped).
* Independent review covered the restoration changes; the subsequent arrival/rest
  repair received a focused follow-up after tests and ordinary PIE observation.
* A broader five-file cognition run was stopped after roughly nine minutes without
  completed results. It is not counted as a pass. No full-suite claim is made.

## Still failing the quality target

The observed shared-rest pile and walking livelock are repaired; people still gather
in a tight, visually repetitive group. Activity animation quality and broader work/
conversation-slot choreography need the later living-settlement slice. Roof/canopy
proportions, floating detail, terrain, roads and settlement composition remain poor.
These screenshots must not be presented as a successful Ashford 2.0 result.

Loaded history still grows rapidly and sustained play can accumulate scheduling
debt. The measured cache improvement is a prerequisite repair, not completion of
the real-time-world frontier. The full economy, wildlife, combat and region journey
has not been accepted. Human gameplay/aesthetic approval remains outstanding; do
not use fixture results as acceptance or merge without explicit approval.
