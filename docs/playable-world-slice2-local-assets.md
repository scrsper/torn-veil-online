# Playable World Slice 2: local asset note

Verified from the local Unreal project on 2026-09-16. This is an inventory and provenance boundary, not visual acceptance evidence. Slice 2 visual acceptance is still pending.

## Visual finish palette (2026-09-17)

This supersedes the table below where they differ. The chosen families are coherent in realism level: realistic Megaplant vegetation, AdvancedVillage buildings, props and landscape, Free Medieval furniture and work props, and scanned ground layers. Stylized Quaternius nature, the AdvancedVillage bonsai-like trees and grass patch, Gothic/Medieval house singles, animal packs and sword packs are not used.

| Semantic role(s) | Local source | Treatment |
|---|---|---|
| `Vegetation.Oak.A–D`, `Vegetation.Tree.A/B`, `Vegetation.Pine.A/B` | Megaplant `Tree_English_Oak_Forest_01_A–D` | Derived static Nanite assemblies under `/Game/TornVeil/LocalPalette/Vegetation` (`create_local_vegetation.py`, `TV.BakeNaniteAssembly`); pine roles use young oaks because the local Baltic Pine bark textures are missing |
| `Vegetation.Orchard.A/B` | Megaplant `Tree_Japanese_Medlar_01_A/B` | As above |
| `Vegetation.Shrub.A–C` | Megaplant `Shrub_European_Spindle_01_A–C` | As above |
| `Vegetation.Grass` | Poly Haven `grass_medium_01` (CC0) | Existing import; object path now fully qualified |
| `Ground.Settlement` layers | AdvancedVillage `T_Landscape_Grass/Soil`, Iceland `T_Iceland_Dirt`, `T_ForestGround`, SM_Roads_05 `MT00133-Cobblestone_01`, Iceland `T_Voronoi_Perturbed_4k` | Owned material built by `create_environment_materials.py`; textures referenced, not copied |
| Building roofs, wells, carts, sacks, produce, haystacks, logs, stones, street lights, flowers, pumpkins, pots, tools | AdvancedVillage meshes | Pack material instances copied and reparented to flagged base copies (`create_local_village_materials.py`, `/Game/TornVeil/Materials/LocalPalette/Village`) |
| Furniture, barrels, keg rack, log piles, wall lanterns, buckets, troughs, stone blocks (also chimneys), hay bales, sign boards, planks, poles | Free Medieval Environment Props | Local PBR wrappers (`create_local_prop_materials.py`), routed automatically by mesh name |
| Walls, windows, door frames, plinths, beams, gables | Quaternius Medieval Village MegaKit (CC0) | Existing imports, new two-tier grammar |

Provenance is unchanged: Megaplant, Iceland Environment, SM_Roads_05 and the AdvancedVillage/Free Medieval packs are local library prerequisites with no license statement in the repository. Their derived assets stay local and git-ignored; nothing from them is redistributed. A checkout without them falls back to the documented engine and CC0 defaults per semantic role.

## Earlier runtime palette (2026-09-16)

The existing palette keeps the world coherent and small:

| Semantic role | Current local selection | Class | State |
|---|---|---|---|
| `Architecture.RoofSlope` | `/Game/ThirdParty/Quaternius/Meshes/Roof_Wooden_2x1` | Quaternius modular roof | USE NOW; documented CC0 |
| `Architecture.RoofEnvelope` | `/Game/TornVeil/LocalPalette/SM_StoneTimberRoof` | derived roof presentation asset | USE NOW; local derived asset |
| `Architecture.Wall`, `Architecture.Window`, `Workshop.Wall` | Quaternius plaster/window/wood-grid modules | modular architecture | USE NOW; documented CC0 |
| `Vegetation.Grass` | `/Game/AdvancedVillagePack/Meshes/SM_GrassPatch_Var01` | grass patch | USE NOW; local pack provenance unresolved |
| `Vegetation.Tree.A/B` | `/Game/AdvancedVillagePack/Meshes/SM_Tree_Var01`, `SM_Tree_Var03` | temperate tree meshes | USE NOW; local pack provenance unresolved |
| `Environment.Rock` | `/Game/WaterPlane/Environment/Props/SM_Rock` | rock prop | USE NOW; local pack provenance unresolved |
| `Community.Well` | `/Game/AdvancedVillagePack/Meshes/SM_Well` | well prop | USE NOW; local pack provenance unresolved |
| `Storage.Open/Closed` | `/Game/AdvancedVillagePack/Meshes/SM_Crate_Open`, `SM_Crate_Closed` | containers | USE NOW; local pack provenance unresolved |
| `Fixture.Chair/Table/Bench/Counter/Barrel/Crate/Lantern` | selected meshes under `/Game/Fab/Free_Medieval_Environment_Props_Collection` | whole medieval props | USE NOW only through local palette wrappers; provenance unresolved |

The Fab props have local palette material wrappers under `/Game/TornVeil/Materials/LocalPalette/` (for example `M_TV_Local_WoodenChair`, `M_TV_Local_WoodenTableLong`, `M_TV_Local_Barrle1`, `M_TV_Local_WoodenCrate`, `M_TV_Local_LanternRound`). These wrappers preserve the project’s material boundary while the source pack remains untouched.

## Local pack sizes and classes

Sizes are filesystem totals, including textures where present:

| Local pack | Size / files | Useful classes and examples | Sample maps / dependencies |
|---|---:|---|---|
| `AdvancedVillagePack` | 439.7 MB / 266 | house variants, trees, grass, barrels, crates, well, fences | `AdvancedVillagePack_Overview`, `AdvancedVillagePack_Showcase`; no extra plugin recorded |
| `Fab/Free_Medieval_Environment_Props_Collection` | 617.1 MB / 330 | whole chairs, tables, stools, crates, barrels, lanterns, fences, hay/log piles | no sample map; local PBR wrappers are in TornVeil materials |
| `Fab/Medieval_House` | 0.5 MB / 2 | standalone house assets | no sample map; rejected as a runtime architecture source until provenance/scale are cleared |
| `Fab/Gothic_House` | 0.3 MB / 2 | standalone Gothic house assets | no sample map; rejected for ordinary settlement palette and provenance/scale are unresolved |
| `Megaplant_Library` | 2.02 GB / 226 | branches, leaves, skeletal branch/leaf assets for Baltic Pine, English Oak, European Spindle, Japanese Medlar | no sample map; missing whole-tree/dependency closure for current use |
| `WaterPlane` | 139 MB / 34 | water materials plus `SM_Rock` and rock textures | `LakeWater_Example`, `OceanWater_Example`, `TranslucentWater_Example`; use only as a water/rock source |

`Megaplant_Library` is not a ready whole-tree library in this checkout. Its visible content is branch/leaf assets such as `Branch_Baltic_Pine_*`, `SKM_Branch_*`, and `Tree_*_Sapling`/forest variants, with missing dependencies for a clean bounded runtime tree selection. Do not substitute it for the existing AdvancedVillage tree palette.

## Provenance and packaging boundary

The repository documents Quaternius Medieval Village MegaKit Standard, Quaternius Ultimate Nature, and Poly Haven sources as CC0. The newer Fab imports above have no local seller, license, or redistribution statement. Their presence is evidence of a local prerequisite only; it must not be treated as Fab-standard rights or repository redistribution permission. No Fab web/account lookup was performed.

Animal packs, additional animal species, and extra animation packs are deferred. They are not needed for Slice 2 architecture or furnishing readability.

Keep source packs immutable. Derived palette assets and wrappers remain local until provenance is cleared. Runtime fallback remains the project’s existing engine/basic-shape fallback and semantic role mapping; no vendor path is canonical simulation truth. Visual acceptance for this palette remains pending.
