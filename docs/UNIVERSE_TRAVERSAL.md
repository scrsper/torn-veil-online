# Torn Veil: The Astral Sea

This branch adds an original, playable procedural-world expedition to Torn Veil's
Babylon client. It starts on the existing Cinderveil height field, supports walking,
launching, manual flight, assisted continuous travel to other planets, controlled
descent, landing, and persistent return visits. Interstellar travel is an explicit
warp command. This is a travel foundation, not No Man's Sky feature parity.

## Play

For the saved town character, run **Play Torn Veil Journey.cmd**, or:

```powershell
npm run universe:campaign
```

This starts the existing realm host with a development client on port 7530 and
opens `/?universe&campaign`. New mapped expeditions preview the actual character
and existing town. **Explore on foot** continues from those coordinates.
**Fly under own power** requires learned gravity forms and enough actual body,
equipment and mana capacity; it does not grant an ability or move the parked ship.
The same route is available from the town's **Travel & journal** panel.
After landing within either mapped home town, **Return to town** resumes ordinary
town interactions at the actual location/facing, or reachable clear ground within
three metres if occupied. Entry requires a stationary, eligible body outside the
Tower and any other pending crossing. Earlier expeditions retain their saved
gateway geography and vessel-based return rules.

The campaign launcher follows the ordinary realm host's save selection:
`.debug/realms/world-current.json` when present, otherwise
`.debug/realms/world.json`, with the durable journal in the adjacent `.store`
directory. `TV_REALMS_SAVE` can select a specific campaign and `TV_REALMS_PORT`
can select a free port. The launcher prints the exact path. It never imports the
standalone explorer save. Ctrl+C checkpoints the realm journal before exit.

Canonical saves now write schema **32** and still read schemas 24–31. Before
opening a save from older source, checkpoint it using that exact previous source
and runtime. An outstanding journal tail from another engine fingerprint is
refused rather than replayed under changed mechanics. No existing user save was
migrated during development or testing.

For the original independent explorer, run `Play Torn Veil Universe.cmd`, or:

```powershell
npm ci
npm run universe:play
```

This standalone launcher starts the loopback host on 7526 and Vite on 7525, then opens
`http://127.0.0.1:7525/?universe`. It refuses occupied ports. Ctrl+C in the launcher
saves and stops its children. The default save directory is
`%USERPROFILE%/TornVeilAlpha/universe-expedition`; no existing realm save is opened.
`TORN_VEIL_UNIVERSE_HOME`, `TORN_VEIL_UNIVERSE_SEED`,
`TORN_VEIL_UNIVERSE_PORT`, and `TORN_VEIL_UNIVERSE_WEB_PORT` override defaults.
The seed defaults to 20261017 and cannot change for an existing save.

1. Press **F** or **Launch**.
2. Choose a planet in the chart, then **C** or **Sail to target**.
3. The vessel flies around obstructing worlds and brakes above a dry landing site.
4. Press **F** when landing is available. The host descends to ground contact.
5. Walk with **W/S** along the character's heading, sidestep with **A/D**, and
   turn with **left/right arrows**. Movement remains body-relative when the
   camera looks back. Return within 60 metres of the vessel to launch again.

In flight, W/S thrust, A/D strafe, arrows steer, Q/E move vertically, and Space
brakes. Manual movement controls cancel assisted navigation. Drag with the left
or middle mouse button to orbit freely; the wheel or **[ / ]** changes preferred
zoom, and **R / Recenter** places the camera behind the current heading. On the
ground, **up/down arrows** also tilt the camera. Orbit and zoom stay local and do
not steer, spend mana, or cancel a route. Camera preferences persist in the browser,
separately from the world save. M folds the chart; ? opens help. Esc and focus
loss release controls. Choose a system address 0–65535 and
**Cross the veil** after leaving the atmosphere. Reloading resumes the host's
expedition; restarting clears held thrust and unattended navigation/descent.

