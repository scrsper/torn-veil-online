# Grounded humans, attention, sound and lighting — 2026-10-10

Continuation from `679ce9a` on `codex/ontology-human-motion`, using two GPT-6.1 Sol
implementation workers and root integration. The user's Witcher 3 benchmark is
now expressed as [production quality gates](../../web/QUALITY_TARGET.md).
This is a verified presentation milestone, not a claim of overall parity.

## What changed

Imported adults now sample the drawn ground under each foot. A small sole
footprint supplies height and normal; missing samples, sharp edges, distant
floors and excessive slopes reject support. Height adjustment is limited to
22 cm per unit body scale, tilt to 25 degrees, with bounded acquisition/release
and existing leg-reach limits. Canonical roots and movement do not move to fit
the mesh. Flat-ground output retains the preceding contact behavior.

Adults also use their projected attention point for smooth, bounded neck/head
gaze: approximately 46 degrees yaw and 20 degrees pitch, split across the chain.
Each fresh animation pose is restored before adding attention, avoiding rotation
accumulation. Actions, hits and down states suppress attention. This is head/neck
motion; it does not provide facial performance, eye motion or new NPC decisions.

The attention adapter no longer sends every nearby conversational NPC's gaze to
the player. Explicit projected entity targets resolve to their nearest visible
body within 8 m, with deterministic ties and support for multiple bodies. A
conversation formation supplies its existing inward heading, not an invented
partner identity. Missing targets do not become the player. No canonical state
or knowledge is changed.

Imported-human footsteps follow swing-to-support edges instead of a separate
distance counter. Baked contact masks lead when a clip dominates; intermediate
walk/run blends reuse the foot-placement pass's observed body-relative support.
The baked mask remains authoritative when available, preventing small ankle
rises inside a stance from triggering a second sound.
Initial poses, idle, frame gaps and teleports do not manufacture landings. Nearby
NPCs use the same presentation
adapter with distance attenuation and camera-relative stereo; hearing remains
at the controlled body when the camera pulls back. Physical ground palette IDs
distinguish wood, stone, paths/soil, grass and water, including stone interiors.
The lookup checks the projected floor at body sole height and the drawn water
sheet, so a wooden bridge does not inherit the terrain beneath it and shallow
water does not sound like its substrate. Layered synthesized
weight/contact/texture sounds respond to speed and rain;
temporary audio nodes/routes are disconnected after playback. Procedural and
placeholder player bodies retain the distance fallback.

Daylight now has a slightly weaker sun and broader, more neutral sky/earth
illumination. Shaded clothing and facades retain detail without increasing
exposure. Clouds soften the balance toward diffuse light; clear-night light
channels, the sky/exposure pipeline and the number of render passes are retained.

## Evidence and limits

The [recorded keyboard acceptance](canonical-motion.webm) shows the actual
strike, guarded strafe, walking/running and town load. It is a browser capture,
not a curated cinematic or an audio recording.

| Check | Result |
|---|---|
| Focused tests | 65 tests across 9 files pass; final affected boundary check included. |
| TypeScript / production Babylon bundle | Both pass on the integrated source. |
| [Imported terrain fixture](terrain.json) | 18 cases: three sizes × flat, incline, tread, edge, missing ground and cliff. Root unchanged; largest normalized correction per 60 Hz frame approximately 2.4 cm. |
| [Imported gaze fixture](gaze.json) | 16 cases: two sizes × two parent rotations × target/capped/null-release/action-release. Root/feet displacement zero; maximum frame rotation approximately 0.109 rad. |
| [Flat-ground regression](footplant.json) | Prior six-case measurements retained: support speed walking .691→.310 m/s, running 1.380→.965 m/s; maximum frame displacement no worse than raw animation. These reductions originated in the previous milestone. |
| [Canonical keyboard acceptance](canonical-motion.json) | One jab changes practice-body health 80→60.1843; hitSeq1; idle recovery and guard release pass. Walk3.3587 m/s, sprint5.2059 m/s; town12 actors; zero page errors. |
| [Footfall/audio acceptance](audio/result.json) | Six walking and seven running contact sounds, no idle/stopped chatter or duplicate distance fallback. Five actual OfflineAudioContext surface renders: peak .113–.143, correct stereo energy, no page errors. |
| [Lighting conditions](lighting/conditions.json) | Clear11, dusk18.5, night23, rain11 and night-rain23 render without page errors; before/after clear11 share a frozen pose, camera, sky and exposure. |

