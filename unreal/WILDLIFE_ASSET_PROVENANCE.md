# Wildlife presentation asset provenance

## Quaternius Ultimate Animated Animal Pack — Deer

- Source page: <https://quaternius.com/packs/ultimateanimatedanimals.html>
- Download folder: <https://drive.google.com/drive/folders/1uJ3N5HfB7jKTseJUNQr3N4YaN0UuEtHk>
- License: CC0 1.0 Universal, confirmed by the downloaded `License.txt`.
- Local source: `.debug/ultimate-animated-animals/Deer.fbx` (ignored; never committed).
- Source SHA-256: `B79F07AC3FD702AB98F5D1B606168618A318F10F57028AAAEFD420C468BE2618`.
- License SHA-256: `83D8959F9FC56353ED571FBE2DC52E4BCD64508E2399501CD45AC2CE3DF0BF8C`.
- Imported project path: `/Game/TornVeil/Wildlife/Deer/`; Unreal derivatives are committed through Git LFS.
- Import script: `unreal/scripts/import_quaternius_deer.py`.
- Species fit: stylized deer approximation for canonical `roe_deer`; not a zoological claim.
- Verified glTF companion contains one skin, 48 nodes, and 13 clips: walk, gallop, eating,
  idle variants, hit reactions, death, attacks, and jump. There is no dedicated drink/rest clip.
- Presentation mapping uses canonical activity only. Drink/rest/sleep use the explicit
  `Idle_Headlow` fallback. No vendor AI, controller, navigation or gameplay authority is imported.
- Raw downloaded source remains ignored/local. CC0 permits redistribution of the imported
  mesh, skeleton, materials and clips; `DeerProvenance.json` records the actual imported paths.
  Epic mannequin/GASP locomotion content is a separate, ignored local dependency and is not
  included by this CC0 provenance statement. No commercial-game content is imported.