In the canonical campaign, **G** starts personal flight from standing ground.
**F / Descend** returns toward supporting ground. The chart admits assisted
interplanetary flight only when the actual protection, speed, mana and effort
forecast allow it. Personal flight cannot use vessel warp. Low reserves begin
descent; exhausted lift leaves gravity and momentum in effect. Grounded rest
recovers existing breath/mana through the world clock. Closing the client pauses
the world and does not grant offline resource recovery. See
[MAGICAL_FLIGHT.md](MAGICAL_FLIGHT.md) for capability and survival boundaries.

## Implementation

- `src/sim/world/universe/generation.ts`: version 1, independent keyed seed
  streams, four to six worlds per requested system, five terrain families,
  stable world IDs, dry natural landing sites, immutable 64-system LRU cache.
  There is no eagerly allocated galaxy. Cinderveil preserves the existing
  `planet.ts` geography and radius; new worlds do not copy its settlement pads.
- `travel.ts`: deterministic 20 Hz surface/flight state, bounded input,
  acceleration and proximity braking, terrain sweep, obstacle-aware assisted
  navigation, ≤40 m/s landing descent, explorer/vessel IDs, discovery provenance.
- `src/server/universeRuntime.ts` and `universe.ts`: loopback intent API,
  session/sequence fencing, 0.5-second input expiry, exclusive writer lock,
  checksummed atomic saves and strict load validation. Accepted structural
  commands save before acknowledgment; moving state checkpoints every 5 seconds.
  Unexpected power loss can lose that movement interval. Storage failure stops
  further advancement and commands instead of continuing with undurable state.
  Touchdown/discovery checkpoints immediately; the writer verifies lock ownership
  before accepting operations and before each durable save.
- `src/sim/world/universe/binding.ts`, `src/server/canonicalUniverse.ts` and
  `realmUniverseApi.ts`: optional canonical residency in the existing World and
  RealmJournal. The same Person and Body IDs bind travel; the retained body is
  absent from planar presence while its coordinates live in the astral binding.
  Town collision/perception cannot target a phantom body. Existing realm/NPC
  simulation continues on its 60 Hz clock; every third step advances travel.
  Transitions have revision checks and bounded idempotency receipts. Landing
  outcomes become durable before publication. No second World or save writer
  owns the traveling character.
- `src/web/universe/terrain.ts`: bounded cube-sphere quadtree residency,
  parent coverage retained until children are ready, skirts, shared terrain
  sampling at all levels, water and atmospheric rims. Planet transforms are
  camera-relative; the host coordinates never rebase. A soft 5 ms tile budget,
  maximum two uploads per frame, and `&lite` constrain streaming work. Small
  cosmetic grass, crystals and stones have no resource or collision semantics.
- `client.ts`: renders host snapshots, interpolates only the view, displays the
  chart and flight telemetry, and sends intents. It imports no executable host,
  save, or travel-step code. `camera.ts` owns local orbit, zoom, transported
  horizon and gradual ground/flight framing. Camera clearance is a presentation
  constraint. Camera, lighting, rig ownership and pending visual acceptance are
  documented in [UNIVERSE_PRESENTATION.md](UNIVERSE_PRESENTATION.md).
- `src/web/main.ts`, Vite proxy, package scripts and the launcher expose the
  expedition through the existing browser client. Existing routes stay available.

Public-source research and the distinction between documented No Man's Sky ideas
and our implementation are in [UNIVERSE_RESEARCH.md](UNIVERSE_RESEARCH.md).
No proprietary No Man's Sky code or assets are used. Local presentation reuses
Torn Veil's installed asset packs and existing character materials.

## Integration boundary

The **campaign route binds the saved Person and Body**, preserving inventory,
injuries, rank, quests and retained Tower progress in the same journal. Entry,
travel outcomes and return produce causal world events. Planar actions and Tower
entry are fenced while the body resides in the astral domain. There is no copied
character or cross-save reward synchronization. The standalone route remains
separate and is clearly labeled.

