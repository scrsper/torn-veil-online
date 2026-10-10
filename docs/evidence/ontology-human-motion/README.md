# Ontology and human motion — 2026-10-10

Work is on `codex/ontology-human-motion`, in the authoritative Desktop checkout.
The branch integrates `origin/main` at `10a648b`, preserving the pre-existing
controller and Tower work from `claude/combat-gym-arpg`. The shared detailed adult
cast and visual ontology editor came from that main baseline; this pass extends
their motion integration and canonical embodiment checks.

## Canonical ontology

`World.attachBody` validates registered owner/body identity and ownership before
linking a manifestation. Creation paths for settlements, demographics, wildlife,
the village, game runtime and combat fixtures use it. It is idempotent and rejects
foreign-world objects even when IDs happen to match.

People and creatures still support zero or many bodies. `primaryBody` prefers a
present living body and retains a corpse fallback for existing observational
callers; it skips stale links to another owner's body. Graph diagnostics detect
missing reverse links, duplicate/dangling manifestations and wrong owners.
Regression coverage confirms equipment stays on its original body when another
manifestation becomes primary. This is ownership integrity, not completion of the
entire metaphysical ontology or a new embodiment lifecycle.

## Human presentation

- Shared adult rigs face the canonical direction through a presentation child
  transform. Their world position, identity, damage and movement remain simulated.
- Live observed/predicted actions select separate punches, kicks and dodges.
  Completed historical combat records no longer trap a character in attack motion.
  Action sampling follows the canonical preparation/active/recovery clock.
- Forward walk/run clips blend and change playback rate with ground speed;
  backward/sideways movement selects directional clips. Guard retains moving legs.
- Leg overlays preserve phase when changing direction, stop outgoing groups and
  honor per-body freeze/slow clocks. Shared foot planting uses separate ankle
  baselines and contact hysteresis.
- Child/fallback kits use distance-paced procedural gaits and two-bone IK,
  including nonuniform body scale, directional travel and combat hand poses.
- Blender kit rebuilds add project-authored heads/eyes and repair garment coverage.
  See [art provenance and rebuild instructions](ART.md).

## Evidence and reproduction

The production Babylon client was built to an isolated `.debug/human-pass/client`
directory. The disposable server ran on port 7515; existing user servers and saved
worlds were not used. The canonical browser script rejects servers without the
disposable-world identity before resetting a fixture.

```powershell
$env:TV_GYM_PORT = '7515'
$env:TV_GYM_STATIC = 'C:/Users/green/Desktop/projects/torn-veil-online/.debug/human-pass/client'
node --import tsx scripts/web/combat-gym-server.ts
# In a second terminal:
node scripts/web/human-motion-verify.mjs
# Procedural showroom measurement; a Vite client is running on port 5181:
node scripts/web/human-gait.mjs
```

Use `TV_MOTION_URL` and `TV_MOTION_OUT` to select another isolated server/evidence
directory. `TV_GYM_STATIC` can point at a normal `dist-web` build instead.

The headed Chrome check issued ordinary keyboard commands. A jab changed the
practice body's canonical health from **80 to 60.1843** with one confirmed hit,
then returned to idle. Guard release, locomotion, sprint and the town shared cast
passed; sampled canonical walk/run speeds were **3.3587 / 5.2059 m/s**. There were
no page errors. See [structured observations](canonical-motion.json),
[combat capture](gym-attack.png) and [town capture](town.png).

The controlled showroom check covers 18 cases: female, male and child rigs;
1.5 and 4.6 m/s; forward, backward and lateral travel. Six seconds per case yields
over 100 stable planted-foot samples after warm-up. The worst mean horizontal
planted-foot speed was **0.04564 m/s**, below the 0.1 m/s acceptance limit. These
are procedural rig measurements on a flat render fixture, not measurements of
the shared imported adult clips or uneven terrain. Raw results are in
[gait-measurements.json](gait-measurements.json).

A separate headed action-arena sequence confirmed foot-lock acquisition/release
and both foot bones. Its reversal/turn samples still show substantial residual
sliding; it is evidence of functioning locks, not a production-quality foot-slip
benchmark. Local videos are retained under `.debug/human-motion/canonical` and
`.debug/arena/validation-5181` and are not committed as large binary evidence.

## Verification

- Six focused files / 27 tests passed for ownership, equipment, locomotion,
  shared cast/action mapping and arena layers.
- Production Babylon build passed.
- Final TypeScript, normal regression and visual ontology package results are
  recorded below when their running checks finish.

## Remaining work

Imported strike contact timing uses a phase mapping, not per-clip contact markers;
pose-space weapon reach and motion-specific contact calibration remain useful.
Terrain slope adaptation, sharp-turn foot slip, clothing deformation and
close-camera adult material quality still need another art/motion pass. The child
and fallback kits remain stylized procedural art. This is automated desktop
validation, not human gameplay or gamepad acceptance, and does not establish
performance on lower-end GPUs.

The merge preserved pre-existing local tooling in a recovery stash. Comparing its
untracked blobs confirmed that main already includes the useful behavior plus the
correct nested ontology path and shared-asset routes. The stash and unrelated
reference-art directories remain untouched.
