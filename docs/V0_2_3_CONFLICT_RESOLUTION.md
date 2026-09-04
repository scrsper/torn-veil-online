# v0.2.3 — Social & Conflict Resolution

**Scope:** a focused simulation-infrastructure pass on top of v0.2.2 Scale Readiness
(`main` at `71a897f` at the start of this pass). Branch:
`claude/v0.2.3-conflict-resolution`. No v0.3 progression/metaphysics work is included.

**Method:** every finding and number below was produced by running the real headless
engine (`npm run sim`, the same canonical `World`/`Simulation`/village generation the
browser client uses) at fixed seed `918271`, plus the deterministic test suite, plus a
real browser smoke test of the voxel client. Nothing is inferred from code shape alone.

---

## 1. Problem

The v0.2.2 Scale-Readiness Audit established that the primary blocker to longer
simulation was no longer per-event CPU cost. It was that **Torn Veil had mechanics for
initiating and escalating conflicts but almost no general mechanic for ending them.**

- `Relationship.fear`/`grudge` only ever rose. Decay existed (a crude fixed exponential
  in `strategic()`) but had no notion of severity, of whether an active threat still
  existed, or of the difference between a passing fright and a defining grievance — and
  it was dominated by reinforcement as long as the fight continued.
- A knocked-down combatant recovered after ~45 seconds and, still carrying maximum
  fear/grudge, immediately re-registered as a threat and re-engaged.
- `arrest` was an *attack intent*, not an *outcome*: a guard could subdue a criminal
  and then... stand there, and the criminal would get up and the fight would resume.

The consequence was that **event-generation rate itself grew over calendar time.** At
seed `918271` an ordinary guard/bandit conflict generated 150+ retained attack events
while never resolving, and an 8-day headless run became pathological — killed after
340+ seconds in the audit, and completing in a degenerate 219s / 8110 attacks on the
hardware used for this pass.

v0.2.3's job: make conflict an **evolving social state with causes, escalation,
consequences, and endings** — capable of avoidance, intimidation, a completed robbery,
an escape, a withdrawal, a surrender, a subdual, an arrest, custody, release,
deterrence, reconciliation, persistent nonviolent hostility, or — when justified —
death. Not a combat-content expansion. Simulation infrastructure.

---

## 2. Architecture

### 2.1 Relationship evolution (`src/sim/mind/relationships.ts` · `evolveRelationships`)

Deterministic, semantically-shaped temporal evolution — **not** "subtract a fixed
amount from every field every tick". Run on a ~10-minute cadence from `strategic()`
(its half-lives are hours-to-days; per-minute granularity was pure cost).

| dimension | behaviour |
|---|---|
| **fear** | half-life ~16h once the danger is gone; **does not decay at all** while an active/disengaging `Conflict` with that entity exists (`activeThreat`) — you do not calm down mid-fight |
| **grudge** | half-life ~5 days, and only *toward the `grievance` floor*, never below it; half-life ×3 while an un-`handled` known crime by that actor is still on the books (`unresolvedHarm`) |
| **grievance** (new field) | a durable floor under `grudge`, set only by severe harm — the killing of kin (0.9), the sustained assault of oneself by the same attacker ≥3 times (up to 0.55). Decays only on a ~400-day half-life: a defining wrong stays defining |
| **trust** | recovers from the *negative* side toward neutral on its own ~10-day half-life — being no longer afraid of someone is not the same as trusting them |
| **affection / respect / familiarity** | deliberately **untouched** on a combat timescale — a wronged friend is still a friend who was wronged |

`grievance` is a first-class `Relationship` field, ratcheted up (never down) by
`adjustRel({ grievance })`, and a positive grievance immediately pulls `grudge` up to
its floor so the relationship reads as hostile at once.

### 2.2 Explicit conflict state (`src/sim/social/conflict.ts` · `World.conflicts`)

```
Conflict {
  id, participants[2], initiator, cause, intent,
  status: active | disengaging | suspended | resolved,
  escalation (0..1), attackCount, startedAt, lastMeaningfulInteraction,
  resolvedAt?, outcome?, startEventId?, resolveEventId?
}
```

- **cause:** `robbery | crime_response | self_defense | faction_hostility | retaliation | dispute | territorial | unknown`
- **outcome:** `objective_completed | robbery_completed | target_fled | aggressor_fled | surrender | subdual | arrest | custody | withdrawal | deterrence | reconciliation | death`
- **status:** `suspended` is the canonical "persistent nonviolent hostility" state —
  two rivals / feuding families / enemy factions who are not *currently* attacking each
  other.

