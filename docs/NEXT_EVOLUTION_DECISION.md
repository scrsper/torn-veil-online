# Next Evolution Decision — The Traveler Lives Here (player embodiment parity)

**Branch:** `claude/fable-player-embodiment`, from `main` at `a87186d` (v0.8 Legible World merged).
**Authority:** `docs/TORN_VEIL_CONSTITUTION.md` §9 / Invariant VI (shared ontology), §39 (real economic
flows), Invariant XIV; `AGENTS.md` ("an NPC and the player should always go through the same code path").

## Chosen evolution

Make the player a full participant in the ordinary-life loop every NPC already lives in — under the
same rules, through the same functions — and make that participation legible on the HUD:

1. **Same needs.** The player's body already runs `stepPhysiology` every world-minute (the strategic
   loop never excluded `controlled`), so the Traveler has been silently starving and dehydrating since
   v0.4 with no way to eat, drink, or even see it. Now: hunger / thirst / rest are shown, and the player
   eats (`eatFood`) and drinks (`drinkAt`) through exactly the metabolism functions an NPC's `eat` /
   `drink` actions call. Hunger already degrades the player's physical capability (`getPhysicalCapability`
   penalises extraction rate and carry mass) — that consequence is now real and visible.
2. **Same money.** Player purchases/sales move `Person.wealth`, the single currency every NPC path
   (`buyFoodPortion`, `payWage`, `settleWholesale`, robbery) already uses. The player's separate
   `coins`-item currency is retired as a *currency* (physical purses remain ordinary items). This closes
   the last live instance of the dual-currency split the independent audit named a Constitution §9
   violation and the mechanism of an inert-money leak.
3. **Same work market.** The player can take an open haul `Request` from its requester ("Any work?" in
   dialogue), physically load at the source (`loadHaulCargo`), carry it (real cargo item, real carry
   capacity from their own strength/hunger/skill), deposit at the destination (`depositHaulCargo`), and
   be paid by `completeRequest` → `payWage` — the identical envelope an NPC hauler is paid through,
   with the identical conservation guarantees. Failing/abandoning drops the cargo where you stand,
   exactly as for an NPC.
4. **Same meal.** "Buy a meal" at a food seller goes through `buyFoodPortion` (scarcity-priced, the NPC
   purchase path), not a player-only shop screen.

## Why now

The v0.8 playtest finding was "internally sophisticated, externally unreadable". v0.8 fixed *reading*.
The next failure a player hits is *participating*: they can watch a real economy but cannot earn, spend
at real prices, eat, drink, or hold a job in it. The Constitution's stated test for the player is
"enter reality", and today the Traveler stands outside it with an invisible starvation timer running.
Every future player-facing system (property, law, apprenticeship, institutions, class) presumes the
player is an economic and physiological participant; none can be built well on a player who is not.

## Problems it solves

- Player-facing: a survival/work/earn/spend loop exists; hunger has visible cause and remedy; jobs are
  discoverable from the people who need them; wages are real silver you then spend at real prices.
- Architectural: one currency for all persons; the "player can too" comment on `canHaul` becomes true
  in code; the Request market has its second kind of worker without a second implementation; the HUD
  reads the player's own canonical state rather than inventing one.

## Future systems it unlocks

- Wage responsiveness / labour market (Roadmap Part IX) can be *played*, not only benchmarked.
- Player-taken construction-labour and production Requests (same `Request` envelope, next slice).
- Property/ownership enforcement and theft consequences that bite on a player who needs money to eat.
- Apprenticeship / skill progression — the player already practices `hauling` on every delivery.
- Institutions (guild, guard hire) built on the same accept/complete/pay pipeline.

## Alternatives considered

1. **Fix the village-wide economic collapse (currency source, downstream-gated production, income for
   all occupations).** Highest systemic importance per the audit, but it is calibration-heavy, has
   already absorbed two milestones (v0.7, v0.8 closure) without resolution, and its player-visible
   result is indirect. It should follow this work, because a player who lives in the economy is also
   the best probe of it. Deferred, not dismissed.
2. **Semantic place/production projection (mill/bakery visibly working, stock piles, damage).** Good
   legibility value and the projector framework is ready, but it is more *watching*; the player still
   could not act. Deferred.
3. **Social cognition (opinions that change, obligations, trust-driven refusals).** Constitutionally
   central, but the existing dialogue/relationship layer needs an economic and physiological player
   for those reactions to have stakes (refusing to trade with you matters only if you need bread).
4. **HUD epistemic honesty (stop showing NPC goal / exact HP on sight).** Real defect, small; folded
   into "remaining gaps" rather than chosen as the evolution.

## Scope boundary (NOT in this slice)

- No construction-labour or production Requests for the player (haul only — one excellent path).
- No debt, credit, or new currency source; no price-model changes.
- No new poses/projectors; the player reuses the existing `haul` pose derivation.
- No changes to NPC haul cognition or wages.
- No starvation death for anyone (parity with current NPC physiology, which has none).
- Physical `coins` items stay as objects (the stolen purse remains an artefact with provenance); they
  simply are no longer the player's purchasing power.
