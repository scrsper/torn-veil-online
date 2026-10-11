# Magic in the Tower of Chrysanthus, and its god

Magic, imbuing, potions, the Proving Hall (where every magic can be tried), and Chrysanthus, god of the tower.
Code: `src/web/arena/magic.ts` (data), `src/web/arena/world.ts` (kernels, statuses, reactions), `src/web/arena/vfx.ts`
(effects), `src/web/arena/tower/tower.ts` (emergence, loot, belt, hall) and `src/web/arena/tower/chrysanthus.ts` (the god).

## Constitution alignment

| Principle | Where it comes from | How the tower applies it |
|---|---|---|
| Capability before class | §12: mana control and elemental affinity are capabilities | A spell exists because the climber holds an affinity and has learned a form; nothing is picked from a menu |
| Classes and skills emerge from capability and history | §12 | Spells dawn as insights when affinity meets form; mana control grows with every cast; spells rank up with use |
| Mechanical truth vs cultural interpretation | §30, its example: "fire mana becomes stronger near volcanic leylines" | Each floor has a ley element (+35% to that element, faster mana). The scholars' note gives a measurement; the faithful credit a god |
| Gods are entities, with manifestations | §42, §13 (God tier: one being, many bodies) | Chrysanthus meets you on floor 10 as an avatar and at the summit as himself |

## Elements and forms

A spell is an element shaped by a form. Ten elements and eight forms give 80 spells, each with its own name:
- **Lightning:** Lightning Bolt, Thunderhead.
- **Gravity:** Singularity.
- **Time:** Stasis Field, Rewind, Blink.
- **Water:** Hydro Jet.

| Elements | Forms |
|---|---|
| Fire, Ice, Lightning, Wind, Earth, Shadow, Life, Water, Gravity, Time | Bolt (missile), Nova (burst), Wave (cone), Field (lasting zone), Lance (line), Weave (imbue weapon), Ward (self), Step (teleport) |

- **Spells emerge.** Once an element's affinity reaches 1, every form you know gives its spell. You get an *INSIGHT*
  announcement; the spell fills an empty slot if there is one and otherwise joins the Spellbook.
- **Sources of affinity:** elemental tomes, essences, god boons and gear affixes. Time comes only from Chrysanthus.
- **Forms** come from treatises.
- **Bootstrapping:** the first chest or boss that finds you with no form gives a treatise; one that finds you with no
  element gives a tome. Magic starts on floors 1–2.
- **Mana** is a separate bar from stamina. It refills with mana control (which grows as you cast) and runs faster on a
  ley floor. Maximum mana grows with mana control and total affinity.
- **The Spellbook (B)** shows the element × form grid: discovered spells are lit, the rest are named and greyed.
  - Click a spell, then a slot, to ready it.
  - It also lists your affinities, the floor's ley and the reaction rules.

## Element behaviour and reactions

Each element leaves a status. Statuses are the memory of a fight, so combinations emerge in play.

