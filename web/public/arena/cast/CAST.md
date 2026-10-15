# Provisional cast bodies (model review 2026-10-15)

One body per role, registered in `src/web/presentation/library.ts` (`CAST_BODIES`) and drawn by
`ArenaAssets.loadHumans` with its own retarget bake. These are **provisional picks**, chosen from the candidates
rendered in the model review (stills, retargeted idle/walk/attack videos, contact sheet). They replace the earlier
`arena/people/` and `arena/people_flat/` MPFB casts.

| File | Look | Role | Source | Licence | Tris | Textures | sha256 |
|---|---|---|---|---|---|---|---|
| `tv-human-male-v2.glb` | `player_m` | player (male) | `tools/ontology/public/assets/entities/tv-human-male-v2.glb`, byte-identical | CC0-1.0 (MakeHuman Community / Data Collection AB) | 40,862 | 2048² | `869ebb80…` |
| `tv-human-female-v1.glb` | `player_f` | player (female) | `tools/ontology/public/assets/entities/tv-human-female-v1.glb`, byte-identical | CC0-1.0 (MakeHuman) | 44,418 | 2048² | `c69e97f5…` |
| `tv-human-male-v1.glb` | `npc_m` | resident (male) | `tools/ontology/public/assets/entities/tv-human-male-v1.glb`, byte-identical | CC0-1.0 (MakeHuman) | 42,244 | 2048² | `fc594f5a…` |
| `quaternius-peasant.glb` | `npc_f` | resident (female) | Quaternius *Modular Character Outfits – Fantasy* `Female_Peasant` (`tools/ontology/public/assets/library/quaternius-peasant/model.gltf`) | CC0-1.0 (Quaternius) | 13,568 | 2048² (from 4096²) | `da272bcb…` |
| `quaternius-ranger.glb` | `warden` | Tower wardens, human foes, Chrysanthus | Quaternius *Modular Character Outfits – Fantasy* `Male_Ranger` (`…/quaternius-ranger/model.gltf`) | CC0-1.0 (Quaternius) | 26,982 | 2048² (from 4096²) | `8848c2da…` |
| `quaternius-imp.glb` | `imp` | enemies: orc, skeleton family | Quaternius *Bestiary – Dungeon Monsters Kit* Imp (`…/quaternius-imp/model.glb`) | CC0-1.0 (Quaternius) | 15,232 | 2048² | `a877d7d1…` |
| `quaternius-puglin.glb` | `puglin` | enemies: goblin, goblin archer | Quaternius *Bestiary – Dungeon Monsters Kit* Puglin (`…/quaternius-puglin/model.glb`) | CC0-1.0 (Quaternius) | 7,528 | 2048² | `83216d0d…` |

Quaternius licence evidence: `tools/ontology/docs/ASSET_LICENSES.md` and `tools/ontology/assets/provenance/`.

The Quaternius files are packed into single GLBs with `art/tools/cast/pack_gltf.py` (geometry, skin, node
names and materials unchanged; images above 2048 px downscaled with Lanczos):

```
python3 -I art/tools/cast/pack_gltf.py tools/ontology/public/assets/library/quaternius-peasant/model.gltf web/public/arena/cast/quaternius-peasant.glb
python3 -I art/tools/cast/pack_gltf.py tools/ontology/public/assets/library/quaternius-ranger/model.gltf  web/public/arena/cast/quaternius-ranger.glb
python3 -I art/tools/cast/pack_gltf.py tools/ontology/public/assets/library/quaternius-imp/model.glb      web/public/arena/cast/quaternius-imp.glb
python3 -I art/tools/cast/pack_gltf.py tools/ontology/public/assets/library/quaternius-puglin/model.glb   web/public/arena/cast/quaternius-puglin.glb
```

Rig notes: all seven use UE-mannequin bone names. Quaternius rigs name the head `Head` (aliased to `head` in
`ArenaAssets.person`); the imp and puglin have four fingers (no `pinky_*`), so the fist grip uses the ring finger.
Children still use the legacy kit (`models/kit_c.glb`): no candidate covers them.
