# John Smith: the Orchestrator's watch, quests and loot

John Smith is the orchestration layer above the simulation (Constitution §16–18). He is
not a Person, has no body, holds no rank and never acts inside the world as a character.
This system gives him his first canonical role: an **archivist that watches canonical
history**, **recognizes** (never authors) the matters and deeds it finds there, presents
them to the people who carry his **interface**, and adjudicates a **finite, seed-authored
reserve** of loot.

He is a *scheduler + kernel + archivist + constitutional authority*, not a dungeon master.
Nothing in this system creates a threat, a goal, an NPC desire, a request, a quest giver,
a combat encounter, a rule change or a power grant. Every quest is a reading of a real
open matter; every feat is a reading of real canonical events; every cache is a numbered
portion of a finite reserve that existed from the world seed.

Code: `src/sim/orchestrator/`. Host wiring: `src/server/towerController.ts` (watch pass
after each fixed step), `src/server/realmRuntime.ts` (journaled `johnsmith` operations),
`src/server/realms.ts` (projection push and socket commands), `src/server/launchHome.ts`
(Observatory developer truth). Browser: `src/web/realms/johnSmith.ts`, mounted by the city
client (`client.ts`) and the Tower client (`ascent.ts`). Tests: `tests/john-smith.test.ts`,
`tests/john-smith-realm.test.ts`.

## The four parts

| Part | What it is | Source of truth |
|---|---|---|
| **Watching** | John Smith's attention on significant entities, and his record of deeds. | `World.historicalSignificance`, canonical events |
| **Quests** | Open matters an interface holder actually knows of, with live objectives. | The holder's own knowledge, possessions, commitments and deeds |
| **Overview** | The interface: quests, the watch, feats, loot, the archive of one's deeds. | A detached allowlisted projection (`johnSmithView`) |
| **Loot** | Tiered caches from a finite reserve; history-derived appraisal of items. | Seeded reserve table + canonical items with provenance |

An **interface holder** is a living, externally controlled person (or `World.playerId`).
Everyone else is watched by the same rules, but only holders receive quests, notices and caches.

## Constitutional boundaries (enforced by tests)

1. **Simulation authority.** John Smith reads canonical state. His only writes to the
   physical world are the ones a cache opening requires: one owned container and its
   items, each with provenance naming the reserve and the cache, and folding that
   container away once it is empty. Everything else he keeps lives in `World.johnSmith`,
   which no mind, goal, combat rule or economy path reads.
2. **No story authorship.** No recognizer may cause a matter. A quest exists only while a
   canonical source exists (a trial the holder agreed to, an award or coffer they own, a
   source they carry, a threshold or place they have seen, a desire they were told of, a
   request they accepted, a concern or obligation they hold, a crime they suffered or saw,
   a fight they are in).
3. **Local knowledge.** A quest is recognized only from what the holder knows: their own
   knowledge items (with provenance), their possessions and commitments, and their own
   deeds. Waypoints appear only when the holder holds a location belief. A matter ends
   for the holder only when the holder has evidence it ended: the
   `personalSituationView` gate, their own act (a person knows what they did without
   hearing of it), or their own perception. If the world changes behind their back, the
   quest stays open "as far as you know" and eventually fades.
4. **Deliberate system presentation (§61).** The interface shows coarse orchestrator
   state that no character could otherwise know: the holder's own attention tier, the
   attention tier of persons the holder *knows by name*, a count of watched entities
   beyond the holder's knowledge, the holder's renown (how many living people's minds
   hold an event the holder did), the reserve's remaining stock, and an item's archival
   legend tier. These are presentations of mechanical truth to an interface holder. They
   never enter any mind's knowledge and never feed a decision. Names the holder never
   learned stay out of the projection (a trial warden is "a trial warden").
5. **Shared ontology.** Ledgers, feats and attention apply to every person and creature by
   the same rules. Persons without the interface still earn recognitions, which are
   recorded but cannot be delivered.
6. **No feedback loops.** Orchestrator events carry no `actor`/`target`, so they add
   nothing to historical significance, and carry no position, so no mind perceives them.
   John Smith never draws from `world.rng`; every choice uses a stable hash of the seed and
   identifiers, so it cannot shift any other random stream. The reserve never pays for its
   own deliveries (see Loot pacing).
