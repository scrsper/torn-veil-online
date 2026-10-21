# Starting town — asset manifest

Branch `claude/starting-town-oct20`. Every runtime file the town page loads, with source, licence and sha256.
GLBs and textures are **not committed** by this branch: `scripts/town/stage-assets.mjs` copies them into the build output
(`dist-town/`) after checking each hash; the browser loader (`src/web/planet/library.ts`) re-hashes every GLB before use
and falls back to a procedural stand-in if bytes differ. Everything else in the town is procedural geometry written in code
(`src/web/town/props.ts`, `kit.ts`, `actors.ts`, the reused pagoda in `src/web/planet/pagoda.ts`).

Checks done 2026-10-20 (session 1): `sha256sum -c SHA256SUMS` in /workspace/torn-veil-assets-git — all 12 models, metadata,
README, START_HERE, ZIP OK. Keyword scan of INTEGRATION_MANIFEST.json, metadata/*.json, START_HERE.txt, README.md and the
GLB binaries for NCSoft / Aion / source-game / native buffer recovery / Bip001: no hits. All 12 have catalog verdict `use`
(`src/sim/world/assets/libraryCatalog.json`). No asset is a character, rig or skeleton. The Codex character studio and the
Veil-Creator zips were not opened (run rule); environment architecture/flora GLBs cannot share bytes with character files,
and the loader supports a deny-hash list (`TV_DENY_SHA256` in sync-library) if one is supplied. Nothing from /workspace/tv-licensed.

## torn-veil-assets GLBs (Omnius)

| File | Source | Licence | sha256 | Used for |
|---|---|---|---|---|
| models/tv_08_01_village_lane.glb | torn-veil-assets (Omnius), Crooked Hamlet 01 | Project-owned (private scrsper/torn-veil-assets; Omnius-made, no third-party licence recorded) | `a8d9abe66babb1029c0642bc220cb739b7ca041ab457b1cbeaf0211c18a72774` | Hamlet lane the main street runs through |
| models/tv_37_01_market_square.glb | torn-veil-assets (Omnius), Covered Market Square 01 | Project-owned (private scrsper/torn-veil-assets; Omnius-made, no third-party licence recorded) | `8b70181157c80917065aac8f6521c72acb62f1ec5a06e00ac930cc9549108fc5` | Covered market west of the plaza |
| models/tv_31_06_tavern.glb | torn-veil-assets (Omnius), Brass Lantern Tavern 06 | Project-owned (private scrsper/torn-veil-assets; Omnius-made, no third-party licence recorded) | `74440fa66a3c9d48f6af9007bd5d6d2421323e991f8e63ed8f10cc892344e096` | Brass Lantern tavern on the plaza |
| models/tv_04_01_gatehouse.glb | torn-veil-assets (Omnius), March Gatehouse 01 | Project-owned (private scrsper/torn-veil-assets; Omnius-made, no third-party licence recorded) | `bc8fce7ea0852a250fb589ebdf8f8af1b4b6725d322a3304187dcc850be4dac0` | South gatehouse (town entrance) |
| models/tv_10_01_watchpost.glb | torn-veil-assets (Omnius), Warden Watchpost 01 | Project-owned (private scrsper/torn-veil-assets; Omnius-made, no third-party licence recorded) | `742bd4d0fad2473baf3350979f9e3110da4a65c42095dea0f81a501bd7f00bc6` | Watchpost outside the east gate |
| models/tv_44_01_dungeon_junction.glb | torn-veil-assets (Omnius), Dungeon Junction 01 | Project-owned (private scrsper/torn-veil-assets; Omnius-made, no third-party licence recorded) | `c9bef0d9df23ded2f0ab0a09827a1045cf5dcc6a429f0c6beeb9ea31aef10941` | Ruined junction in the north-west meadow |
| models/tv_41_01_gate_segment.glb | torn-veil-assets (Omnius), Gate Passage 01 | Project-owned (private scrsper/torn-veil-assets; Omnius-made, no third-party licence recorded) | `74aee9e80c8502272241a4f86251614ce48fd66d729e9521fd3ee53e90c8e7e0` | North gate framing the Tower |
| models/tv_42_01_courtyard_passage.glb | torn-veil-assets (Omnius), Arcaded Passage 01 | Project-owned (private scrsper/torn-veil-assets; Omnius-made, no third-party licence recorded) | `dfcba68eeaea38738bb147db4feb5dbeaa89dbe6f72588bf40b9bd6b4662b4f6` | Arcaded passage, north-west quarter |
| models/tvn_biome_021.glb | torn-veil-assets (Omnius), Elderwood Boulder Group | Project-owned (private scrsper/torn-veil-assets; Omnius-made, no third-party licence recorded) | `464c0581504891f3382c29b5a0d771ec3eb3cacb3d69fe24803eefb23f949214` | Boulders in the meadow |
| models/tvn_flora_001.glb | torn-veil-assets (Omnius), Veil oak · single-stem juvenile | Project-owned (private scrsper/torn-veil-assets; Omnius-made, no third-party licence recorded) | `ef22ac438b5b6cb31a12b43b317e30f2d3400e992790339fcf2ef4693cc86ec3` | Oak saplings in the meadow |
| models/tvn_flora_005.glb | torn-veil-assets (Omnius), Silver willow · single-stem juvenile | Project-owned (private scrsper/torn-veil-assets; Omnius-made, no third-party licence recorded) | `2f37e2e80df6de195a46c59e0ade320fb1b6e54c58313d9f4d92138f0b77b1ab` | Willow saplings in the meadow |

## CC0 textures (vetted by the world run; entries re-confirmed and hashes re-checked 2026-10-20)

| File | Source | Licence | sha256 | Used for |
|---|---|---|---|---|
| web/public/textures/world/weathered_planks-albedo.jpg | Poly Haven [weathered_planks](https://polyhaven.com/a/weathered_planks) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `01c9a372cfd7a7bf471b59c2458ed3ccecc93448aebf7ba0cc5b3b5b6ed24349` | timber frames, stalls, crates, barrels, pagoda timber (albedo) |
| web/public/textures/world/weathered_planks-normal.jpg | Poly Haven [weathered_planks](https://polyhaven.com/a/weathered_planks) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `381d298f3194ec4961b04b4912b9b6efea4b2ff7b914dac57e24c8b6b0be6a25` | timber frames, stalls, crates, barrels, pagoda timber (normal) |
| web/public/textures/world/weathered_planks-arm.jpg | Poly Haven [weathered_planks](https://polyhaven.com/a/weathered_planks) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `f0d81d945dbb267ed8b411af4db55141ae52b87313403667dd06aead9532fbef` | timber frames, stalls, crates, barrels, pagoda timber (arm) |
| web/public/textures/world/plastered_wall-albedo.jpg | Poly Haven [plastered_wall](https://polyhaven.com/a/plastered_wall) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `73312ebb6eabc8e0a55addd8a82a8924bcd1e717b9488a887cc77f14b6ea554e` | house walls, pagoda walls (albedo) |
| web/public/textures/world/plastered_wall-normal.jpg | Poly Haven [plastered_wall](https://polyhaven.com/a/plastered_wall) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `504e1f7baf4b68714c64b6670e7954bebe99efe31c49f7ce5a2089e4b76023b5` | house walls, pagoda walls (normal) |
| web/public/textures/world/plastered_wall-arm.jpg | Poly Haven [plastered_wall](https://polyhaven.com/a/plastered_wall) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `cd927f46fa85b7e5c1a9747b90258c505529d7347d5f4dd356ae0ed2bda34d4f` | house walls, pagoda walls (arm) |
| web/public/textures/world/rock_wall_08-albedo.jpg | Poly Haven [rock_wall_08](https://polyhaven.com/a/rock_wall_08) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `9cd907e8d8ce9317bc51a840a9e87b547fdf768aa61f5288aaee0f6fbcaac2ac` | town wall, towers, plinths, fountain, rocks (albedo) |
| web/public/textures/world/rock_wall_08-normal.jpg | Poly Haven [rock_wall_08](https://polyhaven.com/a/rock_wall_08) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `862f7ed95069bc629d63d0dc18c6c2ad7a96c7c9534b7629e9e90e3896793168` | town wall, towers, plinths, fountain, rocks (normal) |
| web/public/textures/world/rock_wall_08-arm.jpg | Poly Haven [rock_wall_08](https://polyhaven.com/a/rock_wall_08) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `c53192d14045adae2f29eea048b58f30c74cfd935b268ab352b79f8c0c3bd403` | town wall, towers, plinths, fountain, rocks (arm) |
| web/public/textures/world/cobblestone_floor_08-albedo.jpg | Poly Haven [cobblestone_floor_08](https://polyhaven.com/a/cobblestone_floor_08) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `ec131f7a99a1e7f9df25d4725609c55a6dad1df487630685e9a66ecbf41ec33a` | cobbled streets and plaza (splat), pagoda podium (albedo) |
| web/public/textures/world/cobblestone_floor_08-normal.jpg | Poly Haven [cobblestone_floor_08](https://polyhaven.com/a/cobblestone_floor_08) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `26bfff70b266a4e86983814c7e56a9b48daf93cd34dcdc16a5db13e4fabcfbb6` | cobbled streets and plaza (splat), pagoda podium (normal) |
| web/public/textures/world/cobblestone_floor_08-arm.jpg | Poly Haven [cobblestone_floor_08](https://polyhaven.com/a/cobblestone_floor_08) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `4b2548135784852f07befc3bb0abb7c83738a3c022997c30527a15d5caa7a389` | cobbled streets and plaza (splat), pagoda podium (arm) |
| web/public/textures/world/reed_roof_04-albedo.jpg | Poly Haven [reed_roof_04](https://polyhaven.com/a/reed_roof_04) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `3f779402c569424200b5898114dd9daa85505bce296044254d595b9e4afe7584` | thatch roofs, hay (albedo) |
| web/public/textures/world/reed_roof_04-normal.jpg | Poly Haven [reed_roof_04](https://polyhaven.com/a/reed_roof_04) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `4b775ad177610bdcc0d8f081da4bd56ef3ae778c12cf1090376b6d67c5fddf4d` | thatch roofs, hay (normal) |
| web/public/textures/world/reed_roof_04-arm.jpg | Poly Haven [reed_roof_04](https://polyhaven.com/a/reed_roof_04) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `84010888f8440e10033bbfc12c9ec54751847cf52884b073c80bce8137f88b18` | thatch roofs, hay (arm) |
| web/public/textures/world/roof_slates_02-albedo.jpg | Poly Haven [roof_slates_02](https://polyhaven.com/a/roof_slates_02) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `de3d2729ab385c5f7dd7106d3b435c737f6d2c3ea8883cea37de53cec2a34867` | house and tower roofs, pagoda roofs (albedo) |
| web/public/textures/world/roof_slates_02-normal.jpg | Poly Haven [roof_slates_02](https://polyhaven.com/a/roof_slates_02) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `32be0c0ba1565856156a315dc98a773d72f1a03415930657b8a8ad62bf60c1bf` | house and tower roofs, pagoda roofs (normal) |
| web/public/textures/world/roof_slates_02-arm.jpg | Poly Haven [roof_slates_02](https://polyhaven.com/a/roof_slates_02) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `a43d670bb04a70d32502e8b976b0cb97dd975ccab04b8a612ac6543f2b89ad2a` | house and tower roofs, pagoda roofs (arm) |
| web/public/textures/world/brown_mud-albedo.jpg | Poly Haven [brown_mud](https://polyhaven.com/a/brown_mud) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `df3f135c899f10a3b018738343b222cbc67d13e7c76c5d8da834a3d34c984417` | worn earth (splat), ground macro variation, fountain/well water ripple normal (albedo) |
| web/public/textures/world/brown_mud-normal.jpg | Poly Haven [brown_mud](https://polyhaven.com/a/brown_mud) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `ac517ca39eb507ae0f27e2b3db431c60888f9b5c3c52bec49d2c0775da0920cb` | worn earth (splat), ground macro variation, fountain/well water ripple normal (normal) |
| web/public/textures/world/brown_mud-arm.jpg | Poly Haven [brown_mud](https://polyhaven.com/a/brown_mud) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `40a5ac438f23ea454ff45f3f62f0fe4ac5b89c42fd070d10e7d41c51252caf88` | worn earth (splat), ground macro variation, fountain/well water ripple normal (arm) |
| web/public/textures/world/grass_ground-albedo.jpg | Poly Haven [grass_ground](https://polyhaven.com/a/grass_ground) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `a79cc5ed65af0f80261b39a383b64a8c5272c5144d724deb43dbc29f0e4cd19b` | meadow ground (splat), leaf masses (albedo) |
| web/public/textures/world/grass_ground-normal.jpg | Poly Haven [grass_ground](https://polyhaven.com/a/grass_ground) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `7000e2ccd479bb7b66dcdf4faef7b47554324566886314ca620cbf03e274e826` | meadow ground (splat), leaf masses (normal) |
| web/public/textures/world/grass_ground-arm.jpg | Poly Haven [grass_ground](https://polyhaven.com/a/grass_ground) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `b8c13e5972827dda6465fc98bbb8b3a0e67215bf8e864c729072fc9c1cc502ef` | meadow ground (splat), leaf masses (arm) |
| web/public/textures/world/bark_brown_02-albedo.jpg | Poly Haven [bark_brown_02](https://polyhaven.com/a/bark_brown_02) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `920fa0bed0c9d78c1d530e99795113afd532d7db746de440f4a85d7c83ed0f1a` | tree trunks, woodpiles (albedo) |
| web/public/textures/world/bark_brown_02-normal.jpg | Poly Haven [bark_brown_02](https://polyhaven.com/a/bark_brown_02) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `0d5e691e8ad8bcd093a3587887fda2a6b4a948b5708a4f256f7919584c6eb857` | tree trunks, woodpiles (normal) |
| web/public/textures/world/bark_brown_02-arm.jpg | Poly Haven [bark_brown_02](https://polyhaven.com/a/bark_brown_02) | CC0 ([polyhaven.com/license](https://polyhaven.com/license)) | `6bd86d37b3b9b40cc30a4b661e382ec41fa7463a8b1144ff44708b19fa675af1` | tree trunks, woodpiles (arm) |
| web/public/textures/environment/kloppenheim_06_puresky_1k.hdr | Poly Haven kloppenheim_06_puresky (recorded in art/reference/web-rebirth/generated-texture-provenance.json) | CC0 | `206c67e3a1b992282821cf06662bdd69bbb4915c1c4444a66338a40d6a7d4e34` | image-based ambient/reflections (engine default) |

## Skipped

| Asset | Reason |
|---|---|
| tv_05_01_ravine_bridge (torn-veil-assets) | Usable, but needs a carved gorge; no river in this town's layout. |
| web/public/focused/* (focused runtime pack: timber house, city street, tavern 01, general store, forests, modules) | Not from the torn-veil-assets repo (copied from tornveil-world-library-v2); the run allows only torn-veil-assets GLBs. |
| web/public/textures/world/foliage-branch.png, foliage-pine.png | Not listed in the CC0 material manifest; provenance unconfirmed. Foliage is procedural instead. |
| web/public/textures/world/forest_ground_04, mossy_rock (CC0) | Vetted, but not needed. |
| web/public/arena/*, items/*, models/* | Characters/weapons/other packs; characters are placeholders by rule; not needed. |
| Character work (/workspace/torn-veil-build/blender-characters), Codex Aion character studio, Veil-Creator zips, /workspace/tv-licensed | Off limits by rule; not touched. |