Owned by the canonical simulation. `beginConflict` is idempotent per participant pair
(a fight is one conflict no matter how many blows); a `suspended`/`disengaging`
conflict that is freshly re-engaged reactivates in place rather than duplicating.
`Simulation.applyHit` creates/updates it on every blow between two people;
`recordConflictBlow` bumps escalation and fires `conflict_escalated` when the
aggressor's intent hardens (`rob → subdue → injure → kill`). Telemetry, the Chronicle,
and the anomaly detector **read** conflicts; none mutate them.

`maintainConflicts` (deterministic, every ~10 world-minutes) drives the lifecycle: a
dead party → resolve `death`; a detained party → resolve `custody`; an `active`
conflict stale >40 min with the parties out of contact → `disengaging`; `disengaging`
past a 20-min grace → `suspended` or `resolved` by who broke off and the cause; a
long-`suspended` conflict whose mutual grudge has cooled below 0.12 → resolve
`reconciliation`.

### 2.3 Disengagement (Priority 3)

- **Losing-badly flee:** in a live conflict, health < 32%, opponent materially
  healthier or you're outnumbered, opponent not out to kill → a high-utility `flee`
  that *overrides* the bandit/guard "bravado" (`brave`) term that previously kept both
  sides fighting to the last.
- **Bounded pursuit:** a chase (`attack`/`take_custody`/`talk` re-issuing a `goto`
  toward a target it cannot reach) gives up after 4 failed approaches or 46 units, sets
  a **per-target pursuit cooldown** (`Mind.pursuitCooldowns`, ~45 min), and lapses the
  conflict to `disengaging`. Without this a guard who can see but not path to a known
  criminal re-adopted `attack` every think tick — a path_failure / goal_completed storm
  that was, in fact, the single largest remaining cost after the fear/grudge fix (see
  §5).
- Choosing to `flee` an opponent you have a live conflict with **is** breaking it off:
  `disengageConflict` is called from `setGoal`.
- A completed robbery calls `resolveConflict(..., 'robbery_completed')` directly — the
  objective was met, the fight ends there.

### 2.4 Surrender & subdual (`src/sim/social/custody.ts`, Priority 4)

- **Surrender** is voluntary and canonical (`Person.surrender`). Adopted via a
  `'surrender'` goal when the fighter is genuinely cornered: critically wounded
  (< 16% health) **and** pinned or outnumbered, opponent not trying to kill. Timid
  actors fold; fierce ones and guards resist (`courage`/`aggression`/`loyalty`
  penalties). Clears after 6h of world time with no fresh aggression (`maintainCustody`)
  — they warily get back up.
- **Subdual** is imposed: a downing blow whose intent was `subdue`/`arrest` sets
  `Body.subduedUntil` (~2 world-hours), holding the body incapacitated far longer than
  the ~45s plain knock-down and blocking re-engagement.
- `Simulation.applyHit` returns `null` (no hit) for any non-`kill` attack on a
  surrendered / subdued / detained person — a safety net beneath goal selection, which
  already skips them as threats. `kill` intent still lands (grim, but constitutional).
- A subdued / surrendered / in-custody body stays `pose: 'downed'` — neither the
  held-state `wait` action nor `bodyPhysics`' recovery stands it back up.

### 2.5 Arrest & custody (Priority 5)

```
crime known → confrontation → surrender OR subdual → arrest → custody → release
```

`takeIntoCustody(detainee, by, crimeKey, conflict)`:

- sets `Person.custody = { active, byFactionId, byId, reason, crimeKey, since, releaseAt }`;
- clears any surrender (custody supersedes);
- emits `entity_arrested` (history) + `custody_started` (history);
- writes an institutional record to the arresting faction:
  `faction.knowledge['custody:<id>'] = { state: 'in custody', reason, since, crimeKey }`
  (Constitution §37 — the institution learns through a real process, not telepathy);
- marks the justifying crime `handled` for the arresting officer and their faction peers;
- resolves the conflict `arrest`.

`releaseAt` is `since + custodyDurationFor(crimeType)` — deterministically 1.5 / 3 / 6
world-days for theft / attack / kill. No courts, no sentencing model (explicitly out of
scope). `maintainCustody` releases at `releaseAt`, emits `custody_ended`, updates the
institutional record to `state: 'released'`, and gives the detainee a 12-hour
`layLowUntil` window during which they do not initiate fresh robberies — so a released
bandit does not walk out and cycle straight back in.

