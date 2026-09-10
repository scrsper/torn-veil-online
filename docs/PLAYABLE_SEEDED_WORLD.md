# Playable Seeded World v0.1

Implementation branch: `codex/playable-seeded-world-v0-1`, based on merged main `ed70d64`.

This checkpoint implements the continuous canonical world and a generic Unreal client. **It is not a claim that every requested showcase acceptance condition passed.** The completed canonical journey, native projection evidence and remaining gaps are distinguished below.

## Run

```powershell
npm run bridge:playable
./unreal/scripts/Build.ps1
./unreal/scripts/Launch.ps1
```

Press Play in the editor. WASD moves, Shift runs, mouse orbits, wheel zooms, Tab selects a visible person, E interacts, C consumes carried food, Q drops the held item, M opens mechanism offers, number keys choose an offer, F5 saves, and F6 requests explicit developer comparison. GameSim determines every outcome. The first native connection controls the avatar; additional native connections observe.

`TORN_VEIL_SEED` selects the initial seed; default is **918271**. `TORN_VEIL_SAVE` selects a save path; the playable launcher defaults to `.debug/playable-world.save.json`. An existing save takes precedence over the seed. Autosave runs each minute of server stepping. A stopped server resumes its saved clock; it does not invent offline history. A disconnected Unreal client does not stop the server.

For the authored reference, run `npm run bridge` and `./unreal/scripts/Launch.ps1 -Scenario Ashford`. Ashford's map and authored generation remain available.

## Canonical architecture

| Area | Implemented behavior |
|---|---|
| Hierarchy | Seed → independent geographic fields → suitable sites → existing settlement-local seeds → one World/Simulation |
| Dimensions | 24,576 × 24,576 metres; bounded 48-cell vertical grid |
| Population | Seven settlements; seed 918271 starts with 127 generated residents plus the ordinary player Person |
| Placement | Water distance, fertile ground, woodland/stone availability and construction relief; 1.5 km minimum separation |
| Geography | Continuous hills, grassland, woodland substrate, exposed stone, dry/sandy ground, three meandering rivers, settlement farmland and resources |
| Connectivity | Bounded terrain-cost searches generate feasible nearby roads. No guaranteed complete road network or invented crossings; the reference seed has three regional roads |
| Regions | 256 m identities; nine nearby presentation regions. Resource relevance follows all canonical bodies, independently of clients |
| Baseline | Pure geography/resource queries use local derived seeds and bounded caches. Region visitation order does not consume a shared generation RNG |
| Historical overlay | Grid differences plus canonical resources, dropped items, structures/projects, kernel state, people, knowledge, events and scheduler state |
| Persistence | Save schema 24 regenerates baseline and restores overlay; indexed resource lifecycle state remains saved. Unvisited terrain/trees are not densely serialized |
| Clock and LOD | One calendar at 6× physical time for the playable world. Full existing NPC stepping everywhere; no reduced distant simulation or equivalence claim |
| Coordinates | Canonical metres never rebase. Unreal subtracts the current presentation origin and converts to centimetres |
| Authority | Input adapter, movement collision, doors, natural-water drinking, extraction, physiology, cognition, economy and outcomes remain TypeScript |
| Epistemics | Body-specific visibility, evidence-backed names/beliefs, ordinary stranger entry, separate developer truth. Perceiving one body does not reveal another body of that Person |

Save schema 23 is rejected explicitly; there is no migration of old saves in this checkpoint. Existing save files are not deleted. The original billion-metre locality regression remains separate from playable geography.

The browser emergency heal/teleport/respawn shortcut is removed. Death persists; a presentation client cannot silently repair a Person.

## Unreal and assets

`TornVeilWorld.umap` contains only global presentation infrastructure. Setup is idempotent. `ATVWorldProjection` owns bounded region actors; `ATVRegionProjection` groups terrain, modular structures, resource/crop/item/mechanism/construction/fire visuals and PCG dressing. Geometry facts never include private minds. The ordinary snapshot supplies avatar-visible people and knowledge. F6 obtains an explicit truth-versus-belief response.

