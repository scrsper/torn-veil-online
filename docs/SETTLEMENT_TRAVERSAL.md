# Canonical settlements on the home sphere

This slice places the existing Brass and Aether settlement geometry in the
spherical travel scene. It maps the retained character's location and reads the
live canonical grid for collision. It does not create replacement towns, NPCs,
Bodies, inventories or doors.

Ordinary NPC interaction, combat, door interaction, town navigation and Tower
entry still require returning to the town controller. The spherical scene is a
continuous geometry and locomotion integration, not yet a continuous world
social simulation.

## Coordinates and source ownership

`src/sim/world/universe/settlements.ts` owns the chart descriptors shared by
simulation and presentation. All mapped positions are home-planet-local metres.
The home planet centre is zero in system zero.

| Realm | Spherical anchor | Canonical chart origin | Canonical patch |
| --- | --- | --- | --- |
| Brass | `HOME_ANCHOR` | X `11312.5`, Z `3092.5`, floor Y `1` | X `11168..11456`, Z `2976..3264`, extended to the actual focused geometry bounds |
| Aether | `FAR_ANCHOR` | X `3120`, Z `3120`, floor Y `1` | X and Z `2976..3264` |

The Aether origin is the existing local `48,48` plus chunk offset `3072`.
Canonical planar X maps to negative chart east; Z maps to chart north. Radial
height is planet radius plus the six-metre home plateau plus canonical Y minus
one. Point projection and its inverse preserve source coordinates; direction
projection uses the same chart differential.

Settlement geometry points represent their actual source position. The travel
reference lies three radial metres above the character's feet. This shared
reference convention does not make the human hull three metres tall: the human
collision capsule has radius `0.3` and height `1.8`; the vessel has radius `3`
and height `6`.

`src/server/universeSettlements.ts` projects actual cached `RealmGrid` chunks,
the focused source plan and terrain, and current door states. It projects at
least chunks `31..33` in each realm and any additional chunks intersecting the
focused Brass bounds, with a bounded chunk budget. It never reruns a town
generator to produce an alternative layout. Returned descriptors are cloned so
a renderer cannot modify canonical cached geography. The client consumes these
patch descriptors instead of maintaining its own settlement rectangles.

## Host movement and ground contact

The pure settlement sweep uses the live `movementGeometryAt` source triangles
and `isSolidAt` voxel material queries, including current door state. It is
independent of GLB fetches, render distance, renderer disposal and camera origin.
Source geometry owns its authored columns; other columns use the existing voxel
world. Conservative capsule inflation accounts for chart compression.

Movement samples no more than 12 cm apart and refines the first obstruction
eight times. A query accepts at most 512 metres of motion, enough for the bounded
host tick rather than arbitrary teleport commands. Per-query caches do not
survive a door edit.

`settlementGroundAt` finds the actual source floor below the prior body feet,
allowing a step of at most 55 cm. `canonicalUniverse.ts` supplies this through
`TravelGeometry` to the ship and personal-flight integrators, command checks and
status queries. Consequently, a source floor below procedural terrain and an
upper floor above it remain valid ground. Each terrain sweep retains its prior
safe reference when resolving source support.

After the core travel step, `constrainUniverseSettlementMovement` checks the
actual source hull path. Ground walking retains its previous source height
before finding support at the next horizontal point. Flight can travel above
roofs or beneath ceilings without requiring a floor at every sample.

A terrain touchdown remains provisional until source support and headroom pass.
The adapter withdraws a provisional landing in a settlement patch, preserves
the prior personal-flight record and its accumulated costs, and supplies a
source-validated landing candidate. The canonical host then applies the one
accepted touchdown, discovery and causal event. The adapter does not manufacture
events or grant flight abilities.

## Same character, explicit controller boundary

New continuous-surface entry uses the actual canonical Body feet and facing.
The retained Body remains the identity and resource owner during spherical
travel, with its planar presence disabled. Its inventory and Person are not
copied. Host ticks advance travel and body resources through the canonical
runtime and journal.

