# The Character Foundry (v0.11 slice 2)

> The simulation determines **who** a person is.
> The Foundry determines **how** that person is physically realized.
> Unreal displays the result.

The appearance pipeline (`docs/CHARACTER_APPEARANCE_PIPELINE.md`) gave every canonical person a
structured, persistent description of what they look like. It stopped short of bodies: the
description reached Unreal as colours and tokens, and Unreal drew a tinted mannequin.

The Foundry is the layer that turns that description into a **configuration of real parts**.

```text
Person (canonical)
  -> AppearanceDescription              canonical, persisted, renderer-neutral
  -> slotRules()                   "this person needs a long bound feminine hair asset"
  -> realizeCharacter()            matched against what THIS machine actually installed
  -> CharacterRealization          body/head/hair/garments/footwear/accessories + materials
  -> Unreal                        applies it, or falls back and says so
```

---

## 1. Status of this slice, stated plainly

**Stage A could not be run here.** The environment this slice was implemented in has no character
assets at all: `.uasset` files are unfetched Git LFS pointers, and
`unreal/TornVeilOnline/Content/Characters/` — where Mannequins, MetaHuman and any modular character
pack live — is gitignored and absent. There is no Unreal Engine and no Windows machine.

So this slice delivers **the Foundry itself and the tool that inventories a machine**, proven
against synthesised catalogues, and defers every claim that needs real assets. Nothing below
asserts that a character has been seen in PIE, because none has.

What *was* determined from the committed tree is in §3, and it is a real and load-bearing finding.

---

## 2. Architecture

Three pieces, deliberately separated by what changes them:

| Piece | Where | Changes when | Committed? |
| --- | --- | --- | --- |
| **Manifest** — what a person needs | `src/foundry/manifest.ts` | the *design* changes | yes |
| **Catalogue** — what this machine has | `.debug/character-foundry/catalogue.json` | packs are installed | **no**, machine-local |
| **Resolver** — matching one to the other | `src/foundry/resolve.ts` | the *algorithm* changes | yes |

The manifest contains **no asset paths**, and a test asserts it. It says "kimono, formal, female,
noble"; it does not know that `/Game/SomePack/SKM_Kimono_Formal_F` exists. Swapping content packs
changes the catalogue and the audit script's classification, and should not change a line of
matching logic. That is what makes this a foundry rather than a lookup table.

### Requirements, preferences, prohibitions

- A **requirement** must be present or the asset is simply wrong for this person (a child's body
  for a child).
- A **preference** ranks candidates (`female` cut, `angular` face, `noble` register).
- A **prohibition** disqualifies outright. Two exist, both about station: nobody above `poor` is
  put in `rags`, and nobody below `affluent` is put in `noble`. These are not preferences because
  they are not matters of degree — this is the rule that stops a settlement sample reading as
  nonsense role/status combinations.

### Relaxation

When nothing matches, requirements are dropped one at a time in a declared order, and prohibitions
last of all. Every relaxation is **reported**, so "everyone ended up in the same tunic" shows up as
a measurement rather than as a mystery in a screenshot. A thin pack still dresses everybody; it
just dresses them more approximately and says so.

### Determinism

Each slot draws from its **own** stream, keyed by the person's identity *and* by what that slot is
asking for — not from one shared sequential stream. This was a real bug found by a test during this
slice: with a shared stream, uninstalling one hair pack silently re-rolled a person's clothes and
props. Fail-soft has to mean "lose that part", not "become a different person".

---

## 3. Skeleton compatibility — the finding that constrains everything

Determined from the committed tree (paths only; no asset was opened):

- `unreal/TornVeilOnline/Content/TornVeil/Combat/Repair/RTG_TV_CombatRepair` retargets
  `IK_TV_RepairSource` → `IK_TV_RepairManny`.
- Every retargeted clip (`RT_*`: sprint, dodge left/right, jab, cross, front kick, roundhouse,
  crouch transitions) lands on the **UE5 Manny** skeleton.
- `ATVCharacter` loads `/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple`.
- `AnimStarterPack` carries a second family (`HeroTPP_Skeleton`, `HeroTPP`,
  `ASP_HeroTPP_AnimBlueprint`), and the three Motifect packs (463 assets) ship a skeleton per clip
  — all *sources* to retarget from.

**So the animation target is UE5 Manny.** Any body, head or garment mesh the Foundry selects must
bind to that skeleton, or to one an installed retargeter can bring onto it. A beautiful body mesh
on an unreachable rig is a character that cannot walk, which is worse than a plain one that can —
so `animatableSkeletons()` gates the candidate pool on exactly this, and reports how many assets it
excluded and why.

This is also the first thing to check when the audit runs for real: if the installed human packs
are not Manny-compatible, the next slice is a retargeter, not a resolver change.

---

## 4. Running Stage A (on the Windows machine)

```powershell
unreal/scripts/Run-EditorPython.ps1 -Script unreal/scripts/audit_character_assets.py
```

Read-only — AssetRegistry queries only, exactly like `audit_local_environment.py`. No asset is
loaded, saved, moved or modified.

It classifies every candidate into a Foundry slot and a tag set by keyword over package path and
asset name, groups skeletons, finds retargeters, infers the animation target from animation counts,
and writes `.debug/character-foundry/catalogue.json`.

That file is **machine-local and gitignored on purpose**: it names licensed Fab/Marketplace and
engine content that is not redistributable. It is read by the presentation layer only, and nothing
in it ever enters canonical `Person` state — the same boundary
`docs/playable-world-slice2-local-assets.md` already draws for environment content.

Classification is keyword-based and will not be perfect on a pack it has never seen. Improving it
is a change to `SLOT_PATTERNS` / `TAG_PATTERNS` in that one script. The resolver never learns about
any particular pack.

