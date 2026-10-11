# Canonical Tower integration decision — October 8, 2026

Status: **audit and proposed implementation boundary, not implemented**. Inspected candidate `88d8eba`
on `codex/connected-realms`. The existing combined game passes all 2,050 tests in 204 files, but that
does not make browser encounter outcomes canonical. This report precedes implementation because the
coordinator explicitly requested a report first if a substantial design conflict was found.

## The conflict

`src/web/arena/world.ts` declares ArenaWorld a disposable combat laboratory outside canonical World.
Its Fighter owns health, mana, energy, attacks, elemental statuses and defeat. TowerRun derives floor
completion, equipment and scoped progression from that browser simulation. Moving its checkpoint to
the host, checking its shape, or putting ArenaWorld behind a headless renderer would still leave two
sets of physical rules. The current `authority: checkpoint-only` label accurately describes that limit.

The Constitution §§4, 9, 11, 14, 29–30 and 41 requires simulation-owned reality, shared mechanics,
intentional conflict and capability-based advancement. The requested canonical integration fits those
principles. Preserving every prototype combat mechanic unchanged through a small adapter does not.

| Existing Tower behavior | Existing ordinary-world contract | Consequence for integration |
| --- | --- | --- |
| Fighter health, elemental damage/statuses, flasks, client defeat | Body health/injury plus Person physiology; canonical contact resolves damage | A checkpoint cannot award damage, healing or kills. The renderer must consume host outcomes. |
| Many spells, mana regeneration, ley bonuses, divine armor | `physical/veil.ts` implements the provenance-gated Veil Hush; no matching contract for the Tower spell catalogue was found | Porting the entire catalogue introduces substantial new shared mechanics. Hush does not stand in for arbitrary spells. |
| Run weapons, affixes and automatic upgrades | Ordinary Item ownership, equipment slots, condition, hand actions and provenance; armor catalogue powers remain descriptive | Preserve existing Item identities. Do not manufacture functional affixes or grant checkpoint gear. |
| Floor-driven Bronze/Silver/Gold and higher labels | `core/advancement.ts` implements Normal→Iron; higher paths explicitly remain blocked pending metaphysics | Never copy the scoped label or relax practice, knowledge, recovery or history gates. |
| Defeat ends a climb; retry starts a new healthy Fighter | Injury, nonlethal downing and explicit lethal intent; death invokes history and inheritance | Retry cannot reset canonical health or resurrect a Person. A dead character needs an existing supported recovery/embodiment path, not an implicit new one. |
| Browser-owned floor roster, NavGrid and simulation clock | One World grid, navigation, Simulation and physical/world clocks | Floor collision and actors must exist in the same host World. Run the clock once. |

The legacy prototype remains valuable as art, layout and combat-feel work. This finding does not authorize
deleting it, weakening global rules, rewriting its author's branch, or converting its old rewards.

## Smallest safe path

**Recommended: implement a canonical connected-Tower encounter using currently supported World actions,
retain the standalone prototype and its saved run, and extend shared mechanics in later explicit slices.**
This is a meaningful behavioral difference: the first canonical encounter cannot honestly promise all
100 floors' spells, affixes, divine powers or scoped rank progression. That difference requires a scope
decision before replacing the currently linked run. Full mechanic parity is a larger simulation project.

1. **Attach existing control.** Construct one `BridgeSession` with `state: {world, sim}` and
   `defaultPlayer: false`; open its channel for the existing Person. Those APIs already attach without
   generating another world or traveler (`src/bridge/session.ts`). Reuse its body-bound command envelope,
   command queue, `submitCombatInput`, movement, guard, hand/container and projection contracts. Reject
   practice/reset/debug commands at the connected route. Keep the existing single-controller lease over
   both pages; a second tab must never acquire a second World or combat clock.
2. **Materialize a bounded real floor.** Extract only renderer-independent seeded geometry from the
   existing maze generator into `src/sim/world/realms/`; leave colors, effects and mesh selection in web.
   Add a persisted instance descriptor and stable building/floor/room/actor identities. Represent its
   walls, doors, walkable arrival and owned ordinary Items in the canonical grid. Move the same Body to
   that floor only after validating both landings. The current grid has no instance-address contract;
   choose and test an explicit bounded namespace rather than quietly using the solid inter-realm gap.
   Use the same descriptors to draw collisions and access, never a separate client NavGrid as authority.
3. **Use one physical result.** Host canonical opponents and their supported conflict intentions through
   the existing NPC action paths. Player and NPC strikes use `Simulation.stepScheduled`, canonical contact,
   `applyInjury` and `applyHit`. Reuse ordinary equipment/consume/take actions. Project results into the
   existing Babylon character and floor presentation; do not run ArenaWorld.step for a bound encounter.
   Preserve surrender/downing as valid outcomes: hostility alone cannot imply a lethal fight.
