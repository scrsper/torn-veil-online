# Shared adult gait - PR65 integration

Implementation commit: `54dd42959f8a7ad0ced9b48bacac6b36dea9cb3a` on
`codex/connected-realms`, continuing and preserving checkpoint
`3b7af4a9838441d0c64233e6a8ab321a1c3c554b`.
The source is [PR65](https://github.com/scrsper/torn-veil-online/pull/65),
`claude/natural-human-gait` at `1a61094fdfcb700dda01fbcc175b66aaea747187`.
Its gait curves are authored approximations. They are not measurements from,
or a reconstruction of, the referenced video.

The curves now reach the active imported adult rigs used by the standard
Babylon App, canonical Tower and motion lab. PR65's original legacy-kit
animator changes alone would not reach these characters. `HumanGait` adapts
the imported rest transforms and hanging-arm alignment, applying a single
absolute locomotion pose after Babylon animation and before foot planting.
It drives hip, knee, ankle, toe, pelvis, trunk and unarmed arm motion. It uses
the existing walk/run pacing and the playing clip's normalized cycle clock.
Armed upper-body tracks retain their authored pose; action clips, guard layers
and backward movement retain ownership. The actor root is never moved by gait.
Acceleration lean, turn bank, visual stance correction and blend settling use
elapsed time. Canonical movement, collisions, combat clocks and progression
remain the simulation's responsibility.

Verification exposed three existing presentation/input problems addressed in
this integration: a full-weight leg layer oscillated below its target; C in
the Tower refreshed a crouch lease without starting the crouch command; and
Q/guard without a visible target had no fixed facing for backpedal. The layer
now settles at its target. Tower and lab C use the existing canonical crouch
command and release it on key-up/blur. Tower Q/guard faces the camera when no
target is visible. The lab also releases keyboard guard on key-up. No physics,
cooldown, rank or resource rule was changed.

The checked evidence is in [RESULTS.json](evidence/shared-gait-pr65/RESULTS.json).
Raw videos, screenshots and input/frame traces remain under
`.debug/gait-pr65`; their exact paths, sizes and SHA-256 hashes are recorded.
The rendered gait recordings remain local. Private delivery receipts and raw
report originals are retained outside the tracked source reports.
They are real headed-Chrome output, with ordinary keys/buttons against the
canonical bridge. The standard town is explicitly disposable and uses the
production App; the Tower uses a new isolated realm save. Synthetic NullEngine
tests separately verify joint normalization, unchanged actor roots, idempotent
pose application, action/guard ownership, reverse release, armed tracks, phase
synchronization and frozen time.

- Focused checks: 33 tests in 4 files passed. TypeScript and the production web
  build passed; Vite reported a 105-second bundle build.
- Lab: 12 input checks passed. Canonical Tower: 17 checks passed. Standard App
  town: 12 checks passed. Each verifies slow movement, run, turning, actual
  reverse travel, attack/dodge handoffs, resumed locomotion, collision and
  interrupted input. Recorded reverse samples were also checked against the
  canonical facing/velocity dot product.
- Tower reload and return preserved the person, body, Normal rank and inventory.
  Town inventory checks compare item identities and quantities; available UI
  actions correctly change when the player is standing against a fence.
- Matching lab recordings use the same capture script before and after, with
  existing motion capture assets, six rendered people and canonical contact.
  Both had no browser errors. Recorded frame intervals were p50 6.9 ms,
  p95 7.1 ms and p99 7.3 ms. These are local QA observations, not a controlled
  performance comparison. Videos are encoded at 25 fps independently of game
  frame rate. Durations: before 25.8 s, after 24.04 s, Tower 39.32 s, town 32.44 s.
- JavaScript heap at capture end was 258,466,309 bytes in the lab and
  723,615,808 bytes in the town. These are single browser samples, not peak
  process memory, VRAM measurements or a capacity guarantee. Tower frame/heap
  measurements after returning to the realm are excluded from Tower statistics.
- Full aggregate: 2126 tests in 214 files passed in
  2078.41 seconds against the frozen implementation commit. Detailed results
  and exact normal-suite scope are recorded in the accompanying evidence.
  The unchanged one-worker suite excludes the repository's separate browser and
  long-run acceptance suites. The actual browser input checks above cover the
  affected surfaces; no long-run acceptance result is implied.

To launch the shared motion lab from this worktree, run:

```powershell
$env:TV_MOTION_PORT='7521'
$env:TV_REALMS_ASSETS='<licensed-assets>/web/public'
node --import tsx src/server/motionReview.ts
```

Open `http://127.0.0.1:7521/?motion-review`. WASD moves, Shift runs, C crouches,
J/K/L strike, Space dodges and G guards. The lab has no player save.
To launch a fresh realm/Tower slice, set `TV_REALMS_PORT=7522` and a new
`TV_REALMS_SAVE=.debug/gait-pr65/play/world.json`, retain the asset override,
and run `node --import tsx src/server/realms.ts`. Open `/?realms`, walk to the
Tower, enter its atrium and select the shared Tower trial. Use a fresh QA path
or the documented persistence upgrade procedure; never bypass journal
fingerprint guards or overwrite existing player state.

For the production App town, build with `npm run web:build`, set
`TV_GYM_PORT=7523` and the same asset override, run
`node --import tsx scripts/web/combat-gym-server.ts`, then open
`http://127.0.0.1:7523/?gym=1&scenario=town&autoplay=1&view=orbit&renderer=webgl2`.
Select "Switch to Town" if needed. This opens an in-memory canonical town,
not a live save. Reproducible gait QA uses `scripts/web/shared-gait-review.mjs`
with `TV_GAIT_SURFACE=lab|tower|town`, `TV_GAIT_URL` and `TV_GAIT_EVIDENCE`.
Start a fresh disposable town host for a repeat of its seeded route.

Human animation review remains useful for foot sliding over varied slopes,
all imported looks, unusual body proportions and weapon combinations. The
current default movement speed reaches the run blend under existing pacing;
the slower crouched pass exercises walk curves without altering movement speed.
There is no claim of visual equivalence to the reference, scientific
gait validation, mobile performance or megacity performance. The separate
Tower-polish worktree, Unreal, player saves and canonical progression were not
edited. Gold policy work remains paused. Nothing was pushed, merged or deployed.
