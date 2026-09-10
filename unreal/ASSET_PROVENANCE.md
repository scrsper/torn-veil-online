# Playable world prototype assets

Verified 2026-09-10. Source assets are kept in `.debug/playable-assets`; imported content is under `Content/ThirdParty`. Shared wrapper materials and projection rules are under `Content/TornVeil` and `Source/TornVeilOnline`. No source geometry has been edited. All imported texture objects cap runtime texture size at 1024.

| Source | License | Included subset | Use |
|---|---|---|---|
| [Quaternius Medieval Village MegaKit Standard](https://quaternius.com/packs/medievalvillagemegakit.html) / [official download](https://quaternius.itch.io/medieval-village-megakit) | CC0 1.0; confirmed in the archive's License_Standard.txt | 14 wall, window, door, frame, floor, roof, support, stair and railing modules; plaster, wood, brick and tile diffuse/normal textures | Runtime canonical building assemblies and fences. Prototype culture profile; Ashford keeps its separate identity. |
| [Poly Haven brown_mud_leaves_01](https://polyhaven.com/a/brown_mud_leaves_01) | [CC0](https://polyhaven.com/license) | 1K diffuse, DirectX normal, roughness | Continuous terrain material |
| [Poly Haven rock_boulder_dry](https://polyhaven.com/a/rock_boulder_dry) | [CC0](https://polyhaven.com/license) | 1K diffuse, DirectX normal, roughness | Resource rock and decorative stone material |
| [Poly Haven grass_medium_01](https://polyhaven.com/a/grass_medium_01) | [CC0](https://polyhaven.com/license) | FBX grass cluster; 1K diffuse, alpha, DirectX normal | Actual PCG grass instances with a shared masked material |
| [Quaternius Ultimate Nature](https://quaternius.com/packs/ultimatenature.html), [creator's archive mirror](https://opengameart.org/content/low-poly-nature-pack-1) | CC0 | CommonTree_1, BirchTree_1, PineTree_1, Rock_1, Bush_1 | Small environment subset; canonical trees/rocks and decorative PCG bushes |
| Installed Epic UE 5.8 mannequin template | Unreal Engine license; user installation required | Existing skeleton, locomotion, attacks, hit/death; derived local activity loops | Character manifestations; excluded from Git |

`fetch_playable_assets.ps1` downloads the free Standard archive, selected Poly Haven maps/grass and the five-mesh nature subset. `import_playable_assets.py` imports 14 FBX modules, creates shared wrapper materials and records measured mesh bounds in `PlayableAssets.json`. `create_activity_animations.py` derives ten small activity loops from the locally installed template. No executable third-party asset scripts are run. `ASSET_HASHES.json` records the downloaded source subset.

The PCG graph generates only collision-free, noninteractive dressing from canonical substrate samples. Its graph output has the `TV.Decorative.NoGameplay` tag. Harvestable resources come from GameSim and have stable node-to-instance references. Changing either art library requires presentation adapters, not simulation changes.

Run `import_playable_grass.py` and `import_playable_nature.py` for the environment meshes, then `configure_runtime_materials.py` to save instancing shader flags on the shared wrappers. Soil/stone roughness maps are retained source assets; the prototype materials currently use a shared roughness constant. Birch/pine modules are retained replacement variants; the current canonical tree renderer uses CommonTree_1. No high-resolution fir-tree model was imported: its source geometry alone was roughly 478 MB and unsuitable for this prototype subset.