Returning from spherical travel requires standing on actual valid source ground
inside either home settlement. Angular alignment from orbit is insufficient.
The host inverse-maps the current location, checks the ordinary movement
predictor and nearby occupancy, and resumes the same Body in town. A blocked
return remains blocked; an orbital position is not projected down to a town.

While spherical travel is active, the ordinary planar action APIs remain fenced.
The source towns continue to exist, but spherical player-to-NPC interaction and
combat are not implemented by this adapter. A projected door reflects its
canonical state; clicking it in the spherical scene does not yet operate it.

## Save compatibility

Settlement collision is enabled only by `TravelState.settlementRevision: 1`.
An absent field preserves the previous expedition geography and physics.
Existing saved expeditions are not silently opted into this mapping. The
canonical continuous-surface entry path owns opt-in and eligibility.

`settlementSaveValidator` is a pure callback over the same live source grid.
Within the home patches it validates support, headroom and hull clearance.
Grounded references must be within 1.5 cm of actual support. Personal flight
uses the human hull, vessel flight uses the vessel hull, and a parked vessel is
validated independently. Flight beneath all source floors is rejected. Other
systems, positions outside the patches and high orbit delegate to the existing
terrain validator.

Inactive body coordinates and departure receipts are historical records, not
current occupants of a door. Historical support uses walking's 0.55 m search
window, then requires the resolved feet height to agree within 0.015 m. Active
body and parked-vessel checks still require present physical clearance. The
departure position must equal its retained entry receipt.

Replacing ordinary town geometry with focused geometry is refused while a
mapped expedition binding is retained, even after return. The old history and
parked vessel cannot be assumed valid in replacement geometry. This guard
executes before mutation; existing focused worlds and legacy gateway migrations
retain their previous behavior.

This extension does not change Atlas placement identity: Atlas revision and
catalog content hash remain separately pinned. Source assets still need the
ordinary canonical provenance and persistence checks; a client-loaded model
cannot authorize new collision or a saved location.

## Regressions and evidence

The following defects were addressed during implementation:

- A procedural-ground clamp could finish a landing above an actual source floor
  40 cm below it. The live source-ground callback now participates in the core
  integrator, and the post-step adapter validates the final touchdown.
- Walking on an upper floor could be reset to procedural ground before collision.
  Support resolution now carries the prior source height.
- A provisional personal touchdown could discard its flight record and duplicate
  a land event before source validation. The adapter restores the prior record
  and the canonical host records the accepted outcome once.
- Projecting a position by angle alone could hand an orbiting body into town.
  Return mapping now requires supported source ground and clearance.

The focused verification command is:

```text
npx vitest run tests/atlas-placement.test.ts tests/universe/settlements.test.ts tests/universe/settlementHost.test.ts
npx tsc --noEmit
```

The scoped test run on 2026-10-20 passed 28 tests: nine Atlas placement/collision,
five pure settlement and fourteen settlement host tests. The settlement tests
cover exact point/direction charts and patch boundaries, live doors, a
high-speed wall crossing, source floors and headroom, projection isolation,
legacy opt-out and return mapping.

Seven of the host cases exercise the actual `RealmRuntime`: walking, ship
descent and ability-backed personal descent at source Y `0.6` and Y `8`, plus
powered ascent stopped by a roof underside. They verify final supported
positions, one landing event, the retained Body, independent vessel clearance
and actual mana expenditure. Test flight abilities are learned through the
normal source mechanism before entry; no gameplay capability is granted by
these adapters.

These tests use bounded canonical geometry fixtures and do not establish
exhaustive collision coverage for every authored asset. Browser and campaign
journey evidence belongs in the current evidence report. Remaining work includes
the spherical interaction/combat bridge, live NPC presentation, direct door and
Tower interaction, and broader source-scene route certification.