4. **Persist facts as they happen.** Keep injury, death, ownership and consumption on the same entities
   during the encounter, not copied back from the browser on return. Dynamic Persons/Bodies/Items already
   serialize. Persist the new instance descriptor, floor objectives and causal reward receipts alongside
   their entities and execution state. Validate the roster and geometry before restoring a controller.
   Reconstruct/rebind the bridge if a failed save rolls back the RealmSession; no stale World reference
   may remain in the controller, timer or queued input.
5. **Make rewards causal and idempotent.** Prefer finite ordinary loot placed in the generated floor and
   transferred by existing inventory actions. A completion reward, if used, needs an explicit supported
   reward source, a host-verified objective event and a durable receipt keyed by instance/floor/objective
   and recipient. Record source Item IDs and transfer events in the same atomic save. The browser sends
   an intent, never a reward amount or completed-enemy list. Replayed transfers and lost acknowledgements
   return the persisted result without new Items, events, practice credit or rank. The current command
   queue is a bounded connection ledger, not a replacement for durable reward/transfer receipts.
6. **Return without repairing the character.** Validate a live body's destination, clear transient input
   and commit the same body/inventory/injuries with the return position before acknowledgement. Downing
   or death must remain real: present the actual resulting state; no free escape, health reset or revival.
   Cross-realm resumption uses the saved canonical instance and existing Person/Body. Ordinary clock and
   bounded NPC work continue under the same scheduler, with no full population simulation for scenery.

The existing bridge is the reusable implementation seam, not permission to adopt its whole rural UI or
world generator. Shared components and the existing Tower art can be retained without a wholesale rewrite.
Actual compatibility with the realm grid, scheduled NPC work and Tower presentation remains to be tested.

## Save and rollout contract

- Keep version-27 checkpoint-only expeditions readable and immutable as legacy scoped evidence. They
  cannot seed canonical rewards, spell knowledge, rank or a full-health replacement body.
- Add a discriminated canonical expedition version and migration tests. Archive/reference the old bound
  run explicitly rather than silently converting its floor-two equipment or overwriting it. Existing
  independent Tower localStorage saves and rural world saves remain untouched.
- Existing canonical items cross the threshold by retaining their IDs and holders. A new canonical
  encounter starts from present World state; its prospective starting kit must have an ordinary source.
- Host-generated floor completion follows actual resolved objectives. Persist outstanding reward and
  transfer receipts. A save failure blocks the transition and retains the previous durable state.
- Reload resumes the persisted physical/execution state; it must not recreate an untouched floor with
  consumables already spent or injuries already applied. A deliberately chosen safe checkpoint policy
  must roll back the entire atomic World, never only its player or only its encounter.

## Required acceptance checks after implementation

| Area | Evidence required |
| --- | --- |
| Identity and command authority | Same Person/Body entering, fighting, returning and changing realm; unknown/other-body commands rejected; only one lease and scheduler. |
| Equipment and consumption | Existing equipment affects canonical resolver; consume decreases the existing Item once; drop/take/equip preserve ownership/provenance over reload. |
| Injury and death | Canonical attack/contact produces persistent local injuries and physiological costs; downing remains nonlethal; explicit lethal fixture uses ordinary death/history/inheritance; return cannot heal/revive. |
| Rewards and ranks | Source-backed finite loot or objective receipt; duplicate, reordered and malicious claims do not grant rewards; Normal→Iron assessment remains unchanged, higher ranks remain blocked. |
| Determinism and persistence | Same seed and accepted ordered inputs reproduce physical outcomes; save/reload preserves roster, RNG, geometry, action/execution state and receipts; no duplicate floors or opponents. |
| Transitions and failures | Return and cross-realm resume; cancellation; disconnected/reloaded active page; stale revision; failed disk write; lost acknowledgement before/after commit; retry after restart. |
| Simultaneous tabs | Second tab refused; old closing socket cannot release a replacement; stale epoch input cannot replay consumption or combat; exactly one physical clock. |
| Actual browser proof | Ordinary-input encounter with visibly correct held equipment, canonical consequences, return and cross-realm resume; actual screenshots/video and clear fixture labels. |

Existing 2,050 passing tests, 11 journey checks and 9 recovery checks validate the present checkpoint-only
candidate; **none are claimed as completed verification of this proposed canonical encounter**.

## Decision needed before the mechanical replacement

Proceed with the recommended shared-mechanics encounter and preserve unsupported prototype features in
standalone Tower until they receive canonical implementations, or require full shared spell/item/power
parity before replacing the linked run. The latter is a larger scope with unresolved metaphysics, not a
safe quick adapter. No code or gameplay rule was changed by this audit. The requested street/art pass
remains next after canonical correctness, as directed; the character candidate remains unintegrated.
