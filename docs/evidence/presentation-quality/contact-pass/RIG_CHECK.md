# Radial contact rig check

This is a headless geometry check, recorded on 2026-10-20 after local checkpoint `53c1f73`. It is not browser planting, shadow, gait-quality or performance acceptance. The accompanying [rig-check.json](rig-check.json) records the exact locally staged model hashes and measurements.

The check loads the existing credited Ranger (`hero.glb`) and Wren (`wren.glb`) skins and the verified CC0 UAL source. Each rig uses its own retarget bake of `Idle_Loop` and `Walk_Loop`, the existing canonical metre normalization and the 180-degree source-facing adapter. A parent rotates local up to normalized `(0, .3216, .9469)`. The test floor is an absolute plane through the actor's feet; the render origin is `(12000, 1000, -4000)`.

The new radial solver selects at most thirteen vertices per foot from the actual imported geometry. Eligible vertices have at least 95% skin weight on that foot or its toe descendants and lie below the bind ankle. Twelve downward support directions plus the lowest vertex select a bounded support hull. Both current approved rigs select boot vertices. Their positions after IK use Babylon's current linear-blend skin matrices and the mesh world transform. This is distinct from the earlier ankle/bind-reference estimate. A separate unit test compares these sampled positions against Babylon's whole-mesh CPU skinning result after an animated foot rotation.

| Rig / clip | Sole vertices per foot | Eligible settled samples | Largest absolute minimum-sole gap |
| --- | ---: | ---: | ---: |
| Ranger / idle | 13 | 228 | 0.0192 mm |
| Ranger / walk | 13 | 135 | 0.7192 mm |
| Wren / idle | 12 | 228 | 0.0266 mm |
| Wren / walk | 12 | 147 | 0.6967 mm |

Each clip runs 120 frames at 60 Hz; a sample is eligible only when correction weight exceeds .98 and the foot is not releasing. The measured value is the minimum signed plane distance across the selected sole vertices for that foot. Higher toe vertices are not required to touch the floor. Walk swing phases release their anchors. Negative gaps denote penetration. The first uncorrected idle samples penetrated approximately 12–18 mm; the solver adjusts the leg joints instead of translating the root.

The measured audit loop averaged roughly .34–.45 ms per frame in NullEngine. This includes pose application and the analytic plane sampler, and excludes a rendered scene and live town support-triangle queries. It is not a browser frame-budget result.

## Implementation and bounds

`FootPlant` retains the existing planar path. `RadialFootPlant` is selected only when `SharedCharacterEnvironment.radialContacts` is provided. The callback supplies a stable reference, current render origin, up direction and nearby floor sampler. Inputs and returned support points use absolute universe metres. Anchors retain those coordinates across floating-origin changes; IK subtracts the current origin before passing a target to Babylon.

Corrections require a supported small cross footprint and the entire measured toe/heel hull to agree with the same local support plane. Missing data, steep walls, stair edges and distant floors are refused. Acquisition/release contributions are bounded to two stature-scaled metres per second; correction is limited to a 22 cm stature-scaled vertical envelope and releases after excessive stance displacement or heading change. The solver never modifies canonical body state, actor/root positions, textures, source geometry, skin weights or animation provenance. Near full leg extension projects the requested ankle position into reach rather than stretching bones.

Airborne presentation, its eased landing overlay, missing frames, reference changes and teleports clear anchors. `motion.radialContacts` reports absolute selected skin points, mesh/vertex identifiers, signed gaps, support source/normal, anchor identity, weights, releasing status and reset reasons. Browser checks must inspect gaps and motion independently; an enabled lock is not itself proof of contact.

## Preserved development failures

- The first prototype retained the planar solver's `.985 * legLength` reach reserve. A supported downhill foot on a 15% incline repeatedly released because this artificial reserve prevented a reachable correction. The rotated/scaled fixture caught it. The radial path now allows `.999 * legLength`, while the two-bone solver still avoids exact extension; the fixture passes. This does not alter the planar solver.
- Import scale is not person stature. The measured Ranger source height is 1.8263 m and its normalization scale is .95823; Wren is 1.5324 m and normalizes with 1.14200. Both target a 1.75 m reference here. Contact bounds now use canonical stature and presentation-parent scale, rather than those different source-unit conversions (U-061).
- A centre cross alone missed a ledge under a long boot's toe or heel. The final solver also checks its measured sole hull; an explicit regression rejects an edge beyond the cross but inside the boot extent (U-062).

## Verification and remaining limits

Executed successfully, with the real-import test running rather than skipping:

```text
npx vitest run tests/radial-footplant.test.ts tests/radial-footplant-import.test.ts tests/arena-footplant.test.ts tests/arena-locomotion.test.ts
30 tests passed across 4 files
npx tsc --noEmit
passed
```

The real-import regression skips explicitly when the existing local art has not been staged; it does not download or fabricate substitutes. Synthetic Babylon skin fixtures also cover rotated/inverted frames, body sizes, per-foot slopes, origin shifts, stance anchors, swing/flight/support loss, reference changes, teleports and unsupported boot edges. Existing planar tests pass unchanged.

U-048 remains open pending the ordinary browser route. These selected vertices are a bounded support hull, not exhaustive collision of every deformed boot triangle. Strong toe curls, unusual shoes, nonuniform/skewed transforms, per-frame appearance changes, unsupported moving platforms and floors outside the nearby patch remain limits. No pelvis or root displacement is added to make unreachable surfaces appear supported. Live town paving, slope transitions, stop/turn slip, flight-to-ground acquisition and rendered contact shadows require their separate captured evidence.
