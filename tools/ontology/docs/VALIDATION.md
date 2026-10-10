# Bootstrap validation

Executed locally on 2026-10-04. Evidence is local under `generated/validation/bootstrap/`, with Blender views under `generated/previews/human_001-4648fa49/`. Generated binaries/screenshots are intentionally ignored by Git.

## Technical checks

- TypeScript type-check and Vite production build passed. Vite reports a large catalog bundle; code splitting/performance budgeting remain future work.
- Seven focused Vitest cases passed: raw vocabulary coverage, schema validation, compositional identity/culture, determinism and purity, missing-state handling, registry/provenance/quality gates, unset art direction.
- Khronos glTF validator reported **zero errors** on all eight catalog assets, including the Blender-exported GLB. Source warnings remain: generated tangent space, unused objects, and skinned mesh nodes under non-root transforms. These are recorded in `generated/validation/gltf-reports.json`, not suppressed.
- Thirty-six staged public files have CC0 provenance and SHA-256 verification. Imported source inventories retain pack ancestry and license metadata.
- Blender background probe verified 5.2.2 LTS, Python 3.13.13, MPFB 2.0.17 enabled, and generation of a 19,158-vertex MPFB base human. No generated MPFB mesh was published.
- Blender processed the real Quaternius male glTF: three visible meshes, 8,483 vertices, 14,318 triangles, a 65-bone skeleton, no missing textures or degenerate polygons. Exported height is 1.75 meters and Babylon reload agrees within 0.01 m. It is still a prototype.
- Blender rendered front, side, back, three-quarter and game-camera images. The front and side were visually inspected after correcting hidden-helper bounds; the body is now grounded and retains source anatomy/materials.

## Browser acceptance

The actual catalog was launched on loopback. Automated Chromium acceptance exercised Human, female base, Imp, Puglin, UAL mannequin and the processed human. It verified catalog startup, search, ontology selection, missing Dragon state, visible CC0 provenance, orbit, zoom, reset, wireframe, skeleton and animation selection. A walking clip's frame advancement is checked, not just the dropdown value. The UAL demonstration exposes 43 clips.

The automated run uses WebGL fallback. The visible in-app browser additionally rendered the Human, Imp and processed Human in **WebGPU**, with textures and scale visually inspected. No new browser warnings/errors appeared after the final shader-registration fix. Evidence: `08-webgpu.png`, `09-webgpu-imp.png`, `10-webgpu-roundtrip.png`. Screenshots and review findings distinguish actual rendering from successful asset loading.

## Visual review findings and fixes

1. Original catalog camera faced character backs. Reset camera was corrected to the source-facing side.
2. Blender included its glTF importer bone-display Icosphere in bounds, causing an undersized floating export. The helper collection is now excluded, and the exported GLB matches 1.75 m in Babylon.
3. Several source image URIs had `_png.png` suffixes with only `.png` textures present. Staging repairs them using originals from the same pack.
4. WebGPU initially rejected more than eight vertex buffers from unused UV channels. Runtime staging removes only UV sets unused by the material.
5. Missing WebGPU shader registration caused fallback requests for `postprocess.vertex.fx` and `rgbdDecode.fragment.fx` to receive Vite HTML, making the lighting decode fail. The catalog's color/default/PBR, RGBD decode and HDR filtering WGSL shaders are now explicitly registered before rendering. Vite rejects missing `.fx` requests with a clear diagnostic instead of serving HTML. A fresh startup and model switching then rendered correctly.

## Remaining visual limitations

Human anatomy is the source's muscular superhero style; it does not establish Torn Veil's body proportions. Skin is fairly smooth and the body is in underwear/rest pose. There is no approved face/hand style, age treatment or culture-specific wardrobe. Vampire shares the human mesh and has no authored vampire treatment. Imp/Puglin are source-library examples, not approved Torn Veil species. Missing identities are explicit empty stages, not primitive stand-ins. No visual quality status was promoted automatically.

Full crowd performance, LODs, shadow behavior, rig retargeting, clothing deformation, turntable output and Torn Veil integration are not acceptance claims for this milestone.
