# Roadmap and honest gaps

Current priority is the [reference-guided Human milestone](HUMANOID_MILESTONE.md). Do not broaden the 230-term catalog. Improve face/hair, ordinary garments and boots; measure proportions; validate deformation; retarget locomotion. Shared Elf/Orc/Dwarf derivatives follow Human quality. The initial Human studies do not complete this milestone.

## Next milestone: one reference-approved embodiment family

Choose a body/face/hand and game-camera reference set, then build Human / Elf / Orc / Dwarf from competent source geometry under one humanoid rig contract. Fit one Dunmere outfit and one blacksmith outfit, implement actual species features and deterministic morph/hair/material variants, retarget a small UAL locomotion set and compare all four at identical scale and camera. This provides more value than adding hundreds of nominal models.

## Afterwards

- Add reviewed bone mappings, socket contracts, clothing masks and automated deformation fixtures.
- Add two genuinely distinct nonhumanoid families (quadruped and amorphous/dragon) with qualified source artwork.
- Turn comparison contract into side-by-side UI; introduce body/age/culture/class/rank/state/equipment controls only when corresponding visual rules exist.
- Add reusable approved material tiers, LOD generation, animation LOD, asset pooling and performance checks at realistic crowd counts.
- Package the shared resolver and integrate via existing Torn Veil appearance/foundry boundaries behind a feature flag.

## Known bootstrap limitations

- Ten validation identities lack suitable assigned geometry. Human and Vampire share a generic superhero-proportioned source; no vampire material or teeth authoring yet.
- Source outfit files need actual head/body assembly and body masks. Their mere presence is not a dressed-character solution.
- Imp and Puglin are useful real rigged source references; no clips ship in those two free GLBs. UAL's 43 clips play on its own demonstration rig; retargeting is unverified.
- Ultimate Monsters official Drive downloads were quota-blocked. No animated monster pack was successfully acquired.
- Culture, profession, age, body build, scars, hair variation and supernatural effects are resolver requests with explicit unresolved status; seed changes do not yet change source geometry.
- Comparison has a shared-scene contract, not finished UI. Static socket/PBR helpers exist; skinned clothing/retargeting is explicitly unimplemented. Turntable frames are implemented but untested in bootstrap.
- Source GLBs pass Khronos validation with warnings (unused objects, tangent generation, skinned meshes below non-root nodes). Those warnings need review before production use.
- Production LOD, collision-independent bounds, shadow review, material budgets and performance gates are documented, not implemented.
- No asset has APPROVED or PRODUCTION status. Final style awaits user references.
