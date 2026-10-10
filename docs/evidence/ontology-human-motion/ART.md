# Human character art rebuild record

The browser kits are generated from the project-authored geometry in
`art/tools/web_characters`. The current build uses the shared humanoid skeleton,
analytic head and eye meshes, procedural hair, fitted garments, and canonical
material slots. The old imported VRoid face is no longer part of the kit build;
the source remains in the repository only as historical CC0 reference material.

## Rebuild

From the repository root, with Blender 5.2.2 installed at the standard Windows
location:

```powershell
$blender = 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe'
$out = 'web\public\models'
foreach ($sex in 'f', 'm', 'c') {
  & $blender --background --python art/tools/web_characters/build_kit.py -- $sex "$out\kit_$sex.glb"
}
```

Final regenerated artifacts:

| Kit | Bytes | SHA-256 |
| --- | ---: | --- |
| `kit_f.glb` | 15,965,372 | `d93340953d87ab3b3aae47bd353d628b3f8d8354de107d690d5800a04776c4ab` |
| `kit_m.glb` | 9,010,772 | `49a3bf008f1ac1121a017e7c47e9c0ed75736d4d02f2287be2ddfdffac06d718` |
| `kit_c.glb` | 9,020,580 | `d5dca4d9a8f9d31897a3763d76cf5963ba9dec194ba2185cbec907cb862b4fdd` |

The same values are recorded in `web/public/models/runtime-receipt.json`.

## Change record

- Replaced the baked imported face in `build_kit.py` with the project analytic
  head and canonical `EyeL`/`EyeR` meshes, preventing baked eye whites from
  occluding runtime iris materials.
- Assigned `TV_SkinHead` to the analytic head so `CharacterMaterials` paints the
  procedural complexion, brows, lips, and age detail.
- Added child torso clearance in `garments_web.py` to prevent exposed hip wedges.
- Capped sleeve shoulder starts to close small garment holes during poses.

## Visual evidence

Fresh headed Chrome showroom captures were made against `http://127.0.0.1:5181`
with `window.__tv.ready` awaited and no page errors. The final merged child
lineup capture is preserved as
`final-merged-child.png`; it shows readable facial features and irises, seated
hair, continuous child clothing, and adult lineup context.

The visual review covers showroom presentation and representative idle/pose
captures. It does not prove every garment token, camera angle, animation pose,
or lighting environment is free of seams. Tiny shoulder seam shadows may remain
at the sleeve-to-torso join, while the reviewed captures show no exposed body
through those joins.
