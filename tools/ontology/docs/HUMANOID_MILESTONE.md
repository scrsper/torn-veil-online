# Reference-guided Human milestone — first implementation

Status: **begun; visual-quality goal not yet achieved**. Bootstrap commit `9b889f6` remains the ancestor. No changes were made to Torn Veil's source, simulation or original reference images.

## Implemented

- Complete visual intake of 18 images, eleven usefulness dimensions, overlapping variants and contradictory evidence; SHA-256 provenance and byte-identical local copies.
- DRAFT art direction and male/female proportion proposals. These are visual authoring baselines, not mechanical biology or automatically approved canonical ratios.
- One reproducible Human family using existing MPFB 2.0.17, authored MakeHuman hm08 topology, macro targets, eyes, brows, lashes, hair, clothing and the same 53-bone game-engine rig. Provider remains replaceable.
- Male and female clothed GLBs in Babylon, deterministic provider selection, source provenance, body-study selector, six camera presets plus inspection, local reference gallery.
- Real elevated exploration camera parameters from the current Torn Veil Babylon client. Matching Blender gameplay preset; front/side/back/three-quarter views remain orthographic technical inspection.
- Elf/Orc/Dwarf derivation requirements explicitly inherit the Human family. No fake completed models or independent species programming classes.

## Run

```powershell
Set-Location (Join-Path $env:USERPROFILE 'Desktop/projects/ontology')
npm run catalog
# Open http://127.0.0.1:5173 ; Human defaults to the new family.
npm run references:verify
node scripts/acquire-makehuman.mjs   # reuse or recover the pinned official source pack
npm run human:build                 # male + female; also refresh provenance
npm run human:build -- male         # one body study
npm run test:humanoid-browser
npm run assets:verify
node scripts/blender.mjs render --input public/assets/entities/tv-human-male-v1.glb --height 1.8 --output generated/validation/humanoid-v1/male --report generated/validation/humanoid-v1/male-roundtrip.json
```

Recipe: `blender/scripts/humanoid_family.py`. Blender and MPFB paths are discovered from existing installations; no duplicate software was installed. Editable generated `.blend` sources are under `assets/generated/`. Source inputs under `assets/imported/makehuman/system` remain unchanged. Human builds use existing source texture normal maps and material assignments following the source garment UV atlas. User art is guidance, never projected onto the model as a texture.

Recovery uses the recorded SHA-256; an upstream pack update fails closed for review. Set `PYTHON_PATH` if the previously audited Python runtime lives elsewhere. The checksum proves correspondence to this acquisition, not an independent signed upstream release.

Catalog entity previews honor the entity's explicit height or species default (Human 1.75 m). Source inspection shows the family studies at native male 1.80 m / female 1.73 m. These two contexts are intentionally distinct. The body selector changes a local appearance preview, never simulation state. Age, personalized face/hair and cultural wardrobe still appear as unresolved requirements.

## Visual assessment and changes made during review

Inspected Blender and Babylon renders, including both faces and gameplay views. Corrected a garment material classification that colored the entire connected suit dark; replaced an inaccurate height-based material boundary with the authored UV layout. Corrected camera target/radius recalculation so view changes and reset reproduce the chosen preset. Changed source hair alpha to a cutout to address transparent-card sorting artifacts. Corrected public-file provenance lookup so Human GLBs in a shared directory cannot inherit an unrelated Quaternius record.

The result is a useful authored-mesh Human study, **not a genuinely good Torn Veil Human yet**. Faces are generic and youthful relative to Omni; brows/lashes and hair need work. The shirt retains a modern collar/cut, trousers and low boots do not match the reference calf-boot silhouette, and a proper belt is missing. Materials lack the reference's textile/leather richness. A-pose is for authoring, not a convincing idle. Source skin textures contain some baked shading. Close-up hair cards still require scrutiny. At 8 m the cream/dark silhouette reads, but that alone does not pass visual quality.

## Remaining work in priority order

1. Measure and refine the authored male/female meshes against the provisional ratios and neutral modeling references. Resolve face/hair shape and skin response; select or commission better source pieces where needed.
2. Replace/refine plain garments with a competent linen shirt/blouse, belt and calf boots. Existing MHCLO fitting demonstrates an assembly path, not proven deformation quality.
3. Validate shoulder/elbow/hip/knee motion and garment intersections on both bodies. **No deformation pass is claimed.**
4. Map Quaternius locomotion to MPFB game_engine with rest-pose compensation, bone-axis conversion, translation scaling and foot-contact checks. Sharing the broad humanoid family label does not mean the skeletons are directly compatible. **No locomotion retarget is claimed.**
5. Once Human quality is sufficient, use authored morph deltas on the shared topology and refit the same wardrobe/rig for Elf, Orc and Dwarf. Orc has design evidence; Elf and Dwarf need reference direction.

No assets were promoted to CANDIDATE, APPROVED or PRODUCTION. No irreversible provider migration was made. Existing Quaternius sources and processed bootstrap model remain available in Sources.
