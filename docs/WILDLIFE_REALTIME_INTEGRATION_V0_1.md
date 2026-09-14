# Embodied wildlife / realtime foundation integration v0.1

Integration branch: `codex/wildlife-realtime-integration-v0-1`.
Worktree: `C:/Users/green/Documents/ChatGPT/TornVeilOnline-wildlife-integration`.
Origin: `https://github.com/scrsper/torn-veil-online.git`.

## Sources and merge

- Realtime first parent: `53901d59403750b611ca6b0dbcb8301edc98f83f`.
- Wildlife second parent: `d991d22ea0d4f10bef60604b8a48c5490dca5c78`.
- Source merge: `39193ee`. Both sources remain separate and unchanged by this task.
- Git conflicts were limited to `.ai/DECISIONS.md` and `.ai/STATE.md`. Resolution retained
  both the realtime combat/prediction decisions and the wildlife decisions/history.
- TypeScript merged automatically. Semantic review retained the shared physiology kernel,
  Creature/Body ontology, canonical combat fields/validation, physical/world clock distinction,
  resource maintenance, playable generation and schema-24 execution checkpoint.
- This is an integration branch, not a merge to main or a PR. No Unreal source or assets
  were edited, and no Unreal process was started for this task.

## Scheduler and identity

`Simulation.stepScheduled` owns the live entry point. Each interaction interval calls
`stepWildlifeInteraction` once, then accumulates the existing 20 Hz slow work and executes
the existing combat step. The slow `Simulation.step(..., scheduled=true)` does **not** call
wildlife again. Both bridge stepping entry points use this scheduler. Player movement
prediction, command admission/acknowledgment and combat geometry retain their existing rules.
Fresh village and playable bridge worlds use the canonical wildlife initializer once.
Loading restores saved animals, and the isolated combat arena remains an explicit wildlife-free fixture.

The live wildlife controller samples potential encounters every 0.2 physical seconds and
replans an escape at most once per 0.6 seconds, with bounded navigation searches. It moves
only active bodies during each physical interval (normally 1/60 second). Species walking
speed, size, fatigue and the existing `travelPath` voxel/footprint sweeps constrain motion.
No renderer transform, camera, client residency or animation controls canonical movement.

Metabolism, resource decisions, intake settlement, gestation, aging, mortality and census
remain on 900 **world** seconds. The original coarse `stepWildlife` is still available to
headless ecology scenarios. Once live scheduling has been enabled, its persisted interaction
state also selects live continuation through a direct `Simulation.step` caller.

There is one Creature identity and the same zero-or-many Body references in both modes.
Per-body `encounter` state contains activation, one sight-based threat memory and a ledger
of already accounted physical/world time, walking, sleep and a bounded resource-intake
attempt. A WeakMap worklist is a disposable derived index; it is rebuilt after loading.

Nearby living Person manifestations select physical scheduling relevance regardless of
whether a player controls them. The relevance radius is at least 32 metres, with a four-metre
margin; it exceeds ordinary human observation range. Proximity alone supplies no threat knowledge. Sight uses
the species' local sensing radius and canonical line of sight. A detected Person triggers
the minimal avoidance response; a last-seen position is retained for two physical seconds,
without following the person's unseen current position. There is no human planner, combat
resolver, belief structure or LLM attached to an animal.

Active scheduling without a sensed threat continues ordinary ecological targets. Travel
toward a previously selected source is continuous; only time actually spent attempting
intake at the source can be settled later. Sleep is similarly accounted from elapsed
activity. Threats interrupt these activities; activation itself does not imply fear.

On activation, any unexecuted portion of the current background quantum is charged as
idle time. It cannot become a retrospective movement jump, meal or sleep bonus. Live travel
and rest are then recorded and deducted from the coarse budget. On deactivation the ledger
survives until the next quantum, which may spend only the remaining background allowance.
Natural death stops motion and removes the derived work item, retaining the canonical body.

## Common physical presence

`World.nearbyPhysicalBodies(pos, radius, includeDead=false)` reuses the existing watched
body spatial index. It returns physically present, owned Person and Creature manifestations,
including unsupported creatures, and optionally corpses. It is a broad-phase truth query;
observers must still establish sight, reach or other legitimate sensing.

