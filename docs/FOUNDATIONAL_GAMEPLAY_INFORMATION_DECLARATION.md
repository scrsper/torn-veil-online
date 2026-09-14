# Foundational Gameplay Presentation v0.1 — Information Declaration

Status: implementation checkpoint complete on 2026-09-14; native build and focused verification pass, pending human playtest.

## A. Verified facts

- The canonical production checkout is `C:/Users/green/Desktop/projects/torn-veil-online`.
- The implementation base is `origin/main` at `333665e4ce5c33baee7e751bf35044daa6b296d4`, which consolidates embodied ecology, realtime wildlife interaction, realtime combat/contact and martial selection/learning.
- Work is isolated in `C:/Users/green/Desktop/projects/torn-veil-online-foundational` on `codex/foundational-gameplay-presentation-v0-1`; the dirty production checkout was preserved and not switched.
- `src/sim/` owns canonical identities, bodies, position, inventory, combat, ecology, knowledge, and persistence. `src/sim/core/types.ts`, `src/sim/physical/interactionMovement.ts`, `src/sim/physical/combatAction.ts`, `src/sim/ecology/`, and `src/sim/persist/save.ts` are concrete sources.
- Disposable native movement/combat prediction and reconciliation already exist in `src/bridge/commands.ts`, `src/bridge/session.ts`, `src/sim/physical/prediction.ts`, `TVBridgeSubsystem`, and `TVCharacter`. Native character collision/movement authority remains disabled.
- The native camera is one spring-arm third-person presentation with collision, lag, zoom, shoulder offset, mouse/stick look, and canonical facing integration in `TVCharacter.cpp`.
- Locomotion presentation currently uses canonical velocity/yaw/pose, a 2D blend space, sprint selection, pose snapshots, bounded foot IK, and combat handoffs. There are no dedicated start/stop/pivot presentation states.
- Canonical inventory is `Person.inventory: EntityId[]` over persistent `Item` entities. Shared pickup, drop, give, buy, consume, and resource interactions exist in `src/sim/core/interaction.ts`, `src/sim/physical/hand.ts`, and `src/sim/mind/agent.ts`.
- `handInteractions` projects semantic, observable affordances and `performHandInteraction` revalidates state, reach, passage, ownership/action kind, and availability. The bridge sends opaque interaction IDs to this canonical path.
- Schema-24 additive canonical `Container` entities now own capacity/open state/item identities and validated whole-stack transfer; equipment slots remain absent and combat still derives weapons from carried items.
- Native UI remains an `AHUD::DrawHUD` implementation but now applies CommonUI-style HUD/modal/back/controller principles to inventory, physical containers and pause/settings surfaces. CommonUI is not yet enabled and no widget owns canonical state.
- UE 5.8 CommonUI and PCGBiomeCore engine plugins are installed. No local Lyra, Electric Dreams, or Content Examples project was found in the inspected project/install locations.
- The local Game Animation Sample exists at `C:/Users/green/Desktop/projects/GameAnimationSample` and was inspected read-only. No code or asset was imported.
- Roe deer canonical state exists in `src/sim/ecology/species.ts` and `src/sim/ecology/types.ts`. `Creature.id` and `Body.id` are persistent; per-body activity/physiology is persisted. Death and presentation withdrawal are distinct.
- `src/bridge/wildlife.ts` projects observer-visible activity, condition and persistent body/creature identity. `TVBridgeSubsystem` now maintains disposable actors keyed by `bodyId`; omission withdraws presentation while `dead` remains a rendered state.
- Ecology advances on a fixed 15-minute quantum and authoritative travel is materialized in TypeScript. A native deer layer would need timestamped interpolation/reconciliation without changing canonical displacement.
- Current PCG dressing in `TVWorldProjection` is seeded from canonical substrate, collision-free, tagged `TV.Decorative.NoGameplay`, and kept distinct from canonical resources.
- No cleared final roe-deer mesh/rig/animation set was found. The committed v0.1 actor uses only Unreal Engine basic-shape meshes as an explicitly temporary procedural proxy; no vendor AI or animal asset was imported.
- Save schema 24 now persists containers and contained-item location additively alongside people, items, bodies, ecology, resources and scheduler state.

