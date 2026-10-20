# Reachable universe destinations

The campaign uses its saved world seed. A fresh realm host defaults to **918271**;
the successful isolated presentation journey used **20261017**. Changing a launch
environment variable does not replace a loaded campaign's seed.

## Starting worlds

Both seeds start in system address `0`, **Cinderveil Expanse**. Planet indices are
zero-based; the numbered suffix in a display name is one-based.

| Seed | Planet index | Name | Terrain family | Radius (metres) |
| --- | ---: | --- | --- | ---: |
| 918271, fresh campaign default | 0 | Cinderveil | temperate | 1600 |
| 918271 | 1 | Nacrefall 2 | desert | 1347 |
| 918271 | 2 | Astraward 3 | glacial | 1945 |
| 918271 | 3 | Ardenreach 4 | volcanic | 1145 |
| 20261017, journey fixture | 0 | Cinderveil | temperate | 1600 |
| 20261017 | 1 | Thalehollow 2 | glacial | 2374 |
| 20261017 | 2 | Vesperspire 3 | volcanic | 1571 |
| 20261017 | 3 | Vesperrest 4 | oceanic | 2220 |

Cinderveil retains the existing home geography and maps the **Cinderveil (Brass
& Thorn)** and **Aether Reach** town patches onto the sphere. These are the existing canonical
settlements and their geometry, not separately generated inhabited planets.
Ordinary town interaction, combat, doors and Tower operations resume through the
explicit town Return transition with the same Person and Body. See
[the settlement adapter](../src/sim/world/universe/settlements.ts).

## Address space and travel limits

The version-1 generator accepts **65,536 system addresses**, `0` through `65535`,
with four to six planets per system. A read-only enumeration of descriptor counts
on 20 October 2026 gave:

| Seed | Four-planet systems | Five-planet systems | Six-planet systems | Total planet addresses |
| --- | ---: | ---: | ---: | ---: |
| 918271 | 21,675 | 21,938 | 21,923 | 327,928 |
| 20261017 | 22,005 | 21,774 | 21,757 | 327,432 |

These are deterministic **seeded addresses**, not that many authored, individually
playtested worlds. IDs such as `u1:918271:s0:p2` are unique addresses; display names
can repeat. Five terrain families, bounded naming fragments and a shared static
asset pool supply variation. Runtime generation is sparse, with a 64-system cache;
it does not construct this whole list when playing.

The chart accepts a system address; it is not restricted to the next system.
**Vessel warp is an explicit discontinuous transition** to the destination's first
planet at 1,800 metres above its sea sphere. It requires vessel flight outside the
nearest atmosphere plus 120 metres. There is currently no vessel fuel mechanic.
Continuous ground/sky/space movement is within one system. Personal magical flight
cannot warp between systems; assisted routes require the character's learned lift,
ward, equipment, physiology and reserve budget. A new character is not granted the
strong flight capability used by the journey fixture.

Planets have fixed centres, radii and sampled surface relief. There is no orbital
simulation, seamless interstellar travel, procedural inhabited society on every
planet, cave volume, resource extraction economy or deformable terrain in this
slice. [Generation](../src/sim/world/universe/generation.ts),
[vessel traversal](../src/sim/world/universe/travel.ts),
[personal flight](../src/sim/world/universe/personalFlight.ts) and
[capability formulas](MAGICAL_FLIGHT.md) define the implemented limits.

## What was actually visited

The current integrated release at `4cde1b4` completes the
[53-check journey](evidence/universe-release/verified-run/RESULTS.md): ordinary
home-town walking/departure, personal flight to Vesperspire3, landing/reload, home
landing and town return, with zero HTTP/browser errors. The same body, inventory,
discoveries and original parked vessel survive. Exact host restart and final-head
CI remain separate gates in [the release record](UNIVERSE_RELEASE.md).

The earlier [verified campaign journey](evidence/presentation-quality/verified-run/RESULTS.md)
visited Cinderveil and Vesperspire 3, landed/reloaded, flew home and returned to town.
It passed 51 checks plus a separate 17-check restart follow-up. The earlier
[standalone explorer](evidence/universe/RESULTS.md) exercised system-1 warp and
return; that evidence predates canonical campaign integration. Neither establishes
all-address navigability or all-world visual acceptance.

The later [contact pass](evidence/presentation-quality/contact-pass/first-run/RESULTS.md)
measured home-town feet and restored checkpoint 10649. It did not complete a new
flight journey. Its slope planting and departure-harness limitations remain
explicit, as do the camera/flight presentation limits in the earlier reports.
