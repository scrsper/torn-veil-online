# Torn Veil: connected procedural realms

The isolated October 12 focused-asset candidate is documented in
[Focused authored world checkpoint](FOCUSED_WORLD_OCT12.md). Its feature flag,
verified source geometry and migration guard supersede the older voxel-only
description for opted-in QA worlds. Existing Tower saves require coordinated
migration before adoption. The tested focused prototype is now adopted in the
canonical main save; see that checkpoint's final consolidation status and rollback data.

This candidate adds a playable world foundation to Torn Veil's existing TypeScript simulation and Babylon client. It is a first city district slice of the intended sci-fi / high-fantasy / steampunk universe. It is not a completed megacity or a match for the reference's fidelity.

The October 9 canonical Tower and earned-growth checkpoints supersede the initial
legacy expedition adapter described in older evidence. See
[shared Tower authority](CANONICAL_TOWER_OCT9.md) and
[earned growth, difficulty and floor residency](TOWER_GROWTH_OCT9.md), and
[late-floor persistence and input stability](TOWER_PERSISTENCE_OCT9.md) for current
mechanics and verification. The [representative art gate](CONNECTED_REALMS_ART_GATE.md)
remains unpassed.

## Launch

From this checkout, double-click **Play Torn Veil.cmd**. The launcher starts one loopback host at `http://127.0.0.1:7510/?realms`, opens the existing Babylon client in its realm presentation mode, and keeps its active save in `.debug/realms/world.json.store/`. Any original `.debug/realms/world.json` remains as the unchanged import.

For development:

```powershell
npm ci
npm run realms:play
# Open http://127.0.0.1:7510/?realms
npm run realms:check
npm run typecheck
npm run web:build
npm run realms:journey
# For a fresh isolated QA world: fight floor one, reload floor two, return and cross realms
npm run realms:expedition
# Then exercise the retained QA save with labelled failed-response fixtures
npm run realms:recovery
```

`Play Torn Veil.cmd -CheckOnly` performs preflight without starting anything. `TV_REALMS_PORT`, `TV_REALMS_SEED` (new worlds only), and `TV_REALMS_SAVE` choose an isolated host/world. Use a **new** save path to test another seed; an existing save's seed is authoritative. Never point a test at a user/live save. `TV_REALMS_ASSETS` may reference the existing checkout's `web/public` read-only, for locally built character kits. The launcher discovers the Git common directory for that purpose. All used textures and body kits are already in the project; no reference code, assets or media were copied from Gigacity.

Both `Play Torn Veil.cmd` and `Play Torn Veil Web.cmd` launch the same current connected-world build. The prior living-world service remains an explicit historical comparison through `scripts/web/Play-Web.ps1`; its saves are not rewritten. The current connected-world save is a distinct world, not a migration of an existing live person's identity. Bringing an existing live character/world into this baseline requires a deliberate migration, not copying an ID or recreating their inventory.

## Play the slice

- WASD moves; Shift runs; drag the scene or use arrow keys to look.
- E opens/closes real building doors or offers portal travel. “Stay here” and Escape cancel a pending crossing.
- “Walk to Tower” and “Walk to portal” use the canonical Navigator and physical path traversal. Movement keys interrupt the route.
- Enter the Tower gate and choose its canonical trial. Fight with the same world body, save/reload the current state, learn finite sources and return through the blue threshold. Workshops and archives also have bounded ground-floor rooms behind working doors.
- I opens the character/journey panel. Saving and browser reload retain the same Person, Body, ordinary inventory, ontology and door state.
- Aether Reach uses stepped high-rise crowns, service ribs, luminous glazing and a cooler material palette. Cinderveil uses plaster/stone, timber-colored framing, slate gables, spires, chimneys and warm lamps. District programmes constrain building uses and heights; parcels vary on their own seed streams.

The authorized Tower checkpoint **e7cd628** and its committed ancestors remain integrated as an explicitly
separate legacy expedition. Its browser-owned ArenaWorld and floor-start checkpoint cannot award global
items, injury or ontological advancement. Legacy gear and capability stay scoped to that expedition.

