# Adult garment fit evidence — 2026-10-10

Bounded asset changes: **Wren and Brann**. Their existing MPFB adult bodies,
outfits, 53-bone game-engine rigs, bone names, UVs, original textures, and
interpolated skin weights remain. Canonical simulation is unaffected.

Wren's `toigo_wool_pants` source garment has no authored body-delete mask.
Underlying hip/thigh skin was therefore exported and could break through cloth
when differently weighted surfaces bend. The builder now derives covered body
vertices from the fitted trouser surface (within 90 mm, excluding the outermost
6 mm of waist and 15 mm of cuff). A matching coverage mask supplements Brann's
trousers too. Both trousers receive a 3 mm outward normal allowance. Fabric PBR
roughness is 0.88 and leather 0.72 instead of the generic 0.5 plastic-like finish.

## Source and rebuild

Source: MakeHuman/MPFB 2 with the community garments already credited in
[`web/public/arena/people/CREDITS.md`](../../../web/public/arena/people/CREDITS.md).
Wren retains mindfront lusekofta, toigo wool pants/gloves, punkduck medieval boots,
and elvs French braid. Brann retains rehmanpolanski Viking tunic/pants/boots,
tattoo skin, and hair bun. No new downloaded assets or license substitutions.

From repository root, with installed Blender 5.2.2 LTS and MPFB 2:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b --python art/tools/arena/build_arena_people.py -- web/public/arena/people wren brann
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b --python art/tools/arena/validate_people_fit.py -- web/public/arena/people .debug/human-motion/garment-fit wren brann
```

For before/after comparisons place original GLBs in the validation output's
`before/` subdirectory. Partial rebuilds now merge `people.json`, preserving the
other characters' receipts. Reviewed final receipts: Wren 1,345 covered body
vertices, 10,935,832-byte GLB; Brann 1,498 covered vertices, 8,551,128-byte GLB.
Both retain their original 53 named bones. Trouser triangle counts are unchanged
(Wren 2,674; Brann 2,544).

## Reimported export checks

The validator reimports the **exported GLBs**, bends hips/knees/torso, and checks
walk, run, twisting punch, and a 90-degree hip/115-degree knee crouch. Each pose
was rendered from matching front/rear oblique cameras, 32 views total. Selected
views are saved here; full working renders are in `.debug/human-motion/garment-fit`.

Skin/trouser triangle contact pairs (BVH overlap) decreased:

| Character | Walk | Run | Twisting punch | Deep crouch |
|---|---:|---:|---:|---:|
| Wren | 4 → 2 | 184 → 2 | 28 → 2 | 746 → 68 |
| Brann | 61 → 0 | 417 → 0 | 22 → 0 | 988 → 53 |

Before/after pose receipts including bone names are in
[`fit-validation.json`](fit-validation.json). Assertions passed for unchanged
bone names, unchanged trouser triangle counts, no contact-count regression in
any inspected pose, and aggregate improvement. No final trouser triangle
collapsed in these poses. Wren's source trousers had five zero-area triangles;
the normal allowance removes those degeneracies. Both Python tools compile.

- [Wren twisting punch before](wren-before-punch.png) / [after](wren-after-punch.png)
- [Brann deep crouch before](brann-before-crouch-front.png) / [after](brann-after-crouch-front.png)

## Limits

Contact pairs are a geometric stress metric, not a direct count of visible
pixels or independent holes. Cuff/waist boundary skin is intentionally retained;
extreme crouches still have 68/53 contact pairs. Matching rendered front/rear
views show continuous trouser coverage and the softer fabric/leather finish.
These deterministic static stress poses do not prove every runtime animation,
transition, or combination; browser motion evidence is maintained separately.
No garment topology or weight repaint was attempted, and other characters were
not regenerated in this slice. This addresses fitted garment coverage and
material finish, rather than claiming a full garment collision simulation.
