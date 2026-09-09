# Procedural settlements

`generateVillage` remains the authored Ashford Vale regression scenario and the browser default. `generateProceduralWorld` creates several societies in one canonical `World`, with one simulation, clock, entity registry, and physical coordinate space. It requires an empty world and returns each site's specification and generated entities.

## Generation

`src/sim/world/settlementSpec.ts` derives a local seed from the complete `(world seed, site ID, x, z)` tuple. Site ordering does not change generation. A local RNG generates terrain parameters, resource capacities, economic composition, households, names, family structures, and historical obligations. Runtime simulation uses the existing world RNG streams.

The consumption basket expands through `supply.ts`'s occupation/process inputs and outputs. Resource capacity changes producer counts; woodland and dryland support different production mixes. Couples, singles, children, and occasional older parents form households. Child ages respect the canonical human fertility ranges. Historical births, marriages, debts, and disputes become canonical events, relationships, memories, knowledge, and monetary transfers.

`src/sim/world/settlement.ts` fits seeded plots with foundation and clearance checks, then uses the existing structure builders. Housing capacity follows household size. Workplaces, fields, trees, stone, stocks, tools, schedules, and local geography knowledge are initialized through existing systems. Walkable local paths connect the generated settlement; no paths connect settlements.

`RegionalGrid` stores dense inhabited patches over lazily evaluated, continuous wilderness. Sparse navigation preserves physical coordinates, including coordinates beyond signed 32-bit range. The default four sites are one billion metres apart. At ordinary walking speed and the existing 60x world clock, even uninterrupted walking would take more than 500 world years. There is no settlement membership test that disables interaction. Food, energy, terrain, movement, and ordinary destination discovery still apply.

Each settlement is a canonical `Settlement` entity with a stable slug, World-scoped ID, site ID, local seed, location, bounds, former inhabitants, and a population ledger. Buildings reference it through `settlementId`. Population, habitation, households, stocks, and bottlenecks are derived from canonical residence and items. Birth/death events and residence changes maintain the observational ledger; no simulation decision reads it. Peak population and depopulation dates are derived from that ledger. The founding date is null when no founding event establishes it; `createdAt` records the earliest generated physical evidence without pretending that this proves an exact founding date.

Saves retain settlement entities, the site recipe, physical places, and voxel edits. Empty settlements and former inhabitants are retained. Loading regenerates terrain/buildings and restores canonical state. Existing Ashford saves retain their original generation path. The sparse regional grid is currently a headless simulation facility; browser rendering remains on the authored dense-grid scenario. Entity IDs remain scoped to their owning World; no global singleton or universe count is introduced.

## Locality audit

| System | Physical/local knowledge constraint |
| --- | --- |
| Marriage and conception | Present bodies must be together; sharing a world is insufficient. |
| Conversations and perception | Existing spatial hearing/perception and communication reach remain authoritative. |
| Civic destinations, pursuits, food discovery | Local geography knowledge plus bounded daily search; remote known food does not become a daily destination. |
| Work and economic production | Resolve the person's local workplace; process every applicable local workplace rather than the first world-wide match. |
| Cooking and stock limits | Count the relevant local supplies and consumers. |
| Hauling and construction | Match local suppliers, destinations, producers, projects, and competing labour. |
| Gathering, dropped items, commerce | Existing bounded resource/item discovery and physical action reach remain in use. |
| Ownership and relationships | Shared-world probes check owners, destinations, relationship links, and emitted events for cross-site leakage. |

`locality.ts` centralizes the 256-metre daily discovery range and physical co-presence helpers. These bounds constrain ordinary local activity, not eventual world travel. The test's site labels are diagnostic only. No trade, migration, war, diplomacy, or long-distance exploration system is introduced.

## Verification and performance

```sh
npm test -- tests/procedural-settlement.test.ts
npm run settlements:accept
npm run world:settlements -- --seed 42 --days 7
npm run world:settlements -- --seed 42 --days 30
npm run world:settlements -- --seed 42 --days 90
npm run world:settlements -- --seed 42 --years 1
# Explicit coarse/epoch experiment, not detailed acceptance:
npm run world:settlements -- --seed 42 --years 5 --epoch
```

