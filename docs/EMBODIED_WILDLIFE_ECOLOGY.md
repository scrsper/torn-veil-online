# Embodied Wildlife & Ecology v0.1

Branch: `codex/embodied-wildlife-ecology-v0-1`, based on current remote main `d9e758c`. No merge, PR, Unreal changes, combat resolver changes, martial learning changes or human planner changes. `agent.ts` has one import and one scheduler hook replacing decorative stepping **only for creatures with ecology state**. The shared `physical/hand.ts` resource query has one necessary kind filter so new direct-intake nodes cannot mask ordinary gatherable stone/trees; no combat handlers were changed.

## Module inventory

New modules: `core/creatureSpecies.ts`; `ecology/animals.ts`, `generation.ts`, `lifecycle.ts`, `sensing.ts`, `simulation.ts`, `species.ts`, `types.ts`; `physical/travel.ts`; `world/ecologyResources.ts`; and `headless/ecology/scenarios.ts`, `cli.ts`. Three ecology test files cover the integration. Existing core physiology, spatial indexing, resource upkeep, World types, persistence and world-generation entrypoints received bounded extensions.

## Canonical composition

`core/creatureSpecies.ts` describes body plan, locomotion components, cognition controller, senses and optional innate capability references independently of human identity. `ecology/types.ts` adds the currently supported diet, habitat, metabolic, lifecycle, gestation and spacing components. Species lookup is by persistent string id, not a closed three-animal enum. The supported controller validates its components instead of silently treating a sapient or otherwise unsupported creature as ordinary wildlife.

The three calibrated profiles are **field hare**, **roe deer** and **woodland boar**. They differ in mass/clearance/speed, grass/browse/mast digestion, preferred cover, food and water reserves/demand, sleep, environmental exposure tolerance, maturation, lifespan and reproduction. These are disclosed simulation calibrations, not zoological measurements. Boars currently demonstrate plant omnivory; eating live prey is deferred.

The general species composition is not a replacement for `Person`. Sapience is selected by a cognition controller, never by being human. Existing Person knowledge, learning, relationships, inventory and social mechanics remain the future path for sapient nonhumans. A global bestiary catalogue, arbitrary controller attachment and non-walking execution are not implemented in this slice. Additional locomotion/capability handlers must obey canonical mechanics. There are no dragon, magic, progression or civilization implementations hidden behind the data interfaces.

Each animal is an existing `Creature` identity with a `bodies[]` collection. The optional wildlife component records birth time, sex, parents, a seeded senescence time, breeding eligibility time, gestation and **per-body** physiology/activity. Position, health, dead/present state, physical path, heading and pose remain on existing `Body` entities. There is no duplicate animal HP or alive flag. Age, maturity, approximate growth scale and current living population are derived. A second body has separate energy, hydration, fatigue and mortality. Withdrawn bodies are not offscreen optimization proxies.

## Physical loop

Every 15 world minutes the controller senses nearby registered resources through the existing spatial index and voxel line of sight, selects a need, follows a bounded local navigation path, consumes actual matter, updates condition and evaluates lifecycle consequences. It seeks food/water/habitat, eats, drinks, sleeps, rests and occasionally roams. Failed approaches leave a small expiring memory; a visible but inaccessible source does not hold the animal indefinitely. Animals do not inspect remote resource maps or human minds.

`stepEmbodiedPhysiology` extracts the existing physical reserve integrator from the human wrapper. Human formulas and modifiers remain unchanged; animals supply biological rates to the same activity, heat, wetness, fatigue and sleep calculations. Hunger/thirst are reserve deficits. Walking consumes physical seconds and metabolic effort. Navigation and sub-metre collision sweeps prevent tunnelling, cliff climbing and implicit door operation. Both pending clocks persist; a calendar jump cannot supply free physical movement.

`ResourceNode` now also supports **forage biomass in kg** and **surface water in litres**, outside inventory item types. Terrain-derived grass, accessible woodland browse and mast are finite stocks. Multiple consumers subtract from the same quantities. Plant renewal runs through `maintainResourceNodes`, using per-node 30-day grass/browse and 120-day mast recovery; paving/removing the substrate stops renewal. Timber's existing multi-year lifecycle and crops are unchanged.

Surface-water nodes meter the existing water voxels at accessible banks: a one-metre water voxel starts with 1,000 litres. Intake validates canonical membership, presence, reach, visibility and remaining volume. Depletion clears that actual voxel. Removed water remains removed on load. There is no invented well entitlement, rain refill or hydrology model. Existing human well/natural-water action adapters and legacy abstract hunting-ground meat pools remain separate legacy paths pending their own integration; wildlife never consumes or replenishes those meat pools.

## Lifecycle and history

Conception requires maturity, body condition, hydration, rest, suitable habitat, nearby physical food/water and a mature locally sensed mate. Local density moderates conception opportunity; it never directly modifies population or survival. Gestation costs energy and can fail under scarcity. Birth transfers energy and water from the mother into canonical offspring; inadequate reserves or missing food prevent successful birth. Nursing transfers reserves locally with an energy loss, without inventing milk or feeding remotely. Juveniles also gradually forage. Growing reserve capacity does not create stored energy/water.

Starvation and dehydration damage existing Body health. A small natural-mortality adapter records death, stops movement and leaves the identity and dead body in place. Senescence is drawn once from the species lifespan range and persists. No death creates a replacement. Parental references survive death and can support later genealogy without assigning human beliefs.

