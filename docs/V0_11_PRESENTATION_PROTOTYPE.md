# v0.11 — Presentation Prototype: a grounded fantasy ARPG look over the same canonical world

**Status:** prototype / vertical slice. Not merged. Presentation-layer only — no simulation code
was added, removed or changed in this milestone.

## What this is

Torn Veil's simulation was never the problem; its *presentation* was. The client drew every
substance in the world as a cube, every person as a stack of boxes, and every surface as a flat
vertex colour, so a deep social simulation looked like a voxel sandbox. This milestone rebuilds
the presentation layer so the same world reads as a grounded fantasy ARPG, and does it without
moving a single coordinate, block or decision into the renderer.

The rule the whole milestone is built around, from Constitution §46 and AGENTS.md:

```
canonical simulation state          →  presentation descriptor  →  renderer
VoxelGrid / Place / ResourceNode /     style.ts channels +          terrainSkin, foliageSkin,
Body.pose / CropPlot / doorStates      material families            buildingSkin, humanoid,
                                                                    VoxelRenderer
```

Presentation is downstream. Every skin reads canonical state every rebuild and caches none of it.
`src/sim/` is byte-for-byte unchanged.

## The architecture

### One owner per cell

`src/game/presentation/style.ts` is the new descriptor layer. It maps each canonical block id to
exactly one **presentation channel** — who draws it — and one **material family** — how it looks:

| channel | who draws it | which substances |
| --- | --- | --- |
| `terrain` | `terrainSkin.ts` | grass, dirt, stone, sand, snow, mud, gravel, path, cobble, farmland, mossy stone |
| `foliage` | `foliageSkin.ts` | logs, leaves, bushes, tall grass, flowers, the whole crop lifecycle, hay, pumpkins |
| `architecture` | `buildingSkin.ts` | glass, doors, fences, lanterns |
| `voxel` | `voxel/mesher.ts` | everything genuinely block-shaped: walls, floors, furniture, fixtures, water |

`BuildingSkin` additionally claims cells *dynamically* — the roof shell and gable ends of each
building — and publishes them through `claimedCells()`, which `VoxelRenderer.setSkinned()` reads
as air. Because ownership is exclusive by construction, no cell is ever drawn twice and none is
silently dropped.

Adding a better look for a substance is a row in `style.ts` plus a case in one skin. Nothing else
changes, and the simulation never learns about it.

### The skins

- **`terrainSkin.ts`** — reads the canonical height field (topmost `terrain`-channel cell per
  column) and drapes one continuous corner-averaged mesh over it, with normals from the field and
  per-vertex slope blending toward each substance's sub-surface colour. A hillside becomes a
  hillside; the village plateau stays exactly flat. Split into `ground` and `rock` draw groups so a
  cobbled square and a grass verge are different materials.
- **`foliageSkin.ts`** — turns log/leaf cells into real trees: a tapered, leaning, root-flared
  trunk plus either stacked conifer tiers or overlapping broadleaf masses, sized from the canopy
  cells the world generator actually placed. Crops, grass, flowers and bushes become clumps of
  procedurally bent blades. All of it sways in a vertex shader driven by canonical wind. A log
  column with no canopy is a mill post or a bridge pile, not a tree, and is drawn as a timber post.
- **`buildingSkin.ts`** — the staircase gable becomes a pitched roof by applying the *same*
  corner-averaging trick to the roof's height field, with a 0.42-unit eave overhang, a fascia, a
  gable-end skirt in the wall material and a ridge beam. Plastered and planked walls get exposed
  timber framing (sill, mid-rail, top plate, studs) emitted only where the canonical wall cell is
  actually solid. Glass cells become framed, mullioned windows; door cells become hinged leaves;
  lantern cells become iron-framed lanterns; market-stall canvas becomes a pitched, valanced awning.
- **`humanoid.ts`** — a ~7.5-head proportioned figure with a segmented spine, shoulders, elbows,
  hips, knees and feet, built from tapered solids. Ten merged meshes per person, one material,
  all colours baked into vertex colours — *fewer* draw calls than the old cube figure.
- **`textures.ts`** — every texture in the game is generated at boot on a 2D canvas: a greyscale
  height field per material family turned into a subtle albedo modulation and a normal map. No
  external art assets were used or downloaded.
- **`worldSkin.ts`** — the orchestrator. Owns the one shared thing: the canonical dirty-chunk set.

### How canonical state reaches the screen

