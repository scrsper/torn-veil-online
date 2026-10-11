# Imported adult footwork verification

The presentation foot correction now captures ankle baselines in the unscaled bind pose, uses baked support phases for a clear cyclic animation leader, and fades contact instead of replacing a weighted anchor during turns. Height-based inference still requires 40 ms of landing dwell. Explicit support phases acquire immediately with a blended correction, so a short running stance is not consumed by inference delay. Lift, turning, overreach, inactive presentation and root teleport guards remain active.

Reach correction projects continuously into the leg's reach sphere. This replaces the discontinuous extension-weight cutoff that produced an extra foot jump as an imported knee straightened. Projection can permit a small ankle lift while the contact releases. Large horizontal corrections also release at a bounded rate: weight loss contributes at most 2 times body scale metres per second, while small offsets keep the ordinary 10-per-second weight fade.

## Reproduction

Start a client that serves the current arena assets, then run from the repository root:

```powershell
$env:TV_MOTION_URL = 'http://127.0.0.1:5182'
$env:TV_MOTION_OUT = 'docs/evidence/fluid-human-models/footwork-controlled.json'
node scripts/web/human-footplant-verify.mjs
```

The default URL is `http://127.0.0.1:7516`; the default output is `.debug/footplant-controlled.json`. Chrome and the repository's Playwright dependency are required.

The fixture loads the detailed `people/hero.glb` adult through `ArenaAssets.human('ranger')` (25,112 mesh vertices), then pauses the render loop and disables regular world foot correction. Fresh instances compare correction off/on with identical animation frames, bind-pose resets, movement and yaw at 60 Hz for 240 frames per scenario. The first 30 frames are excluded from measurement. Cyclic clips use direct unweighted `goToFrame`, which applies values immediately; stopping uses the production Animator's 0.2-second walk-to-idle fade and an explicit fixed-time animation step to flush weighted bindings. The script rejects mismatched raw ankle ranges or support sample counts between the paired runs.

Travel uses each clip's measured stance speed at the arena's 1.22 scale. The imported strafe clip's support motion matches local +X travel; the earlier exploratory -X direct-clip trial was a mismatched direction and is not used as evidence of runtime behavior. The sharp turn rotates travel and actor yaw by 90 degrees over 0.2 seconds. Stop begins at two seconds; settled stop samples begin 0.4 seconds later.

## Controlled result

`footwork-controlled.json` contains the paired measurements. Primary support speed uses the same baked contact mask for raw and corrected poses, requiring support on both adjacent frames. It measures horizontal ankle speed during those samples, including acquisition/release, rather than selecting frames because the corrected foot happens to be locked.

| Imported motion | Raw support speed (m/s) | Corrected support speed (m/s) | Reduction |
|---|---:|---:|---:|
| Walking | 0.691 | 0.310 | 55.1% |
| Running | 1.380 | 0.965 | 30.1% |
| Backward | 0.113 | 0.062 | 45.3% |
| Strafe | 0.126 | 0.089 | 29.7% |
| Sharp turn | 0.745 | 0.399 | 46.4% |

Settled stop ankle speed decreased from 0.00396 m/s to 0.0000042 m/s. This is a narrow result on this imported adult and these clips, not a game-wide claim.

## Limits and remaining work

- Correction reduces measured support sliding but does not remove it. Running still averages approximately 0.965 m/s within the source support mask. Better source contact timing, support duration and retargeted leg poses remain relevant.
- Maximum displacement over **all** measured frames, including swing and imported clip discontinuities, was unchanged within numerical precision for every scenario: approximately 0.1127 m for walking/turn/stop, 0.1966 m for running, 0.1146 m for backward and 0.0521 m for strafe. The bounded release fixed an earlier correction-induced walking peak of 0.1282 m. The underlying animation's largest steps remain; improved average support speed does not establish their elimination. The JSON records the frame and raw displacement at each maximum for diagnosis.
- Walking and running ankle pivots stay above the geometric bind-height acquisition band in this rig. A height-only stance classifier finds no support samples for them; reporting those missing samples as zero sliding would be misleading. Source support hints are needed for these retargeted offsets. Production disables hints when no clear travel leader exists during mixed fades.
- This fixture covers one detailed adult at one scale, a flat floor, specified cyclic clips and one stop transition. It does not establish quality for every adult model, terrain, gait blend, guard overlay, action or frame rate. Canonical browser acceptance and visual review are separate evidence.
- `footwork-exploratory.json` preserves the first realtime keyboard run. It had variable frame cadence and sparse directional support samples, and produced mixed results. It is exploratory, not the controlled comparator or a success gate.

Nine focused foot-contact tests cover midstride initialization, bind/parent scaling, turns, lift/gait changes, root teleport, sustained travel without frozen feet, idle stop, explicit support acquisition, knee straightening and bounded release of a large correction. Together with the five existing motion-clock tests, 14 tests passed after the final solver change. Their synthetic slip reduction is a regression bound, not evidence of game-wide improvement.
