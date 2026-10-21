# Shared character motion — 20 October 2026

The existing credited MPFB Ranger and Wren meshes remain the campaign heroes. This revision changes their presentation, not Person identity, body dimensions, inventory, learned magic, movement, collision or save data. Creator staging and the separate private VRM creator are unchanged.

## Source and reproducible staging

The redistributable locomotion fallback is **Quaternius Universal Animation Library, Standard, Unreal/Godot `UAL1_Standard.glb`**, licensed CC0 1.0. The [author's page](https://quaternius.com/packs/universalanimationlibrary.html) identifies the license; the existing downloaded pack supplies the matching notice below.

Exact audited source:

- 7,618,436 bytes.
- SHA-256 `69591853d817488edaa8fd9bf8fc1d821eaeaf789f8627b3cd23b41c4ed67997`.
- Tracked source: `tools/ontology/public/assets/library/quaternius-ual/model.glb`, already included in the repository before this traversal release. The hash and length above match this file exactly.
- Staged byte-for-byte to ignored `web/public/arena/motion/ual-standard.glb`; this release adds no binary model or animation files.
- No source asset edits, new downloads, runtime decoder services or creator-runtime dependency.

Run `node scripts/web/stage-human-motion.mjs`. A clean checkout uses the tracked source above without an external motion install. `TV_HUMAN_MOTION` can point to the same audited source elsewhere; `TV_REALMS_ASSETS` can provide an already staged copy. Existing sibling-project copies remain fallback candidates. The campaign launcher and current-assets staging call this shared step. A different existing target is refused and retained. The manifest is `src/web/presentation/motionSources.json`; runtime rechecks its byte length and hash before Babylon parses it.

The UAL source contains 43 clips. This revision uses only four corresponding aliases:

| Requested shared clip | Actual UAL source |
| --- | --- |
| `unarmed/idle_neutral` | `Idle_Loop` |
| `unarmed/walk_forward` | `Walk_Loop` |
| `unarmed/run_jog` | `Jog_Fwd_Loop` |
| `unarmed/run_sprint` | `Sprint_Loop` |

Existing optional local Mixamo/Motifect packs keep precedence when available. Missing combat, strafe and other motions retain the existing KayKit fallbacks. Diagnostics expose the actual source, source clip, path, target rig and, for the CC0 UAL pack, the verified hash and license. An alias is not a provenance claim. Full current-build staging still requires its previously audited optional local packs; this does not relax that release policy.

Supplied notice:

> License: CC0 1.0 Universal (CC0 1.0), Public Domain Dedication
>
> https://creativecommons.org/publicdomain/zero/1.0/
>
> Models by @Quaternius
>
> Consider supporting me on Patreon! https://www.patreon.com/quaternius

## Rig, pose and materials

Each loaded distinct rig receives its own baked clips and grips. Wren previously reused Ranger's bone tracks despite substantially different rest rotations (including spine, pelvis and feet). Per-rig retargeting preserves target trunk geometry and maps UAL's actual `Head` and complete finger chains. Source keys and source GLBs remain unchanged.

Temporary UAL, optional Mixamo/Motifect and KayKit source instances dispose their complete Babylon instantiated entries, including cloned skeletons. Removing only their meshes and animation groups leaves a cloned skeleton registered until scene disposal. The ownership regression instantiates and disposes a real Babylon asset container repeatedly while confirming the reusable source skeleton, animation and shared material remain intact.

Airborne motion uses the authored relaxed idle under a bounded visual overlay, not ground walking at flight speed. A smoothed pelvis-region pivot leans into cruise, with bounded arm reach, knee flex and bank. The phases distinguish launch, hover, ascent, cruise, braking, descent and landing from observed local velocity; they do not imply available magical power or modify the trajectory. The overlay restores each fresh joint pose before the next animation evaluation and fades away after landing. Planar contact correction stays off until the overlay is nearly neutral.

The first browser pass caught false braking during steady assisted travel: the tangent-speed component shrank as the radial frame rotated. Braking now compares total velocity magnitude, while lean and reach retain their local directional inputs. A constant-speed rotation regression covers the failure. The spine-tilt diagnostic now measures against the actor's radial up direction, above the flight pivot; it previously reported approximately 67.6 degrees for an upright hero simply because the town was not at the global-Y pole.

The spherical avatar retains the camera's stable tangent heading for vertical steering, and accepts the shared lighting caster owner. Planar foot IK remains disabled on the spherical parent. The current contact iteration supplies a separate radial solver with absolute anchors, a fresh render-origin frame and host-derived floor triangles inside settlements. Outside mapped settlements it uses the shared canonical terrain/Atlas support functions. Browser acceptance is tracked separately from the geometry checks.

The radial solver measures a support hull of at most thirteen actual boot vertices per foot, selected by distal foot/toe skin weights. Each update evaluates their animated skin transforms before bounded leg/ankle correction; diagnostics reevaluate the same vertices afterward. It checks the centre and full heel/toe footprint, releases unsupported or discontinuous contacts and retains anchors across render-origin shifts. Body stature controls metre limits independently of source import units. The actor root, canonical position, source geometry, textures and skin weights remain unchanged. The planar solver remains on its existing path.

The actual staged Ranger and Wren rigs, their own UAL idle/walk bakes and synthetic rotated/skinned fixtures pass the focused checks. Selected settled minimum sole gaps on the analytic test plane remain below 0.72 mm in the sampled imported-rig frames. This is geometry evidence, not an exhaustive mesh collision claim or rendered town-slope acceptance. The source hashes, measurement method, prototype failures and limits are in [RIG_CHECK.md](evidence/presentation-quality/contact-pass/RIG_CHECK.md).

Optical refinements now recognize the inspected `Human.body`, `Human.low-poly` eye, specific hair, clothing and leather material names on the actual heroes. They preserve source textures, colours, UVs and geometry. Existing character credit requirements remain in `web/public/arena/people/CREDITS.md`. No VRM or other unreviewed character replacement is introduced.

## Validation and remaining work

Focused tests cover vertical heading, phase transitions and bounded offsets, no accumulated bone overlay, restored ground transforms, exact staging and overwrite refusal, UAL mapping and HTML refusal, and material-role specificity. Existing retarget, gait, footplant, shared presentation and metre tests cover the reused pipeline. Browser evidence must additionally verify actual loaded rig/source, animated frame changes, front/side/back silhouettes, flight transitions and caster registration.

The focused 12-file run passed 61 tests, and TypeScript passed. A separate read-only NullEngine check loaded the actual staged UAL and actual hero/Wren GLBs: all four clips produced 53 tracks on each rig, and the idle upper arm pointed mostly down (normalized vertical component approximately -0.900 on both). The four UAL clips took approximately 237–246 ms to bake per rig on this machine, excluding asset loading, other source clips and rendering. These measurements are not a full-cast browser frame budget or a substitute for visual inspection.

After the flight-phase, radial diagnostic and temporary-skeleton corrections,
the combined presentation/settlement regression run passed **121 tests in 21
files**. This includes actual Babylon ownership tests, staging refusal,
retargeting, gait/contact reuse, camera geometry, shadow bounds, Atlas ownership,
canonical berth retention and the browser/server import boundary. TypeScript
passed after the final source changes. Browser acceptance is recorded separately
under `docs/evidence/presentation-quality/`.

Remaining work includes live radial-contact acceptance across paving, steps and slopes, gesture/flight pose review against clothing deformation, measured per-rig load/bake cost for the full resident cast, and further character/cloth detail after that visual review. The current hero meshes exceed the earlier approximately 25k-triangle target (Wren about 35k, Ranger about 45k); this pass does not claim a geometry-budget reduction.

### Measured ground review

The `docs/evidence/presentation-quality/final-run/03`–`06` ground captures show relaxed arms, attached wrists and covered shoulders/waist. Both boots clear the HUD, and the chest marker is absent. The corrected anatomical spine diagnostic reads approximately 2.0–4.2 degrees during idle.

Existing scene landmarks, transformed back against the recorded radial up and canonical feet position, put the ankle joints approximately 7.35–7.60 cm above the feet reference. A separate read-only calculation from Wren's GLB bind transforms and mesh bounds gives an approximately 8.30 cm ankle-to-bootsole reference at the import adapter's 1.75 m reference stature (scale 1.141997; import vertical offset 8.70 mm). This approximate bind comparison does **not** indicate a large global avatar-height error. It is not an animated sole-contact measurement: the person's stature, foot rotation, skinned boot vertices and local support surface still matter.

The visual contact cue remains weak. **U048 stays open**; no spherical planting claim or global height correction follows from this evidence. Existing material identities, source textures, geometry and character-budget targets remain unchanged.

That run's attempted flight captures `08`–`10` recorded 0 m/s at ground level after an obstructed departure. They are retained as failure evidence, not verification of moving flight or its corrected braking pose.

### Verified moving-flight review

The later `verified-run/08-moving-ascent.png` shows 154 m/s and clear separation
from the terrain. `10-moving-flight-side.png` shows 852 m/s with a long diagonal
silhouette, legs trailing and forearms forward. No obvious waist tearing or
detached limbs is visible. Main/side diagnostic samples report planet-relative
ascent and approximately 43–47° anatomical lean, replacing the first run's
persistent false-brake classification.

The front/recentered view remains foreshortened and can read as upright with
raised forearms. The airborne hero is about 100–150 pixels and dark against
space; those captures cannot certify fingers, eyes or fine elbow/cloth
deformation. A stricter browser steady-speed assertion had no eligible interval;
its coverage limit is retained in the report. U-048 radial contact and U-059
space readability remain open. See the [verified evidence](evidence/presentation-quality/verified-run/RESULTS.md).