Terrain uses 2 m samples around inhabited patches and 8 m wilderness samples, with shared boundary stitching. Static regional changes invalidate resident projection; unchanged regions are reused. Dynamic batches update only when their regional semantic signature changes. Door state/orientation, depleted resource stumps, crop stages, partial construction and component condition/operation are projected. Weather and shared time drive sunlight/fog presentation.

| Presentation area | Assets and behavior |
|---|---|
| Settlement kit | Fourteen Quaternius Medieval Village MegaKit Standard wall/window/door/floor/roof/support/stair/railing modules, fitted to canonical footprints and openings |
| Families | Dwelling, workshop, shop/stall, community, production and agricultural/storage routing; differences currently emphasize footprint, framing, roof and open-versus-enclosed form |
| Environment | Poly Haven 1K soil and stone maps, grass cluster; a small Quaternius nature subset for trees, bushes and resource rocks; shared water/crop/path materials |
| PCG | Actual runtime `UPCGGraph`: canonical substrate samples → deterministic points → weighted grass/bush mesh spawner |
| Classification | Canonical IDs map to component/instance references. PCG output is tagged `TV.Decorative.NoGameplay`; all dressing is noninteractive, collision-free and cannot send canonical actions |
| Replacement boundary | Prototype culture/family and asset-selection code lives entirely in presentation. Ashford retains its own profiles and map; this kit does not define future cultures |
| Characters | Existing licensed Epic mannequin/skeleton, canonical appearance colors/build, locomotion/attack/hit/downed clips and ten generated activity loops |
| Activities | Talk, eat, drink, inspect, repair, operate, work, chop, haul and rest adapters. Locomotion follows canonical velocity; pose/action state selects animation |
| Interaction UI | Knowledge-based target/HUD and mechanism offers. Inspect first; diagnosis, testing, dismantling, replacement and known-part manufacture are attempts through shared GameSim handlers |

Source/license links, imported subsets and reproducibility are in [`unreal/ASSET_PROVENANCE.md`](../unreal/ASSET_PROVENANCE.md). Source hashes are checked in. Imported CC0 assets total approximately 48 MB. Epic template and generated derivative animation assets remain local and are regenerated on launch when missing. Materials have saved instancing shader permutations.

## Evidence

`npx tsx src/headless/worldlab/playable.ts 918271` writes [`playable-world-acceptance.json`](playable-world-acceptance.json) and a local save. It steps the same bridge input adapter at 0.1 physical seconds; it does not teleport, coarse-step, prescribe NPC success, or suspend distant systems.

| Observation | Measured result |
|---|---|
| Identity | Initially unfamiliar `p_39` became Flint Reed through heard introduction event `e_1425` |
| Survival | Ordinary well drinking in A and B; hydration restored canonically |
| Persistent alteration | A tree was physically reached and depleted through the hand extraction action |
| Outbound travel | 5,323.21 m including local approach/activity; 4,681.49 m regional road; arrived in settlement 2 from settlement 3 |
| Travel accounting | Main travel interval 945.5 physical seconds / 5,673 calendar seconds; energy .790 → .662, hydration .995 → .807, fatigue .102 → .158 |
| Locality | An unintroduced B resident still regarded the avatar as an unfamiliar person |
| Return | 10,510.42 m total and 20,238 detailed steps; same depleted resource and learned identity on return to A |
| Presentation eviction | 118 unloads; no canonical deletion or pause caused by eviction |
| Persistence | 22.44 MB save; save/load/reconnect 3.72 s at the journey checkpoint; same clock, player ID and depleted resource |
| Behavior observed | Walk, run, work, eat, drink, talk, haul, stand, sit and pray poses occurred autonomously |
| Simulation profile | 155.77 s harness runtime; think 88.81 s, perceive 46.35 s, act 10.04 s; all residents active |
| Bridge profile | 1.012 s accumulated region-frame work and .534 s accumulated snapshot work during the journey checkpoint; later 2 m native terrain sampling is measured separately |
| Memory | 260.6 MB heap after retaining both original and reloaded worlds; intermediate travel samples ranged roughly 70–172 MB. This is not a GC-normalized leak claim |

