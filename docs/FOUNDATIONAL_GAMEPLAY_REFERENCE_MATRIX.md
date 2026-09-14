# Foundational Gameplay Presentation v0.1 — Reference Matrix

This matrix records inspected evidence separately from design targets. Commercial games are presentation references only; no proprietary implementation or asset was inspected or copied.

| System | Torn Veil need | Primary reference | Secondary reference | Pattern learned | What not to copy | Canonical owner | Unreal responsibility | Current repo support | Implementation gap | MVP priority |
|---|---|---|---|---|---|---|---|---|---|---|
| Camera | One readable exploration/combat language | Game Animation Sample camera rigs (inspected) | Witcher/Ghost design language | Composable framing, collision and smooth mode changes | Sample gameplay authority/free-orbit default | TypeScript facing/outcome | Spring arm, framing, collision, zoom, interpolation | Exploration/combat/incapacitated policy derives from canonical state | Human tuning remains | Implemented v0.1 |
| Locomotion | Excellent-looking canonical movement | Game Animation Sample (inspected) | Witcher/Ghost design language | Data-driven gait/direction presentation | Mover/CharacterMovement authority | TypeScript movement/collision | Select/blend poses from canonical samples | Canonical speed plus derived stand/walk/jog/sprint and transition signals | More animation-specific polish | Implemented v0.1 |
| Starts/stops | Anticipation and planted settling | Game Animation Sample | Monster Hunter design language | Explicit transitions with pose continuity | Root displacement | TypeScript displacement | Mesh-only start/stop handoffs | Derived start/stop signal triggers pose continuity | Dedicated authored clips deferred | Implemented v0.1 |
| Pivots | Readable reversals without sliding | Game Animation Sample | Ghost design language | Direction thresholds and orientation warping | Unbounded motion warping | TypeScript yaw/position | Bounded mesh-only pivot/orientation | Signed wrap-safe pivot and shoulder signal | Dedicated pivot clips deferred | Implemented v0.1 |
| Combat transition | Exploration → commitment → recovery → exploration | Existing Torn Veil combat | Elden Ring/Monster Hunter language | Anticipation, commitment, recovery, shared camera | Broad combat rewrite/Souls rules | TypeScript action/contact/outcome | Pose/camera/UI continuity | Realtime lifecycle, pose handoffs and shared camera modes | Human tuning remains | Implemented v0.1 |
| Interaction prompts | Legitimate contextual verbs | Existing `handInteractions` | CommonUI principles | Semantic actions, revalidate on execute | Per-object Blueprint authority | TypeScript eligibility/action | Display best prompt and glyph | Items/resources/containers/talk share semantic prompt path | Dynamic device glyph art | Implemented v0.1 |
| HUD | Restrained readable status | CommonUI installed | Ghost/Witcher hierarchy | Layered HUD with transient prompts | Debug wall as final UI | TypeScript projected facts | Composition/visual hierarchy | Layered Canvas HUD/modal shell with controller/back routing | True CommonUI widgets deferred | Implemented v0.1 |
| Inventory | Show canonical possessions | Existing Torn Veil + CommonUI | Skyrim/Fallout/Valheim language | Projection, selection, actions | Lyra/UI inventory truth | TypeScript Person/Item | Read-only DTO view + semantic intents | Native canonical inventory/container screen | Equipment detail deferred | Implemented v0.1 |
| Equipment | Distinguish carried from equipped | User intent | RPG design language | Explicit canonical slots before presentation | Inferring equipment from widget selection | TypeScript (not implemented) | Display/submit equip intent | Carried-item weapon fallback only | Canonical model/API absent | Blocked/design first |
| Containers | Physical storage/transfer | User intent | Skyrim/Fallout/Valheim language | Two inventories projected from world state | Widget-owned contents | TypeScript Container/Item | Screen and transfer intent | Persistent physical container, reach/open/capacity transfer and two-column UI | Stack splitting/locks/theft deferred | Implemented v0.1 |
| Pickups | World item → accepted action → inventory | Existing Torn Veil | Skyrim/Valheim language | One prompt and canonical round trip | Actor destroys itself as truth | TypeScript | World mesh/prompt/feedback | Canonical pickup and bridge intent exist | Native item visualization is primitive | P1 |
| Looting | Corpse/container access without invented truth | User intent | RPG design language | Eligibility first, UI second | Auto-generated loot/UI authority | TypeScript (not implemented) | Project legal observed contents | No corpse/container loot API | Canonical semantics absent | Deferred/blocked |
| Controller UX | Equivalent semantic controls | CommonUI installed | Lyra principles (not locally inspected) | Action routing, focus, cancel, active-device glyphs | Key-specific sim commands | TypeScript semantic intent validation | Input mapping/glyph/focus | Keyboard/controller semantic routing and consistent back | Dynamic glyph art deferred | Implemented v0.1 |
| Pause/settings | Coherent stack and back flow | CommonUI installed | Lyra principles | Modal stack, top-screen cancel | Pausing canonical server implicitly | TypeScript clock/save policy | Local menus/settings/input capture | Local menu states keep persistent canonical world running | Rebinding/settings controls deferred | Implemented shell |
| Wildlife rendering | Persistent roe deer keyed by body | Torn Veil ecology | RDR2 language | Body-keyed disposable actor | Blueprint spawn/AI truth | TypeScript Creature/Body | Mesh, material, interpolation | Body-keyed native actor with dead/withdrawn distinction | Final cleared deer asset | Implemented proxy |
| Wildlife animation | Communicate activity naturally | Canonical activity enum | RDR2/Monster Hunter language | Activity mapping and nonblocking transitions | Animation-granted delays/movement | TypeScript activity/movement | Idle/walk/eat/drink/rest/sleep/flee/dead visuals | Procedural proxy maps all required states | Rigged clips/transitions | Implemented proxy |
| Wildlife reactions | Threat response readability | Canonical sensing/behavior | RDR2 language | Orient/tension/acceleration/catch-up | Unreal AI or hidden hesitation | TypeScript sensing/activity | Present accepted state | Realtime Person threat response and canonical flee projection exist | Human visual tuning | Implemented v0.1 |
| Biome dressing | Rich representative habitat | Existing TV PCG projection | PCGBiomeCore installed | Data-driven density and canonical/decor split | PCG resources/collision authority | TypeScript substrate/resources | Decorative foliage/assemblies | Seeded collision-free PCG exists | Quality/transitions need tuning | P2 after base |
| Vegetation | Dense visual ground cover | Existing Poly Haven/Quaternius path | PCGBiome principles | HISM/PCG decorative layers | Entity per blade | TypeScript only for meaningful resources | Grass/fern/flower/shrub visuals | Grass/bush/tree/rock dressing exists | Limited variety/biome tables | P2 |
| Item visualization | Central canonical→presentation descriptor | Existing item DTO | RPG readability | One mapping with fallback | Scattered asset paths | TypeScript item/location | Mesh/icon/socket/scale/fallback | Central engine-safe catalog and canonical regional location | Final icon/mesh art | Implemented v0.1 |
| IK | Foot contact without root authority | Game Animation Sample | Existing Torn Veil combat IK | Bounded presentation correction | Capsule/root displacement | TypeScript root/ground truth | Foot/pose correction | Bounded foot IK exists | Extend carefully to locomotion/deer | P2 |
| Streaming presentation | Recreate projections without changing lifetime | Torn Veil protocol 2 | Existing PCG | BodyId registry, unload presentation only | Camera-driven spawn/despawn | TypeScript lifetime/state | Residency and actor recycling | Wildlife body registry plus regional items/containers/resources | Pooling/scale tuning | Implemented v0.1 |
| Save/load presentation | Reconnect to restored canonical state | Torn Veil schema 24 | CommonUI feedback principles | UI reflects confirmed restored snapshot | Saving widget/native actor state as truth | TypeScript save/load | Save intent/status/reprojection | Items, containers and wildlife persist; F5 saves canonical world | Polished load menu deferred | Implemented seam |
| Settings/rebinding | Durable user-facing controls | CommonUI/EnhancedInput | Lyra principles | Semantic bindings and device-aware display | Duplicated hardcoded control text | Local presentation settings; semantic intent canonical | Rebinding UI and glyph resolution | EnhancedInput classes enabled; legacy mappings | No settings data/UI | P2 |
| World readability | Settlement-to-wilderness continuity | Existing seeded world | Witcher/Ghost design language | One traversal/prompt/camera vocabulary | Developer-test-mode transitions | TypeScript world facts | Dressing, cues, restrained HUD | Continuous regional world exists | Presentation layers remain prototype | P2 |

## Synthesis decision

### Adopted in the v0.1 implementation

- Thin renderer-neutral DTO extensions; one body-keyed projection registry; one semantic interaction path.
- CommonUI/UMG shell over canonical snapshots, with Canvas retained as debug/fallback.
- Central item presentation descriptors.
- Mesh-only locomotion transitions and warping with zero actor-root drift telemetry.

### Defer

- Full Motion Matching, traversal migration, large-creature combat, broad biome catalog, final settings/rebinding, looting economy, and additional species.

### Reject

- Any Unreal-owned movement, wildlife AI, inventory/equipment/container truth, resource generation, damage, quests, or save state.

Implementation is not authorized by the synthesis gate until the accepted base is consolidated and asset provenance is resolved.