7. **Capability over labels.** A cache tier, an item's catalog tier and its legend tier
   never grant power. Mechanics come only from the canonical item fields the rest of the
   simulation already uses (`damage`, `physicalArmor`, `arcaneSource`, consumable type).
8. **Finite reserve.** The reserve per world is fixed. A spent tier substitutes the next
   lower tier with stock; when all are spent, recognitions are logged without a cache.
   Materialized cache items carry the cache id, so finiteness survives even if the
   orchestrator record itself were lost (`reconcileReserve`).
9. **No retroactive awards.** The record starts at the end of history when John Smith first
   runs. Earlier deeds are never counted, and a Tower floor cleared before he arrived is
   never recognized.

## Watching

- A cursor over canonical event ids processes each event once, in id order, on every host
  step. Periodic passes run once per second of physical time (attention every 2 s, renown
  every 10 s), so the journal's replay reproduces them exactly.
- Per-person **ledgers** count deeds: blows, downs, kills, blows taken, floors cleared,
  flawless and near-death clears, crossings, sources learned, casts, advancement stage,
  returns, gifts, heals, thefts, arrests, crafts, debts paid, settled matters, caches
  opened, attention and renown. Holders' ledgers are kept for life; others are bounded
  (least recently active forgotten first).
- A creature's knockdown is credited to the creature (`downed.data.by`); the holder's
  archive files it as their own hard experience ("Knocked down by the woodland boar.").
- A per-item **deed archive** records hits, downs, kills and wielders of weapons, which
  drives the item **legend** (Unremarkable → Storied → Renowned → Legendary). Rarity is
  history: a plain trial dagger that has downed thirty wardens is appraised above a
  pristine catalog sword.
- **Attention tiers** are fixed thresholds over lifetime historical significance
  (0/1/5/25/100/400): Unremarked, Noted, Watched, Followed, Studied, Fixated. Holders are
  at least Noted: the interface is itself John Smith's attention.
- **Renown** counts living people (other than the holder) whose minds hold a belief
  about an event the holder performed.
- **Travels**: places of public note within sight (36 m), the Veil threshold (30 m), the
  realm wards the holder has walked, and the places they have entered.

## Quests

Each recognizer has two functions: `scan` lists matters currently open for the holder;
`judge` decides whether an existing open quest has ended *from the holder's evidence*.
Quests carry provenance (`basisKeys`), objectives recomputed from state, and close as
`completed`, `failed`, `moot` or `faded`. A closed quest never reopens; a matter that
opened and closed between two passes is recorded once, as closed.

| Kind | Opens when the holder… | Ends | Cache |
|---|---|---|---|
| trial | is climbing a Tower floor they agreed to | cleared / fallen / run over | milestone floors at new altitude: 5 Silver, 10 Gold, 25·50·75 Platinum, 100 Legendary |
| award | owns a cleared floor's sealed award | emptied / left behind | — (the award is the reward) |
| coffer | has an unfolded cache coffer still holding things | emptied / left behind | — (housekeeping, not counted) |
| study | carries a book or essence they have not learned | learned / lost | — |
| veil | has seen the threshold and never crossed | crossed | — (the feat pays) |
| landmark | has seen a public place and not entered it (two nearest) | entered | — |
| recover | was told someone wants an item back | returned / given away / owner dead / returned by another | Silver |
| reclaim | knows something of theirs was stolen | back in their hands | Bronze |
| protect | accepted a protection request | settled / failed | Silver |
| work | accepted haul, labour or production work | done / failed / cancelled | Bronze |
| tend | holds an active welfare worry about someone | saw them well / knows they died | Bronze |
| justice | suffered or witnessed a wrong (not inside an agreed trial) | learns it was answered for / culprit dead | Silver |
| repay | holds a live obligation or debt | fulfilled / broken / forgiven / lapsed | Bronze |
| fight | is in an unagreed fight (two or more blows) | resolved | Bronze, only if they did not start it |

The holder may **watch** up to four quests (the HUD tracker; new quests take a slot by
themselves only while fewer than three are watched) and **hide** quests from the journal.
Neither is a canonical act: abandoning a commitment still happens in the world, through
the ordinary social path.

## Loot

Reserve per world: Bronze 240, Silver 96, Gold 36, Platinum 12, Legendary 4, Celestial 1.

