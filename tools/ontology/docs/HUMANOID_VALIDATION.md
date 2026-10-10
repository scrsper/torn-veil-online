# Human reference milestone validation

2026-10-04; outputs under `generated/validation/humanoid-v1/`. These are technical checks plus an explicit visual assessment, not art approval.

| Check | Result |
|---|---|
| Reference originals and copies | All 18 SHA-256 hashes match; originals unchanged |
| Reference visual review | All 18 individually viewed, including full sheets |
| Focused tests | 11 passing across ontology and Human-family tests |
| TypeScript and Vite | Build passes; existing large Babylon chunk warning remains |
| GLB validation | Both new Human GLBs: 0 errors, 9 non-fatal warnings each |
| Blender import / render | Both exported Human GLBs reimport and render five views |
| Model topology | Male 42,244 triangles, female 44,418; 53-bone rig each; zero degenerate polygons and no missing textures in roundtrip reports |
| Babylon browser | WebGL fallback tested; both Human variants load, source provenance appears, presets/orbit/zoom/reset/debug work |
| Reference gallery | 18 metadata entries, local image serving and first image load verified |
| Fixed comparison | Male/female cameras equal for gameplay; captures use same entity height, lighting and floor |
| Visual approval | **FAIL / NOT READY**: generic faces, interim hair, modern garment cut, missing reference belt/calf boots, no convincing idle |
| Motion and wardrobe | **NOT VERIFIED**: no shared locomotion retarget or deformation pass claimed |
| Elf / Orc / Dwarf | Shared-family requirements recorded; no newly completed meshes |

Each Human GLB has two generated-tangent-space warnings and seven skinned-mesh parent-hierarchy warnings from the retained normalization hierarchy. These are recorded in `generated/validation/gltf-reports.json`; they are not a declaration of animation correctness. Explicit tangent export and animated hierarchy validation remain pipeline work. WebGPU was proven in the bootstrap; this Human follow-up browser run explicitly used WebGL and does not claim a new WebGPU acceptance pass.

The image review corrected shirt/pants material segmentation, transparent hair sorting and camera target reset. Reviewed close faces, full-body and actual gameplay-distance views. Original bootstrap evidence remains in its separate directory.