| Combination | Result |
|---|---|
| Water, then Lightning | **Electrocute:** double damage, stun, arcs to every wet foe nearby |
| Water, then Ice | **Freeze:** frozen solid for 2 s (the body's own clock stops) |
| Frozen, then Fire, Earth, or a heavy or critical blow | **Shatter:** triple damage |
| Burning, then Water (or Fire on the wet) | **Steam:** douses the burn; everyone in the cloud staggers |
| Burning, then Wind | **Wildfire:** the flames leap to nearby foes |
| Gathered by Gravity, then a burst | **Crush:** bonus damage to foes pulled together |
| Slowed by Time, then any three contacts or blows | **Rupture:** stored time bursts out as damage |

Other element behaviour:
- **Wind** hurls.
- **Earth** shreds armour (+20% damage taken) and staggers.
- **Shadow** wounds the unaware.
- **Life** heals you from what it harms, and roots.
- **Gravity** fields drag foes in, then collapse. Wind and water fields pull too.
- **Time** fields slow everything inside.

Wards differ by element:
- **Earth:** Stoneskin is 60% stronger.
- **Life:** Barkskin regenerates you.
- **Shadow:** Veil of Night makes half of attacks miss.
- **Time:** Rewind returns your health to what it was three seconds ago.
- **Other elements:** the ward strikes attackers with its element.

Bosses shake statuses off faster, and gods barely notice them.

## Imbuing and potions

- **Weave spells** imbue the drawn weapon for 20 s. Every ordinary blow, melee or arrow, then carries the element and
  its reactions, and the weapon glows.
- **Runestones** imbue a weapon slot for good. Elemental elixirs imbue for 30 s.
- **The belt (V drinks the first):**

| Potion | Effect |
|---|---|
| Mana Draught | Restores 60% mana |
| Quicksilver Tonic | +25% move and attack speed |
| Giant's Draught | +30% damage |
| Stoneblood Elixir | −40% damage taken |
| Draught of Clarity | Spells free for 8 s |
| Elixir of *element* | Imbues your weapon |

The flask (Q) still heals.

## The Proving Hall (floor 0)

`Play the Proving Hall.cmd`, `?arena=1&tower=1&hall=1`, or the Combat Gym panel's **Enter the Proving Hall** button.

- **What you get:** every element at affinity 1.5, every form (all 80 spells), seven slots and 400 mana.
- **Belt:** one of each potion, plus six runestones by the north wall.
- **Training dummies** that mend themselves.
- **N** summons real foes.
- **No consequences:** loot, achievements and class churn are off.
- The door leads to floor 1.

## Chrysanthus

The god of the tower: the top-tier floor-100 boss, met first on floor 10 as his avatar.

**Body** (`build_arena_stylized.py`, look `chrysanthus`):
- tall and heroic, with long hair and an authored full beard;
- an ivory robe with gold pauldrons and gold gloves;
- bare feet, because he floats and never touches the ground.

**Equipment** (runtime): a sword in his right hand, an orb of shifting element in his left, and a staff strapped to his
back, all under a golden aura.

**Floor 10, the trial:**
1. He descends from above the hall in golden light.
2. He speaks. His lines read your run: class, tier, kills, essences, the magic you have learned, bare hands,
   legendaries and achievements. You answer three times.
3. Then the trial begins. **Phase 1:**
   - teleporting sword strikes (blockable, parryable);
   - orb volleys of every element;
   - soak then shock: a wave of water, then lightning from above. He uses the reactions too.
   - gravity wells and a time slow;
   - **Verdict:** a golden mark, then an unblockable blow. Dodge it.
4. **Phase 2, after one minute:** he draws the staff (the sword goes to his back):
   - starfall;
   - **stasis:** your time stops;
   - an unblockable staff sweep.
5. **Damage barely touches him** (2.5%). The trial ends when he has seen enough (30 blows landed, or 90 s), or when you
   would fall: he catches you.
6. **Farewell:** he speaks again, reviewing your blows, the verdicts you dodged, and whether he had to spare you.
7. **His gift:**
   - **The Unwound Hour:** +1 Time affinity. This is the only source of Time magic.
   - **A Seat at My Table:** one more skill slot.
   - **Two Lessons:** two forms you don't know.
8. He rises and vanishes, and the stair opens.

**The summit (floor 100):** the same god fights for real, taking 35% of damage. You can win.

## Evidence (automation, not a human playtest)

| What | Status | How it was checked |
|---|---|---|
| 80 spells, deterministic, distinct | VERIFIED | `tests/web-magic.test.ts` |
| Reactions through the real engine | VERIFIED: Electrocute, Freeze, Shatter, Steam, Wildfire, Crush | `scripts/web/magic-reactions.ts` |
| Every form cast in the hall; Rupture and Wildfire in play | VERIFIED (screenshots) | `scripts/web/magic-showcase.ts`: no errors, ~7 ms median frame |
| Floor-10 trial end to end | VERIFIED | `scripts/web/chrysanthus-trial.ts`: descent, adaptive dialogue, real-input fight (unblockables dodged, soak-shock landed), staff phase, farewell, gift (Time spells emerged), door open, no errors |
| Spell emergence in a normal climb | VERIFIED | `tower-climb.ts`, seed 29: Frost Nova emerged on floors 1–6 |
| Feel: damage numbers, cooldowns, mana flow, trial difficulty | UNVERIFIED | Needs human play |
| Summit true-form fight | IMPLEMENTED, not played | |
