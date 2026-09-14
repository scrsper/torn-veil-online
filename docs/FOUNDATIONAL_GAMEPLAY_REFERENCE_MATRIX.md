# Foundational Gameplay Presentation v0.1 — Reference Matrix

This matrix records inspected evidence separately from design targets. Commercial games are presentation references only; no proprietary implementation or asset was inspected or copied.

| System | Torn Veil need | Primary reference | Secondary reference | Pattern learned | What not to copy | Canonical owner | Unreal responsibility | Current repo support | Implementation gap | MVP priority |
|---|---|---|---|---|---|---|---|---|---|---|
| Camera | One readable exploration/combat language | Game Animation Sample camera rigs (inspected) | Witcher/Ghost design language | Composable framing, collision and smooth mode changes | Sample gameplay authority/free-orbit default | TypeScript facing/outcome | Spring arm, framing, collision, zoom, interpolation | Coherent shoulder camera exists | No camera policy/mode adapter | P1 after base |
| Locomotion | Excellent-looking canonical movement | Game Animation Sample (inspected) | Witcher/Ghost design language | Data-driven gait/direction presentation | Mover/CharacterMovement authority | TypeScript movement/collision | Select/blend poses from canonical samples | Velocity/yaw blend space and prediction exist | Limited state graph | P1 after base |
| Starts/stops | Anticipation and planted settling | Game Animation Sample | Monster Hunter design language | Explicit transitions with pose continuity | Root displacement | TypeScript displacement | Mesh-only start/stop handoffs | Accel/decel canonical; no dedicated visuals | Add renderer telemetry and native selection | P1 |
| Pivots | Readable reversals without sliding | Game Animation Sample | Ghost design language | Direction thresholds and orientation warping | Unbounded motion warping | TypeScript yaw/position | Bounded mesh-only pivot/orientation | Yaw projection exists | No pivot state/telemetry | P1 |
| Combat transition | Exploration → commitment → recovery → exploration | Existing Torn Veil combat | Elden Ring/Monster Hunter language | Anticipation, commitment, recovery, shared camera | Broad combat rewrite/Souls rules | TypeScript action/contact/outcome | Pose/camera/UI continuity | Accepted realtime lifecycle and pose handoffs | Needs integrated shell and base consolidation | P1 blocked |
| Interaction prompts | Legitimate contextual verbs | Existing `handInteractions` | CommonUI principles | Semantic actions, revalidate on execute | Per-object Blueprint authority | TypeScript eligibility/action | Display best prompt and glyph | E/C/Q Canvas prompts exist | Prompt layer, focus, device glyphs | P1 after base |
| HUD | Restrained readable status | CommonUI installed | Ghost/Witcher hierarchy | Layered HUD with transient prompts | Debug wall as final UI | TypeScript projected facts | Composition/visual hierarchy | Canvas debug HUD | No reusable widget root | P1 |
| Inventory | Show canonical possessions | Existing Torn Veil + CommonUI | Skyrim/Fallout/Valheim language | Projection, selection, actions | Lyra/UI inventory truth | TypeScript Person/Item | Read-only DTO view + semantic intents | Browser UI and native summary | No native screen; DTO too thin | P1 |
| Equipment | Distinguish carried from equipped | User intent | RPG design language | Explicit canonical slots before presentation | Inferring equipment from widget selection | TypeScript (not implemented) | Display/submit equip intent | Carried-item weapon fallback only | Canonical model/API absent | Blocked/design first |
| Containers | Physical storage/transfer | User intent | Skyrim/Fallout/Valheim language | Two inventories projected from world state | Widget-owned contents | TypeScript (not implemented) | Screen and transfer intent | No container primitive | Canonical access/capacity/transfer absent | Blocked/design first |
| Pickups | World item → accepted action → inventory | Existing Torn Veil | Skyrim/Valheim language | One prompt and canonical round trip | Actor destroys itself as truth | TypeScript | World mesh/prompt/feedback | Canonical pickup and bridge intent exist | Native item visualization is primitive | P1 |
| Looting | Corpse/container access without invented truth | User intent | RPG design language | Eligibility first, UI second | Auto-generated loot/UI authority | TypeScript (not implemented) | Project legal observed contents | No corpse/container loot API | Canonical semantics absent | Deferred/blocked |
| Controller UX | Equivalent semantic controls | CommonUI installed | Lyra principles (not locally inspected) | Action routing, focus, cancel, active-device glyphs | Key-specific sim commands | TypeScript semantic intent validation | Input mapping/glyph/focus | EnhancedInput plugin; legacy named bindings | CommonUI routing/glyph adapter absent | P1 |
| Pause/settings | Coherent stack and back flow | CommonUI installed | Lyra principles | Modal stack, top-screen cancel | Pausing canonical server implicitly | TypeScript clock/save policy | Local menus/settings/input capture | No native menu architecture | Define local vs canonical pause | P2 |
| Wildlife rendering | Persistent roe deer keyed by body | Torn Veil ecology | RDR2 language | Body-keyed disposable actor | Blueprint spawn/AI truth | TypeScript Creature/Body | Mesh, material, interpolation | Canonical deer exists | No DTO/actor/asset | Blocked |
| Wildlife animation | Communicate activity naturally | Canonical activity enum | RDR2/Monster Hunter language | Activity mapping and nonblocking transitions | Animation-granted delays/movement | TypeScript activity/movement | Idle/walk/eat/drink/rest/sleep/flee/dead visuals | Body pose/activity exists | No rig/clips/AnimInstance | Blocked by asset |
| Wildlife reactions | Threat response readability | Canonical sensing/behavior | RDR2 language | Orient/tension/acceleration/catch-up | Unreal AI or hidden hesitation | TypeScript (realtime reaction incomplete) | Present accepted state | Ecology has no native/player realtime reaction bridge | Contact/perception integration gap | Blocked by base |
| Biome dressing | Rich representative habitat | Existing TV PCG projection | PCGBiomeCore installed | Data-driven density and canonical/decor split | PCG resources/collision authority | TypeScript substrate/resources | Decorative foliage/assemblies | Seeded collision-free PCG exists | Quality/transitions need tuning | P2 after base |
| Vegetation | Dense visual ground cover | Existing Poly Haven/Quaternius path | PCGBiome principles | HISM/PCG decorative layers | Entity per blade | TypeScript only for meaningful resources | Grass/fern/flower/shrub visuals | Grass/bush/tree/rock dressing exists | Limited variety/biome tables | P2 |
| Item visualization | Central canonical→presentation descriptor | Existing item DTO | RPG readability | One mapping with fallback | Scattered asset paths | TypeScript item/location | Mesh/icon/socket/scale/fallback | Regional items projected with basic meshes | No central descriptor/catalog | P1 |
| IK | Foot contact without root authority | Game Animation Sample | Existing Torn Veil combat IK | Bounded presentation correction | Capsule/root displacement | TypeScript root/ground truth | Foot/pose correction | Bounded foot IK exists | Extend carefully to locomotion/deer | P2 |
| Streaming presentation | Recreate projections without changing lifetime | Torn Veil protocol 2 | Existing PCG | BodyId registry, unload presentation only | Camera-driven spawn/despawn | TypeScript lifetime/state | Residency and actor recycling | Region ack/unload and stable resources exist | Wildlife/item actor lifecycle incomplete | P1 |
| Save/load presentation | Reconnect to restored canonical state | Torn Veil schema 24 | CommonUI feedback principles | UI reflects confirmed restored snapshot | Saving widget/native actor state as truth | TypeScript save/load | Save intent/status/reprojection | F5 save and persisted current world state | Containers/equipment absent; no polished menu | P1 after canonical support |
| Settings/rebinding | Durable user-facing controls | CommonUI/EnhancedInput | Lyra principles | Semantic bindings and device-aware display | Duplicated hardcoded control text | Local presentation settings; semantic intent canonical | Rebinding UI and glyph resolution | EnhancedInput classes enabled; legacy mappings | No settings data/UI | P2 |
| World readability | Settlement-to-wilderness continuity | Existing seeded world | Witcher/Ghost design language | One traversal/prompt/camera vocabulary | Developer-test-mode transitions | TypeScript world facts | Dressing, cues, restrained HUD | Continuous regional world exists | Presentation layers remain prototype | P2 |

## Synthesis decision

### Adopt now when the base gate opens

- Thin renderer-neutral DTO extensions; one body-keyed projection registry; one semantic interaction path.
- CommonUI/UMG shell over canonical snapshots, with Canvas retained as debug/fallback.
- Central item presentation descriptors.
- Mesh-only locomotion transitions and warping with zero actor-root drift telemetry.

### Defer

- Full Motion Matching, traversal migration, large-creature combat, broad biome catalog, final settings/rebinding, looting economy, and additional species.

### Reject

- Any Unreal-owned movement, wildlife AI, inventory/equipment/container truth, resource generation, damage, quests, or save state.

Implementation is not authorized by the synthesis gate until the accepted base is consolidated and asset provenance is resolved.
