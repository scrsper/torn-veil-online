# Character spec — kimono hero direction (Oct 15)

Status: **direction chosen by Jacob; no conforming model exists yet.** This document is the target
that every future character version is reviewed against. Items marked **UNVERIFIED** were not
readable or not checked when this was written; items marked **TBD (Jacob)** need a decision.

Chosen direction: the stylised kimono hero from the ice concept sheet (silver hair, animal ears and
tail, ivory fur, white/blue snowflake kimono, gold/crystal ornaments), dressed in Ashford's
Japanese-style clothing language.

Rejected, do not use as a base or a reference: the `tv-human-*` creator bodies
(`tv-human-male-v2`, `tv-human-female-v1`) and the Oct 15 swap picks on local branch
`art/character-swap-oct15`.

Sources read for this spec: `docs/web/STYLE.md`, `art/reference/web-rebirth/`,
`art/reference/cultures/ashford/`, `art/source/reference-characters/`, `docs/CHARACTER_FOUNDRY.md`,
`src/foundry/`, `tools/ontology/`, `src/web/arena/retarget.ts`, `src/web/actors/animator.ts`.
Also checked (outside the repo, box-local): `/workspace/torn-veil-build/model-review/LINEAGE.md` and
`model-review/hero-v006/info.json` / `hero-refine-v001/info.json` with their front, three-quarter and
back renders and idle/walk/attack MP4s. Review render facts: hero-v006 72,308 tris, 53 bones, 1.507 m,
49 meshes, no textures; hero-refine-v001 158,336 tris, 55 bones, 1.505 m, 55 meshes, no textures. Both
retargeted Mixamo idle, walking and great-sword slash from `mixamo_clips.glb` (22 bones mapped).

## 1. Concept-sheet reference images

All paths verified with `ls` on this branch.

| Image | Use |
|---|---|
| [02-ice-character.png](../../art/reference/web-rebirth/02-ice-character.png) | **Primary.** Hero turnaround (front, back, two profiles), face close-ups, ornament/fabric/bow details, action poses. 1122×1402 per `reference-manifest.json`. |
| [01-world-and-creatures.png](../../art/reference/web-rebirth/01-world-and-creatures.png) | Mood and palette only; the "Esse" class figure (silver hair, pale robes) is the nearest in-world echo. |
| [reference-manifest.json](../../art/reference/web-rebirth/reference-manifest.json) | Sizes and SHA-256 of the two sheets. |
| [material-manifest.json](../../art/reference/web-rebirth/material-manifest.json) | CC0 Poly Haven world materials only (planks, plaster, rock, roofs, ground). **No character material is listed.** |
| [ivory-indigo-silk.png](../../web/public/textures/couture/ivory-indigo-silk.png), [ivory-sparse-embroidery.png](../../web/public/textures/couture/ivory-sparse-embroidery.png) | Existing generated couture textures (provenance in `generated-texture-provenance.json`); candidate kimono ground fabrics. |
| [Ashford ART_BIBLE.md](../../art/reference/cultures/ashford/ART_BIBLE.md) | Culture clothing grammar and palette (§4). |
| [shiro / ren / ayami / ascetic sheet](../../art/reference/cultures/ashford/characters/-ren-ayami-shiro.png) | NPC 8 "the kitsune, snow moon" is the culture-side twin of the hero. |
| [hana](../../art/reference/cultures/ashford/characters/hana.png), [yuki](../../art/reference/cultures/ashford/characters/yuki.png), [kaito](../../art/reference/cultures/ashford/characters/kaito.png), [shogun](../../art/reference/cultures/ashford/characters/shogun.png) | Role/status costume families dressed onto the two bases. |

Not references for this direction: `art/source/reference-characters/*/reference-and-draft.png`
(the blonde red/black coat sheet `mc-female-1` that hero-v006 was built against).

## 2. Proportions

- Stylised fantasy realism (`docs/web/STYLE.md`): readable silhouette, no photoreal claim.
- Female base: tall, slender, long legs; read off the sheet at roughly 7.5–8 heads.
  Male base: same family, broader shoulders, ~7.75 heads (the ontology family's
  `headsTallTarget` 7.5 / 7.75 are reusable *numbers*, not reusable meshes).