Then:

```bash
npm run foundry:report                  # uses .debug/character-foundry/catalogue.json
npm run foundry:report -- 1337 <path>   # or an explicit catalogue
```

---

## 5. How the appearance description maps to assets

| Canonical field | Becomes |
| --- | --- |
| `presentation` | `female` / `male` / `unisex` cut preference |
| `agePresentation` (derived from `Person.age`) | `child` / `adult` / `elder` body and head **requirement** |
| `frame` | `slim` / `average` / `muscular` / `heavy` preference, plus `heavy`/`muscular` morph values |
| `stature` | `tall` morph value, and the uniform height scale |
| `faceShape`, `skinTone` | head preference |
| `hairStyle` | `short` / `long` / `bound` requirement plus `braid`/`bun`/`topknot`/`updo` preference |
| `hairColor` | hair asset preference, and the hair material tint |
| `accessories: beard` | facial-hair slot |
| `garmentSilhouette` | upper + lower shape, or a single `robe`, plus `armor` where the silhouette is armoured |
| `garmentPalette`, realized colours | cloth material tints — never an asset choice |
| `status` | quality register preference, and the two prohibitions in §2 |
| `wear`, `grooming` | `worn` preference, and scalar material parameters |
| `roleCues` (derived from `Person.occupation`) | accessory slot: hammer, hoe, spear, tray, ledger… |
| `accessories` | accessory slot: beads, staff, fan, jewellery, hood, helm… |

Materials and scale come **straight from canonical appearance** and are correct even when not a
single mesh resolved — which is exactly the state a machine with no packs should be in.

---

## 6. Fail-soft, and what it guarantees

Verified by test (`tests/character-foundry.test.ts`, 30 tests):

- **No catalogue** → a realization with no slots, correct materials and scale, and a `no-catalogue`
  problem. The person is untouched.
- **Sparse catalogue** → body and head relax down to whatever exists; missing slots are named.
- **Foreign skeleton** → assets excluded with `skeleton-incompatible`, required slots reported
  unresolved, mannequin fallback.
- **Malformed catalogue** (bad JSON, wrong schema, junk entries, `null`) → dropped entry by entry
  with reasons; never throws.
- **One mapping deliberately removed** → that part is lost, *every other part is byte-identical*,
  and the gap is reported.
- **Canonical state is never touched** by any of the above, and no world RNG stream is advanced.

---

## 7. Results so far (against a synthesised pack, not real assets)

`tests/fixtures/characterCatalogue.ts` synthesises a plausible modular pack (8 bodies, 9 heads, 10
hair, 10 upper / 6 lower garments, 3 robes, 2 armours, 4 footwear, 24 accessories, all on the
animation target).

| Stage | Result |
| --- | --- |
| **B — one person** | Complete: body, head, hair, upper, lower, footwear, trade prop, on the animation skeleton. Deterministic and independent of catalogue scan order. |
| **C — ten residents** | 10/10 complete, 10 distinct configurations, ≥8 distinct outfits, ≥5 distinct bodies and heads; child on a child body, elders on elder bodies. |
| **D — Ashford sample (seed 1337, 33 residents)** | 33/33 complete, 33 distinct configurations, 33 distinct outfits, 8 distinct bodies, 9 distinct heads, 0 unmet requests, 9 relaxations. |

Those 9 relaxations are worth reading, because they are the diagnostic doing its job: the fixture's
only jewellery asset is tagged `noble`, so every commoner wearing `gold_filigree` or `ear_drops`
had to drop the `!noble` bar to wear anything at all. That is a *content gap in the pack*,
surfaced as a measurement — precisely what should happen, and precisely the kind of thing that is
invisible in a screenshot.

**None of this is evidence about real assets.** A fixture proves the resolver's contract. What it
cannot prove is whether a real pack gets *classified* well, and that needs the Windows machine.

---

## 8. Reconciled presentation layer and remaining limits

- PR #45 now projects the canonical description through this resolver and carries
  `CharacterRealization` to `UTVCharacterPresentation`. Unreal loads the resolved body and skeletal
  modular parts, applies scale/morph/material inputs, preserves the hidden Manny animation driver,
  and fails soft to that driver when a body or pose source is unavailable.
- The apply layer has not yet been compiled or exercised against a real Stage A catalogue. Groom
  and static attachment binding remains deliberately unresolved until the audit establishes the
  installed packs' component/socket requirements.
- No named-character bespoke likenesses. The priority order in the brief puts scalable modular
  realization first, and that is what exists; `resolveAppearance({ archetype })` already pins a
  named character to a family, which is the hook a bespoke pass would build on.
- No claim about locomotion, sprint, dodge, combat or hit reactions. §3 establishes what
  *compatibility* requires; nothing has been played.

## 9. Reference-image limitations

The eight families come from five 2D sheets. A 2D reference does not determine rear skull shape,
body depth, hidden anatomy, hair geometry or topology, and nothing here pretends otherwise — the
families constrain *selection among installed assets* (tone range, silhouette, costume structure,
palette, status cues), and the assets supply the geometry. No claim of exact reconstruction is made
anywhere in this pipeline, and `characterArchetypes.ts` records per family what was actually read
off the sheet and what was deliberately not taken.

---

## 10. Next recommended slice

1. Run `audit_character_assets.py` on the Windows machine. Read the coverage table and the
   `unmet` list; that is the shopping list.
2. Check the finding in §3 against reality: are the installed human packs on Manny, or do they
   need a retargeter?
3. Build and verify the reconciled wire format and `ATVCharacter` apply layer, then Stage B in PIE
   and the acceptance list — one character, ten characters, locomotion, sprint, dodge,
   combat, hit reaction, save/reload, the deliberate-breakage fallback test, screenshots, video.
