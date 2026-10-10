# Torn Veil reference intake

Place future user-approved references in these folders:

| Folder | Most useful references |
|---|---|
| `character/` | Full-body front/side/back, faces, hands, age/body variety, Human/Elf/Orc/Dwarf scale lineup |
| `creature/` | Wolfkin, skeletal bodies, dragons, slime, golem, android; silhouette and locomotion notes |
| `armor/` | Armor layers, joint clearance, shoulder/hand scale, rank distinctions |
| `clothing/` | Dunmere and other cultures; workwear, robes, boots, profession accessories |
| `materials/` | Skin, fur, leather, cloth, metal, stone; roughness and palette targets |
| `environment/` | World context and materials that characters must fit |
| `lighting/` | Neutral review and actual gameplay lighting, contrast examples |
| `camera/` | Gameplay screenshots with desired camera distance, angle and character pixel height |

Use names such as `dunmere-farmer-front-v01.png`. Add an adjacent `.md` note with source URL/creator, rights, approval status, what to borrow, what to avoid and associated entity/culture IDs. Reference permission is distinct from permission to redistribute or generate derivative artwork. Reference binaries are ignored by Git by default.

The initial **18-image intake is complete**. See [INVENTORY.md](INVENTORY.md), [manifest.json](manifest.json) and [evidence analysis](../docs/REFERENCE_ANALYSIS.md). The canonical source folder is `%USERPROFILE%/Desktop/projects/character-models`; original files must never be edited. `npm run references:verify` verifies source hashes and creates missing byte-identical local copies. The catalog's **18 art references** button displays copies through a development-only route; builds do not bundle the image binaries.

Art direction is DRAFT. Reference selection does not automatically approve generated meshes. Images containing several useful dimensions are stored once and classified in the manifest instead of creating redundant copies in every folder.