## B. User-established design intent

- TypeScript simulation owns canonical world truth; Unreal is presentation/input plus disposable local prediction.
- Players use ordinary entity/body/action rules. Control status is not world knowledge.
- Equivalent player and NPC actions use the same canonical mechanics.
- Combat acceptance, contact, damage, injury, death, inventory, item location, container/equipment state, wildlife behavior, ecology, and save/load remain canonical.
- Wildlife identities persist across presentation streaming. A corpse is not a despawn.
- UI exposes only legitimately observed or communicated possibilities and information.
- PCG decorates canonical facts but cannot manufacture canonical resources.
- Standard presentation problems should begin with mature references and thin adaptation, not novel parallel authority.
- Commercial and uncertain-license assets/code must not be copied or committed.

## C. Inferences

- A thin CommonUI/UMG shell over bridge DTOs is the lowest-risk permanent UI direction.
- A renderer-neutral movement-presentation DTO plus mesh-only start/stop/pivot selection can improve locomotion without changing authority.
- Wildlife should use a body-keyed actor registry tied to regional residency and distinct dead/withdrawn handling.
- The 15-minute ecology cadence will require bounded visual interpolation and may expose large corrections unless the bridge provides suitable samples; presentation must catch up rather than delaying truth.
- Explicit equipment slots remain a later canonical extension; v0.1 does not infer equipped truth from the inventory screen.

## D. Unknowns

- A redistribution-cleared roe deer mesh, skeleton, and animation source and its final project path.
- The final canonical equipment-slot model and equip/unequip semantics.
- Whether CommonUI should be enabled immediately or introduced after a minimal UMG adapter proves bridge contracts.
- Human approval of movement, camera, combat continuity, wildlife presentation, UI, and performance; no human quality approval is claimed.

## E. References actually inspected

| Reference | Location/source | Exact systems inspected | Principle extracted | Read-only | Imported |
|---|---|---|---|---|---|
| Torn Veil repository | Production checkout and named branches | `.ai` guidance; bridge/session/streaming/regions; hand interactions; core types; ecology; persistence; native bridge/character/HUD/world projection; focused tests | Existing authority, interaction, projection, persistence, and streaming seams | Yes | No |
| Game Animation Sample | `C:/Users/green/Desktop/projects/GameAnimationSample` | `SandboxCharacter_Mover*`, `SandboxCharacter_CMC*`, third-person/strafe/aim/collision/crouch camera rigs, character/camera property data, movement thresholds, orientation/rate warping modifiers, motion-warping notify, traversal/movement-mode data, debug config | Data-driven presentation, pose continuity, bounded warping, composable camera policy | Yes | No |
| UE 5.8 CommonUI plugin | `C:/Program Files/Epic Games/UE_5.8/Engine/Plugins/Runtime/CommonUI` | Installation/module presence only | Input-routed layered UI is locally available; no Torn Veil integration exists | Yes | No |
| UE 5.8 PCGBiomeCore plugin | `C:/Program Files/Epic Games/UE_5.8/Engine/Plugins/Experimental/PCGBiomeCore` | Installation presence; Torn Veil's existing PCG projection was inspected in detail | Data-driven biome tooling is available but cannot own resources | Yes | No |
| Lyra | Local search | Not found | Use only general stated design principles until an actual project/source is inspected | N/A | No |
| Electric Dreams | Local search | Not found | No implementation claim adopted | N/A | No |
| Unreal Content Examples | Local search | Not found | No implementation claim adopted | N/A | No |
| RDR2, Witcher 3, Ghost of Tsushima, Elden Ring, Monster Hunter, Skyrim, Fallout, Valheim | User-provided design references only | No proprietary source/code/assets inspected | Presentation language and usability targets only | N/A | No |