A detained person runs the `'idle'` held goal (no combat, no movement) and cannot be
freshly arrested.

### 2.6 Re-engagement gating (Priority 7)

`Simulation.reengagementBlocked(p, otherId)`: **true** when a `Conflict` with `otherId`
has already ended (resolved / suspended / disengaging) and nothing *new* has happened
since — no fresh aggression, no un-`handled` crime learned *after* the conflict wound
down. Grudge and fear on their own **do not restart a fight**. A blocked entity is
tracked as someone to be *wary of and keep clear of* (an `avoid` → `flee` goal for
non-hostiles) rather than attacked.

This is the distinction that lets rival families, enemy factions, and historical
enemies exist as a canonical state (`suspended` conflict + retained grudge/grievance)
without generating combat forever.

### 2.7 Canonical events (Priority 8)

New `WorldEvent['type']`s, each a real canonical state change (not telemetry decoration):
`conflict_started`, `conflict_escalated`, `conflict_disengaged`, `conflict_resolved`,
`entity_surrendered`, `entity_subdued`, `entity_arrested`, `custody_started`,
`custody_ended`. The terminal / status-change ones (`conflict_resolved`,
`entity_surrendered`, `entity_arrested`, `custody_started`, `custody_ended`) are
`category: 'history'` and retained through compaction. Attacks and confrontations carry
`data.conflictId`. Causal ancestry is preserved; conflict-lifecycle events filter their
`causes` to events that still resolve (a `Conflict` outlives many hourly compaction
passes).

### 2.8 Chronicle conflict compression (Priority 9)

`buildChronicle` pulls every *operational-detail* event of a fight — blows, demands,
`conflict_started`/`_escalated`/`_disengaged`/`_resolved` — into a per-`conflictId`
bucket and emits **one entry per conflict**:

> Day 101 — Brigid Tallow and Vex came into conflict over a crime; it ended in an arrest (2 exchanges).

The *turning points* inside a conflict (`entity_surrendered`, `entity_subdued`,
`entity_arrested`, `custody_started`, `custody_ended`, `kill`, `death`) stay as their
own entries — they are important consequences, not blow-by-blow:

> Day 101 — Brigid Tallow subdued Vex.
> Day 101 — Brigid Tallow arrested Vex for theft.
> Day 101 — Vex was taken into the Village Watch's custody.

Every source event id and the union of causal ancestors are preserved on the
consolidated entry. A 40-blow conflict → 1 entry (regression-tested). The deterministic
30-day Chronicle is **251 entries** (of which 122 are conflict entries) rather than
tens of thousands of raw blows.

### 2.9 Anomaly detection (Priority 10)

New observational anomaly classes (grouped, never one-per-occurrence, never mutate the
sim):

- `unresolved_conflict_loop` — an `active` conflict open > 12h with ≥ 25 blows and no
  resolution (the exact v0.2.2 shape). Carries `{ participants, cause, status, durationWorldHours, attackEvents }`.
- `surrender_or_custody_ignored` — a non-`kill` attack landing on a surrendered / detained person.
- `repeated_arrest` — the same person arrested ≥ 4 times inside the window (a
  revolving-door custody problem).

The 30-day benchmark at seed 918271 produces **zero anomalies**.

---

## 3. Epistemic behaviour

Observers learn about conflict outcomes through the **existing** perception pipeline —
`entity_surrendered` / `entity_subdued` / `entity_arrested` / `custody_started` all
carry `visibility`/`loudness`, so a witness in range perceives them, `learn()`s a
knowledge item with `source.viaEvent` provenance, forms a memory, and can gossip it
onward. Someone out of range learns nothing until told. An NPC does not know a
surrender or arrest happened unless information legitimately reached them
(regression-tested: a witness present at an arrest learns it; someone across the map
does not).

Faction knowledge of a detention is **institutional**: it is written to
`faction.knowledge` only by `takeIntoCustody`, from the arresting officer's own
first-hand knowledge — never by mirroring every member's private knowledge. The
`custody:<id>` record moves `in custody → released` at release time.

The `victim always knows who hit them` guarantee and the `witness learns the canonical
event, not the ephemeral perception` fix (both in `applyHit`/`tell`/`remember`) mean
gossip about an old arrest days later still resolves to a real causal ancestor rather
than dangling.

---

## 4. Persistence

