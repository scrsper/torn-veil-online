# Character Foundry against real assets — PIE validation

Machine: Bernhaldt. Branch `codex/character-foundry-real-assets-v0-1`. PR #48 open, not merged.
Everything below was measured on this machine on 18 September 2026; nothing is inferred from a
store listing or from an earlier session's notes.

The question this slice had to answer: **can Torn Veil render distinct, believable humans from
canonical simulated people using the installed free assets?** The short answer is at the bottom.

## 1. What is actually installed

`Content/CitySampleCrowd` is a directory junction onto `D:/TornVeilAssetCache/Installed/CitySampleCrowd`
(1,434 files, 6.2 GB). `du` does not follow junctions, so a naive listing reports it as empty; it is not.

| Family | Content path | Skeleton | Installed reality |
| --- | --- | --- | --- |
| Polytope Lowpoly Modular Armors (free) | `/Game/Polytope_Studio` | its own `SK_Mannequin` copy, 87 bones | 8 complete sets (2 sexes x armour 01_A, armour 05_C, `cloth_00`, `naked_00`), **2 heads total**, 4 hairstyles, 2 beards, 9 static accessories |
| Quantum Modular Character (free sample) | `/Game/QuantumCharacter` | `SK_Military_Character_Skeleton`, 351 bones | 1 complete male character + 9 modules, 1 head, **no hair, no beard, no female**, one modern tactical outfit |
| City Sample Crowds | `/Game/CitySampleCrowd` | `metahuman_base_skel` (body), `SK_Base` (clothing), `Face_Archetype_Skeleton` (face) | 12 MetaHuman faces (6F/6M), 6 bodies (3 builds x 2 sexes), **12 hair grooms**, 7 facial-hair grooms, 120 groom bindings, ~110 modern garment meshes |
| Hannah FREE MetaHuman | — | — | acquired, **not imported**; MetaHuman Creator Core Data still absent |

### Audit corrections this session made

The previous catalogue was not trustworthy and is now fixed:

- **Heads 3 → 15.** The 12 City Sample MetaHuman faces were being rejected for sitting on a
  different facial rig. They are now accepted with explicit `fits` families.
- **Hair 103 → 18 usable.** The 103 included card-LOD static meshes and follicle textures; those
  are now marked `assemblyOnly` and never offered as a hairstyle. Real hairstyles: 14 grooms
  (City Sample) + 4 skeletal (Polytope).
- **Facial hair 38 → 9 usable**, same cause.
- **A zero-byte vendor file** (`Polytope_Studio/.../T_Quinn_01_CCRCCPlastic_MSK.uasset`, a truncated
  Fab download — C: has only 9.3 GB free) made *every* editor commandlet exit 1. It is moved, not
  deleted, to `.debug/character-foundry/quarantine/`. Re-download it through Fab to restore.

Usable (non-`assemblyOnly`) catalogue: body 20, head 15, hair 18, upperGarment 66, lowerGarment 42,
footwear 23, facialHair 9, armor 5, accessory 19.

## 2. Rig compatibility — measured, not assumed

`unreal/scripts/probe_city_compatibility.py` compares parents and reference transforms bone by bone
against the Manny driver. Bone-name overlap proved nothing; the reference pose decided every case.

| Rig | vs its pose parent | Verdict | Adapter built |
| --- | --- | --- | --- |
| Polytope `SK_Mannequin` | 87 shared with driver, **84 differ**, worst 9.7 cm | Leader Pose unsafe despite identical bone names | IK retarget — `ABP_TV_Polytope_Retarget` |
| City `metahuman_base_skel` (body) | 80 shared with driver, 79 differ, worst 6.6 cm | proportion-aware retarget | IK retarget — `ABP_TV_CityBody_Retarget` |
| City `SK_Base` (clothing) | 150 shared with the body, 38 differ, worst **1.3 cm** | close enough to copy | Copy Pose — `ABP_TV_CityCloth_CopyPose` |
| City `Face_Archetype_Skeleton` | 32 shared with the body, 5 differ, worst 5.9 cm | separate facial rig | Copy Pose — `ABP_TV_CityFace_CopyPose` |
| Quantum `SK_Military_Character_Skeleton` | 89 shared with driver, **3 differ**, worst 1.3 cm | the most driver-compatible rig installed | Copy Pose — `ABP_TV_Quantum_CopyPose` |

All five compiled clean and are registered in `CharacterPalette.local.json`; the audit then lists
them in `runtimeSkeletons`, which is what makes their parts eligible at all. **All five were
exercised in PIE and all five reported `retargeted=true` with `unresolvedSlots=0`.**

