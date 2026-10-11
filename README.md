# Torn Veil Online

Torn Veil is a persistent simulated world. **Babylon.js is the active game client.**
`src/sim/` owns the world; `src/web/` displays it and requests canonical actions.
The simulation is being retained. Unreal is archived; Three.js is historical.
GitHub `main` is the shared source baseline. Use a clean main checkout and its
primary launcher, which reports the exact compiled commit. [Current state](docs/CURRENT_STATE.md)
records the implementation, test scope and known limits. The October 11 consolidation
is tracked in [PR #66](https://github.com/scrsper/torn-veil-online/pull/66), with
independent CI and its landing receipt. Full integration ancestry and intermediate
private reports remain preserved locally; source branches and historical previews remain intact.

## Play

The launcher opens one home for Play, character, Tower, persistent Observatory and historical experiments. See the [local repair checkpoint](docs/TORN_VEIL_REPAIR_OCT11.md).

Double-click **Play Torn Veil.cmd** (or `npm run play`) for the persistent
Aether Reach / Cinderveil world and **canonical Tower**. The launcher builds
`dist-web` for this checkout's exact clean commit, shows that commit, and rejects
an older host on its port. `npm run play:build` builds without launching.
The local save is `.debug/realms/world.json.store/`; original JSON imports remain intact.
From another checkout, choose a free port: `Play Torn Veil.cmd -Port 7550`.

[Current state, test scope, known defects and held-back work](docs/CURRENT_STATE.md).
The atrium's **Enter shared Tower trial** uses the same canonical person, body,
rank, possessions, injuries and saved world. Historical score-based Tower and
Town/Gym previews require explicit lab URLs and do not define progression.

**Play Torn Veil Web.cmd** opens the same current build as **Play Torn Veil.cmd**.
The explicit older `scripts/web/Play-Web.ps1` and **Play Torn Veil Isometric.cmd**
remain historical living-world comparisons with their original saves.
Existing live characters/saves are not silently migrated into the new geography.

Use `Play Torn Veil Web.cmd -CheckOnly` for a read-only preflight.
[Browser controls](docs/web/CONTROLS.md) · [Browser setup](docs/web/README.md)

## Understand an NPC

Double-click **Torn Veil Observatory.cmd** or choose Observatory in the launch home.
It reads the same persistent world as Play and the Tower: actual identities, needs,
canonical development, possessions, beliefs and stored event causes.
The home shows the running build and persistence identity.

Disposable scenario experiments remain available through `npm run observatory`;
their older [workbench guide](docs/OBSERVATORY_WORKBENCH.md) describes that separate
reproduction environment. History in the current home labels those experiments.

## Current direction

Finish a small, visually convincing Babylon experience and make its NPC behavior
understandable. Judge it in normal gameplay against the supplied visual references.
Do not restart the simulation or change engines to address an unmeasured problem.
The current Observatory reads the owning persistent gameplay host. The disposable workbench remains available for reproducible scenarios.

## Development

Use Node.js 22 and run `npm ci` in the checkout to install dependencies. These launchers
describe the prepared Windows development machine. A fresh clone does not include local
character GLBs or private profiles; see [asset setup](docs/web/WEB_ASSETS.md).
The Vite development client also needs the world service and web gateway described in
[browser setup](docs/web/README.md).

```powershell
npm run typecheck
npm run web:build
npm run web:dev
```

See [.ai/REPO_MAP.md](.ai/REPO_MAP.md) and
[verification policy](.ai/TESTING.md). `npm run dev` and the default `build` scripts
still target the historical Three.js client; use `web:*` for Babylon.

[Unreal archive and recovery](docs/UNREAL_ARCHIVE.md) ·
[Visual reference assessment](docs/web/VISUAL_REFERENCE_GAP_V2.md)