Meals/drinks have low-significance world events at the beginning of intake bouts; exact cumulative quantities live on embodiment state and nodes. Births/deaths/gestation are canonical lifecycle events, not automatic Chronicle entries. A daily observational census emits Chronicle-worthy tracked-world extinction, large collapse or doubling events with actual recent lifecycle causes. These are explicitly changes in the **tracked world population**, not claims of local extinction in unmodelled wilderness. The census cannot change resources, births, survival or migration. Pregnancy causes are pinned during event compaction.

## Generation and persistence

Fresh `newWorld()` Ashford and `generatePlayableWorld()` runs initialize terrain-supported resources and small seeded founder groups. Playable generation uses three bounded river-bank samples; these bound initial registration work, not animal movement or territorial rules. Other custom/headless generators can call `initializeWildlife` or `enableEcology` explicitly. This slice does not populate every wilderness region or spawn animals as a camera moves.

Schema 24 receives an additive, internally versioned ecology component. Species data, independent RNG stream position, fixed-cadence remainder, census, animals, gestation, reserves, failed-approach memories and body paths persist. Legacy saves without the component retain their prior semantics. Deserialization disables founder generation and overlays exact saved nodes/individuals, preserving extinction and empty resources. Animal continuation works without an attached human scheduler as well as through ordinary Simulation.

## Verification and reproduction

Focused tests: `tests/ecology.test.ts`, `tests/ecology-persistence.test.ts`, `tests/ecology-boundaries.test.ts`.

Run the reproducible evidence report with:

```sh
npx tsx src/headless/ecology/cli.ts
```

It writes `docs/ecology-acceptance.json`: two 100-day healthy-habitat histories, a 50-day overcrowding/recovery history, a water-scarcity scenario and a 1,000-individual/one-day performance sample. The short-lived lifecycle test uses an explicitly synthetic rodent profile to exercise multiple generations and senescence; no resource clock is accelerated. The healthy tests use the catalogue hare's ordinary 42-day gestation.

Measured on this checkout (wall time is machine-dependent): 1,000 individuals, 4,160 resource nodes, 96 quarter-hour quanta, **20.424 seconds** for one simulated day. All 1,000 survived; 7,949 path searches occurred. Spatial broad phase examined 18,294,809 resource candidates, versus 399,360,000 candidates for a full resource scan per animal/quantum (about 22× fewer). This is headless coarse-step throughput, not a claim of a smooth 1,000-animal realtime renderer or century-scale acceptance.

| Scenario | Day | Living animals | Births | Forage kg |
|---|---:|---:|---:|---:|
| Healthy, seed 701 | 0 | 8 | 0 | 774.400 |
| Healthy, seed 701 | 50 | 12 | 4 | 764.393 |
| Healthy, seed 701 | 100 | 18 | 10 | 750.324 |
| Healthy, seed 711 | 100 | 15 | 7 | 755.209 |
| Crowded feeding bank | 0 | 48 | 0 | 5.000 |
| Crowded feeding bank | 3 | 48 | 0 | 0.061 |
| Crowded feeding bank | 10 | 0 | 0 | 0.321 |
| Recovery after extinction | 50 | 0 | 0 | 5.000 |

All 48 crowded animals died of starvation. All six animals in the separate water-free scenario died of dehydration by day 10. Recovery occurred through ordinary resource renewal; extinction remained extinction, with no automatic replacement founders.

Verification: **831 checks passed** across 23 focused ecology checks, 65 existing resource/physiology checks and 743 additional normal regression checks (77 files). The two long ecology scenarios initially exceeded their 60-second limits after live-source validation was added; moving visibility checks behind cheap biological eligibility checks resolved that cost, and both passed unchanged on rerun. No assertions or time limits were relaxed. Typecheck and production build passed (132 bundled modules). The broader normal regression excluded the already-verified ecology/resource/physiology files and retained the repository's specialized-suite exclusions. No browser, Unreal or unrelated specialized long-run acceptance was run.

## Limits and deferred hooks

- No hunting, predation/animal combat, carcass food conversion, taming, ownership mechanics, domestication, mounts, butchering or animal economy. Future actions should address these persistent identities and bodies through canonical action/combat/ownership APIs.
- Locomotion execution supports walking on the current navigation grid only. No flying, swimming, burrowing, doors, aerial navigation or body-specific nav mesh. Growth/clearance use approximate body dimensions; no anatomical or full mass/chemical model.
- No pack/herd cognition, territory ownership, migration memory, disease, seasons, measured air temperature, hydrology or plant succession. Weather exposure affects reserves; plant renewal uses existing bounded resource rules.
- Fixed cadence is shared by all wildlife, independent of camera distance. Movement is swept and paid but only materialized at quarter-hour endpoints. No renderer interpolation or population aggregation is authoritative. Global historical identities remain retained; very long worlds will need existing history/storage policy extended proportionally.
- Human perception/collision selection currently uses human living-body indexes. Wildlife has its own lightweight derived broad phase over ordinary bodies, avoiding changes to active combat code. A future common physical-presence query and human observation adapter should expose animals safely without feeding them into Person-only combat/planner code.
- Visualization is deferred. Canonical bodies include a quadruped shape and species body-plan data for a later non-authoritative projection. No Unreal or realtime combat integration branch was touched.
