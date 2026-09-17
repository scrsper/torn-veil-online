# Character appearance pipeline (v0.11 slice 1)

Torn Veil's people used to be mannequins with a colour on them. Every ordinary resident of a
procedural settlement was given one random shirt colour and nothing else; the five authored
character sheets in `art/reference/cultures/ashford/characters/` influenced nothing at all.

This slice adds the missing layer: a canonical, persistent, structured description of what each
person looks like, generated procedurally from those five reference sheets, and projected to
renderers as tokens rather than as asset paths.

```text
art/reference/cultures/ashford/characters/*.png      authored reference sheets
        -> src/sim/world/characterArchetypes.ts      hand-written interpretation (8 families)
        -> src/sim/world/characterAppearance.ts      per-person selection + variation
        -> Person.appearance.traits                  canonical, persisted, save/load stable
        -> src/sim/core/appearance.ts                traits -> realized colours/scale
        -> bridge projectAppearance()                traits + canonically derived age/role cues
        -> Three.js src/game/actors, Unreal ATVCharacter::ApplyAppearance
```

---

## 1. Where the reference images are used

The task brief named `docs/characters/`. That directory does not exist in this repository; the
five committed sheets live in **`art/reference/cultures/ashford/characters/`** and that is what is
used. The file names in the brief match exactly.

| File | Read as |
| --- | --- |
| `hana.png` | One character sheet. Festival register: crimson/black cherry-blossom kimono off the shoulder, wide obi, long wavy honey-blonde hair with blossom ornaments, heavy gold filigree, raised sandals. |
| `kaito.png` | One character sheet. Young-retainer register: black topknot, dark lamellar over a black patterned kimono, deep red sash and torn banner cloth, throat scarf, katana. |
| `shogun.png` | One character sheet. Authority register: heavy bearded build, open black kimono with gold dragon/blossom work, red-lined hakama, thick red cord, sleeve tattoos, geta. |
| `yuki.png` | One character sheet. Court/performer register: violet-and-pink blossom kimono over black, red braided cord, kanzashi with red tassels, folding fan, very long straight black hair. |
| `-ren-ayami-shiro.png` | **Four** labelled NPC panels, not one: `NPC 5 — THE MONK (wandering ascetic)`, `NPC 6 — THE RONIN (exiled swordsman)`, `NPC 7 — THE DANCER (desert rose)`, `NPC 8 — THE KITSUNE (snow moon)`. The filename lists only three names for four panels, so the monk is keyed by role (`ascetic`) rather than by a name the sheet does not give. |

So five files yield **eight** archetypes: `hana`, `yuki`, `kaito`, `shogun`, `ren`, `ayami`,
`shiro`, `ascetic`. `tests/character-appearance.test.ts` asserts that every archetype names a file
that still exists on disk, so the provenance cannot silently rot.

One deliberate omission: the kitsune panel's fox ears and tails are **not** taken. Torn Veil has no
canonical non-human humanoid, and inventing one to satisfy a costume would be renderer truth
outrunning simulation truth. What is taken from that panel is the winter register — pale ground,
deep blue accent, white hair, fur.

---

## 2. How archetypes are defined

`src/sim/world/characterArchetypes.ts` is a hand-written, human-editable table. There is no image
analysis and there should never be: a person read the sheets, and what they read is written down.

**An archetype is a stylistic family, not a costume and not a character.** `shogun` does not mean
"this person is a warlord"; it means "this person's look descends from the black-and-gold dragon
silk family". Three orthogonal axes decide what somebody actually wears:

| Axis | Source | Example |
| --- | --- | --- |
| Family | archetype, drawn per person | `shogun` — black ground, gold figure work, red lining |
| Station | `GarmentStatusId`, from canonical means at generation | `poor` vs `affluent` |
| Role | `OCCUPATION_CUES`, derived from `Person.occupation` every projection | a smith's hammer, a farmer's wide hat |

That separation is the reason the five images influence the *whole* population instead of producing
five bespoke dead-end NPCs: a dirt-poor farmer and a captain of the watch can both belong to the
`shogun` family and still read unmistakably as a farmer and a captain.

Each archetype therefore carries two registers — `dressPalettes`/`dressSilhouettes` for when a
station can afford the family's formal look, and `workPalettes`/`workSilhouettes` for everyday
clothes in the same visual language.

Adding a culture means adding archetypes with a new `culture` id and, if needed, new entries in
`GARMENT_PALETTES`. Nothing else in the pipeline is Ashford-specific.

---

## 3. The appearance schema

`src/sim/core/appearance.ts` defines `AppearanceTraits`, stored at `Person.appearance.traits`.