`SAVE_VERSION` bumped **3 → 4**. New canonical state that depends on simulation history
and cannot be re-derived from present state, and is therefore persisted explicitly:

| state | where | why persisted |
|---|---|---|
| `World.conflicts` (the whole lifecycle) | top-level array | a fight in progress, or a `suspended` feud, or a `resolved` arrest whose outcome feeds re-engagement gating, cannot be rebuilt from present positions |
| `Person.surrender` | per person | a surrender must survive a reload |
| `Person.custody` | per person | an active detention (and its `releaseAt`, institutional reason) must survive a reload |
| `Body.subduedUntil` | per body | a subdual that outlasts the save must reload still subdued; a downed pose is reconstructed from it |

**Not** persisted (transient tactical state, correct to reset on load, exactly like
`pose`/`plan`/`robCooldowns`/`attackTarget` already are): `Mind.pursuitCooldowns`,
`Mind.layLowUntil`, `Conflict.data_disengagedBy`.

Regression test: an active conflict, a subdued body, and a detainee all round-trip
through `serialize`/`deserialize`, and the reloaded detainee stays put and does not
fight when the simulation is stepped.

Telemetry / anomaly state remains non-canonical and is not persisted.

---

## 5. Tests

**139 deterministic tests pass** (v0.2.2 baseline: 111). `npm run typecheck` clean.
`npm run build` (tsc + vite production build) **succeeds** on this environment.

New coverage:

| file | count | covers |
|---|---|---|
| `tests/relationship-evolution.test.ts` | 8 | minor fear decays; minor grudge decays slower; reinforcement prevents decay; severe grievance outlasts an ordinary grudge over 20 days; an active threat prevents cooling; determinism; affection/respect/familiarity untouched; negative-trust recovery |
| `tests/conflict-resolution.test.ts` | 21 | one Conflict per fight not per blow; `robbery_completed` resolution; **re-engagement gate — grudge alone does not restart, a fresh attack does**; `maintainConflicts` lapse to disengaging→suspended; a disengagement is not immediately re-attacked; bounded pursuit + no path_failure storm; surrender is canonical state not death, is respected by non-lethal aggressors, kill intent still lands; subdual outlasts the knock-down window; **surrender→arrest→custody** and **subdual→arrest→custody** with institutional record; detainee does not resume combat; no duplicate arrest; release clears custody; `maintainCustody` releases at `releaseAt`; custody duration scales with crime severity; **epistemic locality of an arrest** |
| `tests/persistence.test.ts` (+1) | 1 | conflict / surrender / subdual / custody survive save+reload; reloaded detainee stays detained and does not fight |
| `tests/significance-chronicle.test.ts` (+1) | 1 | a 40-blow conflict folds to ONE entry; turning points kept separate; blow-by-blow gone; source ids + ancestry preserved |
| `tests/robbery.test.ts` (2 setups armed) | — | the two resisted-robbery tests now arm the bandit, so they still exercise subdual-before-theft rather than a robber that is simply outmatched (which now correctly breaks off / yields) |

All 111 pre-existing tests are preserved and pass unchanged, except the two robbery
setups noted above (the assertions are unchanged; the bandit is given a weapon so the
scenario still reaches "victim downed → robbed" instead of the more realistic v0.2.3
outcome of an outmatched robber disengaging).

---

## 6. Benchmarks

Seed `918271`, headless, deterministic (each hash reproduced across ≥ 2 independent
runs). Hardware note: this pass ran on a faster machine than the v0.2.2 audit, so the
v0.2.2 column below is a *re-run of `main`@`71a897f`* on the same hardware, not the
audit's original numbers.

| metric | 2-day v0.2.2 → v0.2.3 | 4-day v0.2.2 → v0.2.3 | 8-day v0.2.2 → v0.2.3 | 30-day v0.2.3 |
|---|---|---|---|---|
| wall-clock | 6.6s → **3.1s** | 18.9s → **6.3s** | **219s (pathological) → 14.1s** | **84s** |
| simulated days | 2 | 4 | 8 (non-convergent in v0.2.2) | **30, converges** |
| canonical events (retained) | 11,629 → **5,863** | 28,796 → **5,171** | 67,463 → **5,828** | **11,624** |
| attack events | 1,349 → **21** | 3,827 → **25** | 8,110 → **67** | **242** |
| thefts | — → 4 | — → 4 | — → 6 | **20** |
| conflicts started / resolved | n/a → 6 / 6 | n/a → ~8 / ~8 | n/a → ~30 / ~30 | **122 / 122** |
| unresolved conflicts (end of run) | n/a → **0** | n/a → **0** | n/a → **0** | **0** |
| deaths | 0 | 0 | 0 | **0** |
| Chronicle entries | 96 → 66 | 88 → 51 | 154 → 87 | **251** |
| anomaly groups | event_spam (28) → **none** | event_spam/stuck/churn (34) → **none** | event_spam (67) → **none** | **none** |
| deterministic state hash | `6a211ea3` → `b62b5c4e` | `6bc93cbd` → `094f794c` | `74c9b8d6` → `50fc0567` | `8326f3b6` (×2) |
| population start → end | 33 → 33 | 33 → 33 | 33 → 33 | 33 → 33 |