Fast tests cover 24 specification seeds and 16 materialized settlements, family/economic validity, structural variation, plot access, determinism, remote-discovery rejection, and procedural save/load. The acceptance test advances four settlements simultaneously for seven detailed days, repeats world seed 42, and compares world seed 43. It checks household, living-index, currency, ownership, destination, relationship, and event locality invariants. Reports include specifications, per-site histories, daily population/economic trajectories, annual total population, elapsed time, heap usage, and deterministic state hashes. The growth/extinction regression uses ordinary demographic mechanics with explicit initial conditions; it is a demographic subsystem test, not a detailed decades-long simulation claim.

Detailed acceptance now uses the established headless physical cadence of 0.15 seconds throughout, without switching cadence or disabling systems. Steps above 0.15 seconds are rejected in detailed mode. This is still distinct from the browser's 0.05-second physics cadence; equivalence between those numerical resolutions is not claimed. The previous five-second first-week / daily-rest benchmark is retained below only as historical coarse evidence.

### Epoch semantics audit

`Simulation.step` accepts a large delta; it does not subdivide it into the missed detailed steps. Calling the same function is therefore not proof of semantic equivalence.

| Mechanism | A 1440-physical-second epoch call (one world day) |
| --- | --- |
| Perception | Samples surroundings and drains stimuli once, rather than repeatedly along movement paths. |
| Cognition | At most one think per person; think budget is reset, not replayed for each missed decision. |
| Actions, navigation, combat, conversation | One action slice and one physics pass. Waypoint/action transitions and interaction opportunities are skipped; long movement/physics deltas change outcomes. |
| Physiology | One strategic call with 1440 accumulated minutes. Needs and reserves integrate a large delta against the current sampled pose/work/food state. Interleaved eating, resting and work are absent. |
| Social work and inference | One relationship/concern/pursuit/absence/inference maintenance pass with accumulated time, not all intervening decisions and evidence. |
| Economy, crops, hauling, fire, spoilage | One maintenance pass against endpoint state. Some rates integrate elapsed time, but intermediate state transitions and resulting actions are not replayed. |
| Weather | At most one due transition; intermediate weather changes and random draws are skipped. |
| Demographics | Each crossed day invokes daily maintenance, but multi-day jumps use the final clock and sampled physiological state for those invocations. |
| History and RNG | Different actions, opportunities and weather draws produce different events and RNG consumption. Compaction is storage maintenance, not reconstruction of the missing history. |

Epoch mode remains useful for experiments with simulation LOD. It has no demonstrated semantic equivalence to detailed simulation and is excluded from detailed acceptance claims.

### Detailed performance work

A Node CPU profile of seed 42, four settlements / 85 people, 0.250025 detailed days at 0.15-second steps took 31.378 seconds. Pathfinding accounted for roughly three quarters of sampled time; `sim.act` took 26.059 seconds. Sparse navigation used a JavaScript Proxy for every cell access and repeated unchanged failed searches.

Numeric Map access and bounded exact path-result caching reduced the same run to 5.732 seconds. Cached paths are copied before returning; failed paths are cached too; all navigation surface rebuilds invalidate the cache. Search budgets, A* ordering, decisions, physics steps and RNG calls are unchanged. After adding physical indexes the run took 6.145 seconds, still about 5.1x faster than baseline. All three runs had exactly the same canonical state hash (`a1460b9ceb6f32740cc12caef98b7db4a2bc1194bd8a7cee556e19fdce85fd56`).

Physical spatial indexes now bound perception, body separation, place lookup, local civic searches, and apprenticeship candidates. A place/item index removes repeated global stock scans. Index maintenance follows ordinary canonical assignments, including in-place coordinate changes and save overlays; tests cover movement across distant buckets and preserved ordering. The indexes do not partition the simulation or disable interaction. At this population their maintenance overhead does not beat navigation-only wall time, but distant entities no longer inflate those per-person candidate scans. Remaining detailed costs are primarily cognition and perception: the navigation-only seven-day run spent 40.0 seconds thinking, 27.9 perceiving, 16.1 acting, and 9.5 in strategic upkeep, out of 97.3 seconds total.

Full reports are written to `.debug/settlements/`; the acceptance filenames distinguish the first run, replay, and other seed. Wall-clock timing and heap measurements are excluded from determinism hashes. The digest covers entities, events, simulation queues/resources, RNG positions, physical edits, and clock state; it is not a substitute for every historical/epistemic acceptance suite.

### Detailed acceptance: 9 September 2026