| canonical fact | how it becomes visible |
| --- | --- |
| a person walks / works / sleeps / prays / eats / hauls / fights | `Body.pose` (+ `WorkStyle` from the actor's active canonical `Action`) selects an animation branch in `HumanoidRig.animate`. Unchanged contract: the rig reads pose, nothing writes it back. |
| a tree is felled (`extractFromNode` clears its cells) | those cells become air → chunk dirty → `FoliageSkin` rebuilds → the tree is gone, and a stump appears |
| a tree node is `regrowing` | `WorldSkin.rebuildStumps` reads `ResourceNode.state` and draws a sapling on the stump |
| a crop plot advances (`cropBlockFor`) | seedling → sprout → standing wheat with grain heads → stubble, as different plant geometry |
| a door is opened (`grid.doorStates`) | the door leaf swings, every frame, from `isDoorOpen` |
| a building is entered (`World.placeAt`) | v0.10.1's `RevealBox` still drives the mesher, and now also hides that one building's roof mesh |
| terrain is edited | the height field is recomputed for the dirty chunk and its neighbours |
| wind / weather | foliage sway amplitude |
| light-emitting blocks | unchanged: `Atmosphere` reads `BlockDef.light` off the grid exactly as before |

## What is still the old voxel renderer

Deliberately, because these are genuinely block-shaped or out of scope for a bounded slice:

- interior furniture and fixtures (beds, tables, chairs, counters, barrels, bookshelves, anvils,
  ovens, altars, gravestones, crates, signs) — now textured and lit properly, but still cubes;
- walls and floors — still block volumes (correctly, they *are* the structure), but re-materialled
  and now wearing timber framing and real openings;
- chimneys, torches, wells, hay bales in bulk, water;
- the mill's sails and other bespoke structures;
- clouds are rounded masses now, but weather particles are unchanged;
- loose world items got merged geometry and a shared standard material, but remain simple props;
- construction-in-progress visuals and extraction effects (`constructionRenderer`,
  `extractionEffects`) are untouched.

## Preserved

Camera-relative movement, the elevated ARPG camera as the default, wheel zoom / middle-drag turn,
first- and third-person (F2), the observer overlay (F6), the Inspector (F3), the event feed (F4),
inventory (I), dialogue, trade, theft, gifting, hauling (G), combat, player embodiment, save/load,
per-building interior reveal, and the ownership-aware interaction HUD. Interaction targeting was
never mesh-based — it raycasts the canonical grid and tests canonical body/item positions — so
none of it depended on how the world was drawn.

## Performance

Measured in the real client, seed 918271, standing in the village square, elevated camera at
distance 20, 1280×760:

| | |
| --- | --- |
| median frame | **6.9 ms** (~145 fps, vsync-capped) |
| p95 frame | 8.0 ms |
| draw calls | 323 |
| triangles | 159 k |
| textures | 25 (all generated at boot) |

The chunk mesher now emits far less geometry (terrain and vegetation left it entirely), which
roughly pays for the new skins. No frame-rate regression was observed anywhere in the village.

## Known limitations

- The drawn ground is the smoothed average of the four columns under a person's feet, so on a
  slope it can differ from the canonical integer surface height by up to half a block. Flat ground
  — the whole village plateau — agrees exactly. Collision and navigation are unaffected.
- One `Place` in seed 918271 ("the Fletcher house") has no structure in the grid at all, so no roof
  is skinned for it. That is the plan step correctly declining a shape it cannot read.
- Roof ridges are rounded by the corner-averaging rather than crisp; a ridge beam covers the seam.
  It suits thatch better than tile.
- Buildings with unusual roofs (the mill) are skinned by the generic algorithm and are the least
  convincing results.
- Interiors are noticeably flatter than exteriors — furniture is still cubic.
- No LOD, no instancing for distant foliage, no frustum-aware skin rebuilds. Fine at this world
  size; would need attention before the world grows much larger.

## Verification

- `npm run typecheck` — clean.
- `npm run build` — clean.
- `npm test` — 477 tests, 49 files, all passing.
- `npm run test:browser` — 10/11 passing, including the v0.10.1 interior-reveal spec, which asserts
  against the geometry actually drawn. The one failure (`crop states differ and player harvest/sow
  use the canonical path`) **also fails on `main`** at the same assertion and is not a regression
  from this work.
- Real-client visual inspection and the screenshots in `docs/v0_11/`.

Not run, by the milestone's own verification budget: WorldLab, seed sweeps, long simulation audits,
deterministic campaigns.

## Is this approach suitable for the whole game?

Yes. The load-bearing idea — *a presentation adapter that re-reads canonical cells and emits
non-cubic geometry* — turned out to be both cheap and general. The corner-averaging surface builder
serves terrain and roofs from the same code; the channel table means converting the next substance
is a row plus a case; and because the grid stays canonical, everything the simulation already does
to the world (felling, harvesting, building, digging) shows up for free. The parts that would need
real thought before scaling are LOD and rebuild granularity, not the architecture.