- **TBD (Jacob):** metre heights. Existing data disagrees: MPFB hero-v006 measured
  `height_m` 1.488; the ontology family targets 1.73 m (F) / 1.80 m (M). The game's metre contract is
  `docs/CHARACTER_METRES_OCT12.md` — the new bases must follow it.
- Hands and feet slightly elongated and elegant; neck long; no exaggerated chibi head.
- The kimono silhouette must survive gameplay distance: wide hanging sleeves, a bell of skirt
  layers, a fur mantle that widens the shoulder line, and tail volume behind the hips.

## 3. Face and hair

- Face: soft anime-adjacent realism — large almond eyes (pale grey-blue on the sheet), small nose,
  small mouth, narrow chin, calm expression. Not the generic MPFB face hero-refine-v001 produced
  (its `refinement-report.json` lists "face likeness fitting" as remaining).
- Hair: silver-white, very long and straight with face-framing side locks and a full fringe;
  ornate hair cluster (flowers, crystals, gold filigree, hanging drops) above one ear.
  Hair is authored as **card/shell masses**, not curve strands (the curve-lock approach was
  rejected in `art/tools/reference_characters/README.md`).
- Male: same hair colour and fringe language; length TBD (Jacob) — tied back / long loose.
- Blink and mouth shapes are required (`STYLE.md`: speech drives them).

## 4. Ears and tail

- Fox-style ears: tall, pointed, white fur with darker inner fur; they replace (or hide) human
  ears. The sheet shows **multiple** large fluffy tails; **TBD (Jacob):** one tail or several
  (cost: each tail is a bone chain plus fur shells).
- Fur is ivory, matching the mantle.
- **Canon conflict, TBD (Jacob):** `src/sim/world/characterArchetypes.ts` (shiro) deliberately
  does **not** take ears and tails because "Torn Veil has no canonical non-human humanoid", and
  `STYLE.md` scopes ears/tail to the showroom hero. Shipping ears/tail on every base needs either a
  canonical species/trait in the simulation or a rule that they are cosmetic per-character
  attachments. This spec assumes **separate removable attachments** so both answers work.

## 5. Clothing language

Hero outfit (from the ice sheet): off-shoulder layered kimono, ivory ground with indigo/blue
snowflake and blossom print; deep indigo obi with a large back bow, gold-and-crystal brooch and
tassels; white fur mantle around shoulders and upper arms; very long sleeves; thigh-high front slit;
strappy sandals with ankle ties; crystal pendant drops.

Culture grammar (Ashford `ART_BIBLE.md`): layered kimono/robes, sashes, styled hair or topknots,
paper/metal ornaments, simple work garments for ordinary people, compact occupation cues (hammer,
basket, spear, bow, fan, beads, blade). **Status is read from cloth quality, layering, and restrained
gold/crest accents.** Palette: ivory, indigo work cloth, burgundy crest cloth, rare antique gold.

Rules:
- Every garment is fitted to one of the two bases (§9), never to a one-off body.
- Garments are layered pieces matching the Foundry slots: `upperGarment`, `lowerGarment` (hakama),
  `robe`, `armor`, `footwear`, `accessory` (obi, haori, fur stole, hairpin, jewellery).