The primary journey verifies deterministic untouched geography, seed divergence, knowledge locality and persistent return. The focused tests additionally check movement descent, shared door operation, action completion/fatigue, resident terrain invalidation, body-specific privacy and mechanism evidence gating.

`projectionProbe.ts` is an explicitly labelled developer visual fixture. It reuses one loaded World while relocating the observer to A, wilderness and B. **Those relocations do not count as travel evidence.** Native screenshots/PCG/instance reports are collected with `verify_playable_pie.py`; the real movement evidence is the detailed journey above.

## Verification status

- Canonical checkpoint: 49 focused checks passed.
- Detailed world round trip passed, including save/reload and the return resource witness.
- Final projection/privacy/menu checkpoint: 11 checks passed; movement regression: 2 passed.
- TypeScript typecheck and production build passed (123 bundled modules).
- UE 5.8 native editor target builds successfully.
- Full regression: 787/789 checks passed; the remaining two stress cases exceeded their 60-second limits while Unreal/projection work was running. With that workload stopped, both passed unchanged in an isolated 86.98-second run. No assertion or timeout was weakened. The full suite was not redundantly repeated.
- Ten activity animations regenerated successfully on the installed mannequin skeleton. This verifies asset generation, not the complete visual activity matrix.
- Final native PIE evidence: [settlement A](evidence/playable/playable-settlement-a.png), [wilderness](evidence/playable/playable-wilderness.png), [settlement B](evidence/playable/playable-settlement-b.png), [instance/PCG measurements](evidence/playable/native-projection-summary.json), [native timings](evidence/playable/native-performance.json).

| Native sample | Total actors (including infrastructure) | Character actors | Canonical instances | Decorative instances | Resident regions |
|---|---:|---:|---:|---:|---:|
| Settlement A | 39 | 6 | 4,249 | 6,673 | 9 |
| Wilderness | 34 | 1 | 212 | 3,779 | 9 |
| Settlement B | 41 | 8 | 3,125 | 6,369 | 9 |

Every sampled region completed real PCG generation. All sampled instance components had collision disabled. In the final editor run, maximum synchronous region build was **26.04 ms** and maximum frame application (including regional replacement) was **90.29 ms**. Sampled PCG generation elapsed times reached **636.59 ms**, including asynchronous scheduling/background-editor delay. Editor process memory ranged **3,123–3,254 MB** across the transitions; that includes editor/assets and is not evidence of a leak-free steady state. There is no one-actor-per-decoration architecture. Unchanged regions and semantic batches are reused; separate isolated unload/PCG CPU and long-duration memory profiles remain future measurements.

The native developer probe was stopped after capture. The ordinary bridge and generic level remain the reproducible play entry points above; no probe position was saved as gameplay history.

## Limits and next frontier

The continuous-world foundation is implemented; full showcase acceptance remains incomplete. The default generated date has primitive education and weather-power boundaries but no guaranteed completed mechanisms. The mechanism panel is verified in the disclosed existing workshop, not falsely attributed to the regional journey. Buying/eating, machinery repair and construction are covered by shared subsystem checks rather than every action occurring in the A→B run.

Geography is deliberately shallow: bounded vertical relief, simplified rivers, no lakes/hydrology, no bridge construction or ecological simulation. Roads can be disconnected. Navigation and physiology remain the existing approximations; 6× calendar progression does not claim physically equivalent numerics to 1×.

Unreal art is an early readable prototype. Roof fitting, interior furniture, detailed structure damage, item/tool silhouettes, crop meshes, weather effects and activity poses need further work. Semantic mechanism visuals do not yet reconstruct full component topology. No 33-minute human keyboard-driven PIE journey or complete animation/combat visual matrix is claimed. PCG timings include scheduling/background-editor delay, not isolated CPU time. No packaged shipping build, remote server, multiplayer, simulation LOD or offline catch-up is supplied.

Recommended next milestone: **Regional Life and Interaction Acceptance** — naturally established technical artifacts/history, player procurement/construction access, complete live Unreal A→B survival/mechanism interaction, stronger regional material/facade rendering and recorded animation/streaming performance passes. Preserve the canonical architecture and do not manufacture prosperity for the fixture.
