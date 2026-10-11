# Arena people: credits

Bodies: MakeHuman / MPFB 2 base mesh and `game_engine` rig (CC0; Data Collection AB, Joel Palmius, Jonas Hauquier).
Built with `art/tools/arena/build_arena_people.py` from MakeHuman community asset packs
(http://static.makehumancommunity.org/assets/assetpacks.html).

CC0 assets (no attribution required, credited anyway):

- makehuman_system_assets: skins, eyes, eyebrows, eyelashes, short02, short04, braid01, long01.
- rehmanpolanski: viking tunic, pants, boots, tattoo skin, hair bun.
- culturalibre: hair 02, male boots.
- toigo: wool pants, fisherman sweater, gloves.
- javherre: templar knight helmet.
- donitz: monk robe.
- jartur69: Slavic male skin.
- elvs: French braid hair.

CC-BY assets (attribution required, Creative Commons Attribution 4.0):

- **mindfront**: lusekofta (knit tunic)
- **punkduck**: medieval boots
- **elvs**: ruffle sleeve peasant blouse
- **maciekg**: leather helmet
- **culturalibre**: warrior helmet 02

Animation source: KayKit Character Pack Skeletons by Kay Lousberg (CC0), retargeted at runtime.

Torn Veil modifications to Wren and Brann (2026-10): fitted trouser body-coverage
masks, 3 mm outward trouser allowance, and fabric/leather PBR roughness adjustment.
Original garment textures, UVs, interpolated skin weights, rig names, and asset
attribution are preserved. Build parameters are recorded in `people.json`.
Reimported walk, run, twisting punch, and deep crouch fit checks are reproducible
with `art/tools/arena/validate_people_fit.py`.