| Field | Meaning |
| --- | --- |
| `archetype`, `culture` | Which reference family this look descends from |
| `presentation` | `feminine` / `masculine` / `androgynous` |
| `skinTone` | Token into `SKIN_TONES` (9 entries) |
| `faceShape` | `round` / `oval` / `square` / `heart` / `long` / `angular` |
| `hairStyle`, `hairColor` | Tokens; 13 styles, 12 colours |
| `eyeColor` | Token into `EYE_COLORS` (8 entries) |
| `frame`, `stature` | Body build and height bands, realized through `FRAME_BUILD` / `STATURE_HEIGHT` |
| `garmentSilhouette` | 13 silhouettes, from `work_kimono` to `lamellar_armour` |
| `garmentPalette` | A costume *family* (primary/secondary/accent), not a single colour |
| `accessories` | Persistent worn items and markings: `prayer_beads`, `wide_hat`, `tattoo_sleeve` |
| `culturalTags` | Stylistic markers a renderer may key off: `ashford`, `festival_silk` |
| `grooming`, `wear` | 0..1. How kempt, and how worn the cloth is |
| `status` | The clothing register their means put them in |

Two boundaries are load-bearing:

**Traits describe; the numeric channels realize.** `appearanceFromTraits` derives skin/hair/shirt/
pants/hat/apron/height/build from the description, so a generated person has exactly one authoring
source. An authored character (`world/cast.ts`) may still pin any exact colour; when they do,
`nearestSkinTone` / `nearestHairColor` / `nearestGarmentPalette` snap the matching token to whatever
was pinned, so the description can never quietly describe a person who isn't there.

**Anything derivable is not stored.** `agePresentation` comes from `Person.age` and `roleCues` come
from `Person.occupation`, both computed by `projectAppearanceTraits` at projection time. Storing
them would be a second representation of a canonical fact (AGENTS.md §7) *and* would freeze a
person at the age they were generated. Because they are derived, a smith who ages twenty-five years
reads as `elder` with no regeneration and no migration.

---

## 4. How procedural variation works

`resolveAppearance` in `src/sim/world/characterAppearance.ts`:

1. **Own stream.** Every draw comes from `individualRng(seed ^ salt, 'appearance:' + identity)` —
   the same mechanism `generatedHuman` already uses for attributes. It consumes no world RNG, so
   adding appearance variation cannot perturb a single behavioural outcome, and a regenerated world
   reproduces the same faces. `tests/character-appearance.test.ts` asserts the world/weather/
   demographic stream positions are untouched across 50 resolutions.
2. **Family.** A weighted draw among archetypes that fit the person's culture, canonical gender and
   age. Occupation affinity raises a family's weight (a priest is far more likely to come out
   `ascetic`) without ever forcing it.
3. **Station.** `statusForMeans(wealth)` picks the register. A child is dressed out of their
   household (`appearanceMeans`, which `demographics.ts` supplies from the parents) one register
   down, never out of their own empty purse.
4. **Costume.** Palette and silhouette from the family's register, then narrowed by
   `wearableSilhouettes` so a trade only wears what that trade could be wearing — no merchants in
   lamellar plate, no captains of the watch in rags.
5. **Phenotype.** Skin tone, face shape, hair style and colour, eye colour, frame and stature drawn
   from the family's own vocabulary. Age then shifts frame/stature (children and the very old step
   down a band), heavy trades can step a frame up, and `greyedHairColor` greys hair on an individual
   roll that ramps from ~38 to ~72 so two sixty-year-olds are not obliged to grey together.
6. **Loadout.** The family's `coreAccessories` (what keeps it recognisable) plus a deterministic
   subset of `optionalAccessories` sized by station, minus anything a child should not be wearing.
7. **Condition.** `wear` from station plus a labouring-trade penalty plus jitter; `grooming` from
   the family's band adjusted by station. `weatheredColour` then dulls and darkens the realized
   garment colours, which is why a destitute vagrant and a comfortable merchant in the *same*
   costume family still read as different people with no renderer change at all.
8. **Authored pins last.** Whatever the caller supplied wins, and the tokens are snapped to it.

Measured on the authored Ashford village (seed 1337, 33 residents): all 8 reference families
present, 8 distinct palettes, 8 distinct silhouettes, 29 distinct garment colours, 33 distinct trait
signatures. Over an 800-person synthetic population every family appears; over 300 people, 280+
distinct signatures.

---

## 5. How Unreal maps traits into visible characters

The bridge sends `appearance.traits` inside each body's visual state.
`FTVHumanoidVisualState::Parse` reads it into `FTVAppearanceTraits` — fully optional and fail-soft,
so a body projected by an older bridge, or a person from a save written before this pipeline
existed, arrives with `bHasTraits == false` and is presented exactly as before.

