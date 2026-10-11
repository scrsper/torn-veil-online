# Fluid human motion and fitted adult clothing — 2026-10-10

Continuation of the [ontology and human motion checkpoint](../ontology-human-motion/README.md)
on `codex/ontology-human-motion`. This slice improves presentation; canonical
identity, movement, combat timing, damage and ownership mechanics are unchanged.
GPT-6.1 Sol workers handled fitted adult clothing and foot contact. Integration
adds contact-aligned travel and continuous animation transitions.

## Stride and transition changes

The imported forward, backward and sideways clips do not begin on the same
support foot. Their raw normalized frame positions cannot be interchanged
without changing support mid-step. A circular estimate from the baked left/right
contact tracks now aligns the centre of left support. Double support cancels,
and the duplicate loop endpoint is excluded. Only registered travel clips use
this alignment; actions retain their canonical sampled clock.

- Forward walk/run, backward/sideways travel, and guarded leg changes carry the
  outgoing support phase. [Measured clip anchors](gait-phases.json) document the
  actual imported clip offsets.
- Seeking to a phase keeps the full loop range, instead of repeating only the
  tail of a stride.
- Interrupted fades retain playing clips and weight velocity, normalize the
  full-body contribution, and use a critically damped response. This avoids
  restarting a returning clip and avoids bleeding through the bind pose.
- Guarded leg overlays remain owned while crossfading, instead of snapping to
  static guard legs during direction changes. Zero-contribution walk/run clips
  are no longer started and stopped on every frame.
- A narrow diagonal direction band prevents repeated gait replacement when
  velocity fluctuates around 45 degrees.

Foot contact now uses baked support tracks when a travel clip clearly dominates,
including guarded legs. Geometric fallback uses bind-pose ankle heights captured
before any clip plays, with subsequent body/parent scaling included. Low-foot
dwell and lift rejection, blended release/reacquisition, teleport reset and a
spherical reach bound keep correction continuous near leg extension. Details,
controlled imported-rig measurements and limits are in [FOOTWORK.md](FOOTWORK.md).
Release speed is bounded by ankle offset, preventing a large lock correction
from disappearing in one step. The final fixed-timestep comparison retains
roughly 55% lower walking support speed and 30% lower running support speed,
without increasing maximum frame displacement in its six imported-rig cases.

## Adult models

Wren and Brann received fitted trouser coverage masks, 3 mm garment clearance,
and rougher fabric/leather materials. Their 53 named bones and garment topology
remain intact. Exported GLBs were reimported for walk, run, twisting punch and
deep crouch checks from front/rear oblique cameras. See [ART.md](ART.md) for
provenance, reproduction, before/after images, counts and residual limitations.

## Validation

- Six focused test files, 32 tests passed across the final affected runs: contact acquisition/release, scaling,
  teleports, motion clocks, support alignment, interrupted fades, 30/120 Hz
  consistency, canonical action mapping and cast selection.
- TypeScript passed; production Babylon bundle passed.
- A fresh GPT-6.1 Sol reviewer independently reviewed the completed implementation,
  tests, asset pipeline and evidence after validation; no actionable findings.
- Blender export validation passed: unchanged named bones and trouser triangle
  counts, fewer skin/trouser contacts in every inspected pose, no new collapsed
  trouser triangles. These are geometric stress measurements, not a claim of
  complete garment collision handling.

Browser acceptance uses an isolated disposable server on port 7516 and a private
build under `.debug/fluid-human/client`. The previous checkpoint remains served
on 7515. Existing saved worlds and user servers are not used for fixture resets.

The headed keyboard acceptance confirmed one canonical jab (practice body health
80 → 60.1843, hit sequence 1), return to idle, moving guard/release, walking at
3.3587 m/s and sprinting at 5.2059 m/s. Town presentation loaded 12 actors without page
errors. [Measurements](canonical-motion.json), [strike](gym-attack.png),
[running](gym-run.png) and [town environment](town.png) are saved here.

```powershell
npx vite build --config vite.web.config.ts --outDir .debug/fluid-human/client
$env:TV_GYM_PORT = '7516'
$env:TV_GYM_STATIC = '.debug/fluid-human/client'
node --import tsx scripts/web/combat-gym-server.ts
# In a second terminal:
$env:TV_MOTION_URL = 'http://127.0.0.1:7516'
$env:TV_MOTION_OUT = '.debug/fluid-human/canonical'
node scripts/web/human-motion-verify.mjs
```

The previous full regression (195 files / 1,925 tests) is recorded in the linked
checkpoint. This presentation-only continuation uses focused validation instead
of rerunning unchanged simulation suites. Terrain-aware sole/toe adaptation,
remaining extreme-pose seam intersections and broader cast wardrobe refinements
remain further work. This is progress toward the supplied visual reference, not
a claim that the full reference quality has been reached.
