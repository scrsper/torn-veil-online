# Astral presentation — 20 October 2026

This revision adds free third-person orbit, gradual flight framing, spherical
lighting and shared-character motion to the existing astral view. It reads host
snapshots; it does not predict movement, grant capabilities, change collision,
advance resources or write character/world saves. The ordinary planar town
camera remains unchanged. The corrected ordinary-control journey passed **51
checks**, and its exact-save restart/reentry/return passed **17 checks**. This
accepts the measured traversal and camera behavior; the character and terrain
polish limits below remain open. A final camera-guard follow-up passed **27
checks** and checkpoint 18377 restored successfully.

## Camera and controls

`src/web/universe/camera.ts` is a pure presentation controller. Left- or
middle-button drag consumes complete pointer deltas locally at render rate,
independently of the 10 Hz intent/poll loop. Horizontal orbit is unrestricted;
pitch is bounded to −15°…75°. Wheel or brackets select a preferred 3…18 m
distance. Flight scales that distance and adds bounded speed framing; the
preferred distance is not a guarantee of the actual lens distance.

R or the Recenter button eases behind the current tangent heading. A transported
frame retains heading through vertical flight and eases the horizon when the
nearest planet changes. Automatic horizon transport is capped at 90°/s, with
exact elapsed-time integration of its capped exponential convergence; the cap
does not restrict pointer orbit or recenter. Close ground zoom gradually lowers
the framing pivot from 1.35 m to 1.05 m above the feet and removes look-ahead to
keep boots clear of the bottom HUD. Ground/personal/vessel offsets and the 52°…57° field of
view also ease over elapsed render time. System warp resets frame interpolation.
Browser-local preferences survive reload independently of canonical saves.

W/S follow the character's heading, A/D sidestep, and left/right arrows turn.
Walking is **body-relative**, including after a front-facing orbit. Ground
up/down arrows tilt the camera; flight arrows steer the host. Mouse orbit,
wheel zoom and recenter send no movement intent and do not cancel assisted
navigation. This is not a camera-relative action-RPG locomotion implementation.

The lens retracts immediately when obstructed and expands gradually after
clearance. `client.ts` combines a sampled terrain/settlement-underlay segment,
canonical cooked Atlas proxies with a 0.3 m sweep, and five settlement mesh rays
approximating a 0.3 m lens footprint. These constraints affect only the camera.
Atlas camera collision is independent of model loading. Town mesh rays depend
on the received, **loaded** settlement meshes; they are not a complete unloaded
canonical-town camera solver. Procedural terrain sampling is bounded rather
than an exact continuous intersection proof. Very tight spaces can retract the
lens to the pivot. The locally owned spherical avatar hides at actual lens
clearance ≤1.25 m and restores at ≥1.6 m, while its animation and orientation keep
updating. This prevents looking through the hero's head without changing shared
material modes, placement or canonical state. It is a visibility transition,
not an alpha fade or a dedicated indoor camera mode.
At minimum zoom and complete wall retraction the aim retains a nonzero look
direction even when eye and pivot coincide. Pure geometry and real Babylon
FreeCamera regressions verify the finite, invertible view without moving the
collision-constrained lens.

## Lighting and ownership

### Contact/readability local checkpoint

The contact pass adds a read-only floor patch to the campaign projection.
It comes from the host's existing collision triangles, including raised paving
and slopes. The browser receives bounded sphere-space triangles around the
traveler; it does not download the full collision catalog. Missing evidence,
unsupported faces and an exceeded triangle budget release contact. The lowered
procedural underlay is never used as a town foot-contact surface.

The spherical avatar passes a fresh absolute origin and radial up direction to
the shared character. Sole anchors remain in absolute coordinates while the
renderer rebases. Correction rotates the legs and ankles, leaving the canonical
body and actor root unchanged. Geometry tests and a partial ordinary-control
ground run are recorded under `docs/evidence/presentation-quality/contact-pass/`.
The ground run reached the step and slope but failed its later departure-position
assertion and returned safely to town. Flat/step contact windows are measured;
the left foot has no eligible slope-idle frame, while the right remains eligible
for 20.19 seconds. The exact inactive
town checkpoint 10649 restores. See [the handoff](UNIVERSE_CONTACT_HANDOFF.md).

