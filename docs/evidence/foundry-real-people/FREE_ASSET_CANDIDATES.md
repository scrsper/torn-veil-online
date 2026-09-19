# Free character assets on Fab — candidate survey

**Verification update, 18 September 2026:** the installed assets supersede the original listing
assumptions below. Polytope contains one head per sex and needs proportion-aware retargeting;
its UE5 label does not establish Leader Pose compatibility. Quantum is male-only. City Sample
Crowds is now installed, and Hannah FREE is acquired but awaiting MetaHuman prerequisites.
See [the integration checkpoint](FREE_ASSET_INTEGRATION.md) for the acquisition ledger,
measured costs, validation status and remaining visual work. Attractive female characters are
a core acceptance requirement; no pack has yet passed the final Torn Veil quality test.

Searched on Fab with the free filter across: `modular character`, `medieval character`,
`modular medieval villager`, `realistic human character`, `peasant villager NPC`. What follows is
the shortlist and, more usefully, why most of the field is unusable for this project regardless of
how it looks.

## The filter that eliminates most free character content

Torn Veil does not need *a character*. It needs a **modular kit on the UE5 skeleton**, because the
Character Foundry assembles a person per slot from canonical traits, and the animation target is
`SK_Mannequin`. That single requirement removes the large majority of free listings:

- **One-off character models** (`Realistic Male Character`, `Farah`, `Riya`, `Camilia`, most of
  NoEdge's catalogue) are a single finished person. They cannot be recombined, so they produce one
  resident and no variation. A settlement of them is a settlement of clones.
- **Editable MetaHuman presets** (`Mason`, `Seo`, `Kabir`, `Advika`) are individual identities.
  Their modular bodies, heads and hair may still be useful; assembly compatibility and runtime
  cost need testing rather than rejecting the entire format. Hannah FREE is under evaluation.
- **Stylized/low-poly single characters** (`Rogue Character Model`, `Elf Blacksmith`,
  `Stylized NPC - Peasant Nolant`) are the same problem with a different art style.
- **Environment packs** dominate the medieval searches and are irrelevant here.

What survives are kits that ship *parts* on a shared skeleton.

## Shortlist

### 1. Lowpoly Modular Armors — Free — MEDIEVAL FANTASY SERIES — **primary candidate**

Polytope Studio · Free · Standard License · UE 5.3–5.7 · 4.3★ (6)
`https://www.fab.com/listings/d32023d6-cc7c-4a6b-bbc6-b0821c3d3391`

| | |
|---|---|
| skeleton | **Unreal 5 skeleton** — the decisive property |
| bodies | 3 male, 3 female, 2 undressed |
| heads | installed: 1 male, 1 female (listing count was not confirmed) |
| hair | 2 male sets, 2 female sets |
| facial hair | 2 male sets |
| armour | 8 modular sets |
| materials | one custom material exposing colour / metallic / smoothness per part |
| cost | 2,090–9,490 tris per character |
| animations | none — irrelevant, the project animates from Manny |

This fills precisely the slots Torn Veil has none of: heads, hair, facial hair, garments, armour,
and female bodies. The installed skeleton differs from Manny in 84 shared reference transforms,
so direct Leader Pose compatibility cannot be assumed. An owned IK adapter has compiled; PIE
deformation and motion acceptance remain pending. The colour-parameterised material matters: the
Foundry already drives canonical garment palette, wear and grooming, and it currently has nowhere
to put them.

**Style caveat, stated honestly:** it is stylized low-poly, not realistic. It is *not* the
photoreal look a "grounded medieval" brief might imply. Two things argue for it anyway. First,
Torn Veil's own environment — the Advanced Village Pack housing, the flat-shaded vegetation, the
simple props already in the shipped screenshots — is itself stylized, so a photoreal human would
clash with the world more than a stylized one. Second, at ~2–9k tris it is the only candidate whose
cost obviously supports a whole settlement.

### 2. Quantum Modular Character Free Sample — **secondary, parts only**

Quantum Assets · Free · Standard License · UE 5.0–5.8 · 4.5★ (51)
`https://www.fab.com/listings/8e200050-3158-4762-b297-f785b5b1533d`

Visually the strongest free human content found: believable anatomy, good skin shading, real face
variation, production-quality presentation. Single UE5 skeleton, MetaHuman-compatible, modular.

**Rejected as the primary solution** on aesthetic grounds: it is a *modern military* character.
Tags are Army, Soldier, Tactical, Rifle, War; the outfits are plate carriers, caps and cargo
trousers. Nothing in it can dress an Ashford villager. It is also **masculine-only**
("Body Types Supported: Tall/Masculine"), so it cannot serve a mixed population on its own.

Its real value is the part underneath the uniform — realistic **bodies and heads** are culture
neutral once clothed. Worth installing as a second source if Polytope's heads prove too simple.

### 3. Considered and rejected

| Asset | Why not |
|---|---|
| `Stylized Handpainted Modular Character Starter Kit` (CoreCharacters) | hand-painted stylization far from Torn Veil's register |
| `FREE Starter Pack — Sidekick Modular Characters` (Synty) | Synty's flat stylization is a different game's art direction entirely |
| `Urban Man - PolyMate` (Alstra) | modern urban, low fidelity |
| `[CR] [LQ] Modular …` series (UNDERKING) | explicitly low-quality ("LQ") tier |
| `Modular Humanoid Characters | Male/Female (Free Demo)` (joaobaltieri) | demo scope; unverified skeleton |
| `Survival Character` (Arberry, 4.8★/55) | modern survival aesthetic, single character |
| `Casual set 01` (Mayjen, 4.6★/19) | modern casual clothing |
| `Character Creator: Nia` / `Kevin` (Reallusion) | CC4 rigs, not UE5-skeleton modular kits |
| `Paragon: Morigesh` / `Sevarog` (Epic) | hero characters, heavily stylized fantasy, single identities |
| `MetaHuman Vampire Character Asset` (Epic) | single identity, MetaHuman cost profile |

## Paid packs noted, not purchased (§11)

Recorded only so the trade-off is visible later. **Nothing was bought and no payment details were
entered.**

| Pack | Publisher | Price seen | What it would solve |
|---|---|---|---|
| Low Poly Bundle 1 — Lowpoly Medieval Fantasy Series | Polytope Studio | $274.99 | the full medieval wardrobe — civilian, merchant, noble, clergy — in the same style and skeleton as the free pack, which is exactly the diversity ceiling the free pack will hit |
| Low Poly Modular Armors Expansion Pack 3 | Polytope Studio | $99.99 | more armour variety, same series |
| Modular Character Mega Bundle | Quantum Assets | $149.99 (from $299.99) | realistic modular bodies/heads at scale, both sexes — the realistic route |
| Modular Mega Bundle — Male / Female | Quantum Assets | $399.99 | the full realistic ecosystem the free sample advertises |

The honest read: the free Polytope pack is a genuine foundation, but its wardrobe is armour-led.
Torn Veil is a village of farmers, bakers and woodcutters, and the civilian clothing that would
dress them is in the paid bundle from the same series. That is the decision to revisit after the
free pack is measured in situ.

## Blocker

Adding anything to a Fab library requires an Epic Games sign-in. The account on this machine is
signed out, and the Epic Games Launcher is not installed at all. I opened the sign-in page and left
it for the account holder; I do not enter credentials.