`Content/TornVeil/Presentation/AshfordAppearanceProfiles.json` (schema 2) is the renderer's own
grammar, and the only place a token becomes something this client can draw:

- `silhouettes` — garment proxy proportions per `garmentSilhouette`
- `hair` — hair proxy proportions and boundness per `hairStyle`
- `accessories` / `roleCues` — which single prop a person carries, role first
- `archetypes` — reference provenance, so a future asset pack can key whole outfits off the family
- `occupations` — the retained schema-1 grammar, still the fallback for a body without traits
- `proxyVisibility` — see below

`ATVCharacter::ApplyAppearance` reads that grammar once per process and applies it: skin/cloth/hair
tints from the realized colours, mesh scale from height/build, garment and hair proxy scale from the
silhouette and hair tokens, prop selection from role cues then accessories, and optional `Wear` /
`Grooming` scalar parameters on the cloth material (a material graph without those parameters simply
ignores them).

**What is visible today.** Manny plus canonical tinting is the look that was accepted in Slice 2.
The cube/cylinder hair/garment/prop stand-ins obscure articulated limbs, so they remain hidden —
`proxyVisibility` in the profile JSON is the single switch, and it is off for all three. The trait
grammar is evaluated either way. What *has* changed visibly in Unreal is that garment, skin and hair
colours are now costume-family and wear driven instead of one random shirt value per resident, and
that height/build now vary across a procedurally generated population.

---

## 6. Persistence and determinism

- `Appearance.traits` is a plain nested object on `Person`, which `persist/save.ts` already
  whole-object-persists at both ends, so it round-trips with no serializer change.
- It is **optional**, which is why `SAVE_VERSION` is not bumped: this is an additive optional field
  of exactly the class the file's own header documents as not needing a bump
  (`KnowledgeItem.lastConfirmedAt?`, `HaulTask.materialSellerId?`). A pre-pipeline save still loads,
  and its people keep the exact look they had — they simply carry no description of it. Deliberate:
  an existing Fenwick save stays playable.
- Same world seed + same person identity (`slug ?? id`) = same baseline appearance. A PIE restart,
  a reload, or regenerating the world from the seed all produce the same faces.
- `tests/character-appearance.test.ts` proves the save/load round trip preserves every person's
  whole appearance object, and that regenerating a world reproduces every trait signature.

---

## 7. Reviewing it without an editor

```bash
npm run appearance:sheet -- 1337 docs/evidence/character-appearance/ashford-contact-sheet.svg 40
```

Writes a contact sheet straight from canonical appearance — one figure per person, proportioned by
their canonical height and build, captioned with the tokens that produced it — plus a JSON summary
of family/palette/silhouette spread. It draws exactly what the bridge would send, so anything it
shows that PIE does not is a projection bug. Committed output:
`docs/evidence/character-appearance/ashford-contact-sheet.{svg,png}`.

---

## 8. What is temporary, and what is future-facing

Temporary:

- The Unreal hair/garment/prop stand-ins are primitives and stay hidden behind `proxyVisibility`
  until fitted modular assets exist. Trait → asset mapping is real; the assets are not yet.
- `Appearance.beard` / `hat` / `apron` remain the old flat channels. They are derived from traits
  now, but they are still a narrower vocabulary than `accessories`.
- `eyeColor` and `faceShape` are carried canonically and projected, but no renderer consumes them
  yet — the mannequin has neither.
- Greying is applied once, at generation. People who age *during play* do not yet re-grey.

Future-facing, and why the shape is what it is:

- **Many residents, many towns.** Archetypes are data keyed by `culture`; a new region adds
  archetypes and palettes, not a parallel code path.
- **Equipment and status changes.** `status`, `wear` and `grooming` are persistent canonical facts
  that an in-world cause is meant to change — being robbed, coming into money, a season of hard
  labour. Nothing derives them from present wealth at read time, precisely so they can diverge.
- **Injuries, aging, role changes, progression.** `agePresentation` and `roleCues` are already
  derived every projection, so aging and a change of trade are visible with no migration.
  `Body.injuries` is a natural next input to the same projection.

---

## 9. What this slice did not do

- No Unreal build or PIE run: no engine is available in the environment this was implemented in.
  The C++ and JSON changes are unverified by compiler or editor and need a build before merge.
- No new modular character assets.
- No change to locomotion, dialogue, combat, persistence format, bridge protocol version, or any
  canonical mechanic. The one behavioural change is that procedurally generated residents now vary
  in build and height, which feeds `defaultPhysiologyTraitsFor` exactly as the authored cast's
  variation already did.