Unsupported: cross-family assembly. A Polytope garment cannot go on a City Sample body and a
Quantum head cannot go on a Polytope body — different rigs, different reference proportions, and no
matching neck seam. The `fits` mechanism already refuses these rather than producing a broken hybrid.

Correction to the previous session's note: City Sample `*_body` meshes are **complete nude bodies**,
not "arms and hands". Their material binds `Color_UNDERWEAR` and `female_body_normal_map`, and the
arena frames show a full unclothed body under the garments. The earlier claim came from
`get_imported_bounds`, which returns meaningless extents for these meshes.

## 3. Two defects found by looking at PIE, and fixed

**Ten of thirty-three residents were rendering as Epic's grey mannequin.** Nothing had failed:
`SKM_Quinn_Simple` genuinely carries `female`, `adult` and `slim`, so it tied with real modular
bodies on every ranked preference and won the tie-break. The audit now tags the engine templates
`placeholder` and `slotRules` forbids that tag — and because `resolveSlot` drops forbidden tags only
after every relaxation step, a machine with no character packs still gets a body. Result: mannequin
fallbacks **10 → 0**, distinct configurations **22 → 30**, distinct outfits **19 → 29**.

**Every face was a different colour from its own neck and hands.** MetaHuman-derived crowd content
ships no per-character skin texture: heads and bodies both point `Color_MAIN` at a shared
`DefaultTexture_VT` and pick a row out of an atlas with an `AtlasSelector` scalar. The head
instances carry the identity index (0–5 per sex); the shipped body instances sit at 0 because the
vendor's own crowd Blueprint assigns them at spawn. `UTVCharacterPresentation` now reads the index
off the vendor head material and pushes it into the body's dynamic instance
(`MatchBodyComplexionToFace`). Before/after: `stage-b-closeface/` vs `stage-b-skinfix-face/`.

A third finding was a wrong *measurement*, not a defect: `npm run foundry:fallback` reported
`FAIL — 40 unrelated slots changed`. Removing one body and demanding that nothing else move is the
right contract for monolithic bodies and the wrong one for modular ones — a shirt cut for one
`fitFamily` is not a garment that fits another. Measured precisely: of the 23 people who kept their
body, **0 changed anything**; all 40 changes belonged to the 10 who lost theirs. The harness now
separates `fitDependentSlotChanges` from genuine re-rolls and passes.

## 4. What PIE actually showed

Live bridge (`npm run bridge:playable`), editor PIE, morning in the settlement.

| Stage | Result | Evidence |
| --- | --- | --- |
| B — one character | Female resident: City Sample body + `f_004` face + turtleneck + slacks + flats + `Hair_S_LowPonytail` groom. No T-pose, no hidden Manny, no detached head, no floating hair, no exploded hands, feet planted, vendor materials intact. | `stage-b/`, `stage-b-face/`, `stage-b-closeface/`, `stage-b-skinfix-face/` |
| Female acceptance | Passed on quality of face, hair and proportions; failed on wardrobe suitability (see §6). | `stage-b-skinfix-face/`, `quantum-closeup/` (two visibly distinct women) |
| C — ten residents | **10 actors, 10 visible, 10 retargeted, 0 unresolved.** 6 distinct bodies, 28 distinct parts, 6 distinct grooms. Families: City Sample 8, Polytope 1, Quantum 1 — all three in one frame. | `stage-c-group/`, `stage-c-closegroup/` |
| D — Ashford 33 | 33/33 complete, 30 distinct configurations, 10 distinct bodies, 11 distinct heads, 29 distinct outfits, **0 mannequin fallbacks**. | `.debug/character-foundry/foundry-report.json` |
| Combat/motion | 40 inputs dispatched (20 attacks, 20 dodges), 20 attacks played, hit reaction and downed state reached. The visible character is a City Sample woman in skirt and top — not Manny — and her clothing deforms correctly through the whole sequence. | `combat/`, `video/foundry-character-motion-combat.mp4` |
| Persistence | Every body present before and after a bridge save/reload carried an **identical appearance signature**. | `.debug/character-foundry/sig-before.txt`, `sig-after.txt` |
| Fallback | Removing the most-used body: 33/33 still complete, 0 re-rolls, only fit-dependent slots moved, diagnostics named the gap. Mapping restored afterwards (the catalogue is filtered in memory; nothing on disk was touched). | `.debug/character-foundry/fallback-report.json` |

### Visual defects still open

- **The detailed face does not attach in the standalone `-game` arena session.** Combat frames show
  the body's own bald head. Faces attach correctly in editor PIE, so this is specific to the
  standalone path and is not yet isolated. It is the single biggest gap in the combat evidence.