Personal-flight framing now scales preferred zoom by 1.15, with at most 1.2 m
of speed pullback. A default 6 m preference therefore reaches at most 8.1 m in
clear flight. The camera still obeys manual zoom, orbit, collision and eased
mode transitions. Raised-hand envelope tests cover the default frame, not all
possible camera angles or clothing deformation.

The flight overlay now raises the arms during strong vertical ascent and allows
a stronger, bounded forward lean during forward passage. Existing hemispheric
and environment fill increase smoothly at altitude, preserving the prior
surface values through 40 m. No extra light, caster or character material is
introduced. Actual front/side moving-flight visual acceptance remains pending:
Jacob requested wrap-up, and no new flight run was started after the ground
assertion. The Atlas capsule-margin sole-query defect also remains open (U-063).

`src/web/universe/lighting.ts` owns the directional key, hemispheric fill, sky
dome, environment texture and shadow generator for this scene. The distant sun
direction is the normalized fixed presentation vector `(0.35, 0.82, 0.45)`.
Local radial orientation determines day-side fill; altitude and the planet's
atmosphere determine sky, fog and star visibility. This is not a simulation of
planet rotation, weather, orbital lighting or the canonical time-of-day clock.

The environment reuses the installed
`/textures/environment/kloppenheim_06_puresky_1k.hdr` asset at a 128-face
environment resolution. ACES tone mapping, restrained exposure/contrast and
the existing source materials provide the current lighting treatment.
The source HDR remains a fixed environment rather than a planet-specific
captured irradiance field.

Nearby character, vessel, town and Atlas meshes register through
`UniverseShadowOwner`. At most 112 meshes / 240,000 triangles enter the normal
2048 shadow map; lite mode uses 48 / 100,000 and a 1024 map. Selection updates
every 0.2 seconds, prioritizes the hero and bounds candidates to 65 m from the
rebased observer by bounding-sphere distance. Whole meshes exceeding the
remaining budget are omitted. The shadow list clears above 120 m altitude.
These are workload bounds, not proof of a target frame rate or full-world
shadows.

Triangle accounting multiplies each prototype by its active thin-instance
count. Spherical materialization transfers the placed instance's shadow
registration and metadata to its replacement mesh. Disposing the original
placement owner unregisters those replacements without disposing shared sources.
Canonical thin-instance batches enable per-instance camera picking, so the lens
tests placed walls/posts instead of an unplaced prototype. Real Babylon
regressions cover these ownership and collision cases.

Asset owners unregister their meshes before disposal. The client disposes
terrain, Atlas, avatar and settlements before the lighting owner and scene.
Camera listeners and pointer capture are also released. The lighting owner
clears its environment reference and disposes its owned GPU resources.

## Shared character

`avatar.ts` projects the same canonical body through a spherical parent and
passes a stable tangent heading to the shared hero. It interpolates visual
orientation without changing the host facing. The current Ranger/Wren meshes,
per-rig retargeting, audited Quaternius locomotion source, explicit motion
fallbacks, bounded flight-pose overlay and material limits are described in
[CHARACTER_MOTION.md](CHARACTER_MOTION.md). Motion source diagnostics identify
the actual loaded clip rather than treating its alias as provenance.

Spherical foot IK is disabled pending a radial support sampler and solver.
Actual moving side captures show a coherent flight silhouette and attached
limbs, while recentered flight still looks too upright and the hero is small
and dark in space. Fine cloth, finger and eye quality is not established by
those captures. No new hero replacement or character geometry optimization is
claimed. Ordinary NPC/combat/door/Tower interaction still uses the town
controller; see [SETTLEMENT_TRAVERSAL.md](SETTLEMENT_TRAVERSAL.md).

