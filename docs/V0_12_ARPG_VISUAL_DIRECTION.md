# v0.12 — ARPG Visual Direction: reference-driven characters and architecture

**Status:** prototype / vertical slice. Not merged. Presentation-layer only — `src/sim/` is
untouched by this milestone.

Base commit: this branch is cut from `main` and carries v0.11 ("draw the same canonical world as
a fantasy ARPG") as its first commit. v0.11 built the presentation-adapter architecture — the
channel table, the smoothed terrain, the foliage skin, the procedural texture set. v0.12 is the
art-direction pass on top of it, aimed at a specific supplied reference set.

## The reference system, extracted

The nine supplied sheets (four building sheets, five character sheets) share one visual system.
The internal specification this milestone worked to:

**Characters.** Semi-realistic stylized — believable anatomy, idealized proportion, no cartoon
exaggeration and no photoreal skin. Roughly 7.5–8 heads. The identity is almost entirely in the
GARMENT LAYERING, not the body: a pale under-robe with a crossed collar showing a V at the chest,
a broad sash at the waist with a knotted cord and a hanging tassel, an outer robe with wide flared
sleeves and a contrasting hem band, and either split trousers or a layered skirt below. Palettes
are tight and disciplined — a near-black or deep-indigo ground, one saturated accent (crimson,
plum, teal), gold-brass fittings, natural skin. Materials read as three distinct classes: matte
patterned cloth, semi-gloss leather straps, dark lacquered lamellar plate with bright metal
medallions. Hair is a solid dark mass with a defined style (topknot or bun for men, long fall with
ornaments for women). Detail that survives at ARPG range: silhouette, the waist band, the sleeve
flare, the hem line, the shoulder plates, the head shape.

**Architecture.** Dark blue-grey clay tile roofs at a low-to-medium pitch, with **very deep eaves
and a slight corner upsweep** — the single most identifiable feature. Heavy rolled ridge caps with
gold circular emblems at the ridge ends. Exposed rafter tails and a fascia band under the eave.
Near-black weathered timber posts, beams and rails against **cream plaster infill panels** — the
highest-contrast cue in the whole set. A dressed stone plinth, a raised plank veranda with posts,
shoji lattice windows glowing warm, a fabric curtain hung under the entry lintel carrying a
circular floral emblem, warm box lanterns on posts, banner poles, and clutter (barrels, jars,
woodpiles, baskets). Detail that survives at ARPG range: the roof profile and eave depth, the
timber/plaster contrast, the curtain colour, the lantern glow.

## Cultural interpretation — the seam

The references are strongly East-Asian. This prototype leans into that vocabulary, but "Japanese"
is deliberately **not** a property of Torn Veil's ontology. `src/game/presentation/culture.ts` is
the one place the gap is crossed, and it is crossed in two hops through culture-free middle terms:

```
canonical PlaceType   →  BuildingArchetype ('dwelling'|'vendor'|'workshop'|'temple'|'hall')  →  style pack
canonical Occupation  →  AttireRole ('artisan'|'merchant'|'clergy'|'warrior'|'labourer'|…)   →  attire pack
```

A bakery and a general store are both `vendor` in any culture; a smith and a baker are both
`artisan`. `buildingSkin.ts` knows the words "deep eave", "ridge cap" and "infill panel" — it does
not know the word *kawara* and it does not know which culture it is drawing. Adding a second
culture is adding a second pack plus a rule in `cultureFor()`, which today answers `veil-east` for
everything. That is a prototype decision, recorded as one function, not an ontological one.

## What changed

### `presentation/culture.ts` (new)
The style/attire descriptor layer described above. `attireFor(person)` derives a complete
`AttireSpec` — palette, garment layers, equipment, hair style — deterministically from canonical
`Person` fields the simulation already maintains: occupation, gender, age, wealth, and the
`Appearance` the world generator assigned. **No gameplay state was invented for visuals.** The
canonical shirt/pants colours still tint the robe, so a person the generator dressed in blue is
still recognisably that person.

### `presentation/humanoid.ts` (rebuilt)
The v0.11 rig kept its skeleton and its animation; what it wears was rebuilt as layers:
under-robe → crossed collar lapels → outer robe with a flared skirt, hem band and a contrasting
front panel → broad obi with a metal ring, a back knot, a cord and tassel → wide flared sleeves
hanging off the shoulder bone → hakama or leggings → wrapped footwear. On top of that:
lamellar shoulder plates, a plated chest with a medallion, leather bracers, a scabbard on the left
hip, an apron, a straw hat, a hood, and four hair styles. Two materials per person (matte cloth
double-sided for the garment shells, semi-gloss metal for fittings), everything merged into the
per-bone buffers — about ten meshes for an unarmoured villager, fifteen for an armoured guard.

### `presentation/buildingSkin.ts` (extended)
From a smoothed roof surface to an architectural kit:
- roof pitch exaggerated from the canonical courses, eave oversail from the style pack, corner
  upsweep where three of the four cells around a vertex are outside the roof;
- per-vertex normals from the roof's own height field, so a shallow pitch stops reading as a
  staircase of facets;
- ridge cap cylinder with a round emblem at each end;
- exposed rafter tails and a fascia board along every eave edge;
- gable ends closed in a darker boarded infill;
- timber frame — sill, mid rail, head plate, corner posts and intermediate posts — with plaster
  infill panels, emitted only where the canonical wall cell is actually solid;
- a stone plinth under the footprint and a raised plank veranda on the doorway face, positioned
  from the canonical `Place.door`;
- a hanging curtain of three panels with an emblem, on a timber rail over the doorway;
- banner poles, and stone lanterns flanking temple and hall entrances;
- shoji lattice windows (a fine grid of muntins over a warm translucent panel) replacing the
  earlier mullioned window;
- box lanterns with a pyramid cap replacing the earlier lantern;
- market awnings retuned and muted toward the settlement palette.

## How canonical state maps to the new presentation

| canonical fact | visible result |
| --- | --- |
| `Person.occupation` | `AttireRole` → garment layers: an artisan gets a short robe and an apron, a guard gets lamellar and a sword, a priest a long robe with wide sleeves, a labourer a short kilted robe and a straw hat |
| `Person.wealth` | brightness of metal fittings; whether a medallion is worn at all |
| `Person.gender` / `age` | hair style, sleeve flare; children never get armour or a blade |
| `Appearance.skin/hair/shirt/pants/build/height/beard` | skin, hair and beard colour directly; shirt/pants tint the robe and sash; build and height scale the rig |
| `Body.pose` (+ `WorkStyle` from the active canonical `Action`) | the animation branch — idle, walk, run, haul, sleep, sit, eat, drink, pray, talk, work, chop, quarry, attack, hit, dead |
| `Body.vel` | gait speed and stride amplitude |
| `Body.lastHitAt` / `lastAttackAt` | hit flash on that person's own materials; swing timing |
| carried `Item.type` | what appears in the right hand |
| `Place.type` | `BuildingArchetype` → roof depth, whether there is a veranda, a curtain, a banner pole, stone lanterns |
| `Place.bounds` | footprint, plinth, wall planes, roof mask |
| `Place.door` | which face gets the veranda, where the curtain and the step go |
| canonical roof/wall block substance | thatch vs tile roof treatment; boarded vs plaster infill |
| `grid.doorStates` | the door leaf swings |
| `World.placeAt` → v0.10.1 `RevealBox` | the roof mesh for that one building hides |
| felling / harvesting / crop growth | unchanged from v0.11 — cells change, skins rebuild |

Presentation remains strictly downstream: every one of these is a read, and nothing in
`presentation/` writes to a `Person`, a `Body`, a `Place` or the grid.

## What still uses the old voxel renderer

Interior furniture and fixtures (beds, tables, chairs, counters, barrels, bookshelves, anvils,
ovens, altars, gravestones, crates, signs); wall and floor block volumes underneath the new frame;
chimneys; torches; wells; water; the mill's sails; resource-node stone clusters at the quarry;
construction-in-progress and extraction effects. Loose world items are merged geometry with a
shared standard material but remain simple props.

## Preserved

Elevated ARPG camera as default, camera-relative movement, wheel zoom and middle-drag turn,
first/third person (F2), observer overlay (F6), Inspector (F3), event feed (F4), inventory (I),
dialogue, trade, buying, theft, gifting, hauling (G), combat, player embodiment, save/load, the
ownership-aware interaction HUD, and per-building interior reveal. Interaction targeting was never
mesh-based — it raycasts the canonical grid and tests canonical body/item positions — so none of it
depends on how the world is drawn.

## External assets

**None.** No models, textures, fonts or other art were downloaded, imported or copied. Every
texture is generated procedurally on a 2D canvas at boot (`presentation/textures.ts`) and every
mesh is generated procedurally from canonical state. The supplied reference images were used only
as visual reference to derive the specification at the top of this document; no pixels from them
are in the repository or the build.

## Performance

Measured in the real client (the in-app browser, real GPU), seed 918271, standing at the village
well with the elevated camera at distance 20:

| | |
| --- | --- |
| GPU render submit (30 renders, `gl.finish()` fenced) | **2.84 ms** |
| draw calls at that vantage | 338 |
| triangles | 172 k |
| geometries / textures | 326 / 25 |
| character rigs live | 33 |

Across the wider screenshot vantages the scene peaks around 540 draw calls and 262 k triangles.
For comparison, v0.11 measured 6.9 ms median **full frame** at 323 draw calls in the same browser;
the two numbers are not directly comparable (full frame vs render submit), but the draw-call and
triangle growth from the new character layers and architecture kit is modest and the render cost
sits far inside a 60 fps budget. The simulation step is untouched, so its cost is unchanged.

Caveat, stated plainly: the headless Playwright harness used for screenshots reports ~700–1100 ms
frames because Chromium falls back to SwiftShader software rendering there. Those numbers are an
artefact of the capture environment, not of the renderer, which is why the measurement above was
taken in the real client instead.

## Known limitations

- The temple archetype's second roof tier produced broken geometry on the shapes this world's
  generator actually makes, and is **disabled** (`upperTier: false`). The chapel currently reads as
  a larger version of the village style with stone lanterns and a banner, not as a tiered temple.
- Roof mask boundaries are jagged where the canonical footprint is, so the eave line zigzags
  slightly on irregular buildings; the overhang offset is computed per vertex and not smoothed
  along the boundary.
- Ridges are rounded by the corner-averaging and covered by the ridge cap rather than being a
  crisp fold.
- Interiors remain markedly flatter than exteriors — furniture is still cubic.
- Quarry resource nodes are still bright white `StoneBrick` cubes, which clash badly with the
  retuned palette.
- Characters read well in silhouette but are soft up close: the robe is a single flared shell
  rather than separate overlapping panels, and there is no cloth simulation, so garments do not
  swing independently of the bones they hang on.
- Only one culture pack exists. The seam is real and exercised, but it has never been proved by a
  second pack actually being written.
- No LOD and no instancing for distant characters or foliage.

## Verification

- `npm run typecheck` — clean.
- `npm run build` — clean.
- `npm test` — 477 tests, 49 files, all passing (the simulation is untouched; this is the guard
  that says so).
- `npm run test:browser` — see the report accompanying this branch. The v0.10.1 interior-reveal
  spec, which asserts against the geometry actually drawn, is the load-bearing one.
- Real-client visual inspection and the screenshots in `docs/v0_12/`.
- Real-GPU performance probe as above.

Not run, by the milestone's stated verification budget: WorldLab, seed sweeps, long simulation
audits, deterministic campaigns.

## Is this approach suitable for expansion across the full game?

Yes, with one qualification. The load-bearing structure — canonical state → culture-free
archetype/role → style pack → procedural geometry — held up under a real art-direction target: the
entire look of the village changed by editing one descriptor file and the two skins that consume
it, with no simulation change and no new canonical state. Occupation-driven attire in particular
scaled for free across the whole 32-person cast.

The qualification is that the building kit is still deriving a *shape* from voxel courses that were
never authored with that shape in mind, which is why irregular roofs and the temple tier are the
weak results. The next step for architecture is to let the style pack propose the roof form from
the canonical footprint and archetype directly, using the courses only for height — rather than
smoothing whatever the generator happened to stack. Characters need no such change; they need
overlapping garment panels and more hair/face variation, both of which are more of the same work.
