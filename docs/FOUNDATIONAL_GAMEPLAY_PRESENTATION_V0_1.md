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

## PR #43 human-playtest lighting correction (2026-09-14)

The black scene was a real Lit-path defect, not missing geometry. The saved-world regional
update in `TVWorldProjection::Apply` selected **100 lux before 06:00 and after 20:00**, while
the unbound post-process volume kept **min/max EV100 12**. The human checkout's saved clock
was 05:43. All required movable lights, realtime skylight, atmosphere, fog and post-process
actors were present; D3D12 SM6/Lumen were enabled. Replaying those presentation values made
PIE near-black. Diagnostic `viewmode unlit` exposed colored terrain, buildings and characters;
it was restored to Lit and is explicitly rejected as an acceptance mode.

Fresh startup was already visible, explaining the earlier screenshot-only false confidence.
The running human bridge also came from the main checkout (`0e4c3b5`), not this PR (`7a4572b`).
Both maps had the identical SHA256 `dcfc79daca6499420b3a4029f531753df5e5d8bedc163fa0b44fb46e1f090dec`.
The main-checkout save could not deserialize on this PR; it was neither migrated nor overwritten
(SHA256 remained `3a50652916c033460860e66bed88ea2d79c00c5507a9deec990d224d226b7b6f`).
The fixed end-to-end run used an isolated fresh fixture with that exact clock value, through
the ordinary playable bridge → Launch → TornVeilWorld → PIE path. It is not claimed as a
successful replay/migration of the incompatible full human save.

Fix: `TVPlayableLighting` supplies a repeatable neutral daylight baseline: movable white sun
12,000 lux at pitch -45/yaw -35, movable realtime captured skylight intensity 1, atmosphere,
fog, and enabled unbound exposure. **EV100 min/max remain 12**; compensation +1 and histogram
method are now explicit instead of inherited defaults. Regional updates no longer independently
dim/rotate the sun. Canonical clock/weather remain unchanged; full time-of-day lighting is
deferred, not simulated by resetting the save. No gameplay, camera, animation or art was added.

`Launch.ps1` now rejects a different-checkout bridge and runs shared level setup/validation.
Native ordinary PIE startup repairs missing/stale infrastructure and validates it. Reopening
the regenerated map verified serialized actors/settings before PIE repair. Duplicate global
actors are rejected, not silently multiplied. `Verify-PlayablePIE.ps1` requires a fresh completed
report, not merely HTTP success from a remote Python request.

The upgraded capture requires the real Lit viewport, valid light/exposure/Lumen settings,
nine resident regions, nine terrain sections, generated PCG and populated mesh instances.
It waits across real frames for camera settling and PNG completion. Its independent pixel
gate samples x=8–92%, y=20–78% (excluding sky/top and bottom HUD): weighted sRGB luma mean ≥0.10,
fraction with luma ≥0.12 ≥35%, and p90−p10 ≥0.08. This is a conservative readability smoke test,
not an art, geometric-correctness or frame-rate score. Geometry assertions and human inspection
remain necessary. The recorded dark image fails (mean 0.049, readable 9.99%); corrected pre-dawn
Lit capture passes (mean 0.367, readable 97.34%).

Evidence: `lighting-fixed-predawn.png/.json`, `lighting-fixed-final.png/.json`,
`saved-time-dark.png`, `saved-time-unlit.png`, `map-reopened-environment.json`,
`lighting-regression.json`, and `lighting-verification-summary.json` in the milestone evidence folder.
`lighting-negative-test.json` is an **expected rejection** of injected 100-lux runtime lighting.

Verification: UE Editor build/generated-spec check pass; native Presentation **5/5** (new daylight
infrastructure/time-of-day and image-readability tests); focused TypeScript **14/14** in four files;
`foundational:accept`, typecheck and production build pass. Existing compiler/deprecation warnings
remain; the native isolated-world destruction test emits a harmless no-world-context warning.
No broad simulation suite was run because no canonical code changed.

Human re-test: from `C:\Users\green\Desktop\projects\torn-veil-online-foundational`, start
`npm run bridge:playable`, then `pwsh -File unreal/scripts/Launch.ps1`, then press Play.
For a machine-checked capture after 9/9 regions load, run
`pwsh -File unreal/scripts/Verify-PlayablePIE.ps1 -CaptureLabel playable-lit`.
Use this checkout's save, not the incompatible main-checkout save. Human re-approval remains pending.