The current canonical trial uses host-owned shared combat, actual learned sources, finite rewards,
injuries, recovery and earned transformations through Silver on the existing Person and Body. New
Gold source promotions are paused pending human policy acceptance; the full ladder and saved capacities remain. Realm
travel resumes that same run. Completed floor residents remain canonical but leave detailed simulation;
their coarse needs/recovery continue under a bounded budget. Current rank gates and simulation limits
are documented in the earned-growth report; they are not a completed population or geopolitical model.

Existing shared character bodies are placeholders: the user rejected their present quality, and a separate
character owner is improving geometry and fit. This branch does not treat them as accepted final art.

## Authority and data flow

`src/sim/world/realms/layout.ts` derives versioned realm/district/chunk/parcel IDs, architectural solids, doors and constrained interiors from hierarchical seeds. No traversal order or runtime RNG is consumed by geography queries. Version 1 has two bounded realm domains, each 64 × 64 chunks of 96 metres. This is an **addressable extent**, not evidence that every district has been visited, rendered or populated.

`RealmGrid` implements the existing sparse `VoxelGrid` contract. Collision is sampled from the same solid descriptions the renderer consumes. Real door apertures control the full opening; its single canonical door state governs the whole doorway. Street borders use the same global alignment, regardless of adjacent chunk load order. Navigation uses the existing `Navigator`; movement uses the existing `predictMovement` kernel, and guided walking uses `travelPath`. Unknown/outside territory is impassable.

Collision is voxel-based for the structural walls, room kit and doors. Decorative lamps, facade trim and inaccessible roof ornaments do not all have separate colliders. Arbitrary construction/remodelling actions are not exposed by this adapter: raw voxel diffs survive canonical saves, but live facade rebuilding for those edits is still required. The currently playable, visibly persistent architectural edit is door state.

`generateRealms` installs that baseline on an ordinary `World`, creates ordinary `Person`, `Body`, `Item` and `Place` entities, and starts four actual residents plus the player. Ordinary `Simulation` cognition/perception runs for this small population. Buildings do not imply thousands of hidden full NPC brains. The residents are not a functioning city economy yet; most generated buildings have a programme/layout but no registered household, staff, stock or production chain. Ground-floor interior access is supported; upper windows are facade detail, not promised enterable apartments.

`RealmSession` accepts bounded intentions. The host advances fixed 50 ms realm traversal steps and the shared 60 Hz Tower interaction scheduler. Portal confirmation resolves and checks the destination before moving the existing body, emits a causal `realm_crossed` event, and consumes the pending crossing once. No Person, rank, inventory or class sheet is recreated. A reload/disconnect cancels an uncommitted choice. Transitions and door changes enter the canonical save. Pending choices and queued inputs are retained only as private host continuation metadata for exact replay, then released when the connection or process restarts; renderer caches remain disposable.

Persistence uses `src/sim/persist/save.ts`, with current save schema **31** and an explicit realm generator version. Readers retain schema 24-30 support; later schemas add shared arcana/contact, canonical trial/recovery, and earned-growth/residency evidence. Older clients reject unsupported schemas rather than silently projecting a realm save onto village geometry. Unknown generator revisions stop load, keeping the files intact. The active save now lives in `<TV_REALMS_SAVE>.store/`: a lossless compressed base plus checksummed, atomically committed operation batches. A replay worker creates full checkpoints off the simulation thread; the imported JSON stays unchanged. Copy the entire active directory for backup, or use the verified JSON export command in [TOWER_PERSISTENCE_OCT9.md](TOWER_PERSISTENCE_OCT9.md). A source fingerprint blocks incompatible journal replay, and persistence failure pauses the host. Rare structural Tower transitions still take one synchronous rollback snapshot. This remains a single-player development host, not a production/multiplayer account service.

`src/web/realms` is an additive presentation mode in the existing browser entry. It reuses `createRenderer`, `Atmosphere`, `MaterialLibrary`, `MeshBatch`, `CharacterFactory` and its animation/appearance mapping. It receives projections and semantic chunks from the host and never creates/steps `World`. Resident visibility is distance/line-of-sight gated; no mind goals are sent to the client. Four resident visuals are reused across crossings, with a hard cache limit of 16 for this adapter. Existing combat and Tower code are retained; an optional TowerHost port supplies world-bound identity/checkpoint transport while standalone Tower behavior remains available.

