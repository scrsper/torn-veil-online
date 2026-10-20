# Levels, experience and the rank ladder (Normal → Diamond)

This adds an RPG-style exponential leveling system to the canonical simulation and completes
the rank ladder from Normal to Diamond. It applies identically to the player and to NPCs,
assesses mobs and items on the same scale, and keeps the Constitution's rule that
**tier is classification and capability is truth** (§14): no level or rank label is ever read
by combat, perception or any other resolver.

Influences, concretely:

| Source | What it contributes here |
|---|---|
| He Who Fights With Monsters | Ten sub-levels per rank shown as "Iron 3"; a breakthrough opens the new rank at 0; rank-ups remake the body (the **vessel**); higher ranks demand fighting threats of your own rank; absorbing an essence is the start of power; items carry rank-named grades. |
| Defiance of the Fall | One global level 1–60; exponential level cost; level-difference XP (more for stronger foes, nothing for far weaker ones); the **bottleneck**: a full track cannot level until a breakthrough; evolution requires peak level plus foundations. |
| Dungeon Crawler Carl | Achievements recognised once and announced as events; mob levels; party credit split by contribution; floor-milestone trials in the Tower. |

## Doctrine kept

* Experience comes only from explicit adapters over canonical events. No caller supplies an
  amount; each source event pays a given person once (`event.data.experienceCredits`).
* Levels never enter combat. What a breakthrough changes is a **stored physical component**
  (the vessel) written by the advancement event and validated against it on load.
* The existing Normal→Iron embodied gate and the Iron–Gold source-transformation gates are
  unchanged. Levels gate only the new transitions (embodied Bronze–Diamond, source Diamond).
* Nothing is retroactive. Saves from schema 31 and earlier load with no ledger and no vessel;
  practice, victories and foundations recorded before the ledger opened are not converted.
* Other people's levels are not shown to the player (they are not observer knowledge). Your
  own level is self-knowledge, like your foundations. Developer inspection shows the truth.

## The curve

`xpToNext(L) = round(100 × 1.2^(L−1))` for global level L (1–60). Each leveled rank has ten
levels; `<rank> s` is global level `10 × rankIndex + s + 1`.

| Rank | Levels | First level | Last level | Peak (full track) | Practice hours alone |
|---|---|---:|---:|---:|---:|
| Normal | 1–10 | 100 | 516 | 2,596 | 9 |
| Iron | 11–20 | 619 | 3,195 | 16,074 | 54 |
| Bronze | 21–30 | 3,834 | 19,781 | 99,521 | 332 |
| Silver | 31–40 | 23,738 | 122,481 | 616,197 | 2,054 |
| Gold | 41–50 | 146,977 | 758,370 | 3,815,334 | 12,718 |
| Diamond | 51–60 | 910,044 | 4,695,626 | 23,623,539 | 78,745 |

Each rank costs about 6.2× the one below. A defeat pays a share of the **victim's** level
cost, so roughly ten even fights complete a level at every rank, while practice (a fixed rate)
carries a mortal through Normal and fades: training alone cannot make a Gold.

**Bottleneck.** Experience fills the current rank's track only. When the track is full
("peak"), later experience is recorded as overflow and not banked. A `level_attained` event
marks each completed level and the peak; a breakthrough reopens the next rank at 0.

## Where experience comes from

