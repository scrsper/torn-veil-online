# Curated camera/combat refinement evidence

Implementation: `f0b2b79f48052b15895254a8da820cf9a207df9d`, 2026-09-12.
See `docs/COMBAT_CAMERA_REFINEMENT.md` for mechanics, controls, limits and test commands.

- `front-oblique.mp4`, `side.mp4`, `rear.mp4`: continuous ordinary-input play,
  approximately 24 s each, at 9.01/9.15/9.15 captured fps. Wall-clock durations are
  preserved using FFmpeg concat duration records and variable frame rate. No interpolation.
  An external verification camera keeps the feet visible; the front oblique avoids occlusion.
- Nine named PNGs show the jab, round-kick active pose and held crouch from those views.
  They accompany the continuous sequences; they do not establish fluidity alone.
- `live-summary.json`: callback-to-observed timeline and evaluated-pose measurements,
  commitment included/excluded explicitly, correction distributions and effector diagnostics.
  Median game rate 60.08 fps. This is not physical input-to-photon. Encoding overlapped
  part of this small run, and frame-time/phase alignment limits are disclosed.
- `capture-summary.json`: capture completion and its separate timing diagnostics.
- `motion-provenance.json`: selected source/retargeted/final samples, actual striking
  foot, authoring knots, preserved left-foot comparison and source sprint displacement.
- `native-tests.json`: nine targeted native test results, all successful.

Raw evidence remains local: `.debug/refinement-live-final/probe.json`,
`.debug/refinement-capture-final/`, `.debug/refinement-native-final/`,
`.debug/refinement-asset-qa.json`, `.debug/refinement-source-poses.json`.
The first capture had front-view occlusion and is not presented as the delivered view.
An initial live connection attempt reached an old server with an incompatible specification;
the delivered runs used the isolated task server on 53636.

TS verification: 116 distinct focused tests across latest affected runs. See
`.debug/refinement-focused-expanded.log`, `refinement-protocol-final.log`,
`refinement-posture-profile-final.log`, `refinement-contact-posture-final.log`.
Final native build log: `.debug/refinement-native-build-final.log`; final web build/typecheck:
`.debug/refinement-web-build-final.log`. No full suite or human approval is claimed.
