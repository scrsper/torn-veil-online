# Tower visual and motion polish: QA record (2026-10-06)

Branch `codex/tower-visual-polish` (from b9a8c41). Local evidence lives under `.debug/arena/` in the worktree (gitignored,
not published). Preview server for every capture: `http://127.0.0.1:5181`, seed 918271, headed Chrome, isolated contexts.

## What changed

**Motion (commit 24ce4ba).** Three runtime causes, each shown before it was fixed:
- Retarget sampling handed out Babylon key objects past a clip's end (`run_sprint` ends at 37.5, bakes sample 38); the
  bake's rest reset then rewrote those keys, so every later rig bake (the creator bodies) inherited rest-pose loop tails.
  `sampleSource` now returns owned copies (`tests/retarget-sample.test.ts`, red/green proven against the old sampler).
- `Animator.loco` restarted a retired zero-weight gait every frame with an unweighted `goToFrame`, so the rendered frame
  showed the walk pose under a running body (live thigh rotation off its own track by ~87°). The seek is now weighted, the
  rate is set before it (Babylon's `speedRatio` setter replays a pending seek unweighted when the rate changes), and
  retired gaits stay off (`tests/arena-locomotion.test.ts`, NullEngine with a constant animation clock; both failure
  modes proven red).
- `FootPlant` teleported pins on turn/drift re-plants and snapped releases. Pins now take short lifted steps, one foot at
  a time, and ease back (`tests/arena-locomotion.test.ts`: in-place turn and release continuity).

**Environment (`src/web/arena/environment.ts`).** Tall pilastered perimeter walls with plinth, cornice, banners and torch
sconces; scanned CC0 surfaces (Poly Haven, `art/reference/web-rebirth/material-manifest.json`) through the shared scan
handling in `render/materials.ts`: `cobblestone_floor_08` and `weathered_planks` floors, `rock_wall_08` walls, tinted per
tier, with all three maps at one tiling per floor; painted polished marble tiles for the Silver/Gold/God courts (no marble
scan is licensed locally); a floor bake (contact shade, worn route to the door); per-tier palettes, fog and light; a stone
arch portal with braziers (`tower.ts` `buildDoor`); ruined walls as coursed masonry at the same collision box.

**Light budget.** A shader effect with 12 lights failed to compile on this GPU (captured in `scenes-env4`, where every PBR
surface vanished; console: "Unable to compile effect"). Now: `scene.requireLightSorting` with `LIGHT_PRIORITY`; environment
materials take 8 (hemi, key, hero fill, rim, door, three nearest torches); characters keep Babylon's default 4 and bind
hemi, key, hero fill and rim on every tier; the two pooled VFX flash lights are disabled while idle and outrank the rim
while live.

**Props and gear.** Containers (pots, jars, barrels, kegs, crates) were 1.3-1.5 m beside a 1.8 m hero; drawn size and
collision now shrink together (seeded positions, hp and the wall-only nav grid unchanged). Stowed blades are slung flat
against the back, hilt by the right shoulder and tip by the left hip, instead of blade-up over the head (no scabbard mesh
exists; it is a placement change only).

**HUD.** Header width capped clear of the status frame; the weapon name sits above its slots; below 1180 px the skill
row rises above the weapon row at 0.8 scale.

**Cleanup.** The door and shrine now dispose their own materials, textures and (shrine) render observer.

## Evidence

| What | Where | Result |
|---|---|---|
| Floor baseline (before) | `scenes-before/` (24 PNG) | grid floor in a void, low perimeter box |
| Floor final, all 8 tiers | `scenes-final2/` (24 PNG + report.json) | 0 page errors, 0 console errors; floor gate OK on all; hero binds 4 lights, floors 8; fps (local, short window, headed): Hall 144.2; floors 4: 71, 16: 73.7, 31: 46.3, 46: 53, 61: 52.6, 76: 47.2, 91: 59.8 |
| Invalid earlier captures | `scenes-env4/` (failed shader), `scenes-final/` (marble tiers blank: a `DynamicTexture.clone()` is an empty canvas) | superseded; the scene harness now fails on console render errors and on a non-renderable floor |
| Motion baseline | `base-motion-male/` (report, MP4) | foot pops > 0.3 m/frame: 33 |
| Motion final, real input incl. turns | `final-motion-male/`, `final-motion-female/` (report, MP4) | pops: male 1 (0.33, guard), female 0 |
| Gear | `gear-before-male/`, `gear-final-male/`, `gear-final-female/` | longest item 0.71-0.74 of hero height (the Veilguard's authored length); stowed blade no longer above the head |
| Prop approach/smash | `.debug/pot-probe.ts` output (session log) | pot: hero stops at the drawn edge (-0.06 to -0.17 m), smashed in 1 swing; barrel smashed in 2 (its approach was blocked by a keg in the path) |
| HUD layout | `hud-before/`, `hud-after/` (1280, 1100, 900) | overlaps before: 3 at 1280, 3 at 900; after: 0 at all three widths |
| Resource plateau | `resources-final.txt` | floors 4, 20, 46 x5: no growth after the first cycle; VFX flash light on only while live; 0 errors |
| Checkpoint e2e | `checkpoint-e2e-final/` (22/23), `checkpoint-e2e-final2/` (23/23), `checkpoint-e2e-corrected/` (22/23), `checkpoint-e2e-atomic/` (23/23) | see below |

### Checkpoint e2e history (all reports kept)
1. `checkpoint-e2e-final`: C5 failed. The real-input retry earned `essence` for the first time; C5 demanded strict
   equality of the whole lifetime record, though `recordEarned` counts each receipt (run:achievement) once and a genuinely
   new award legitimately adds one count and one receipt.
2. `checkpoint-e2e-final2`: a rerun passed 23/23. Not taken as proof: it only avoided the variance.
3. C5 corrected to the contract: prior counts unchanged, every prior receipt still present, each new award exactly one
   count with exactly one new receipt for this run, receipts unique. Independently reviewed against: a valid captured
   retry (accepted), a prior-count duplicate (rejected), a duplicate receipt (rejected), a deleted prior receipt
   (rejected), a new award counted twice (rejected).
4. `checkpoint-e2e-corrected`: C5 passed, C3 failed. The essence was picked up after the harness's `mid` snapshot and before
   the reload (play keeps running), so the baseline raced live play; the reload changed nothing.
5. The baseline is now atomic: the page's render loop (which runs the whole game step) is stopped in the same call that
   reads the record, then the page reloads normally. C3 keeps strict equality. `checkpoint-e2e-atomic`: 23/23, 0 page
   errors. Forced harness steps, disclosed in the header and `report.harnessForced`: that render pause, the instant death
   (G) and placing the hero at the Proving Hall exit (F).

### Tests and build
`tsc --noEmit` exit 0; `npm run web:build` built; unit files `arena-locomotion`, `retarget-sample`, `creator-appearance`,
`shared-cast`, `tower-checkpoint`, `physical-fit`, `materials-fire-crafting`: 46/46.

## Remaining limits (not solved)
- Running stance slide: locked stance frames hold at 0 m/s, but each landing settles through an eased step (at least
  40 ms) that slides at about 3.5 m/s, so the run's median stance slide is 0.7-1.2 m/s depending on which frames are
  sampled. Walk and turn medians are 0. A landing that plants exactly on contact (clip contact refined to the rendered
  foot speed) is the next corrective step.
- Attack and dodge feet slide (median 1.1-1.8 m/s); the plant is off during dodges by design and the attack clips root
  in place.
- The male guard entry produced one 0.33 m foot transient in the final run (the turn-to-aim re-plant).
- Marble court floors are painted, not scanned; the Gilded Courts checker is bold and is a taste call to review.
- No architecture kit is licensed locally, so pilasters, cornices, arches and sconces are code-built primitives with
  scanned or painted surfaces; the props remain the CC0 KayKit set.
- Frame rate: 46.3-144.2 fps overall and 46.3-59.8 on the denser tiers (31-91), measured locally over a short window in a
  headed capture browser; not a performance benchmark.
- The room space above the walls is still visually sparse (open haze, no ceiling or upper structure).
- Rendered media and private delivery provenance remain local.
