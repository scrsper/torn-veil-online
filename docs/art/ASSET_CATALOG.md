# Torn Veil art catalog

Vendor content is immutable. This phase references source meshes directly and creates
graphs/maps only under /Game/TornVeil/.

All Quaternius names below use the exact prefix /Game/ThirdParty/Quaternius/Meshes/.
Sizes are measured unscaled local bounds in centimetres, rounded here; the generator
remeasures full precision and corrects pivot offsets when fitting modules.

| Mesh | Size (cm) | Use |
|---|---|---|
| Floor_Brick / Floor_WoodDark | 200 × 200 × 2 | Floor and boarded ceiling |
| Wall_Plaster_Straight | 200 × 40.65 × 312.48 | Full wall bays |
| Wall_Plaster_Door_Flat | 200 × 40.65 × 312.27 | One entrance bay |
| Wall_Plaster_Window_Wide_Flat | 200 × 40.65 × 312.27 | Window bays |
| Roof_Wooden_2x1 | 225.79 × 156.03 × 124.84 | Pitched panels with timber/gable detail |
| Roof_Support2 | 19.97 × 76.51 × 74.29 | Four supports |

/Game/AdvancedVillagePack/Meshes/SM_Barrel supplies one or two pantry barrels.
No prefab house supplies construction. Round-tile pieces, separate doors/frames,
fences, paths, wells and Fab props remain future options; v0.1 has open entrances
and windows with a wooden roof.

Construction tags: TV.PCG.Dwelling, TV.Dwelling.Seed.N, TV.PresentationOnly.
Collision and navigation contribution are disabled.
See [the dwelling benchmark](PCG_DWELLING_6X8.md).