[Detailed measurements](procedural-settlement-detailed-benchmark.json) contain the profile comparison, seven-day first/replay/other-seed results, daily local trajectories, and invariant results. At 0.15-second physical steps, seed 42 took 116.20 and 119.92 seconds for seven days; both ended with 85 people and identical state hash `1913590fb70a02fefa47b1eb15b3cc6b0632cab7c2b52d2a92a193fcc951459c`. Seed 43 took 91.42 seconds, ended with 76 people, and had a different hash and economic/history trajectories. No monitored invariant failed. These runs overlapped other verification, so their wall times are not isolated performance measurements.

For seed 42, day-seven hungry counts were 6, 3, 8, and 2; grain stocks were 495, 457, 1112, and 1465; bread stocks were 30, 32, 9, and 22. Thus detailed stepping produces materially different outcomes from the historical mixed-cadence results below. Seven days produced no births or deaths in these seeds; birth/decline/depopulation support is proven separately by the canonical demographic continuity regressions, not inferred from unchanged population in this short run.

All 590 regression tests across 60 files passed, including authored Ashford, procedural generation, demographics, continuity, spatial mutation/save overlays, navigation cache invalidation, and conservation. The three-run detailed acceptance test also passed. Typecheck and build passed. Save/load preserves settlement identity and continuity; existing persistence still reconstructs active action plans, so uninterrupted action-by-action replay across a save boundary is not claimed.

A 30-day detailed attempt reached the logged day-21 boundary before being stopped at approximately ten minutes to honor the request to finish promptly. Its final report was not produced, so it is not counted as completed acceptance. The longest fully completed and inspected detailed run is seven days. Ninety days and one detailed year remain unvalidated; the rising cost beyond the first week makes them substantial further work, not an outcome to substitute with epoch stepping. This milestone does not claim long-horizon detailed throughput is solved. The short before/after hash comparison predates addition of canonical settlement entities; the later detailed acceptance hashes include those new entities and their ledgers.

### Historical mixed-cadence run: 9 September 2026

Machine-readable measurements and first-week snapshots: [procedural-settlement-benchmark.json](procedural-settlement-benchmark.json).

World seed 42 generated Grovemere, Juniperhaven, Valemere, and Lindenstead, with local seeds `3309673843`, `12791761`, `1723539047`, and `492011225`. The initial populations were 16, 25, 27, and 17; after five years they were 16, 24, 28, and 18. No monitored invariant failed.

| Settlement | First-week harvest events | First-week production requests completed | Bread at day 7 | Hungry people at day 7 |
| --- | ---: | ---: | ---: | ---: |
| Grovemere | 27 | 0 | 40 | 13 |
| Juniperhaven | 20 | 2 | 30 | 18 |
| Valemere | 65 | 3 | 19 | 20 |
| Lindenstead | 49 | 1 | 25 | 12 |

These are observed outcomes, not authored crises. All four experienced hunger despite remaining food stocks. That is evidence of unmet needs and suggests access or processing constraints, but these aggregate measurements do not establish the exact cause. The generator adds no scripted rescue. The test establishes divergent outcomes; it does not claim a balanced or self-sustaining economy.

The complete shared-world seed-42 run took 308.254 seconds (1.987 milliseconds per world day per initial person). The unchanged replay took 274.901 seconds. Both produced state hash `0fe34389644dd48af3ac2f1f9c3972ce6b7f0510c91b299963d833d0d2093508`. Annual active-population samples were 85, 87, 87, 87, and 86. Heap usage at those samples ranged from 135 to 292 MB. Timings are machine/load dependent; the first run overlapped the regression suite, so they are observations rather than a performance threshold.

World seed 43 generated Keldford, Fenford, Ivesford, and Stonestead. Population grew from 76 to 82, with final local populations 23, 22, 20, and 17. The run took 110.115 seconds (0.794 milliseconds per world day per initial person), with no monitored invariant failures and a different state hash: `87b32de4e9e8f6a99be0853a36ec5d3c88090b26d0b39c6cd2194d898eb06458`. Annual population samples were 76, 77, 78, 80, and 82; sampled heap usage ranged from 181 to 231 MB. The three-run acceptance test passed in 694.67 seconds. Differences in runtime reflect the generated workload as well as machine load; population alone does not predict simulation cost.

Final regression verification: `npm test -- --maxWorkers=2` passed all 585 tests across 59 files in 157.05 seconds. Typecheck and production build passed. The lower worker count avoided a five-second test timeout seen under earlier heavy concurrency; assertions and timeouts were unchanged.