Caches are granted by **feats** (58 recognitions: combat, Tower, Veil, arcana, society and
the archive itself; each a threshold over a ledger counter, each earned once) and by
**settled matters**. They are opened by the holder at a safe moment: alive, able, not
restrained or recoiling, not inside a Tower trial, no live fight within 30 s and no
threat close by. A refusal says why in John Smith's voice.

An opened cache unfolds as an owned coffer at the holder's feet; its contents are a pure
function of the seed and the cache id (the seal hides them, it does not decide them).
Items are ordinary canonical items (provisions, catalog weapons and armor with bounded
quality, curios, signet rings, scrolls from Gold, books from Platinum, essences at the top)
created with provenance `finite orchestrator reserve`. The Celestial cache holds three
pieces of one named Legendary set. Items are taken with the ordinary container transfer
command, so carry mass, ownership and theft rules apply; an emptied coffer folds away.

### Pacing: the reserve is shared and finite

- A **trial milestone** pays only above the holder's best completed floor
  (`HolderRecord.bestTrial`); climbing back to it on a later run earns the floor's own
  sealed award, not the reserve.
- Any other **kind of matter pays at most once per world day** per holder; later matters of
  that kind still settle and count, and say so.
- A matter that ended **without the holder's hand in it** closes unpaid and uncounted: an
  arrest someone else made, a worry about harm the holder caused.
- The reserve **never feeds itself**: recognitions for opening caches ask for nothing, and
  emptying one's own coffer is not a settled matter.
- First-steps feats are Bronze. Advancement pays Silver (Iron) through Legendary (Gold);
  the single Celestial cache belongs to the hundredth floor.

## The interface

- **Sigil** (attention tier, unopened-cache badge, a pulse when the tier rises) and
  **tracker** (watched quests, objectives, a live bearing and distance to the believed
  location; targets behind folded Tower walls or across the Veil show no misleading
  bearing). The city client places them under the realm title; the Tower client at top right.
- **Notices** arrive as toasts (recognitions in their tier colour); a first visit shows
  only the latest notice, and seen notices are remembered per record epoch in local storage.
- **Overview** (key O): Quests, Watch, Feats (earned, and the four nearest), Loot (the
  reserve, sealed caches with the safety verdict, the open coffer, appraisals of carried
  weapons) and Archive (the holder's own file).
- **Reveal**: unsealing shows the contents with Take everything / Leave it here.
- Every action is a validated request (`open_cache`, `watch_quest`, `dismiss_quest`) or the
  ordinary container transfer. The browser bundle imports only types from the simulation.

## Persistence and replay

`World.johnSmith` is an additive optional save field (no schema bump), validated strictly
on load (`restoreJohnSmith`); a malformed record refuses the save rather than guessing.
Holder commands are `RealmOperation`s, so the realm journal replays them exactly; the watch
pass runs inside the controller step on canonical physical time, so replay reproduces it.
All records are bounded (ledgers 256, item deeds 256, attention 96, notices 80, archive
120, quests 120 with at most 40 open, marks 400 with once-in-a-life deeds never dropped).

## Evidence (2026-10-19)

- `tests/john-smith.test.ts` and `tests/john-smith-realm.test.ts`: 32 deterministic tests
  covering every boundary above, each quest kind, pacing rules, reserve purity and
  exhaustion, safe opening, save round-trip, journal replay equality, and a seeded random
  run of 400 deeds, commands and time jumps that checks every invariant at every step.
- Real host + Chromium: the city (watch the Veil quest, cross, receive notices, unseal a
  cache, take everything, archive and feats tabs) and the Tower (trial tracker, cache
  refusal mid-trial, bearings hidden behind folded walls), with no page errors.
- Cost: a full periodic pass is ~0.03 ms in the realm world and ~0.4 ms with 400 people;
  reading events costs ~3–6 µs each in a 400-person brawl.

## Limits

- John Smith does not yet reallocate cognitive fidelity (CLOD) from attention.
- NPCs do not perceive cache openings; the coffer is a physical object they can see but not
  an event they learn.
- The realms build has no dialogue, so social quests appear there only from perception and
  commitments; the full social set is exercised by the deterministic tests.
- Thresholds, reserve sizes and pacing are authored policy, not measured pacing.