| Source | Adapter | Amount | Exploit limits |
|---|---|---|---|
| Defeat | `recordDefeatExperience`, called by the shared hit resolver `Simulation.applyHit` | `0.1 × xpToNext(victimLevel) × gap × share` | Only a defeating blow on someone still in the fight: a body already down, yielded, subdued or held pays nothing, so finishing or executing them is not a defeat. A person must have resisted each credited contributor (an agreed trial, or they struck that contributor this encounter); an animal must be wild and killed. Shares count **effective** damage only (never overkill). A contributor needs a quarter of the victim's health. Each victim pays a person once, ever. |
| Surrender | `beginSurrender` on `entity_surrendered` | as a defeat | Yielding is being overcome: the same encounter, resistance and share rules credit the contributors once. |
| Practice | `recordCapabilityPractice` (existing ledger) | 300 per credited effective hour | The capability ledger's own provenance, novelty, repetition and daily limits. |
| Foundations | `develop()` on each new integer point | `round(25 × 1.2^(value−8))` | Each value once; values held when the ledger opened are baseline. Only development with a canonical cause pays: a fight, credited practice, a meditation, an understanding. Ordinary labour and growing up strengthen a body without levelling it. |
| Tower floor | `observeCanonicalTower` on `tower_floor_cleared` | `0.25 × xpToNext(mean warden level) × gap` | One clear per floor, derived from canonical defeats. |
| Learning | `learnArcaneSource` on `arcane_learned` | `0.3 × xpToNext(min(own, form level))` | Each form once (learning is idempotent); a basic form learned late is worth what it is. |
| Achievement | `achieve` | `levels × xpToNext(min(own, deed level))` | Once per person, priced by the deed (the opponent, quarry, floor or form), so a trivial first saved for a high rank stays small. |

`gap` (DotF): `min(2.5, 1 + 0.15 × (victim − victor))` above, `max(0, 1 + gap/12)` below, so an
opponent twelve or more levels weaker teaches nothing. **Victim level** is capability, never a
label: for a person, the strongest threat they actually presented while striking during the
encounter, or, if they never struck, what they stood ready with at the end (a kitted Tower
warden with no history is still dangerous; a rank label or earned level adds nothing, and a
weapon handed over at the last moment adds nothing either). An animal's level is its threat.

**Encounters.** The shared hit resolver keeps a small per-body tally (`Body.encounter`): the
effective damage each attacker dealt, whom the body struck, and the strongest threat it
presented while striking. Entries lapse after ten minutes without a blow; a defeat or a
surrender closes the encounter. This replaced scanning the global event log, which missed long
fights in a busy world and could not tell overkill from real damage.

A defeat of a person beyond ordinary mortal threat (Iron band and up) also develops the body
through the ordinary `develop()` operator with challenge `10 + 0.9 × victimLevel`; ordinary
brawls keep their existing effect on village life. Only such opponents can push a ranked body
past 20.

## Achievements

| Id | Title | Reward (levels) |
|---|---|---:|
| `first-blood` | First Blood: first resisting opponent overcome | 0.5 |
| `giant-slayer` | Overcame an opponent five or more levels above you | 1 |
| `rank-breaker` | Overcame an opponent whose threat lies in a higher rank | 1.5 |
| `untouched` | Overcame an equal-or-stronger opponent that could fight back, without being struck by them | 0.5 |
| `last-stand` | Delivered a defeating blow below a sixth of your health | 0.5 |
| `quarry:<species>` | First wild kill of a species | 0.25 |
| `awakened` | First arcane form learned | 0.5 |
| `exceptional` | A foundation developed to 15 | 0.5 |
| `tower:1/10/25/50/75/100` | Tower milestone trials | 0.5–1.5 |
| `breakthrough:<rank>` | Each rank reached; credited on the advancement event itself | 0.5 |
| `peak:<rank>` | A full track (peak Diamond is the summit of the ladder) | 0 |

Rewards are `levels × xpToNext(min(own level, deed level))`; the deed level is the opponent's
or quarry's threat, the floor's warden level, the form's grade, or Normal band for an
exceptional foundation.

## The rank vessel

Every breakthrough path (`advanceToIron`, `integrateArcaneSources`, `advanceRank`) calls
`onBreakthrough`, which remakes each body of the person and records the vessel on the event:

| Rank | Resilience (× original max health) | Force (× own strikes) | Foundation ceiling |
|---|---:|---:|---:|
| Normal | 1 | 1 | 20 |
| Iron | 1.6 | 1.5 | 26 |
| Bronze | 2.5 | 2.5 | 34 |
| Silver | 4 | 4 | 44 |
| Gold | 6.3 | 6.3 | 56 |
| Diamond | 10 | 10 | 70 |

The health *fraction* is preserved: nothing is healed or wounded and injuries remain. Force
enters the existing `embodiedStrikeMultiplier` extension point. Development now continues for
every leveled rank up to the vessel's ceiling, with potential shifted by the same lift, so a
remade body meets the same resistance relative to its new limit; Normal bodies are unchanged.
The strength/dexterity expression clamp is `max(2, ceiling/16)`, also unchanged for Normal.
Source victories still measure control against the **original** body, so a vessel's larger
health does not soften the unchanged 97% Gold control gate.

