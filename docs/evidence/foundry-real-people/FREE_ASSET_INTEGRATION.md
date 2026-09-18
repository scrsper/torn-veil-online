# Free character asset integration — paused checkpoint

Machine: Bernhaldt. Branch: `codex/character-foundry-real-assets-v0-1`. PR #48 remains open; no merge.

The user requested a pause and push on 18 September 2026. This is an unfinished integration
checkpoint, not a claim that the new population or female-character quality bar has passed.

## Acquisition ledger (18 September 2026)

| Exact item | Publisher / listing | Free verified | Library | Installed content | Initial assessment |
| --- | --- | --- | --- | --- | --- |
| Lowpoly Modular Armors - Free - MEDIEVAL FANTASY SERIES | [Polytope Studio](https://www.fab.com/listings/d32023d6-cc7c-4a6b-bbc6-b0821c3d3391) | Live Fab browser and editor listing | Yes | `/Game/Polytope_Studio` (5.7 package in UE 5.8) | Male/female modular medieval kit; visibly stylized, one actual head per sex. Not accepted as final art direction. |
| Quantum Modular Character Free Sample | [Quantum Assets](https://www.fab.com/listings/8e200050-3158-4762-b297-f785b5b1533d) | Live Fab browser and editor listing | Yes | `/Game/QuantumCharacter` | Detailed male face; modern tactical outfit; no female sample. Marketing for the paid system does not describe the free sample's inventory. |
| City Sample Crowds | [Epic Games](https://www.fab.com/listings/903037e9-e1ac-4f41-96e8-1683c6fa7ad4) | Live Fab listing | Yes | `/Game/CitySampleCrowd` (5.3 package in UE 5.8) | Candidate for male/female faces, body builds, hair and modular clothing. Modern clothing limits setting suitability. Registry sees 135 skeletal meshes and 21 grooms, not yet certified usable. |
| Editable Metahuman - Hannah FREE! | [GreyGameStudio](https://www.fab.com/listings/60c6be06-f649-4f38-965d-6b1fadbf7d56) | Exact free listing, browser and editor | Yes | Import pending | Stronger female face candidate. First import explicitly required MetaHuman Creator. Core Data is absent; Epic Launcher login is awaiting the user. |

No paid items, subscriptions or trials acquired. The user approved the Fab EULA for selected free downloads. Authentication was not entered by the agent.

## Local storage and evidence

All paths below are relative to `C:/Users/green/Desktop/projects/torn-veil-online` unless absolute.

- Fab cache for subsequent downloads: `D:/TornVeilAssetCache/Fab`.
- City Sample files: `D:/TornVeilAssetCache/Installed/CitySampleCrowd`; a directory junction preserves the project's Content path. Existing content was moved intact, not deleted.
- Unreal Zen derived-data cache: `D:/TornVeilAssetCache/ZenData`, with its original `C:/Users/green/AppData/Local/UnrealEngine/Common/Zen/Data` path preserved by a junction. The cache was relocated after storage errors; no Fab asset was deleted.
- New licensed Content is excluded locally through `.git/info/exclude`; licensed binaries and generated vendor-derived assets are not staged.
- Initial and successive inventories: `.debug/character-foundry/catalogue-before-fab-2026-09-18.json`, `catalogue-after-polytope-raw.json`, `catalogue-after-quantum-raw.json`.
- Detailed first two family probes: `.debug/character-foundry/installed-families.json`.
- Completed City Sample audit: `.debug/character-foundry/catalogue-after-city-raw.json` (334 entries, 252 City Sample entries, generated `2026-09-18T16:15:29Z`). This audit predates the new facial-rig classifier and fit metadata. It rejected 12 valid MetaHuman heads; its 99 hair rows include card LOD meshes, not 99 hairstyles. Re-run the updated audit before using it as the final catalogue.
- Preview evidence: `.debug/character-foundry/fab-review-2026-09-18/` (`polytope-listing.png`, `quantum-installed-head.jpg`, `hannah-free-listing.png`, `medieval-shirt-listing.png`). These are listing/editor inspection, not PIE acceptance evidence.
- Build log: `.debug/character-foundry/build-free-assets.log`.
- Subsequent build logs: `.debug/character-foundry/build-part-pose.log`, `.debug/character-foundry/build-modular-faces.log`.
- Targeted verification: `.debug/character-foundry/foundry-tests.log`, `.debug/character-foundry/typecheck.log`.

## Findings and unresolved work

Polytope's 87-bone rig shares names with Manny but differs in 84 shared reference transforms. It needs proportion-aware retargeting; the UE5 marketing label is not a Leader Pose certificate. Full sets have roughly 2,648–8,108 triangles, one material and one LOD. The unclothed sets are not a dressed resident.

Quantum has 10 skeletal meshes on a 351-bone rig. Its single head has 22,310 triangles and five material slots; the complete character has 162,882 triangles, 14 slots and one LOD. Most extra bones are facial. Copy Pose is a candidate, still awaiting runtime validation. No morph targets were found. Its free sample has no standalone hair or beard geometry.

The first City Sample audit exhausted Windows commit memory while preparing textures: Unreal attempted a 1 GiB allocation and reported an insufficient paging file. This is a failed audit, not evidence of corrupt content or successful compatibility. Retry will limit texture compilation concurrency and release meshes between inventory records.

The retry completed with serialized texture preparation and per-mesh garbage collection. Disk
pressure then required the cache relocation. Unreal is closed at this checkpoint.

Implementation preserves vendor shaders, attaches the visible mesh to the hidden animation driver,
and enables ticking for pose-adapter ABPs. The editor-only `TV.BuildPoseAdapter` helper successfully
authored and compiled `/Game/TornVeil/Characters/Retarget/ABP_TV_Polytope`. That graph is saved locally.
It has not passed PIE motion testing. The retarget script now automates graph creation; that latest
script revision has passed Python syntax checks but has not been executed end-to-end.

The catalogue now supports explicit body-fit families, included geometry, and required geometry.
City Sample's six `*_body` meshes contain arms/hands, not standalone complete humans; the tops,
bottoms, shoes and face must all resolve. Facial rigs need a separate Copy Pose adapter. Source
support for bound groom cards, matching face/body skin materials, and a machine-local runtime
palette is included, but runtime validation remains outstanding. Hair cards at the inspected LOD2
use skinning; simulation is disabled in the new presentation path. Renderer prerequisites were
added to configuration and await the next editor startup.

## Verification at the pause

- Unreal C++ builds passed for the visible-driver/material changes and separate skeletal-part adapters.
- Current Foundry suite: **41/41 passed**.
- Current TypeScript typecheck: **passed**.
- Audit classification unit checks: **5/5 passed**.
- Changed Python scripts: **syntax checks passed**.
- The final modular-face/groom C++ build completed successfully after the pause request
  (`build-modular-faces.log`, 151.47 seconds). Existing float-conversion warnings remain.
- The final facial audit changes, generated adapters for City/Quantum, grooming assembly,
  required-part behavior in PIE, renderer startup and native regression tests remain unverified.

## Resume order

1. Finish Epic Launcher authentication personally, then install MetaHuman Creator Core Data for
   Hannah through the normal Epic workflow. No credentials are to be entered by the agent.
2. Start the editor with serialized texture/skinned-asset preparation while warming this machine's
   cache. Re-run the updated audit, including facial rigs and groom bindings.
3. Probe City body/face reference poses, build the City body IK adapter and face Copy Pose adapter,
   and verify Quantum Copy Pose. Write `CharacterPalette.local.json` using the palette builder.
4. Audit again so runtime eligibility reflects the compiled adapters. Inspect one canonical
   female resident closely before expanding to the ten-person and Ashford samples.
5. Finish motion, persistence/fallback, reference comparison, performance and visual evidence;
   then classify content quality honestly. No merger or purchase is authorized.

**No final quality classification yet.** One canonical resident, the ten-person sample, Ashford33, motion acceptance, reference comparisons and performance observations are outstanding. Attractive female characters are a core acceptance requirement. Hana and Kaito references have been inspected; no reconstruction claim is made.
