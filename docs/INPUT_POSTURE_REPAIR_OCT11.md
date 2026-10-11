# Input and torso repair checkpoint

This local checkpoint continues `448e761` in the isolated connected-realms
worktree. Desktop `dc9e07c`, its untracked files, and preview 7517 are preserved.
The separate character candidate failed visual acceptance and is not included.

Free-cursor third-person now accepts LMB strike and RMB guard, including disabled
or refused pointer capture. Middle drag controls the unlocked camera. Capture
entry does not repeat a strike; blur, cancellation and release clear holds.
Settings and initial hints describe these gestures.

Mixamo torso retargeting retains the target neutral rest geometry and transfers
motion deltas. Arm/limb rest conversion is retained. Other source maps, including
the UE unarmed set, keep their previous mapping. An initially broader correction
changed UE combat posture; matched renders caught it and the final repair is
narrower. No animation root, physical contact or canonical action rule changed.

Validation before main consolidation:

- Initial affected checks: 29 tests in five files passed; final narrowed repair:
  17 tests in three files passed. TypeScript passed. A separate production build
  passed before the final map narrowing; consolidation needs a fresh final build.
- Real mouse acceptance on disposable port 7543 passed nine checks across the
  standard App Gym and Town, with zero page errors. Gym target health changed
  from 80 to 60.1843. Town's mouse attack and hold/release guard reached canonical
  state. Identity and carried-item IDs/quantities stayed stable. The initial
  harness incorrectly compared an absent body `rank` field; it has been corrected
  to claim only identity/inventory. Canonical rank verification belongs to the
  final host/Tower persistence checks.
- Matched full-body side-camera renders passed all four looks (hero, Wren, Brann,
  Mystic), neutral/walk/run and a UE jab, before and after: 32 screenshots and a
  video. Actor roots remained unchanged; UE combat chain measurements matched.
  Hero idle torso inclination changed 11.36 to 1.69 degrees and upper-chain
  inclination 26.96 to 12.43 degrees. These are geometric observations, not an
  overall movement quality score.

Evidence remains in `.debug/input-posture-repair/mouse-gameplay` and
`side-views-final`, with JSON scope descriptions. The latter is an actual rendered
pose fixture using byte-for-byte frozen 7517 GLBs and before/current retargeters,
without foot planting, gait overrides, gaze or a canonical world. It is separate
from the ordinary-input gameplay video. Existing garment/hand defects and varied
body silhouettes remain; static fixtures do not prove final integrated gameplay.

Reproduce the render fixture by staging the four frozen people GLBs and existing
Mixamo/unarmed packs under `.debug/input-posture-repair/assets`; stage
`git show 448e761:src/web/arena/retarget.ts` as `baseline-retarget.ts`. Start Vite
with `--config vite.web.config.ts --port 7544 --strictPort --host 127.0.0.1`, then
run `node scripts/web/posture-check-capture.mjs`. The disposable gameplay helper
supports `TV_GYM_STATIC`, `TV_GYM_PORT` and a read-only `TV_GYM_ASSETS` overlay;
`node scripts/web/unlocked-combat-check.mjs` targets 7543 by default.

Current main consolidation is a separate acceptance step. No push or landing has
occurred at this checkpoint. No real-time progression pacing is claimed.