## Routes to Diamond

**Embodied** (`core/advancement.ts`). Normal→Iron is unchanged. Each later trial needs:
peak level of the current rank; distinct opposed victories over threats at or above the
current band; one practiced capability anchoring the path (its core foundations at the core
demand, all others at the support demand, technique provenance, sustained skilled practice);
and a recovered body. The shared `attempt_breakthrough` action and `advance` intent dispatch
by rank for players and NPCs alike; NPCs consider it only at peak.

| Trial | Core / support | Victories (level) | Practice | Proficiency |
|---|---|---|---:|---:|
| Iron → Bronze | 24 / 18 | 8 (11+) | 8 h | 60% |
| Bronze → Silver | 32 / 25 | 12 (21+) | 24 h | 68% |
| Silver → Gold | 42 / 33 | 16 (31+) | 72 h | 76% |
| Gold → Diamond | 54 / 43 | 24 (41+) | 200 h | 84% |

**Source transformation** (`physical/arcana/growth.ts`). Iron–Gold rows are unchanged. The new
Diamond row needs 2,000 distinct opposed victories, all eight damaging forms demonstrated,
eight learned essences, five spare essences consumed and 97% sustained control, **plus** peak
Gold and 24 victories over Gold-band threats (level 41+). It grants amplitude 45, aperture 20
and reserve 480. The event pins those victories as causes and `data.experience`.

Diamond is the summit of the leveled ladder. God and beyond are ontological transitions, not
numeric advancement (Constitution §15); `advancementBlocked` reports them as blocked.

## Threat levels for people, mobs and items

`progression/threat.ts` estimates a ten-second duel against the ordinary reference adult
(attributes 8, unarmed, 80 HP): offense (damage to an unarmored body, plus the free time a
longer reach buys while the reference closes) × durability (health over the share of reference
blows that pass the armor). Level = `1 + ln(power)/ln(1.135)`. Transient fatigue, hunger and
wounds are excluded. Item grades are the factor an item multiplies the reference's power by.

From `npm run leveling:report` (real entities and the real formulas; ladder rows are
constructed capacity fixtures):

| Assessed | Level | Grade |
|---|---:|---|
| field hare, roe deer (flee only) | 1 | Normal |
| woodland boar (defensive charge) | 7 | Normal |
| ordinary adult | 1 | Normal |
| guard with sword, 110 HP | 15 | Iron |
| Tower wardens, floors 1 / 5 / 25 / 50 / 75 / 100 (max) | 1 / 11 / 15 / 18 / 19 / 14 | Normal–Iron |
| source capacity + vessel: Normal / Iron / Bronze / Silver / Gold / Diamond | 4 / 11 / 21 / 34 / 46 / 56 | each in its own band |
| embodied, ready for the next trial: Iron / Bronze / Silver / Gold | 15 / 24 / 33 / 42 | each in its current band |
| dagger / axe / sword | 7 / 10 / 11 | Normal / Normal / Iron |
| warden harness (any floor ≥ 10) | 5 | Normal |
| warden focus, floors 50 / 75 / 100 | 14 / 18 / 21 | Iron / Iron / Bronze |

`POWER_PER_LEVEL = 1.135` was calibrated so the implemented ladder places each rank in its
band; the test suite asserts this for both routes.

## What the player sees

