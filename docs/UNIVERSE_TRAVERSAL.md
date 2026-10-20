# Torn Veil: The Astral Sea, expedition v1

This branch adds an original, playable procedural-world expedition to Torn Veil's
Babylon client. It starts on the existing Cinderveil height field, supports walking,
launching, manual flight, assisted continuous travel to other planets, controlled
descent, landing, and persistent return visits. Interstellar travel is an explicit
warp command. This is a travel foundation, not No Man's Sky feature parity.

## Play

Run `Play Torn Veil Universe.cmd` in this checkout, or:

```powershell
npm ci
npm run universe:play
```

The launcher starts the loopback host on 7526 and Vite on 7525, then opens
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
5. Walk with **WASD**, turn with **left/right arrows**, and look with **up/down**
   or a pointer drag. Return within 60 metres of the vessel to launch again.

In flight, W/S thrust, A/D strafe, arrows steer, Q/E move vertically, and Space
brakes. Manual controls cancel assisted navigation. M folds the chart; ? opens
help. Esc and focus loss release controls. Choose a system address 0–65535 and
**Cross the veil** after leaving the atmosphere. Reloading resumes the host's
expedition; restarting clears held thrust and unattended navigation/descent.

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
- `src/web/universe/terrain.ts`: bounded cube-sphere quadtree residency,
  parent coverage retained until children are ready, skirts, shared terrain
  sampling at all levels, water and atmospheric rims. Planet transforms are
  camera-relative; the host coordinates never rebase. A soft 5 ms tile budget,
  maximum two uploads per frame, and `&lite` constrain streaming work. Small
  cosmetic grass, crystals and stones have no resource or collision semantics.
- `client.ts`: renders host snapshots, interpolates only the view, displays the
  chart and flight telemetry, and sends intents. It imports no executable host,
  save, or travel-step code. Camera clearance is a presentation constraint.
- `src/web/main.ts`, Vite proxy, package scripts and the launcher expose the
  expedition through the existing browser client. Existing routes stay available.

Public-source research and the distinction between documented No Man's Sky ideas
and our implementation are in [UNIVERSE_RESEARCH.md](UNIVERSE_RESEARCH.md).
No proprietary code, assets, or licensed character packages are required.

## Integration boundary

The host owns the expedition's state, but it is **not yet bound to the existing
canonical Person/body, inventory, quests, or Tower journal**. The existing full
town/pagoda assets and NPC simulation are not populated on the expedition's home
surface. The world-survey link in help opens the existing separate route; it does
not transfer a character or rewards. Do not advertise this as a unified saved
town → space → Tower campaign.

There is no procedural civilization/ecology, resource extraction, fuel, combat,
terrain deformation, caves, or voxel volume generation in this slice. Worlds use
static centers and spherical height fields; gravity metadata is descriptive,
while flight uses arcade vessel controls. Warp changes systems explicitly; it is
not continuous flight between stars. Discovery history persists; travel events
retain the most recent 256 entries and are not a replacement for the canonical
world chronicle. No existing save schema or progression rules were changed.

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