## Verification status and acceptance

The pure tests in `tests/universe/camera.test.ts` cover full pointer-delta
consumption, 360° orbit and bounds, unchanged host inputs, vertical tangent
retention, antipodal/pole continuity, gradual mode framing, recenter, immediate
obstruction retraction, elapsed-time easing, bounded preference restoration,
the automatic angular-speed limit and projected head/feet framing at close zoom.
They verify geometry and state separation, not perceived visual quality.

The first browser route passed 29 checks before rejecting a rapid horizon
change. Follow-up tracing measured 59.54° over approximately 95 ms but a maximum
5.92° in one rendered frame: a fast smooth turn, not an established one-frame
snap. The corrected crossing retained 489 samples and reduced the maximum
coarse-window change to 8.77°, with a maximum single-frame change of 0.648°.
The rate assertions allow browser/engine clock quantization; the largest derived
instantaneous rate was 92.65°/s, not an exact measured 90.00°/s. The original observations remain in
[the first-run report](evidence/presentation-quality/first-run/RESULTS.md).

`window.__tvUniverse.camera` returns a copy of actual camera position, target,
up, tangent heading, preferred/rendered distance, orbit angles, FOV and nearest
planet. `lighting`, `avatar` and `render` expose bounded workload and actual
rig/motion diagnostics. These are inspection surfaces, not gameplay controls.

The isolated-save browser harness
`scripts/world/presentation-quality-journey.mjs` is the reproducible acceptance path.
It requires `TV_QUALITY_ISOLATED=1`, `TV_QUALITY_URL` and the exact
`TV_QUALITY_EXPECT_SAVE`; it creates a new evidence directory. Restart mode
also requires the prior successful `TV_QUALITY_BASELINE`. It uses ordinary UI
and input, with no direct movement injection or capability grant.

The [verified report](evidence/presentation-quality/verified-run/RESULTS.md) and
[restart report](evidence/presentation-quality/restart-run/RESULTS.md) establish:

- Front/side/back close views and a measured 360° drag; actual zoom and recenter
  work while canonical heading, target and cruise remain unchanged.
- Ground, vertical ascent, hover, assisted passage, nearest-world handoff,
  descent and touchdown retain finite camera frames. Space silhouette readability
  still needs improvement.
- Actual rig/clip provenance and animated frame changes are visible, with no
  missing required assets or shader errors in the measured journey. Isolated
  pose tests cover removal of the overlay and lack of accumulated joint offsets.
- Ground/flight shadow workloads stay bounded; warmed frame-time/draw-call
  samples disclose hardware, lite mode and differences from baseline framing.
- The same Person, Body, inventory, parked vessel and discoveries survive
  travel, return, reload and a graceful restart of the exact isolated save.

Ground p50/p95 was 20.8/27.9 ms with 849 draws; the original ground sample was
13.9/20.8 ms with 676 draws. Lighting and shadows add work, and these differently
framed samples are not a controlled benchmark. Maximum sampled shadow work was
112 casters / 51,713 triangles. A 120-frame sample does not establish endurance.

The journey's wall probe reached 1.716 m clearance; the final bounded ground
follow-up reached 1.29788 m across three positions and 24 angles, with a finite
camera view and intact rig diagnostics. Neither exercised the 1.25 m
avatar-hide cutoff; focused lifecycle tests cover the rule, while live threshold
acceptance remains pending. The exact zero-clearance view is covered by the
real-camera regression, not those browser samples. No flight interval met the strict
400 ms / four-update / 0.05 m/s steady-speed criterion; the rotating-frame
false-brake invariant is covered by a separate regression.

The failed first trip, its recovery, the later blocked departure and its safe
recovery remain alongside the corrected journey. No finished character-pipeline,
radial foot-contact or performance certification is claimed. Track concrete
failures and next work in [UNIVERSE_ISSUES.md](UNIVERSE_ISSUES.md).