* Journal (and the Babylon menu's Journal tab): `Iron 3 · level 14`, an experience bar,
  progress to peak, the vessel, achievements, aggregate band-victory counts (never the levels
  of individual defeated people), the next breakthrough's remaining reasons and the practice
  that breakthrough actually needs.
* **Announcements** (Dungeon Crawler Carl "System"): the player's own level-ups, peaks,
  achievements and breakthroughs appear as toasts in the realm client and Tower HUD, from their
  own events only, and never replay on reconnect.
* **Observed threat:** a stranger is read only by species and the weapons, armor and foci they
  visibly wear or wield, as an ordinary adult body. The Tower HUD shows it for the selected
  target ("target looks Iron-grade (≈level 11)"); realm residents carry it. It is a lower bound,
  deliberately: hidden foundations, health, vessels and forms are not observable.
* **Item grades:** carried combat items show their grade to their holder ("Iron-grade weapon
  (item level 11)"); ordinary goods have none.
* Realm character sheet: level line, achievements, each route's requirements named ("Iron by
  bodily practice", "Iron by essence integration") and an **Attempt the … breakthrough** button
  (`advance` command → shared timed action). A breakthrough already under way shows its time
  left instead of the button; the command refuses a duplicate or ineligible attempt.
* Tower HUD: level and experience, once, in the same wording as the other surfaces.
* Observatory / developer inspection: earned level, vessel, and equipped and intrinsic threat.

## Persistence

Schema 32. `progression/persistence.ts` fails closed on malformed ledgers, vessels or
encounter tallies: ranks and track bounds, foundations, defeated ids, feats (distinct, each a
real defeating attack or surrender of a credited victim), achievements (real
`achievement_earned` or advancement events by the same person), vessel values equal to the
table and to the advancement event, an embodied trial's own receipt (the rank below, peak, its
distinct feats among its causes), base health per own body, and every person's attributes
within their ceiling (20 without a vessel). Arcane validation accepts a victory's control
measured against the original or any remade body, and a source transformation followed by a
later embodied breakthrough of the same person. Compaction pins feats, achievements, the track event and the vessel event; the recent
receipt window is informational and pins nothing. Arcane save bounds rise for schema 32 to fit
Diamond capacity (mana 480, cast power 120, damage/effects 6,000, range 300, radius 40).

## Measured findings and limits

* **Current content tops out around Iron-band threat.** The strongest warden kit assesses at
  level 19 (floor 75); floor-100 casters use the weaker gravity field. A climber can level
  through Normal and Iron from the Tower, part of Bronze, and no further: above that, wardens
  fall into the grey. The arcane route still reaches Gold rank by victory counts, so rank can
  outpace level. Higher-band leveling needs higher-threat content; the system values any such
  content automatically because it assesses real capability.
* **Diamond is reachable mechanically, not yet in play.** Peak Gold (3.8 M) and 24 Gold-band
  victories need Gold-band opponents that the current world does not contain. Tests reach
  Diamond with disclosed fixtures for exactly those two conditions.
* **Steel weapons are worth about one rank of threat** in the existing strike model, and armor
  is capped by the 65% per-hit rule, so even floor-100 harnesses grade Normal. These are
  observations about existing balance that the scale makes visible, not changes to it.
* **Measured climb** (`src/headless/towerClimb.ts`, seed 918271, hybrid bot, accelerated input):
  Normal 2 after floor 1, Normal 5 after floor 3 and **peak Normal after floor 4**, where wardens
  first carry daggers and harness and assess at level 11. Experience then overflows. The bot
  fails floor 10 within 600 s on this branch and floor 9 on `main`, with 36–40 of the 48
  victories source Iron needs: a pre-existing wall that the leveling bottleneck now makes
  visible. This is a bot strategy, not human pacing; no human pacing has been measured.
* Experience gains inherently hint at an opponent's danger (as in any RPG); the projection
  limits this to the player's own totals and aggregate band counts.
* The constants are authored policy in `progression/levels.ts`, documented here, and reported
  by `npm run leveling:report`.

## Files, commands and tests

* `src/sim/progression/levels.ts` — browser-safe curve, bands, gap, vessels, trials.
* `src/sim/progression/experience.ts` — ledger, credit, adapters, achievements, vessels.
* `src/sim/progression/threat.ts` — threat for people and animals, item grades.
* `src/sim/progression/persistence.ts` — schema-32 validation.
* `src/sim/core/advancement.ts` — embodied Bronze–Diamond trials and the shared dispatcher.
* `src/headless/leveling/` — `npm run leveling:report` (also writes `.debug/leveling/report.json`).
* `tests/leveling.test.ts` — curve, threat calibration, every source through its real path,
  bottleneck, vessels, Iron→Bronze through the timed action, source Diamond (2,000 victories),
  Tower floors, journal, persistence and tampering.