New expeditions map the existing towns through versioned spherical charts,
including source floors, roofs, walls and live door states. Entry and lift use
the character's current feet rather than moving it to a remote vessel. The
existing hero is projected into this view. Ordinary NPC interaction, combat,
door commands and Tower entry still require **Return to town**; this iteration
does not complete their spherical presentation/control bridge.

Resident simulation advances while the owner is connected, including during
space travel. The host still pauses when no controller is connected. Traveler
metabolism, breath, mana and existing downed recovery advance exactly once on
the same clock. Wounds, impact/vacuum/water damage and ordinary equipment actions
remain incomplete in astral residency. Visiting a world grants no inventory or
progression reward. The vessel remains a traversal fixture; acquisition,
ownership and cargo are next systems. See
[SETTLEMENT_TRAVERSAL.md](SETTLEMENT_TRAVERSAL.md) and the
[defect register](UNIVERSE_ISSUES.md).

The installed Atlas supplies deterministic native-scale population across
worlds and Tower dressing, subject to route, collision and rendering budgets.
Content-hashed local transport verifies each model. Compatible catalog entries,
actual placements and browser-visible models are separately measured in
[ATLAS_INTEGRATION.md](ATLAS_INTEGRATION.md).

There is no procedural civilization/ecology, resource extraction, fuel, combat,
terrain deformation, caves, or voxel volume generation in this slice. Worlds use
static centers and spherical height fields; gravity metadata is descriptive,
while flight uses arcade vessel controls. Warp changes systems explicitly; it is
not continuous flight between stars. Discovery history persists; travel events
retain the most recent 256 entries and are not a replacement for the canonical
world chronicle. The canonical route also records actual travel outcomes in the
World's event history. Progression rules are unchanged.

## Verification

```powershell
npm run typecheck
npx vitest run tests/universe tests/world-sphere tests/web-boundary.test.ts
npx vite build --config vite.web.config.ts --outDir ../.debug/universe-bundle
```

For browser acceptance, start the launcher with an **isolated test save directory**,
then `node scripts/world/universe-journey.mjs`. It uses ordinary UI and keyboard
input, checks a surface → other planet → surface → home round trip, reload,
identity and discovery continuity, collision events, and compact layout. Screenshots,
timings and JSON are written under `.debug/universe-evidence`. It is automated
Chrome evidence, not a human/controller test or a production performance guarantee.

Review-driven iterations fixed stale Babylon Vector3 origin copies preventing LOD
refinement on return, immediate landing snaps, missing meter-scale ground detail,
underground save acceptance, and continued command execution after failed saves.
See the dated `PROGRESS.md` entry for final results and remaining acceptance scope.

For canonical browser acceptance, use an isolated `TV_REALMS_SAVE` and run:

```powershell
$env:TV_UNIVERSE_CAMPAIGN_ISOLATED = '1'
$env:TV_UNIVERSE_CAMPAIGN_URL = 'http://127.0.0.1:7531/?universe&campaign'
node scripts/world/universe-campaign-journey.mjs
```

The script refuses the ordinary play port and requires the isolated-save flag.
Set `TV_UNIVERSE_CAMPAIGN_EXPECT_SAVE` to the exact expected test-save path for
an additional host-path check. The recovery mode
`TV_UNIVERSE_CAMPAIGN_RESUME_RETURN=1` resumes an already landed home journey;
it is not a fresh full-flight run.
The [defect register](UNIVERSE_ISSUES.md) records concrete bugs, verification and
ordered next work. [Campaign results](evidence/universe/CAMPAIGN_RESULTS.md)
separate the original failed journey, its verified recovery and remaining gaps.

The later [presentation results](evidence/presentation-quality/RESULTS.md) cover
free orbit/zoom during actual personal flight, rig-specific shared motion,
atmosphere/shadow ownership and exact-save restart. The corrected journey
passed 51 ordinary-control checks and its initial restart passed 17. Preserved
failed attempts, final guard follow-up, frame costs and unexercised assertions
are reported separately. See [presentation controls and limits](UNIVERSE_PRESENTATION.md)
and [character motion provenance](CHARACTER_MOTION.md).
