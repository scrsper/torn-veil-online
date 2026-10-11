# Human exploration presentation target

The user's visual reference, supplied 2026-10-10:
[かにさし — walking clip](https://x.com/kanisasitosige/status/2108848646842433711/video/1).
The embedded twenty-second preview was inspected in the browser; X requires a
login for the expanded view. The reference is a visual benchmark, not an asset
source or a change to canonical simulation rules.

## What to carry into Torn Veil

- A close rear third-person view with the horizon visible and the clothed body
  large enough to read its gait and silhouette.
- Ordinary walking that communicates weight through a consistent stride, planted
  feet, torso motion and delayed movement of suitable clothing/hair.
- Layered, grounded traveler clothing and carried equipment that suit the world.
  Rendered equipment must still follow canonical inventory/equipment.
- Natural ground detail: grass, broken rock shapes, water and a clear separation
  between nearby detail and hazy distant terrain.
- Stable exploration framing that keeps manual camera control and responds to
  obstruction. Combat can widen the view when opponents or large creatures need
  space.

The clip demonstrates exploration. It does not establish a combat animation or
contact model; Torn Veil's existing canonical combat remains the authority.

## Current implementation slice

The ontology/human-motion work establishes shared human rigs, direction-aware
locomotion, action sampling from the simulation clock, procedural fallback foot
placement and ownership checks. The reference follow-up tunes the exploration
camera to a 4.6 m follow distance and 12-degree downward pitch, retaining manual
orbit, obstruction handling and situational framing. Secondary motion uses
bounded 120 Hz spring steps on rigs that contain coat/hair chains; the detailed
adult rigs currently have no such chains, so this does not add cloth simulation
to those models. Authored woodland now retains its missing canopy presentation,
using the existing projected grid positions and vegetation renderer. See
[`../evidence/ontology-human-motion/README.md`](../evidence/ontology-human-motion/README.md)
for tested results and screenshots.

Further art work is needed on garment deformation, material detail, body-specific
motion, terrain/vegetation silhouettes and atmospheric composition. A camera
change alone does not supply that fidelity. Time of day and weather continue to
come from projected canonical state; review captures must record any overrides.