The old `nearbyBodies` / living-Person upkeep indexes keep their existing human semantics.
Wildlife local mate/density queries now filter the common presence query instead of rebuilding
a second wildlife body index. Resource sensing retains its separate ResourceNode index.
No broad human planner/perception rewrite or animal combat admission is implied.

## Bridge contract

Normal snapshots add `wildlife: { version: 1, scope: 'observed', complete: true, bodies: [...] }`.
The existing server sends snapshots at 10 Hz; authoritative live movement remains 60 Hz.
Regional dynamics include the same observation contract filtered to the requested region IDs.
Existing bridge version 1 and regional streaming protocol 2 are unchanged; the fields are additive.

Each detached body row contains only:

- `bodyId`, `creatureId`, `speciesId`, `regionId`;
- `bodyPlan` (`id`, `shape`, adult reference `heightM`, `radiusM`), plus approximate linear
  `scale` rounded to 0.05 and `ageClass` (`juvenile` / `adult`);
- canonical `pos`, `yaw`, `vel`;
- `alive`, `dead`, `present`;
- visible `activity`: `idle`, `walk`, `forage`, `eat`, `drink`, `rest`, `sleep`, `flee`, `dead`.

The viewer must be present, alive and awake. Range, fog, facing and voxel sight gate the rows.
No exact age, hunger, thirst, private reserve, pregnancy, parentage, threat memory, route,
future target or reproduction decision crosses normal presentation. No speculative injury
or supernatural cues were added.

The array is a complete **current observation**, not a canonical lifecycle roster. A missing
row means remove it from this presentation's residency; it does not prove death. An observed
dead animal has `dead:true`, `alive:false`, `present:true`, `activity:'dead'`. An unloaded,
unseen or withdrawn body has no row. Returning to observation yields the same persistent IDs.
Projection, regional transport reset and region unload never create or remove animals.

Regional `resources` already read canonical nodes. For forage/water they additionally expose
`capacity`, `unit` (`kg` / `litres`), optional `forage` kind and `physicallyAvailable`, derived
from the current substrate/water voxels. `remaining` and `state` retain their existing meaning.
Water exhaustion also edits the existing canonical voxel and therefore the region revision.
There is no projection-owned resource stock or wildlife regeneration clock.

## Save compatibility

`SAVE_VERSION` stays **24** and ecology component version stays **1**. Optional
`ecology.interaction` stores the physical sensing countdown; each animal manifestation may
store the encounter memory and ledger above. Existing body path, pose, position, velocity,
species definitions, RNG and coarse remainder serialization are reused. The realtime
`execution.interactionCadence` checkpoint is preserved alongside ecology's independent debt.

Restoration validates finite/nonnegative ledger values, ownership, supported ecology species,
the sensing interval and the bound that accounted activity cannot exceed pending elapsed time.
Absence of the new fields remains a valid coarse wildlife save. Saves without ecology retain
their existing behavior. Loading never regenerates founders or refills forage/water.

## Validation

Final focused results (no weakened assertions or test timeouts):

| Scope | Result |
| --- | --- |
| New wildlife/realtime integration | 17 passed |
| Existing realtime/protocol/combat/bridge/streaming selection | 104 passed |
| Original wildlife ecology/lifecycle/persistence | 23 passed |
| Existing resource/metabolism/human physiology | 65 passed |
| Additional humanoid visual-state checks | 7 passed, 1 pre-existing failure |
| Typecheck and production build | Passed |

Combined distinct coverage: **216 passed, 1 baseline failure**. The final 12-file
integration/realtime/bridge run, including the extra visual-state file, passed 128 checks
with the same one baseline failure in 27.55 seconds. The final original
ecology run passed 23 checks in 99.24 seconds. The earlier 13-file existing selection took
565.37 seconds, including the existing eight-world-day resource-chain check; the full
repository regression was not run.

