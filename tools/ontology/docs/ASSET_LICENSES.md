# Asset licenses and acquisition

## Reference-guided Human additions

New Human studies derive from MakeHuman core graphical data and the official system assets under CC0. Core geometry, morphs and rig weights are separate from the GPL MPFB program. Official evidence: [core asset license](https://static.makehumancommunity.org/makehuman/faq/are_makehuman_files_free.html) and [system pack](https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html). Headers retain Data Collection AB, Joel Palmius and Jonas Hauquier attribution. Derived GLBs retain source IDs and hashes.

The 18 user images have unknown creator and redistribution rights, marked USER_PROVIDED_REFERENCE_ONLY. They are ignored local references, served by a development-only gallery route, excluded from production builds, and never used as game textures. Their hashes and original filenames remain in `references/manifest.json`.

No paid assets were purchased. The reviewed consolidation publishes the licensed CC0 derivatives and provenance listed in this directory. `public/` contains the licensed editor runtime assets. Downloaded archives, extracted source artwork and generated previews are ignored by Git. Provenance JSON is tracked.

## Acquired Quaternius assets

| Official pack | Edition / local contents |
|---|---|
| [Universal Base Characters](https://quaternius.itch.io/universal-base-characters) | Free **Standard**, archive `Universal Base Characters[Standard].zip` (128,968,391 bytes); male/female superhero bodies and hairstyles |
| [Modular Character Outfits – Fantasy](https://quaternius.itch.io/modular-character-outfits-fantasy) | Free **Standard**, archive `Modular Character Outfits - Fantasy[Standard].zip` (294,347,394 bytes); peasant/ranger male/female outfits and separated pieces |
| [Universal Animation Library](https://quaternius.itch.io/universal-animation-library) | Free **Standard**, archive `Universal Animation Library[Standard].zip` (15,904,933 bytes); in-place and root-motion GLBs plus FBX. In-place demo has **43 clips** |
| [Bestiary – Dungeon Monsters Kit](https://quaternius.itch.io/bestiary-dungeon-monsters-kit) | Free **Standard**, archive `Bestiary - Dungeon Monsters Kit[Standard].zip` (47,299,856 bytes); Imp and Puglin, rigged but these GLBs contain **no animation clips** |

Creator: Quaternius. Asset license: **CC0-1.0**, as stated on official pack pages. Do not confuse pack marketing totals with the smaller free Standard edition. Paid Source/Pro editions were not downloaded. Archives passed CRC tests; SHA-256 values pin the acquired bytes because upstream archive checksums were not published. The 264 extracted files have individual hashes and parent-pack provenance.

[Ultimate Monsters](https://quaternius.com/packs/ultimatemonsters.html) is also CC0 and contains animated monsters. The creator-linked Google Drive returned download-quota pages for its files. The downloader rejected these HTML responses, acquired no usable files and did not attempt a quota bypass. Retry `node scripts/download-monsters.mjs` after upstream access recovers. Current Bestiary is the available monster starter source, not a claim that the animated collection was obtained.

## Curated Poly Haven set

Seven assets, **22 files**, at 1K resolution; HDRIs plus available diffuse, OpenGL normal, roughness, AO and metallic maps:

| Purpose | Official asset |
|---|---|
| Neutral HDRI | [Studio Small 09](https://polyhaven.com/a/studio_small_09) |
| Outdoor HDRI | [Forest Slope](https://polyhaven.com/a/forest_slope) |
| Stone | [Rock Boulder Dry](https://polyhaven.com/a/rock_boulder_dry) |
| Wood | [Wood Planks Dirt](https://polyhaven.com/a/wood_planks_dirt) |
| Metal | [Metal Plate](https://polyhaven.com/a/metal_plate) |
| Ground | [Brown Mud 03](https://polyhaven.com/a/brown_mud_03) |
| Fabric | [Fabric Pattern 07](https://polyhaven.com/a/fabric_pattern_07) |

Assets are [CC0](https://polyhaven.com/license); per-asset creators are recorded from upstream metadata. `npm run assets:polyhaven` downloads only this curated list. Optional arguments name explicit additional asset IDs. The downloader sends an application-specific User-Agent, checks upstream MD5 values, and records SHA-256. [Poly Haven's live API](https://polyhaven.com/our-api) also requires visible attribution; the catalog and this document provide it. Only the neutral HDRI is currently used by the catalog; other maps are acquired for future material authoring.

## MPFB

The existing Blender extension is **MPFB 2.0.17**, licensed **GPL-3.0-or-later** according to its installed manifest. It remains an external offline tool, not bundled in the browser or this repository. Official [MPFB downloads](https://static.makehumancommunity.org/mpfb/downloads.html) recommend Blender's extension platform. The existing installation was successfully enabled and used in a background probe; no duplicate install was needed. Generated geometry and third-party MakeHuman asset packs require their own asset-specific license records. The probe-generated human was not exported or redistributed. No third-party MPFB clothing packs were acquired.

## Registry contract

`assets/provenance/registry.json` covers archives, extracted source files, Poly Haven files and registered Blender derivatives. Each record includes ID, name, creator, source, source URL, license and license URL, UTC acquisition date, original filename, local path, modification status, redistribution restrictions, notes and SHA-256. Parent IDs preserve derivation chains. `public-files.json` covers every staged public file and rejects non-CC0 content without a new explicit policy. `assets/registry.json` connects renderable assets to these records.

Original source metadata lives in `quaternius-packs.json`, `imported-files.json`, `polyhaven.json`, and `monsters.json`. Empty monster metadata reflects the failed acquisition, not a successful library. Source HTML evidence remains local/ignored; official URLs are durable citations. Future restricted artwork belongs under local ignored storage and must never be staged publicly by the default CC0 workflow.