**30-day conflict outcome distribution** (122 conflicts): 48 resolved by a detention
elsewhere, 21 arrests, 23 target/aggressor fled, 21 robberies completed, 7 aggressor
withdrew, 1 aggressor fled, 1 driven off (deterrence). 23 arrests → custody, 21
subduals, 21 releases, **0 surrenders** (this seed's fights always reach subdual before
the surrender threshold — see §8).

**30-day timing shift** (v0.2.2's 8-day: `sim.act` 71%): `sim.think` 45%,
`sim.perceive` 21%, `sim.act` 12%, `sim.strategic.conflict` 6.5%. The conflict
pathology is *gone* — the remaining cost is ordinary cognition, which scales with
population × time, not with unresolved conflict.

**Example resolved causal chains** (from the 30-day Chronicle, seed 918271):

```
Day 100 — Vex robbed Hilda Vance of 97 silver at The Gilded Boar
        → conflict (robbery) resolved: robbery_completed
Day 101 — Vex robs Kestrel, Edda, Maud in succession
        → Brigid Tallow (knows of the thefts) confronts Vex
        → conflict (crime_response) → Brigid subdues Vex → arrests Vex for theft
        → Vex taken into the Village Watch's custody → conflict resolved: arrest
        → every other villager's conflict with Vex resolves: custody
Day 102 — Vex released (detention served) → lays low
        → Bors confronts Vex; Rowan Ashford subdues and re-arrests Vex
Day 104 — Skarn released → Kestrel confronts him → Skarn subdued → re-detained
```

**Browser verification (actually performed):** the voxel client (`npm run dev`) boots
with no console errors; `window.game.stepSim` advances the same canonical simulation;
after ~40 simulated minutes it produced 5 conflicts, all resolved (2 arrests, 2
robberies completed, 1 custody), with Skarn and Vex both in custody — identical
behaviour to headless. The village renders normally.

---

## 7. Remaining scaling risks (carried forward from v0.2.2)

These were **not** the v0.2.3 blocker and remain **documented, not fixed** — profiling
this pass shows none of them is currently material now that conflicts resolve:

- **HIGH — `World.entities`/`byKind` permanently append-only**, scanned in full by
  `Simulation.step()`'s hottest loops. Still not exercised (population stayed 33 with 0
  deaths across every run, including the 30-day). Real once population turnover happens
  over a long run. A maintained "alive" index alongside `byKind` is the scoped fix; not
  done because it is not yet a measured cost and needs its own care.