The extra failure is `tests/bridgeVisualState.test.ts:106`, “does not count rejected attacks;
untargeted physical swings still count.” It expects `cooldown` after 0.5 seconds but receives
an accepted request (`rejection:null`). A detached, clean Git worktree at exactly `53901d5`
reproduced the same failure with the same assertion. No combat behavior or assertion was
changed to hide it. The temporary baseline worktree was removed afterward.

The active scale check advances **128 deer for 60 physical ticks** with a single nearby
Person. It requires all 128 to remain canonically active and fewer than 5,120 total body
broad-phase candidates, including ordinary human perception. Pair reuse bounds discovery
work by nearby Person/animal pairs instead of scanning the dense group for each animal.
This is a bounded-work check, not a production latency claim.

One initial new combat fixture faced away from its target; it was corrected to face the
target, preserving the realtime canonical-facing contract. An active-death worklist edge
was found in review and fixed; dedicated coverage verifies no postmortem motion or duplicate
death. Commands:

```powershell
npm test -- tests/wildlife-realtime-integration.test.ts
npm test -- tests/ecology.test.ts tests/ecology-persistence.test.ts tests/ecology-boundaries.test.ts
npm test -- tests/realtime-session.test.ts tests/realtime-protocol.test.ts tests/realtime-combat-action.test.ts tests/realtime-combat-geometry.test.ts tests/responsive-combat.test.ts tests/combat-refinement.test.ts tests/combat-practice.test.ts tests/bridgeCombat.test.ts tests/bridgeLife.test.ts tests/bridgeVisualState.test.ts tests/bridge-streaming.test.ts tests/world-metabolism.test.ts tests/human-physiology-economy.test.ts
npm run typecheck
npm run build
```

The new integration coverage exercises common presence, one ecology quantum under both
schedulers, active transitions without retrospective movement, per-frame collision bounds,
physiology accounting, threat occlusion, continuous travel/intake/rest, removal of a source
before settlement, death during an encounter, real combat contact alongside wildlife,
unsupported creatures, projection privacy, active save/restore continuation, legacy save
fields, invalid debt rejection and regional animal/resource/death continuity.

No full regression or Unreal acceptance run belongs to this checkpoint. The previous
wildlife population/seed evidence remains in `docs/ecology-acceptance.json`; it is not a
measurement of live encounter performance or a newly executed population benchmark.

## Deliberate bounds and remaining Unreal work

This is a minimal reactive avoidance foundation using existing walking capabilities, not
a new predator, hunting, pack, flight, sprint, domestication or animal combat system.
Only the original field hare, roe deer and woodland boar definitions are used. Innate unique
abilities and sapient nonhuman cognition still require explicit controller implementations.

Intake remains coarse: an active intake attempt only commits against a source that still
exists and is reachable at the quantum boundary. An animal leaving that source before
settlement does not receive retroactive food. This conservative approximation retains matter
conservation and avoids remote consumption; it is not subsecond chewing/drinking simulation.
Injury-aware animal movement, inter-body collision/contact, human awareness of animals in all
planners and combat targeting remain future adapters. Current travel constrains voxel terrain
and footprint clearance, using the same path traversal as background wildlife.

The separate Unreal owner still needs to:

1. Parse the additive wildlife/resource DTOs without attaching Person cognition or inventory.
2. Maintain disposable presentation actors keyed by `bodyId`, linked to `creatureId`; region
   unloading and loss of sight release actors only. Re-observation reuses canonical identity.
3. Supply the three species' meshes/body-plan rigs and restrained locomotion, forage, intake,
   rest/sleep, flee and death animation bindings. Apply the approximate scale to reference size.
4. Interpolate received position/yaw/velocity for display, reconciling to TypeScript authority;
   animation/root motion must not move the canonical animal or consume physics time twice.
5. Show corpse state separately from stream removal. Remove decorative forage/water appearance
   according to canonical remaining/availability and voxel-region revisions, without client refill.
6. Run native DTO, streaming, species visual, animation and human-playtest acceptance, including
   approach/flee, occlusion, collision boundaries, active save/reload and region A→B→A continuity.

This task supplies no Unreal code, assets, native prediction adapter for animal control, hunting
input, damage binding, carcass economy or visualization acceptance claim.