- **Groom hair reads as coarse cards at conversation distance.** Acceptable in the group shots,
  noticeable in `stage-b-closeface/`.
- **The crowd is monochrome.** Canonical garment tints push almost every City Sample outfit to
  near-black, so a settlement reads as a funeral rather than a village.

## 5. Performance

| Configuration | Triangles | Skeletal components | Material slots | LODs | Ticking adapters |
| --- | --- | --- | --- | --- | --- |
| Polytope dressed resident (`cloth_00` + hair) | ~3,900 | 1 (+1 Leader Pose) | 1 | **1** | 1 |
| City Sample dressed resident (body+face+top+bottom+shoes+groom) | **121,648** | 5 + 1 groom | 19 | 4 (body/clothes), 8 (face) | 4 |
| Quantum complete character | **162,882** | 1 | 14 | **1** | 1 |

Likely roles, on these numbers only:

- **Polytope** — distant/crowd. 30x cheaper than anything else and the only single-draw body. But it
  has one head per sex and no LODs, so it is a silhouette, not a person you walk up to.
- **City Sample** — the ordinary nearby resident, and the only family that can carry a face. It is
  expensive (five components, four ticking adapters) but it is the only one that ships LODs, which
  is what makes a crowd of them plausible at all.
- **Quantum** — close/important NPC only, and only if a modern outfit is acceptable. 162k triangles
  with no LOD and 351 bones is not a crowd body.

No LOD architecture was built; these are measurements, not a plan.

## 6. Reference fidelity

Side-by-side: `reference-comparison/hana-vs-result.jpg`, `kaito-vs-result.jpg`,
`shogun-vs-result.jpg`. No reconstruction is claimed, and none is close.

The Ashford references are stylised Japanese fantasy: layered kimono and hakama, obi and cord,
lamellar over kosode, topknots, geta, dragon brocade, jewellery. The Foundry's own manifest already
asks for exactly that vocabulary — and every one of those requests goes unmet on this machine:

> `upperGarment:[kimono]`, `lowerGarment:[hakama]`, `upperGarment:[tunic]`, `robe:[robe]`,
> `footwear:[sandals]`, `hair:[bound]`, `hair:[short]`, `facialHair:[beard]`, and **every** accessory
> (`hat`, `hood`, `belt`, `satchel`, `beads`, `hairpin`, `fan`, `staff`, `sword`, …)

- **hana** (female, layered kimono): matched on sex, apparent age, slim frame and loose-long hair.
  Missed entirely on costume, palette and status — the result wears a black turtleneck and slacks.
- **kaito** (male, lamellar and topknot): the Polytope male is the closest silhouette installed and
  is still a European fantasy tunic on a flat-shaded low-poly body. Face character and topknot absent.
- **shogun** (status, dragon kimono): nothing installed expresses status at all. The settlement crowd
  reads as identical office wear regardless of occupation or wealth.

What the comparison settles: the pipeline is not the limiting factor. **Wardrobe is.** The gap is
not "these assets need tuning", it is "this culture's clothes do not exist in any installed pack".

## 7. Verdict

**GOOD FOUNDATION, MORE CONTENT NEEDED.**

The pipeline is genuinely working and the evidence is in PIE, not in a catalogue: canonical people
become distinct, animated, correctly-proportioned humans with real faces, real hair and matched
skin, deterministically across save/reload, degrading slot by slot when content is removed, on five
different rigs at once through three different pose strategies.

It is not "technically working, visually insufficient" — City Sample residents genuinely look like
people, and ten of them in one frame do not read as a clone wall. It is not "good enough" either,
and the reason is narrow and specific: **there are 12 faces, 2 of them per build, and not one
garment from this culture.** A settlement of 127 will repeat faces, and every resident — baker,
guard, priest — is wearing modern business clothing. Mixing in Polytope to escape that trades one
problem for a worse one: `stage-c-closegroup/` shows a flat-shaded low-poly villager standing beside
photoreal MetaHuman residents, and the two art styles cannot share a frame.

### Smallest next slice

**Get one culturally correct garment set onto the City Sample body rig**, and nothing else. One
kosode, one hakama, one obi, one pair of geta, skinned to `SK_Base`, in two or three colourways.
That single change would let the existing resolver dress the whole Ashford population correctly,
because the manifest is already asking for those tags by name and the fit/adapter machinery already
works. It answers the one question this slice could not: does Torn Veil look like Torn Veil, rather
than does Torn Veil render humans.

Do not import Hannah for this. She adds a thirteenth face to a wardrobe problem, and the MetaHuman
Creator Core Data prerequisite is a large unrelated detour.
