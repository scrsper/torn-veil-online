# Universe expedition verification — 2026-10-19

Implementation branch: `codex/universe-traversal-oct19`, based on world branch
`aeafced`. BERNHALDT, Windows, Node 22.23.2. Local source only; no push or merge.

- `npm run typecheck`: passed.
- `npx vitest run tests/universe tests/world-sphere tests/web-boundary.test.ts`:
  **85 tests in 17 files passed**. Includes generation, descent and navigation,
  surface/orbit/return LOD, input/session guards, corrupt-save and disk-write
  failure cases, landing restart, existing sphere tests and browser boundary.
- `npx vite build --config vite.web.config.ts --outDir ../.debug/universe-bundle`:
  passed, 3,478 modules. No licensed-asset staging or `play:build` was performed.
- `node scripts/world/universe-journey.mjs`: **11 checks passed**, zero page or
  console errors. Ordinary UI/keyboard: home launch → another planet → physical
  landing → walking → browser reload → launch → home return. Discovery IDs remain
  unique; explorer/vessel IDs survive; no assisted-flight collision events.
- Additional ordinary-UI check: manual ascent, warp to system 1, assisted approach
  and landing, warp back to system 0 and home landing: **5 checks passed**, zero
  page errors. Cross-system discovery and explorer identity preserved.
- Graceful launcher shutdown released the test save's writer lock. Relaunch loaded
  its prior discoveries and home position; the browser journey was repeated after
  the restart with the latest runtime.

Final settled compact-view sample: median rAF interval 7.0 ms, p95 7.1 ms across
120 frames; 168 visible terrain tiles, 59,304 vertices, 107,520 triangles, 1,600
cosmetic clumps, zero pending tiles. This is a short headless Chrome sample on this
device, not a 144 fps guarantee, GPU budget, streaming p95, or a long-session soak.

Agent generation probes additionally checked 5,031 safe landing sites and 212
navigation routes. These exploratory probes supplement the committed regression
tests; they are not a complete enumeration of the address space.

Visuals inspected after capture:

- [Cinderveil surface](01-home.png)
- [Continuous space travel](02-transit.png)
- [Glacial world after landing](04-new-world.png)
- [Different star system](06-new-system.png)

Full local test snapshots remain in `.debug/universe-evidence/{journey,warp}.json`.
The second test used `.debug/universe-final-save`, separate from user save storage.
Automated browser input is not a human or physical-controller playtest.

Known limits: the separate explorer is not the existing canonical Person/Tower
character. No campaign inventory/quests/rewards transfer, NPC populations,
town/pagoda assets, resource economy, caves or deformable voxel terrain. See
[implementation boundaries](../../UNIVERSE_TRAVERSAL.md#integration-boundary).