## Streaming and scaling

- A 9 × 9 chunk residency window is bounded at 81; its central 3 × 3 receives full facade/interior detail. Mid-distance chunks reduce window geometry; the outer ring uses silhouettes and inexpensive emissive facade textures.
- The server sends only changed chunk/LOD addresses. Geometry descriptors have a 128-entry disposable cache; canonical edits/door states live independently and survive cache eviction.
- The client uploads at most one chunk per rendered frame. Shared kit parts are thin-instanced per material/chunk; textured near walls and streets use metre-scaled batched surfaces. Scene frustum culling remains active. Departing chunks, their signs and owned materials/textures are disposed.
- The render origin is local to the current realm. Very large worlds will need a moving origin within each realm as well.
- Navigation caches clear on region changes. Save size follows actual entity/history/edit state, not every potentially generated block. There is no render-loop LLM call or remote asset service.
- Dawn/day/dusk are projected from canonical time with realm presentation phase offsets. Clock time is not mutated by sky rendering. Street lamps/window glow are inexpensive presentation detail; emitted light is not simulated for each window. Shadow reception was disabled for these procedural batches after the first visual pass obscured street readability; a production lighting pass is still required.

Future scaling requires asynchronous worker generation/upload budgets, mesh/material atlases, shared facade shaders/parallax windows, explicit HLOD transitions and long traversal/VRAM profiling. A world with useful populations also needs activation and coarsening of actual households, economies and institutions through the existing scheduler. Four residents and 81 visible chunks do not establish that a populated megacity is affordable.

## Reference interpretation

The coordinator verified Ryan Sael's [Gigacity post](https://x.com/ryansael/status/2108203997480063196) and [project page](https://sael.net/gigacity/): layered/twisted/stepped skylines, dense windows, luminous signs, haze, day/night composition and flying traffic. It also identified shader-parallax window rooms and lane/time-based traffic, not fully simulated inhabitants or fully enterable rooms. Those observations inform the rendering/simulation split. This task did not reuse Gigacity code or the separate quoted Unity Megacity assets. The local reference webpage fetch was unavailable; this assessment is attributed to the coordinator's actual browser inspection, not an invented local viewing or benchmark.

## Remaining work toward the whole Veil

The visual treatment has **not passed** the user's quality bar. Before repeating it across more districts,
complete the representative Threshold Square art gate in `CONNECTED_REALMS_ART_GATE.md`: architecture,
street/terrain composition, coherent materials, lighting, atmosphere and useful close-ups. The large address
space is not an instruction to fill the world with more low-detail blocks.

1. Extend the implemented host-validated canonical Tower actions, encounter/loot provenance and exactly-once receipts into broader world encounters. Preserve the existing World authority for items, injury/death and advancement. Travel, floor checkpoint persistence and return are implemented; browser checkpoint claims remain confined to the historical lab.
2. Adapt validated creator bodies, equipment fit and animation improvements deliberately. Preserve authoring tools as tools; don't merge unrelated experiments or source asset variants blindly.
3. Author richer facade/interior kits, actual shop fronts and street furniture with matching colliders, district terrain/topology, bridges, markets, parks and distinctive landmarks. The current clean blocks are visibly repetitive and far below the reference's detail.
4. Register generated occupied places/households into the existing economy/knowledge/logistics systems. Assign capabilities and resources causally. Add bounded agent activation/coarse continuation, rather than claiming decorative traffic/residents are simulated citizens.
5. Expand realm IDs into continent/world registries with migration-stable coordinates and building IDs. Add portal discovery/ownership/rules through canonical state. Preserve old generator versions when geography changes.
6. Run longer city routes, repeated lifecycle/context loss and save recovery tests; measure production-build 1080p/1440p frame distributions, GPU timing, VRAM and memory after warmup. The evidence in this slice is a recorded developer-browser journey, not a finished-game performance promise.

See `CONNECTED_REALMS_INTEGRATION.md` for branch provenance and `evidence/connected-realms/RESULTS.md` for the actual checks and captures.
