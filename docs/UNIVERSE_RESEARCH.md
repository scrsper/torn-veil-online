# Universe generation and traversal research

Date: 2026-10-19. Scope: public technical descriptions and observable mechanics,
translated into original Torn Veil code. No proprietary source or assets are used.

## Documented No Man's Sky techniques

- Hello Games' Innes McKendrick describes a continuous real-time pipeline from voxel
  world generation through polygonization, texturing, population and simulation.
  [GDC 2017: Continuous World Generation](https://www.gdcvault.com/play/1024265/)
  and [the official GDC recording](https://www.youtube.com/watch?v=sCRzxEEcO2Y).
- Hello Games describes seamless flight from one planetary surface to another.
  [Official overview](https://www.nomanssky.com/about/).
- Sean Murray describes mathematical generation of realistic and alien terrains,
  and the challenge of testing enormous generated environments with a small team.
  [GDC 2017: Building Worlds Using Math(s)](https://www.gdcvault.com/play/1024514/Building-Worlds-Using).
- The NEXT release notes specifically discuss approach terrain LOD, planet surfaces
  seen from space, navigability, biome palettes and resource variation.
  [Official NEXT update](https://www.nomanssky.com/en/next-update/).
- Worlds Part I describes dual marching cubes terrain meshing and GPU-driven
  environmental objects. Its notes distinguish visual/biome changes from underlying
  terrain and preserved base positions.
  [Official Worlds Part I update](https://www.nomanssky.com/worlds-part-i-update/).

These public sources establish architectural principles. They do not disclose all
algorithms, parameters, streaming budgets, flight laws or network protocols.

## Torn Veil implementation choices

The following are our designs, not claims about hidden No Man's Sky internals:

- The canonical simulation owns versioned seeds, stable world addresses, ship
  movement, landing validity and visited-world state. The browser projects them.
- Request a system directly by its integer address; generate four to six planet
  descriptors on demand. There is no eager galaxy enumeration.
- Hash each generated field with a named key. Terrain, naming, orbital position
  and landing searches do not share a mutable random-number stream.
- A 64-system LRU reuses deeply frozen descriptors, preserving per-planet terrain
  and landing caches across simulation ticks. Eviction changes no generated result.
- Retain Cinderveil's radius, seed and existing terrain function. New worlds have
  independent Cartesian 3D noise, signed relief and biome-specific palettes.
  Using unit directions avoids latitude/longitude terrain seams.
- A common height function supplies geometry, surface normal and landing queries.
  Landing searches select dry, gentle natural terrain without changing it.
- Planet centers are system-local metres. Local terrain and ship/player clearance
  use planet-local metres. Sparse system addresses are separate from rendered
  coordinates; this avoids placing a full galaxy in float-precision scene space.
- Surface walking, launch, orbit, cruise, approach and landing belong in one
  authoritative traversal model. Client visuals must not establish arrival.
- Orbital meshes and local surface patches should sample the same height field,
  with bounded geometry and distance-based detail. Background population,
  deformation, caves and full voxel streaming are separate future capabilities.

## Acceptance boundaries

Generation tests cover stable random access, invalid addresses, unchanged home
geography, non-overlapping systems, geographic variety, seam continuity, outward
normals, safe landing and call-order independence. Rendering and host integration
need their own evidence; generator tests do not establish those behaviors.

This implementation is an initial universe geography and travel foundation. It
does not establish feature parity with No Man's Sky, autonomous civilizations on
every generated planet, a fully streamed voxel planet, or interstellar continuity.

## Canonical realm bridge

Schema 32 adds a version 1 `World.universeExpedition` binding. It references the
existing Person and Body, the universe seed, a vessel identity, a planar return
anchor, authoritative travel state, and transition receipts. Inventory, health,
rank, quest ledgers and retained Tower progress remain on their existing records.
The standalone universe preview save is never imported into this campaign binding.

The first integration used an explicit Veil gateway transition. The planar Body becomes
`present=false`, removing it from physical targeting and living-body indices.
Its retained planar coordinates identify the eventual arrival anchor. The
binding's travel coordinates identify its universe-domain residency; those
coordinates are never passed to planar collision or perception. Returning requires
a real surface landing on Cinderveil and proximity to the vessel, then restores
the same Body at the checked anchor. When a resident occupies that point, a
deterministic search can select supported, unoccupied ground within three metres,
using the ordinary movement sweep to reject paths through walls. The history keeps
both the requested anchor and actual arrival; fully obstructed arrivals are refused.
The town-to-globe gateway is not continuous
physical flight across the existing planar town geometry.

The existing RealmJournal is the sole persistence authority. Structural entry and
return use checked revisions, idempotency receipts and normal runtime rollback.
Travel input and every travel outcome replay as ordered realm operations. Three
existing 60 Hz realm steps advance one 20 Hz travel step; the partial cadence and
bounded input lease are saved. Realm simulation continues during the trip:
ordinary residents move and choose goals while the traveller is absent. The
canonical history records boarding, return, launch, landing, warp and collision
outcomes with the actual Person as actor. Repeated acknowledgements do not reset
the controller or recreate a transition.

Older schema 24–31 snapshots remain readable. A malformed universe binding never
licenses an absent canonical player, and an active universe binding cannot overlap
an active Tower or legacy expedition. Existing engine-fingerprint protection is
unchanged: a committed old snapshot can migrate, but an uncheckpointed journal tail
from different mechanics must be completed with its matching engine before upgrade.
Never discard that tail or modify the user's save to force a new engine to start.

The October 20 extension adds mapped settlement charts and actual source
collision, plus personal flight admitted by learned forms, equipped capacity
and finite body resources. These are Torn Veil designs, not recovered NMS
internals. Existing gateway saves keep their versioned coordinates. The new
mapped return uses actual supported town coordinates and facing; it does not
require proximity to the parked vessel.

Remaining residency limitations: the distant terrain has no ordinary NPC ecology,
combat, resource economy, survival exposure or item interactions yet. The absent
traveller now receives metabolism, breath/mana accounting and existing downed
recovery once per travel tick. Wounds and environmental/impact damage still
require domain-aware handling before claiming the same simulation coverage as
town. No food, inventory or progression rewards are granted by travel. The vessel currently has no fuel,
construction, ownership transfer or damage model. Interstellar warp remains an
explicit authored transition between generated system addresses.