## F. Adopted patterns

| Reference | Torn Veil adaptation | Authority owner | Why |
|---|---|---|---|
| Game Animation Sample | Data-driven start/stop/pivot/gait selection and bounded mesh-only orientation/rate warping over canonical samples | Unreal presentation; TypeScript displacement | Improves continuity without a second movement model |
| Game Animation Sample camera rigs | One composable exploration/combat camera policy around the existing spring arm | Unreal presentation | Preserves one game language and canonical desired/resulting facing separation |
| CommonUI/Lyra principles | HUD root, prompt layer, modal stack, consistent cancel/focus/device glyph adapter | Unreal presentation | Reuses established navigation/input patterns while DTOs remain canonical projections |
| Existing hand interactions | One semantic prompt list; client sends opaque interaction ID; simulation revalidates | TypeScript | Already shares rules and prevents widget-granted actions |
| Existing region projection/PCG | Canonical substrate/resources plus seeded decorative, collision-free dressing | Split: TypeScript facts, Unreal decoration | Richness without simulated grass or resource duplication |
| Wildlife presentation language | Orient/weight shift/acceleration/gait/settle as nonblocking visual transitions | Unreal presentation | Communicates canonical state without inventing behavior |

## G. Rejected patterns

- Sample-owned Mover, ChaosMover, NetworkPrediction, or gameplay-framework authority.
- Full Motion Matching migration during this milestone.
- Root-motion, CharacterMovement, or animation-authored canonical displacement/contact.
- Unreal-owned NPC or wildlife AI.
- Lyra-owned inventory truth or UI-owned container/equipment state.
- Blueprint-specific interaction logic for each object.
- PCG-created resources or collision that changes canonical traversal.
- Client-authoritative damage, pickup, transfer, equip, or wildlife response.
- Canned quest generation or omniscient request/journal queries.
- Commercial-game assets/code and unverified marketplace/sample assets.

## H. Risks

- Integration: later changes to bridge DTOs must retain command revalidation and body-keyed presentation identity.
- Licensing: no cleared deer asset; several local vendor packs have unverified redistribution terms.
- Authority: UI-only containers/equipment or Blueprint wildlife behavior would duplicate truth.
- Persistence: new canonical state needs explicit schema/version semantics and round-trip tests.
- Streaming: body identity, dead bodies, withdrawal, and region residency must not be conflated.
- Performance: wildlife interpolation, UI snapshots, PCG density, and regional application share the native frame budget.
- Presentation: low-cadence wildlife samples and network jitter can create corrections, foot sliding, or false state timing.
- Asset quality: the safe deer proxy proves architecture and state language, not final silhouette, rigging, foot planting or animation quality.

## I. Current confidence

| System | Confidence | Basis |
|---|---|---|
| Canonical/presentation authority | VERIFIED | Repository rules, decisions, source, tests |
| Realtime combat/movement seams | VERIFIED | Branch/source/docs inspection |
| Current camera/locomotion implementation | VERIFIED | Native source and sample comparison |
| Generic item interactions | VERIFIED | Canonical and bridge source/tests |
| Container support | VERIFIED | Canonical source, bridge tests and save/load round trip |
| Equipment support | VERIFIED ABSENT | Combat still derives carried weapon; UI does not invent slots |
| CommonUI availability | VERIFIED | UE 5.8 plugin installation |
| Lyra/Electric Dreams/Content Examples availability | UNVERIFIED beyond searched locations | No local project found |
| Canonical roe deer identity/activity/persistence | VERIFIED | Ecology/core/persistence source |
| Unreal wildlife projection | VERIFIED | Native build plus body-keyed projection source |
| Deer asset provenance | VERIFIED TEMPORARY | Engine basic-shape proxy; final cleared deer art remains unknown |
| UI/locomotion/wildlife adapters | VERIFIED | Focused TypeScript/native tests, build and startup smoke |
| Human-facing quality and acceptance | UNVERIFIED | Human playtest has not yet occurred |
