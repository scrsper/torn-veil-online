# Art pipeline

Reference-guided branch: `npm run human:build` assembles authored MPFB/MakeHuman art, fits source clothing and weights, removes masked helpers while retaining the armature, exports GLBs and refreshes provenance. See [Human milestone](HUMANOID_MILESTONE.md) for commands and visual limitations. Babylon and Blender share `ontology/game-camera.json`. The Human family proposals introduce no canonical mechanics.

Start with competent, licensed source artwork. This project does not sculpt organic bodies from procedural primitives. Preserve original downloads, make derived copies, record provenance, then inspect real rendered results.

## Commands

```
npm run blender:probe
npm run entity:build -- human_001
npm run entity:validate -- human_001
npm run entity:render -- human_001
npm run assets:verify
npm run catalog
```

Build writes a resolver manifest, a Blender technical report and a normalized GLB under `public/assets/entities`. It registers the processed asset under Sources, with parent provenance. Render writes front, side, back, three-quarter and game-camera PNGs under `generated/previews/<entity>-<fingerprint>`. Validate imports the source and checks mesh counts, finite geometry, dimensions, degenerate polygons, skeleton bone/root counts, material inventory and missing external textures. It does not establish anatomical quality or retarget compatibility.

The lower-level wrapper supports arbitrary registered/trusted inputs:

```
node scripts/blender.mjs build --input path/to/source.glb --height 1.75 --output assets/normalized/body.glb --report generated/validation/body.json
node scripts/blender.mjs turntable --input path/to/source.glb --height 1.75 --output generated/turntables/body
```

The turntable operation produces 24 PNG frames, not an encoded movie. That path is implemented but was not included in bootstrap acceptance. `components.py` supplies explicit PBR assignment, safe static transform application, static bone attachment and basic rig inspection. Skinned-clothing retargeting raises a clear unimplemented error rather than silently misbinding geometry. UV/material references and source shaders need inspection after every conversion.

## Reproducibility and coordinates

Use Blender auto-discovery or `BLENDER_PATH`. The wrapper runs background, factory startup, a project script and nonzero exit on Python errors. Imported glTF is converted from Y-up to Blender Z-up by Blender's importer. Scale and pivot normalization use a hierarchy parent, preserving skin and animation transforms. Export returns to glTF Y-up. Blender's hidden `glTF_not_exported` armature-display helper collection must be excluded from bounds. This was caught by comparing rendered floating feet and Babylon dimensions, then fixed.

The base-character pack contains several `*_png.png` references with only `*.png` files. Staging repairs those specific filename mismatches using same-pack textures. Original files remain untouched. Babylon strips only UV channels not used by the loaded material to fit WebGPU's eight-buffer baseline. It retains all source files for authoring and reports source warnings separately.

## Rig strategy

Target humanoid standard/small/large, quadruped, winged quadruped, dragon, serpentine, insectoid and construct families. A family label expresses intended compatibility, not proof. Before retargeting, establish bone semantic mapping, rest-pose correction, axis/scale conventions, root-motion policy and sockets. Test idle/walk/run/turn, contact, attack, hit and death on each body proportion. Validate feet, hands, poles, twists and equipment. Bake reusable clips offline and keep canonical simulation in control of locomotion; extract or suppress visual root motion as appropriate. The acquired UAL Standard demonstration contains 43 clips; retargeting those clips onto the base characters is still a next step.

## Rendered review loop

Resolve → assemble → render five views → inspect images → compare authoritative references → list defects → adjust components/resolver → rerender. Retain review notes alongside previews. Inspect feet contact, orientation, silhouette, face, fingers, texture seams, clipping and actual gameplay camera readability. A successful process exit proves only script execution.

## Production gate (future)

An entity requires correct scale, ground pivot and orientation; good silhouette/anatomy; deformation-ready topology; complete PBR textures; valid skinning and animation compatibility; correct equipment sockets and occlusion masks; correct shadow behavior; tested LODs, animation LOD and performance budgets; valid GLB; successful Babylon WebGPU and WebGL loads; no missing textures; reference-approved Torn Veil style; and readable, attractive presentation at game distance. Record human reviewer, reference profile version and evidence. None of the bootstrap assets meets this gate yet.
