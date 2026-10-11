# Tower implementation and visual review — October 8, 2026

Worktree: `tower-polish`, branch `codex/tower-visual-polish`, based on `b315356` (with `67c4dac` and `24ce4ba` preserved).
No remote push, merge or deployment. The combined-world task owns integration into the main game.

## Implemented

- Connected tall maze floors, room/corridor loops, reserved boss spaces and reachable loot/shrines. Maze walls are 5.4
  units high, perimeter walls 8.2. Walls and their sconces share the same camera cutaway test.
- Navigation uses actual unbroken prop collision boxes as well as walls; breaking furniture rebuilds its routes.
  An expandable weighted-distance queue replaces the overflowing fixed buffer, and diagonal steering respects corners.
- Encounter budgets add deeper-floor composition, awareness, reinforcements, flanking, ranged sight lines and flask
  attrition. See `towerEncounters.ts`; boss floors remain deliberate spikes followed by respite.
- The pure simulation expedition kernel owns bounded practice and loot receipts, level, tier and class assessments.
  Checkpoint migration retains old gear/levels and preserves a recovery copy without inventing past mastery.
  See `TOWER_EXPEDITION.md` for the host-facing interfaces and the remaining world-Person integration boundary.
- Existing MPFB male/female assets receive restrained skin/eye optics, finer linen, and leather/hair roughness treatment.
  A bounded 1024/2048 key-light shadow map adds body/clothing/prop contact shadows (eight nearby actors, sixteen props;
  disabled at low quality). Source GLBs, UVs, rigs, anatomy and reference images are unchanged.

## Visual judgment and provenance

The source references reviewed included Omni and Kestrel character sheets and the existing Ashford/rebirth art.
The playable bodies are still registered `tv-human-male-v2` and `tv-human-female-v1`, staged byte-for-byte. The separate
GNM heroine-v4 head is static and untextured; the separate TRELLIS character revision has known unresolved defects.
Neither was silently substituted into the Tower, and no reference image was uploaded or regenerated.

Matched renders use the same explicit identity, fixed authored idle pose, fixed cameras, and isolated Proving Hall.
Foes are frozen off-floor for these character-only reviews. The native PNGs are not composited or retouched:

- Before material treatment: `.debug/arena/character-surfaces-before-matched-oct8/`
- Material treatment: `.debug/arena/character-surfaces-after-oct8/`
- Material plus local shadows: `.debug/arena/character-shadow-oct8/`

The added weave and ground contact shadows are visible; the face changes are restrained. These are rendering
improvements to existing assets, not a completed high-fidelity model rebuild. Generic facial anatomy, clothing
intersections, simple props and the gap to reference quality remain. A prior incorrectly framed capture in
`character-surfaces-before-oct8` is excluded from comparisons.

## Verified evidence

- `checkpoint-nav-rewards-oct8`: the exact formerly rejected command was accepted after owner consent. It then failed
  normally: 7/10 checks, zero kills, no page errors, exit 1. This was a navigation/combat failure, not an approval failure.
- `restored-navigation-oct8`: real keyboard/mouse input reached floor 2 at 28 seconds and floor 3 at 51 seconds;
  zero console/page errors.
- `checkpoint-fixed-oct8`: all 23 browser checks passed, zero page errors, exit 0. Covers floor-boundary continuation,
  repeat achievement receipts, practice isolation, death, and retained corrupt/incompatible save recovery.
- Focused progression/checkpoint/navigation/boundary run: 47 tests passed; subsequent TypeScript check passed.
  The earlier pre-reversion 103-test result is not used as validation of this state.
- Final default regression run: 196/202 files passed, 1,995 tests passed, eight failed and 30 were skipped.
  Five files encountered the sandbox's `uv_os_get_passwd ENOMEM` failure in tsx; the item-catalog hash test exceeded
  its unchanged five-second timeout. A normal-reviewed rerun of exactly those six files passed all 44 tests with
  zero failures/skips. The two runs cover all 2,033 default-suite tests; no assertions or timeouts were changed.
  The retry report is `.debug/tower-final-regression-retry-oct8.json`.
- Final `npm run web:build` passed, including TypeScript, source-asset provenance hashes and the production bundle
  (3,395 modules). The first sandboxed build could not read an ancestor directory during esbuild config lookup;
  the same command passed through normal approval review. Output remains local in `dist-web`.
- `maze-final-oct8`: all 12 actual-browser floor/seed cases passed, including loaded collision boxes, flood reachability,
  and wall-crossing assertions along navigation routes. Floors 4, 5, 20, 31, 61, 91; seeds 918271 and 7.
- Character shadow captures: both bodies completed with zero page errors. The maze capture also checks console/shader errors.
- `tower-gameplay-final-oct8`: two minutes of real keyboard/mouse play with a middle-mouse camera orbit, reaching
  floor 5 at 117 seconds; zero console/page errors. During native recording: FPS median 49.4, p10 40.2, 997 samples.
  Unretouched MP4: `.debug/arena/tower-gameplay-final-oct8/frames/gameplay.mp4`. Static frames were also visually reviewed.

Five inspected screenshots cover the floor-31 preview and matched male/female
character views. Their native media and private delivery receipts remain local.
These are the October 8 staged candidate based on `b315356`, not the combined-world
integration build. Floor 31 is a preview, not evidence of reaching it through combat.
The static character review freezes foes off-floor.

The pacing model estimates a 259-minute median and 14/300 Gold clears under its published assumptions. It is neither
empirical player data nor a combat-engine full-ascent simulation. Multi-hour player completion, survival and Gold
incidence remain unmeasured. Refer to `.debug/tower-pacing-oct8.json` and its generator rather than treating the target
4–6 hours / 1–5% Gold as observed outcomes.

Recovery copies taken before implementation resumed: `.debug/tower-retained-oct8-before-resume.patch` for tracked
changes, and `.debug/tower-retained-oct8-untracked.json` for then-untracked source. No broad reset or deletion occurred.

At the verification checkpoint, the 31-file candidate is staged on `codex/tower-visual-polish`; HEAD remains
`b31535637f45d113255b3a74bb93b6d8dd2d21bc`. Automatic approval review rejected the local Git commit, citing the
original read-only Claude inspection scope. No commit retry, cross-branch application, push, merge or deployment
was used to bypass that rejection. Commit-specific approval has been requested; the source changes remain intact.
