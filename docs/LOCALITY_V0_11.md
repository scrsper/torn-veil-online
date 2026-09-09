# Locality: a place is answered from somewhere

`world.places().find(p => p.type === X)` means **"the first place of this type anywhere in the
world"**. There were roughly thirty of those in `src/sim/`. In a one-village world every one of
them is right by accident; the moment a second settlement exists they all silently bind to
whichever village generation registered first, and four villages grind their grain at one mill.

This is that pass. It adds no content and changes no behaviour — same seed, same `stateHash`.

## The shape of the answer

`src/sim/world/locality.ts`:

- `nearestPlaceOfType(world, from, type)` / `nearestPlaceWhere(world, from, match)` — the place of
  this kind **nearest to where the question is being asked from**. Ties break by id. With no origin
  it returns the first match, so a caller with no locality behaves exactly as it did.
- `placesOfType(world, type)` — **all** of them, for the demand-raising passes. A bakery going short
  of bread is a fact about that bakery; a second village's bakery is not answered by raising a
  request against the first one registered.
- `whereaboutsOf(world, person)` — body, then workplace, then home. A question about somebody with
  no manifest body still has an answer, because where they work and live is canonical state that
  outlives any body.
- `placeNear(world, person, type)` — the ordinary form, and the one almost every caller wants.
- `withinErrandRange(a, b)` / `ERRAND_RADIUS_METRES` — how far an ordinary day reaches. Taken from
  the widest errand the village's own goals already undertake (the tree search for a construction
  project), not invented.

Straight-line distance decides in the hot path, which is what the world's other `nearest*` helpers
already use and is honest about being an approximation. Reachability over the navigator is the
correct long-run answer and **no signature has to change to get it** — the WorldLab invariant below
already checks these answers against real walkability at probe cadence, where it is affordable and
a per-tick query would not be.

**Deliberately not a settlement tag.** A `settlementId` filter is a label doing a mechanism's job —
the same inversion Adaptive Society deleted when it removed the `p.occupation === 'miller'` gate.
Distance and reachability are derived, are automatically right for N settlements, and let contact
between settlements eventually emerge from geography rather than from a flag being flipped.

## What was converted

Transforms resolve the place from the WORKER (`mill`/`bake`/`saw` in `world/metabolism.ts`,
`cook`/`tendTavernFire` in `world/cooking.ts`); `restockTavern` and `huntGame` from the keeper's own
post. Demand passes iterate every matching place (`world/production.ts`, `logistics/haul.ts`).
`world/construction.ts` resolves each producer from the site that needs the material, per project.
`mind/agent.ts`'s `tavernId()`/`squareId()`/`chapelId()` became `tavernFor(p)`/`squareFor(p)`/
`chapelFor(p)`; the graveyard from the mourner's home, the gate post from the guard's own
workplace. `mind/pursuit.ts` asks where THIS person would go to be among people.
`logistics/participation.ts` asks which well they are standing at. `history/summary.ts`'s lookups
stay world-global **by design** and say so: a run summary reports on the world, and when a run
contains more than one settlement those fields need per-settlement grouping, not a nearer answer.

## The finding the `find` was hiding

`CONSUMER_DEMANDS` is keyed by place TYPE, and a type is not always one place. Ashford has four
stalls; `find` happened to return the bread stall because generation registers it first, which is
not a reason for anything. Asking every stall instead had the vegetable, grain and hunter's stalls
all demanding bread.

So a consumer is now asked whether it **deals in** the resource at all, from canonical facts rather
than a slug or a name: it already holds some, or somebody who works it plies a trade that makes or
needs it (`world/supply.ts`), or **it has a hearth and the resource burns** (`world/fire.ts`'s new
`isFuel`). That third clause is not decoration — leaving it out silently stopped the tavern's hearth
ever being supplied with kindling, and with it the cook's stew. With all three, exactly the places
the old `find` returned qualify, which is why the state hash is unchanged.

## Person scans

`mind/agent.ts` counted guards, choppers and gatherers across the whole world. The chop and gather
caps exist so one shed does not put the whole village in the woods; counted world-wide, a
woodcutter in one settlement would silently ration another's, so they are scoped to the project's
own locality. Watchmen are filtered to those within errand range — and `nearestKnownGuard` lost its
third fallback, the guard's **live body position**, which was omniscience with no provenance at
all. Where they are is now what this person believes: their own `loc:` knowledge, or the watchman's
workplace, which is as public as the guardhouse door.

## The invariant, proven before it is relied upon

`headless/worldlab/invariants.ts`'s `locality-of-commitments` checks, for every living person, that
every place and person their work post, goal, plan steps and claimed haul tasks resolve to is
(a) in the same connected region of walkable ground they live on and (b) within an ordinary day's
reach of it. It holds across the smoke tier today, in a world where it is trivially true — which is
the point: it is what will fail loudly the first time a second settlement is generated and
something still reaches across the map.

Two things were measured and corrected while building it, and both are worth keeping in mind for
the multi-settlement work:

- **Asking `findPath` per commitment asked the wrong question.** A `provide` goal targets where a
  person is standing this instant, and somebody standing on the rim of the village well occupies a
  walkable island (floor height 19 against the village's 14) that A* will not route to. It reported
  that Elder Godwin could not reach Rowan Ashford, ten metres away in Godwin's own square. That is a
  real property of the world — the goto fails, `stuck_agent` already watches for it — and it is not
  a locality violation. Locality is about which connected piece of ground you are on, so one flood
  fill over the navigator's own walkability replaced the per-pair path query: exact, immune to an
  A* iteration budget, and one pass per probe instead of a search per commitment.
- **The islands are on both sides.** A house's own `inside` is sometimes a raised tile too (seed
  1337: Maud Penny's, floor height 16), so judging her from that one cell said she could not walk to
  her own square. Two positions are in one locality when the ground *around* them shares a region.

`tests/locality.test.ts` (10 tests) asserts the helpers answer from where they are asked, and — the
half that matters — that the invariant is **not vacuous**: it fails on a work post resolved in
another settlement, on a goal somewhere unwalkable, and on a haul raised across two settlements,
while staying silent about a stallholder whose counter is a walkable island.