Terrain measurements use controlled synthetic surfaces and one imported ranger
rig. They do not establish all-cast stair navigation: the callback currently
uses resident terrain geometry, downhill reach has no pelvis adjustment, and
unsupported structure geometry is not magically made walkable. Existing clip
seams and garment intersections are not eliminated by these corrections.

The [lighting comparison](lighting/before-clear11.png) against
[the new balance](lighting/after-clear11.png) changes only the four clear-noon
light channels on one paused world. Screenshot luma is a diagnostic, not a
quality score: shaded stone34.12→39.53, timber32.38→37.42, clothing30.74→36.07;
sky124.30→124.30. None of the measured crops clips at the recorded threshold.
[Crop coordinates and measurements](lighting/controlled-pixels.json) are saved.
The engine is stopped and manual renders skip animation evaluation, so the
comparison is not confounded by gait/grass motion. WebGL2, balanced,1280×720.

Weather captures override presentation atmosphere only; canonical weather,
particles and wet materials are not changed. Their HUD clock still shows the
canonical hour, while capture metadata records the lighting override. Rear-view
captures do not establish facial or interior quality. Deep-night/cloudy-night
palette, foliage/vistas and building interiors still need art work. These runs
do not establish warmed-route frame time, one-hour memory stability, weak-device
performance or physical-controller feel.

Audio remains synthesized. The saved [grass](audio/grass.wav), [dirt](audio/dirt.wav),
[stone](audio/stone.wav), [wood](audio/wood.wav) and [water](audio/water.wav) samples
use deterministic noise through the real synthesis method for repeatable audition.
This verifies signal/headroom/pan, not a listening verdict or recorded-Foley
quality. The controlled keyboard fixture exercises the player's contact route;
nearby NPC audibility is supported by the common adapter and spatial unit checks,
not a separate human listening review.

## Reproduction

All browser checks use `scripts/web/combat-gym-server.ts`, with no save access.
The final private build is `.debug/quality-pass/client`, served on port7517.
Earlier previews on7515/7516 remain available.

```powershell
node node_modules/vite/bin/vite.js build --config vite.web.config.ts --outDir ../.debug/quality-pass/client
$env:TV_GYM_PORT = '7517'
$env:TV_GYM_STATIC = '.debug/quality-pass/client'
node --import tsx scripts/web/combat-gym-server.ts
# Separate terminal, same repository:
$env:TV_MOTION_URL = 'http://127.0.0.1:7517'
node scripts/web/human-gaze-verify.mjs
node scripts/web/human-terrain-verify.mjs
node scripts/web/human-footplant-verify.mjs
node scripts/web/human-motion-verify.mjs
node scripts/web/human-footfall-verify.mjs
node scripts/web/lighting-cohesion-verify.mjs
```

Run browser checks sequentially to avoid GPU contention. Output paths are
selectable with `TV_GAZE_OUT`, `TV_TERRAIN_OUT`, `TV_MOTION_OUT`, `TV_AUDIO_OUT`
and `TV_LIGHTING_OUT`; the motion and footplant scripts use `TV_MOTION_OUT` as
a directory and a JSON file respectively, so change/unset it between those runs.
The full canonical regression from the preceding ontology checkpoint remains
documented there; this presentation slice does not rerun unchanged simulation
suites. A fresh GPT-6.1 Sol reviewer found one P2: using terrain-only block IDs
for Foley missed wooden structural floors and water. The root agent fixed the
resolver for both footfall paths and added five region/cell integration tests,
including raised wood over cobble, indoor stone, water over grass, bridges and
non-support geometry. A further contact regression covers a blended gait without
a dominant baked clip, retaining observed pose support for upper floors outside
the terrain-only IK sampler. Non-resident regions do not emit contact Foley.
Relevant foot/audio/boundary checks and TypeScript pass again. The final
production bundle builds successfully, and its keyboard/audio recheck records
six walking and seven running contacts, no idle/stopped chatter or duplicate
distance fallback, five valid surface renders and zero page errors.
There were no other actionable review findings.