- Long sleeves, robe skirts and the obi bow are **bone-driven** (§7), not baked into the body.
- Avoid western coats, leather boots and buckles as defaults (hero-v006's look).

## 6. Shading and material style

- Stylised PBR under the web client's ACES pipeline (`STYLE.md`): painterly, saturated accents kept
  restrained; no toon outline unless Jacob asks (**TBD**).
- Skin: soft, slightly desaturated, subsurface-ish wrap; pale for the hero.
- Hair: anisotropic-looking highlight via texture/normal; alpha-tested cards with a dither or
  hashed edge (no sorted transparency in crowds).
- Fur: layered shells or cards with an alpha-tested tip map; same treatment for ears, tail, mantle.
- Cloth: tileable print (snowflake/blossom) on a separate detail UV, tinted by the canonical
  palette so one mesh serves many people (Foundry rule: palette is a material tint, never an
  asset choice).
- Metal/crystal: gold as low-roughness metal; crystal as emissive-tinted glossy without refraction.
- Vertex colours authored sRGB, converted once at load (`STYLE.md`).

## 7. Poly and texture budget

All numbers **TBD (Jacob)** — proposals, not measurements of any shipped character.

| Item | Proposed LOD0 | Notes |
|---|---|---|
| Base body + head | ≤ 15k tris | hero-refine-v001 exported 70,985 body vertices after subdivision — far over budget. The MPFB NPC foundations have 13,380 visible vertices. |
| Hair | ≤ 8k tris | cards/shells |
| Ears + tail(s) | ≤ 6k tris | fur shells |
| Full hero outfit | ≤ 20k tris | |
| **Hero total** | **≤ 50k tris** | NPC crowd target ≤ 25k; LOD1 50%, LOD2 25%. |
| Textures | 2048² body/face, 2048² outfit, 1024² hair, 1024² fur, shared 1024² tileable prints | WebGPU/WebGL memory; KTX2/Basis **UNVERIFIED** for current loader. |
| Materials | ≤ 6 per character | |

## 8. Rig and animation requirements

Skeleton: **UE-mannequin bone names**, which every current runtime consumer expects:
`Root, pelvis, spine_01–03, neck_01, head, clavicle_/upperarm_/lowerarm_/hand_{l,r},
thigh_/calf_/foot_/ball_{l,r}`, finger chains `thumb/index/middle/ring/pinky_01–03_{l,r}`, plus
grouped `fingers_01_{l,r}` (required; `hero-v006/rig-contract.json` failed only on these two).

Licensed clips (local only, at `/workspace/tv-licensed/arena/`, **never commit**):
- `mixamo_clips.glb` — `mixamorig:*` names, built by `art/tools/arena/build_mixamo_clips.py`;
  mapped to UE names by `MIXAMO` in `src/web/arena/retarget.ts` (includes all finger joints).
- `unarmed_clips.glb` — already UE-mannequin named (Motifect set), built by
  `build_unarmed_clips.py`; mapped by `UE` in the same file (grouped fingers fan out).
- The Oct 15 review retargeted `locomotion/idle`, `locomotion/walking` and `great_sword/great sword slash`
  from `mixamo_clips.glb` onto both hero drafts (22 bones mapped, per `info.json`). Full clip lists: **UNVERIFIED**.

Retarget needs:
- Rest pose: A-pose matching the concept turnaround; retarget uses rest directions from child
  bones, so bone roll may differ (`CharacterRig` captures rest transforms) but **hierarchy and
  names must match exactly**.
- Units metres, glTF +Y up / +Z forward (`art/tools/reference_characters/slots.json`).
- One skin, normalized weights (hero-refine-v001 measured 0.99999987–1.0000001).
- Known issue to avoid: packed Mixamo locomotion stands with ~50° bent knees
  (`src/web/arena/combat.ts`), so calm locomotion uses the unarmed set.

Extra bones (procedural springs already exist in `src/web/actors/animator.ts`; names are
**exact** — the animator skips bones it cannot find):

| Chain | Bones | Count |
|---|---|---|
| Tail | `tail_01` … `tail_06` (child of `pelvis`) | 6 |
| Ears | `ear_l_01, ear_l_02`, `ear_r_01, ear_r_02` (child of `head`) | 2 each |
| Hair | `hair_l_01–03`, `hair_b_01–03`, `hair_r_01–03` (child of `head`) | 3 each |
| Sleeves | **TBD** e.g. `sleeve_l_01–03`, `sleeve_r_01–03` (child of `lowerarm`) | not yet driven |
| Robe/obi | **TBD** front/back/side skirt chains, `obi_bow_01–02` | not yet driven |

Multiple tails would need `tail_b_*` etc. and an animator change (code; out of scope here).
Sleeve/skirt/obi chains need a new spring or cloth pass in code — **TBD**.

Unreal note: the Foundry targets UE5 Manny (`docs/CHARACTER_FOUNDRY.md` §3). The names above are
Manny's, so the same body binds there; the extra chains are additive.

## 9. Two base bodies

Exactly **two** bases, `base-male` and `base-female`. Every role (hero, villager, monk, ronin,
shogun, …) is the base + head/face morphs + hair + ears/tail attachment + garments + palette.
No role gets its own body mesh.

Each base ships: body (underwear-level, garment-ready), head with blink/mouth shapes, default
hair, ear and tail attachments, skeleton per §8, and body morphs for frame/height/age
(`morphIntents` in `src/foundry/manifest.ts` already emits `heavy`/`muscular`/`tall`).
The hero is `base-female` dressed in the snowflake kimono; a male hero equivalent is `base-male`
in the same family. **TBD (Jacob):** child/elder bodies — morphs of these two, or later bases.

## 10. Versioning rule

- Characters live **only** in `scrsper/torn-veil-assets` (private, Git LFS; per LINEAGE.md it currently holds
  12 environment models only and **no `characters/` folder yet**, so this spec creates the layout) as numbered versions, e.g. `characters/base-male/v001`, `characters/base-female/v001`.
- Each version folder: source `.blend`, exported `.glb`, render sheet `front.png`,
  `three-quarter.png`, `back.png`, a clip check (the base playing idle/walk/attack from the
  licensed sets — rendered output only, never the clips themselves), and a short `info.json`
  (parent version, tris, bones, verts, what changed, review verdict).
- `v(n+1)` must start from `v(n)`'s file and say what changed. **No parallel bases**, no
  alternative "candidate" bodies side by side. Rejected attempts stay as numbered history.
- This repo holds only docs, references, and code that loads versions by id.

## 11. Reusable from hero-v006 and hero-refine-v001

Facts from the in-repo JSON, cross-checked with the review `info.json` (v006 72,308 tris / 53 bones; refine-v001 158,336 tris / 55 bones; both untextured; renders in `/workspace/torn-veil-build/model-review/<name>/`):

| Item | hero-v006 | hero-refine-v001 | Reuse? |
|---|---|---|---|
| Body source | MPFB 2.0.17, `game_engine` rig, macro gender 0 / age 0.4 / muscle 0.42 / weight 0.43 (`status.json`) | copy of v006 (`refinement-report.json` `source_checkpoint` 0163b5e) | **Yes, as a starting topology** for `base-female`; male analogue is `npc-male-foundation-v001` (gender 1.0, same macros). |
| Bones | 53, missing `fingers_01_{l,r}`, `contract_pass: false` | **55, `contract_pass: true`**, `missing_animator_bones: []` | **Yes — refine-v001's skeleton/weights are the rig checkpoint to start from.** |
| Skin quality | — | skin sums 0.99999987–1.0000001; `fingers_01` moves 6316 verts, `calf_l` 7928 | Yes |
| Eyes | none | head-weighted eyes at MPFB eye landmarks (`eye_centers` z≈1.387 m) | Yes (placement); restyle the eye |
| Vertex count | GLB 2,180,692 bytes, 10 skinned primitives | 70,985 body verts after one subdivision, GLB 6,451,528 bytes, 16 primitives | **No** — drop the subdivision; over budget |
| Face | generic MPFB | generic; "face likeness fitting" remaining | No |
| Hair | curve rope locks, unbound | same; "hair reconstruction" remaining | No |
| Costume | red/black coat panels, boots (wrong reference) | same; "tailored costume" remaining | No |
| Approval | "face likeness and cloth weighting unapproved" | `visual_quality_approved: false`, `thigh_crease_fixed: false`, `browser_motions_verified: false` | — |

Also reusable: `art/tools/reference_characters/validate_glb.py` (animator bone contract),
`verify_refinement.py` (skin/deformation checks), `refine_checkpoint.py`'s `fingers_01` addition.
Remaining checks listed in both `rig-contract.json` files carry over: metre scale and +Z forward,
rest pose, idle/walk/dodge/attack in browser, thigh/knee/elbow deformation, sleeve/leg clearance,
close and gameplay-distance turnaround.

## 12. Character Foundry / creator pipeline

Two separate systems exist. Both were read only; nothing was changed.

### 12.1 Unreal-era Character Foundry (on `main`)

- Files: `docs/CHARACTER_FOUNDRY.md`, `src/foundry/{manifest,catalogue,resolve,load}.ts`,
  `src/headless/foundry/{cli,ashfordWardrobe,fallback}.ts`. PR #48 (`6d2ed0f`) and Ashford garments
  PR #50 (`5ab3177`) are both ancestors of this branch.
- What it does: a canonical `AppearanceDescription` → `slotRules()` → per-slot requests with
  requirements / preferences / prohibitions (e.g. nobody below `affluent` in `noble`) → matched
  against a **machine-local** catalogue (`.debug/character-foundry/catalogue.json`, gitignored)
  → `CharacterRealization`. Relaxation is ordered and reported; each slot has its own
  deterministic stream so losing one asset never re-rolls other slots.
- Slots: `body, head, hair, facialHair, upperGarment, lowerGarment, robe, armor, footwear,
  accessory`. **No ear or tail slot.** No sliders: "morphs" are scalar intents
  (`heavy`/`muscular`/`tall`) from canonical traits.
- Garment language: Ashford-aware (hakama, layered robes, obi, haori, fur stole, sandals with
  kimono); `ashfordWardrobe.ts` checks garments come from the Ashford package.
- State: proven against a synthesized fixture (30 tests; 33/33 Ashford residents dressed). Never
  run against real assets; the Ashford garment meshes were kept on the PC (**UNVERIFIED** where).
  Target skeleton: UE5 Manny.

### 12.2 Web ontology creator and Tower "creator bodies"

- `tools/ontology/`: Babylon catalogue + Blender/MPFB scripts (`blender/scripts/humanoid_family.py`,
  `omni_family.py`, …). Deterministic resolver (`src/visual/resolver.ts`, v1.1.0, FNV hash per
  channel). `appearance.ts` applies, **for `tv-human-male-v2` only**, the `TV_JawWidth` morph,
  a seeded linen/leather palette and a fixed shirt/belt/boots; everything else (culture
  wardrobe, equipment, personal hair, age variants) is listed as unresolved. Female v1 has no
  variants. README: "not production character art".
- Tower creator: `5df8c30` (creator bodies, item fit) and `2b07f73` (saved customization: body
  M/F, height 95–105 %, hair show/hide, jaw width, re-roll) are on `origin/codex/tower-creator-fit`
  and `origin/codex/tower-opus-character-vfx`; **neither commit is an ancestor of `main`**, although
  `src/web/actors/creatorAppearance.ts` exists on `main`.
- Its bodies are the rejected `tv-human-*` models, so its output is not usable.

### 12.3 Can either produce the kimono-hero bases?

Not today. Neither has a kimono-style base mesh, fox ears, tails, or the silver groom. Reusable:
- Foundry: slot model, rules/prohibitions, relaxation reporting, per-slot determinism, Ashford
  garment vocabulary, `morphIntents`. Needs **new `ears` and `tail` slots** (code; not done here).
- Ontology creator: Blender/MPFB build-and-validate scripts and the seeded-variation function.
  Its UI controls map to features of the rejected bodies and would need rebuilding.

### 12.4 Recommendation

**One pipeline: the Character Foundry's resolver**, fed by a catalogue that lists only the two
versioned bases (§9–10) and garments/hair/ears/tail fitted to them, loaded from
`torn-veil-assets` by version id for both the web client and Unreal. Retire the ontology creator's
body path; keep its Blender validation scripts as tools. Put creator sliders (height, jaw, palette
re-roll, hair, ears/tail toggle) on top of the Foundry's morph intents and attachments, so the
player creator and NPC generation share one code path. **TBD (Jacob):** approve, and decide the
ears/tail canon question (§4) before the slots are added.
