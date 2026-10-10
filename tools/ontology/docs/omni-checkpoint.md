# Omni motion repair checkpoint

The current idle/walk review is materially improved and passes the bounded source/geometry checks below. The earlier walk is archived and remains rejected. Art likeness and general gameplay locomotion are not approved by this checkpoint.

## Corrected contracts

The catalog now uses a right-handed scene for glTF and the existing model-space retargeter. Reflected left-handed world matrices had invalidated its quaternion-frame calculations, producing raised arms and collar distortion. MPFB torso/neck/clavicle joints retain their anatomical rest axes because their origins differ from UE. Upperarm direction agrees with untouched native UAL motion within 0.001 degrees in sampled idle/walk frames. Available native finger channels are transferred rather than leaving spread rest fingers.

Belt, buckle and rolled cuffs now inherit normalized blended skin weights from their actual fitted garment neighbourhood. No part is frozen or hidden. Animated added separation from matched garment vertices stays below 2.3 mm in idle and 11.7 mm in walking. Shirt worst-frame 99th-percentile edge stretch falls from 3.88 x to 1.58 x in idle and 3.85 x to 1.62 x in walking. Clothing still requires art/deformation review; tiny-edge outliers and masked underlying body are not a full penetration proof.

## Physical contact and movement

The rendered floor is at world y=0. CPU-skinned outsole vertices, rather than ankle height, drive grounding and analytic two-bone stance IK. The animated foot world rotation is preserved. Walking includes measured root travel of 1.219 m per 81-frame cycle at 60 fps; the review viewport carries that travel across loops and follows it with the camera. This produces a moving walk rather than claiming planted feet in a stationary treadmill preview.

Across all 151 idle and 81 walking frames, idle sole penetration stays below 0.14 mm; walking below 1.34 mm. The lower walking sole is within 1.92 mm of the ground. Maximum consecutive planted-foot horizontal step falls from 21.3 mm before physical contact cleanup to 2.73 mm afterwards. These are finite-tolerance measured improvements, not perfect foot locking. A live 4.2-second check crossed 3 loop boundaries, traveled 3.865m, and showed no backward cycle reset; maximum sampled pelvis step was 33.8 mm.

The untouched native source, rejected target, and repaired target were inspected at the same sampled frame from neutral front, side and three-quarter views. The short side-by-side video records actual browser motion. Rejected source images and GLB remain archived in the task workspace. Current source assets remain read-only; no new downloads or generation were used.

## Verification and limits

Typecheck and ontology 13 focused tests pass. GLB validation reports 0 errors and 16 warnings. Five authored rest/shoulder/elbow/hip/knee fixtures have finite geometry and zero tested belt/boot versus trouser overlap candidates. `docs/omni-motion-review.json` retains the measured verdict. `scripts/motion-browser-check.mjs <catalog URL>` checks continuous world travel across animation loops.

This is editor/runtime review motion; the authored GLB has its rig and geometry, with clips attached at runtime. It does not change the canonical simulation or install this avatar in Claude's game. Terrain adaptation, collisions, turns, acceleration, exact foot IK, and general wardrobe penetration remain outside this bounded flat-stage review. Omni still needs stronger face likeness/stubble, detailed hair, tailored sleeves and richer leather construction.
