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