- **HIGH — `computeHistoricalSignificance`** — full `O(events.length)` rescan, called
  hourly. Now that 30-day runs are reachable, the retained-event count is *flat*
  (~11.6k at 30 days vs ~68k at 8 days in v0.2.2), so this is far less pressing than the
  audit feared, but it is still an unbounded-input rescan in principle. A correct
  incremental version must hook `effects.push()` inside `emit()` (see the v0.2.2 audit's
  Phase 6 and `tests/significance-chronicle.test.ts`'s locking test) — a distinct piece
  of restructuring.
- **MEDIUM — `Faction.knowledge`, `Item.provenance`, `Person.desires`** — all still
  unbounded. `Faction.knowledge` now also gains a `custody:<id>` entry per detainee
  (one per distinct person ever detained, updated in place on release — not one per
  arrest), which is bounded by population, not by arrest count.
- **v0.2.3's own new per-tick cost:** `strategic()`'s social-upkeep block builds an
  all-knowledge scan per person every ~10 world-minutes. Batched (from per-minute) and
  the conflict-scan is now a single pass, keeping 30-day cost flat at ~6.5% of wall
  time. If a much longer run makes it material, the knowledge scan can be made
  incremental.

---

## 8. Remaining constitutional / behavioural limitations

- **Surrender is under-exercised at seed 918271.** The threshold (critically wounded
  *and* cornered/outnumbered, opponent non-lethal) is deliberately conservative so
  fierce actors fight on; in this seed the watch always reaches subdual first. Surrender
  is unit-tested and works; it just needs conditions this seed's fights don't produce.
  A future pass could widen it for timid non-combatants caught in a robbery.
- **Conflict `cause` can mislabel.** When a victim pre-emptively swings at an
  approaching robber, the first recorded blow is theirs, so the `Conflict` is created
  `self_defense` even though it becomes a robbery — the Chronicle then reads "came into
  conflict over an assault; the robbery succeeded". The *outcome* is always right; the
  cause label occasionally lags the first blow. A demand-first `beginConflict` mostly
  covers this; a preemptive defender is the residual case.
- **Post-release friction is noisy.** A released bandit walking back through town is
  independently confronted by many villagers in one day, each a short `target got away`
  conflict. Bounded and resolves, but it reads as repetitive. `layLowUntil` suppresses
  fresh *robberies*, not the villagers' reactions.
- **No lethal escalation path yet.** Nothing at seed 918271 generates `intent: 'kill'`,
  so 30 days produces 0 deaths. This is *correct* for v0.2.3 (Constitution §11 — death
  should mean something; people fight, but fights end) but a real blood-feud escalation
  (grievance → revenge as an explicit chosen goal → lethal intent) is v0.3+ territory
  and is not implemented.

**Constitutional review** — how this milestone affects the invariants:

| invariant | effect |
|---|---|
| II — Player non-centrality | **strengthened.** The whole ontology (Conflict, surrender, custody) is player-agnostic; `applyHit`/`takeIntoCustody`/`beginSurrender` are the same paths for an NPC and the player. Browser-verified that NPC-vs-NPC conflicts resolve with no player present. |
| VII — Causality | **strengthened.** Conflicts, arrests, custody, and releases are explicit canonical state with causal event chains, replacing an implicit "keep fighting" loop. |
| VIII — Emergence over scripting | **strengthened.** No actor is named anywhere in the resolution mechanics; `grep` for Skarn/Vex/Dunstan/Ashford in `src/sim/social/` returns nothing. Bandits, guards, civilians, and (in principle) future soldiers/bounty-hunters/feuding families drive the same generalized systems. |
| III / IV — Local knowledge / provenance | **preserved.** Conflict outcomes propagate only through perception and telling; faction knowledge is institutional; regression-tested. |
| historical continuity | **preserved.** Chronicle consolidation keeps every source event id and causal ancestor; the deterministic replay hash is stable. |

---

## 9. Recommendation

### Is the World Engine ready for v0.3 Progression & Metaphysics?

## YES, WITH SPECIFIC CONSTRAINTS

**Evidence:** the ordinary benchmark seed now runs a coherent, deterministic **30
simulated days** — the milestone's most important gate — where v0.2.2 could not reach
one simulated week. Conflict is demonstrably an evolving social state with causes,
escalation, consequences, and endings: 122 conflicts over 30 days, **all resolved**, 0
unresolved at end, 0 anomalies, event-generation rate flat rather than growing. The
same behaviour is verified in the actual voxel client. `Relationship.fear`/`grudge` —
the v0.2.2 audit's single CRITICAL structural risk — now decays semantically and only
when a fight has actually ended.

**Constraints for v0.3:**

1. **Bound `World.entities`/`byKind` iteration to living entities before v0.3
   introduces real population turnover** (births/deaths at scale, migration). This is
   the v0.2.2 HIGH risk that 30 days of a stable-population run still did not exercise;
   v0.3 will. Scoped fix: a maintained "alive" index.
2. **Give `computeHistoricalSignificance` an incremental path** once v0.3's longer
   runs make the retained-event count grow again. The retained count is flat *now* only
   because conflicts resolve; progression content will add its own permanently-retained
   events.
3. **A lethal-escalation path is a v0.3 prerequisite, not a v0.2.3 gap.** Grievance
   exists as a durable state; v0.3's revenge/feud/faction-war content needs to be the
   thing that turns a grievance into `intent: 'kill'`, through an explicit chosen goal —
   not an automatic threshold.

The engine is no longer moving under its own feet. Build v0.3 on it, with the three
constraints above tracked as the first items of the next foundation increment.
