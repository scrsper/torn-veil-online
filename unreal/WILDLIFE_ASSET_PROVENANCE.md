# Wildlife presentation asset provenance

## Quaternius Ultimate Animated Animal Pack — Deer

- Source page: <https://quaternius.com/packs/ultimateanimatedanimals.html>
- Download folder: <https://drive.google.com/drive/folders/1uJ3N5HfB7jKTseJUNQr3N4YaN0UuEtHk>
- License: CC0 1.0 Universal, confirmed by the downloaded `License.txt`.
- Local source: `.debug/ultimate-animated-animals/Deer.fbx` (ignored; never committed).
- Source SHA-256: `B79F07AC3FD702AB98F5D1B606168618A318F10F57028AAAEFD420C468BE2618`.
- License SHA-256: `83D8959F9FC56353ED571FBE2DC52E4BCD64508E2399501CD45AC2CE3DF0BF8C`.
- Intended project path after editor import: `/Game/TornVeil/Wildlife/Deer/`.
- Import script: `unreal/scripts/import_quaternius_deer.py`.
- Species fit: stylized deer approximation for canonical `roe_deer`; not a zoological claim.
- Verified glTF companion contains one skin, 48 nodes, and 13 clips: walk, gallop, eating,
  idle variants, hit reactions, death, attacks, and jump. There is no dedicated drink/rest clip.
- Presentation mapping uses canonical activity only. Drink/rest/sleep use the explicit
  `Idle_Headlow` fallback. No vendor AI, controller, navigation or gameplay authority is imported.
- Public repository policy: raw vendor binaries remain ignored/local unless project licensing
  policy explicitly approves committed derivatives. The provenance manifest is generated only
  after an editor import and records the actual imported object paths.
