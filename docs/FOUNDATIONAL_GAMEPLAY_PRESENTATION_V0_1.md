# Foundational Gameplay Presentation v0.1

Status: implementation checkpoint complete on 2026-09-14; awaiting human playtest.

## Implemented vertical slice

- One canonical-facing third-person camera now derives exploration, combat and incapacitated presentation modes. Starts, stops, pivots, acceleration, gait and shoulder hints are presentation signals; root motion and actor-translation authority are explicitly false.
- A generic semantic prompt layer sends opaque interaction IDs for simulation revalidation. Keyboard and controller prompts share the same path.
- A restrained layered HUD provides inventory, nearby physical container, pause/settings surface, consistent back/cancel, controller navigation and modal input lockout.
- Canonical `Container` entities persist capacity, open state, item IDs and physical location. Transfer commands carry only container/item identity and direction; TypeScript revalidates reach, state, contents, capacity, actor capability and minimal ownership authorization. Player-facing DTOs omit raw canonical owner IDs, and load rejects contradictory container/item topology.
- The generated settlement starts the ordinary controlled person in its public square near one canonical loose item and one canonical chest, allowing pickup/open/transfer/save without developer relocation.
- World items use one central native presentation catalog. Containers and items follow regional canonical projections and never grant interactions.
- Observer-visible wildlife now creates disposable native actors keyed by canonical `bodyId` and associated with `creatureId`. A safe engine-shape roe-deer proxy maps idle/walk/forage/eat/drink/rest/sleep/flee/dead, interpolates canonical motion and distinguishes death from withdrawal.
- Existing biome-driven PCG remains collision-free, tagged `TV.Decorative.NoGameplay`, and separate from canonical resources. Existing combat authority and choreography remain intact while camera/modal behavior stays continuous with exploration.

## Authority boundary

```text
TypeScript entity/action/container/wildlife truth
        ↓ observable bridge projection / semantic intent
Unreal actor, camera, animation, HUD, interpolation and decorative PCG
```

Unreal does not decide movement, pickup, transfer, damage, wildlife behavior, death, inventory or persistence. Native prediction and smoothing remain disposable.

## Controls

WASD / left stick move; mouse / right stick look; Shift / left-stick click sprint; wheel zoom; E / A interact; I / View inventory; arrows / D-pad select; Enter / A transfer; Escape / B back; P pause menu; Tab target; LMB / right shoulder light attack; RMB / Y heavy attack; Space / B dodge; Ctrl / left shoulder crouch; F5 save; F6 diagnostics.

## Verification checkpoint

- Focused TypeScript: 81 tests in 11 files passed, including container authorization/round trip, bridge transfer, ecology scheduler, wildlife identity/residency/activity, persistence and playable world.
- Typecheck and Vite production build passed.
- Generated interaction/combat specifications are current.
- UE 5.8 native Editor build passed using the repository AutoSDK.
- All 3 `TornVeil.Presentation` native automation tests passed.
- Playable loopback startup passed 61 checks; evidence: `docs/evidence/startup/live-smoke.json`.
- A fresh-world PIE capture exercised the ordinary bound Interact command and recorded the
  projected physical chest, canonical contents, layered shell and dressed settlement at
  `docs/evidence/foundational-gameplay/playable-shell.png`; its region/PCG inventory is beside it
  as `playable-shell.json`.

## Remaining gaps

The temporary deer proxy is not final art or animation. Explicit equipment slots/equip actions, true CommonUI/UMG widgets, device-specific glyph art, final settings/rebinding UI, a fully curated biome art pass and human approval remain deferred. No RDR2/Witcher/AAA quality claim is made.

## Human playtest

Run `pwsh -File unreal/scripts/Launch.ps1`, then use the controls above. The ordinary flow requires no console commands after startup. Stop for human feedback before treating presentation quality as accepted.

## Remote hardening checkpoint — 2026-09-14

`npm run foundational:accept` now performs one deterministic ordinary-world journey through the
existing bridge seams: settlement spawn, loose-item pickup, inventory projection, physical chest
open, transfer in/out, canonical travel toward wilderness, observer-scoped roe-deer identity and
flee projection, corpse-versus-withdrawal semantics, save/reload, and exact selected canonical
state comparison. It also rejects duplicate item/resource identities and multiply located items.

Evidence is under `docs/evidence/foundational-gameplay/`:

- `automated-journey.json`: passing machine-readable journey and profiles.
- `settlement.png/.json`: fresh generated-settlement projection.
- `container.png/.json`: ordinary bound interaction opening the canonical chest.
- `wilderness-deer.png/.json`: body-keyed canonical wildlife/corpse projection.
- `post-reload.png/.json`: same `bodyId`/`creatureId` after bridge restart.

Measured direct snapshot payloads were 1,237–1,767 bytes (0.82 ms mean); the real startup check's
largest bounded wire message was 87,508 bytes. Open-container projection averaged 0.0033 ms over
250 samples. After the expected roughly 390 ms synchronous first headless region materialization,
steady region frames averaged 0.95 ms and canonical dynamic changes appeared at 0.48/s. One nearby
wildlife actor was present; native proxy Tick averaged about 0.025 ms over 40 samples in each of
the wilderness and post-reload captures. Save serialization was about 49 ms and reconstruction
about 2.9 s for a 4.16 MB world. No demonstrated runtime pathology justified optimization; native
streaming already progressively slices the headless first-materialization work.

Final remote verification: focused TypeScript 81/81, typecheck/production build, UE 5.8 Editor
build, native `TornVeil.Presentation` 3/3, playable startup 61/61, and the automated journey pass.
No normal-speed video was produced: the unattended off-screen capture path provides verified PIE
screenshots but not a trustworthy real-time recording. Human feel and full visual approval remain
explicitly unverified.
