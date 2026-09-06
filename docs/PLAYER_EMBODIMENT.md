# Player Embodiment — the Traveler lives here

**Branch:** `claude/fable-player-embodiment`. Decision memo: `docs/NEXT_EVOLUTION_DECISION.md`.
**Constitutional basis:** §9 / Invariant VI (the player is an entity, not an exception), §39 (real
economic flows), Invariant XIV (the world does not bend around the player). `AGENTS.md`: the player
and an NPC go through the same code path for the same action.

## What was true before

- The player's body already ran `stepPhysiology` every world-minute (the strategic loop never
  excluded `controlled`), so the Traveler's hunger and thirst have been rising since v0.4 — with no
  way to eat, drink, or see it. `getPhysicalCapability` was already penalising the player's chop
  rate and carry mass for it.
- The player paid for goods from a carried `coins` Item while every NPC path (`buyFoodPortion`,
  `payWage`, `settleWholesale`, robbery) read `Person.wealth` — the dual-currency split the
  independent audit named as both a §9 violation and the mechanism of an inert-money leak.
- `canHaul()`'s comment said "the player can too" while returning `false` for `controlled`; there
  was no way for the player to accept, load, deliver, or be paid for a Request.

## What exists now

### One currency
`Simulation.buyItem` / `sellItem` move `wealth` → `wealth`. No coin Item is minted anywhere. The
generated village gives the Traveler `wealth: 50` and no coin stack; `SAVE_VERSION` is 12. Physical
`coins` items (the stolen purse) remain ordinary objects with provenance — they are no longer anyone's
purchasing power. Dialogue's debt payment ("Pay Fenn's twenty silver") is a wealth transfer.

### Same needs, same remedies
`src/sim/logistics/participation.ts` adds no metabolism of its own; it exposes:
- `eatAtHand(world, person, placeId)` → `findAccessibleFood` + `eatFood` (the NPC `eat` action's
  own functions, same household-larder accessibility rule).
- `drinkHere(world, person, pos)` → `drinkAt` when standing at a `well`-type Place.
- `buyMealFrom(world, buyer, seller)` → `buyFoodPortion` (scarcity-priced, real stock).

Client: **C** eats, **E** on a well/water drinks, "Buy a meal" in dialogue with anyone selling food.
The HUD shows hunger / thirst / rest from the player's own `needs` with the same severity bands
(`hungerBand` etc.) the Inspector shows for NPCs, plus the purse (`wealth`).

### Same work market
- `canAcceptHaul(p)` (haul.ts) is the shared eligibility rule; `canHaul(p) = !controlled &&
  canAcceptHaul(p)` exists only so `think()` never plans a goal for a body it does not drive.
- `haulOffersFrom(world, npc)`: open haul Requests the person raised or that were raised for their
  workplace. Dialogue: **"Any work going?"** with the baker, miller, stall-keeper, innkeeper…
- `acceptHaulOffer` → `claimHaulTask` (same claim, same `request_accepted`).
- `progressHaul(world, person, pos)`: `loadHaulCargo` at the source, `depositHaulCargo` at the
  destination, using the NPC action handlers' own 4 m / 3 m proximity rule. The wage is paid inside
  `depositHaulCargo` → `completeRequest` → `payWage`, once, on completion — never by this module.
  Carry capacity is the player's own `personalCarryUnits` (strength, fatigue, hunger, hauling
  skill); a heavy job takes several trips, and each delivery practices `hauling`.
- `abandonHaul` → `failHaulTask` (cargo dropped where you stand, request failed unpaid). Pressing
  **Q** on carried cargo does this; walking off with the cargo set down fails the job the same way.

Client: **G** performs the step the player's position allows and says what happened (or how far and
which way the next place is). The HUD shows the current job. The player's body shows the same
`haul` pose an NPC carrying cargo shows, derived from `world.haulTasks`, not set by the UI.

### Simulation entry points (mind/agent.ts)
`haulOffersFrom`, `activeHaulFor`, `acceptHaul`, `progressHaul`, `abandonHaul`, `buyMeal`,
`eatAtHand`, `drinkHere` — one-line delegations so `src/game/` calls `Simulation`, per AGENTS.md.
None of them read `controlled`.

## Tests
`tests/player-embodiment.test.ts` (11): physiology parity; eat/drink through the canonical
functions; wealth-to-wealth trade with conservation and no coin item; generated-village starting
kit; dialogue meal purchase; eligibility split; offer → accept claims the real Request; full
load → carry → deposit → paid loop with conservation and `wage_paid`; multi-trip heavy cargo pays
once on completion; abandoned cargo fails honestly. `tests/trading.test.ts` and
`tests/persistence.test.ts` were updated from coin-item to wealth assertions (they encoded the
retired behaviour).

## Limitations / next
- Only haul Requests are player-takeable; construction-labour and production Requests use the same
  envelope and are the obvious next slice.
- No starvation death for anyone (parity with current NPC physiology).
- The HUD still shows an NPC's goal type and exact hit points on sight (audit P2-4) — unchanged.
- The village-wide economic collapse the audit measured is not addressed here; the player is now a
  participant in that economy and therefore a better probe of it.
