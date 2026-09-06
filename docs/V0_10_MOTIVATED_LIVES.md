# v0.10 — Motivated Lives

What a future maintainer needs to know about the two primitives this milestone added, the
presentation mode built to watch them, and the invariants that keep both honest. Everything else
is in the source comments.

## The problem it addresses

v0.9 made events socially causal: an event became a belief, the belief was appraised, the
appraisal became a concern, and the concern bent what someone did next. That is enough to make
people *react*. It is not enough to make them *trying to do something*.

The gap was temporal. A `Concern` could only ever express itself as a bonus on whatever goals
happened to be proposed on a given cognition tick. The moment a `check_on` plan finished, there
was nothing left of the worry but the worry, and the person went back to their day. Nothing
anywhere in the simulation represented "I have been working on this since Tuesday."

The second gap was social stakes. Torn Veil had relationships (how I feel about you), memories
(what I remember), and knowledge (what I believe). It had no way at all to say *I owe you*. A
favour done at real cost moved a couple of relationship scalars and evaporated.

## The two primitives

Deliberately few and deep, and built on top of the v0.9 layers rather than beside them. There are
**no per-event-type handlers** anywhere in this milestone, no scripted sequences, and nothing that
names an individual, a place or a storyline.

| Primitive | Where | What it is |
| --- | --- | --- |
| **Pursuit** | `sim/mind/pursuit.ts`, `Mind.pursuits` | A persistent purpose: an orientation (kind + subject) and a live source, from which the next ordinary goal that would serve it is re-derived every time it is asked. |
| **Obligation** | `sim/social/obligation.ts`, `Mind.obligations` | A social stake with real provenance: who feels it, toward whom, why, because of which canonical event, whether it is live, and how it ended. |

The layering they complete:

```
Concern / Obligation / Desire     why something matters to me          (v0.9, v0.10)
Pursuit                           what I am trying to achieve          (v0.10)
Goal + Action[]                   what I am doing right now            (v0.2)
GoalCommitment                    why I do not casually drop this task (v0.5)
status / resolution               how it ended, and what followed      (v0.10)
```

### What a Pursuit is *not*

It carries no plan. `pursuitSteps(world, person, pursuit)` is asked, fresh, what would serve the
purpose given the world exactly as it is and as that person believes it to be, and answers with an
ordinary existing goal offered as an ordinary candidate that has to win on utility. Change the
world and the same purpose produces different actions — which is what makes "learn she is hurt →
go and look → fetch something → carry it over → look again → conclude she is well" fall out of
state rather than out of an authored sequence.

Four kinds, chosen because each is a genuinely different orientation:

- `tend` — see to someone's welfare until I have reason to believe they are alright.
- `recover` — get a particular thing back to whoever it belongs to.
- `discharge` — carry out a responsibility I actually took on.
- `reciprocate` — do right by someone who did right by me, *when an ordinary occasion arises*.

There is deliberately **no `justice` pursuit**. A justice concern already moves people to tell the
watch (v0.9), and the watch's own role-and-severity reasoning already decides whether to
investigate or confront, with v0.2.3's re-engagement gating intact. Wrapping that in a persistent
purpose would walk straight past that gating and rebuild the v0.9 justice-concern feedback loop
under a new name.

### What an Obligation is *not*

It is not a favour-point counter. A counter can answer "how much do you like them"; it cannot
answer *why*, *because of what*, *is it still live*, and *how did it end* — which are exactly the
questions the milestone requires answers to. Relationship change is a *consequence* of keeping or
breaking one, never the obligation itself: you can dislike someone and still owe them.

Magnitude is assessed from real context (`assessMagnitude`): what the thing was worth measured
against what the giver could spare, how badly the beneficiary needed it, whether the benefactor
was simply doing the job the village sustains them for, how close the two already are (kin do for
one another, and are damped accordingly), and the confidence and provenance of the belief. Below
`MIN_OBLIGATION_MAGNITUDE` nothing is recorded at all — ordinary kindness stays ordinary.

## Invariants

Each is asserted structurally in `tests/motivated-lives.test.ts`.

1. **A purpose may never propose or boost an approach goal.** `PURSUIT_FORBIDDEN_GOALS` and the
   `PURSUIT_SERVING_GOALS` whitelist contain no combat, confrontation, investigation or pursuit
   goal, and `formPursuits` refuses to orient anyone toward someone they fear or across the
   outlaw line. This is the v0.9 justice-concern regression (a measured 40× combat explosion)
   made structurally impossible rather than merely avoided.

2. **People stay embodied.** Every purpose-driven candidate is multiplied by an embodiment factor
   computed from real physiological severity bands and the presence of a threat: 1 normally, 0.55
   at an urgent need, 0.25 at a critical one, 0 under threat or dangerous heat. A village where a
   devoted spouse starves is a failed simulation, not a moving one. The purpose utility ceiling
   (`PURSUIT_BASE_UTILITY` + `PURSUIT_UTILITY_SPAN` = 0.80, before `fit` and embodiment) is only
   safe *because* of this multiplier, and the two must be read together.

3. **Everything terminates.** A purpose has a per-kind maximum lifetime, an attempt budget, a
   no-progress backstop, a count cap, and a requirement that its source stay live. A purpose that
   cannot be finished is abandoned *with a reason*, which is itself an honest outcome.
   Obligations are bounded in count and in magnitude, fade on a per-kind half-life, and lapse
   when the person they are toward dies.

4. **An obligation cannot exist without provenance.** It forms either from the person's own act
   (accepting a request is self-knowledge) or from a `KnowledgeItem` with real provenance, whose
   key it records in `basisKey`. `causeEventId` names a real canonical event. Someone who merely
   *watched* a favour being done owes nobody anything: being helped is something you have to
   notice, and being the person helped is what forms the stake.

5. **Repayment is never forced.** A `reciprocate` purpose proposes *nothing at all* until
   ordinary world state throws up a real occasion — they are hurt, they need something carried,
   they have lost something whose whereabouts I know. The rest of the time it sits there, live and
   remembered, biasing decisions through `obligationGoalBoost` and inventing no errand.

6. **One bridge, one cap.** Concerns, obligations and purposes all reach goal utility through
   `motivationBoost`, capped once at `MAX_MOTIVATION_BONUS` (0.34). Three independent bonuses
   could otherwise stack past 0.7, which is not bending a decision but replacing it.

7. **Presentation owns nothing.** The elevated camera and the observer overlay read canonical
   state and never write it. Following someone is a camera decision made entirely on the
   presentation side; the followed person has no way to tell, and the browser spec asserts that
   toggling follow changes nothing about their goal, plan, position, purposes or concerns. The
   *player* does stand still while you watch someone else — a control decision about the player,
   and the less interfering of the two options, since WASD still reaching a body you cannot see
   would blunder it into walls and people.

## Generalized rather than added

Where the milestone's requirements were already served by an existing layer, that layer was
extended rather than duplicated:

- `concernGoalBoost` became `motivationBoost` — one bridge, one cap, three sources.
- `GoalCommitment` (v0.5) still answers "why am I not dropping the task in hand"; `provide` was
  added to `INTERRUPTIBILITY` and to `commitmentValidity` alongside `haul`/`build`/
  `help_recover_item`. Purposes did not get a second commitment system.
- `Situation` (v0.9) was left alone. Benefits deliberately do NOT open situations: an obligation
  is its own record, and opening a never-resolving `obligation` situation for every kindness would
  have polluted the layer that exists to say what is *unresolved*.
- `Request` (v0.4) is still the acceptance/completion/wage envelope. The accepted-task obligation
  hangs off it, observed through `World.eventObserver` so `core/` keeps its freedom from `social/`.
- `Desire` (recover_item) and the `wanted:` knowledge channel became `recover` purposes without
  changing either.

One genuinely new goal type was necessary: `provide` (goto → pickup → goto → give). Without it a
`tend` purpose could only ever walk over and look, which is one action, not a life. Its plan is
composed entirely of pre-existing canonical actions, and `takePortionInHand` (`world/metabolism.ts`)
factors out the split-and-carry step a purchase already performed, so a caring act can never
quietly manufacture a theft.

## ARPG / observer mode

A second **camera** and a developer overlay over the one canonical World — not a second
simulation, and not a second set of player actions.

- `game/render/arpgCamera.ts` — elevated angled boom, wheel zoom (6–52 blocks), middle-drag
  rotation, smooth follow, obstruction handling. Indoors it takes the **roof** off rather than
  shoving the camera into the subject's face: one *local* clipping plane on the two chunk
  materials (`VoxelRenderer.setRoofCut`), which also tells the boom to stop avoiding geometry that
  is no longer drawn. Local, not renderer-wide, because a global plane would slice the sky dome in
  half.
- `PlayerController.aimOrigin()`/`aimDir()` — the one place that knows how the current camera turns
  "the player is reaching for that" into a ray: eye + look direction immersively, eye + direction
  toward the cursor in the elevated view. Reach, ownership rules and every canonical call below it
  are identical in both, because reach is a property of a body and not of the camera watching it.
- `game/ui/observer.ts` — explicitly omniscient and labelled as such on its own face. A summary
  aimed at understanding causality in one glance (doing / step / because / purposes with their
  causes and steps so far / commitment / concerns / obligations / body / routine / unresolved
  matters), not a dump; the full object graph is still F3.
- Time controls drive the same `speedMult`/`paused` the T and P keys already do. There is no
  second time model.

`F2` toggles the camera, `F6` the overlay. While the overlay is open the primary click *selects*
rather than swings; attacking is unchanged on `X`.

**Click-to-move was not implemented.** The brief marks it desirable but explicitly not required,
and the honest way to add it is through the same navigation the NPCs use rather than a player-only
path mechanic — more than a camera's worth of work, and the brief also warns against letting the
interface consume the milestone. WASD, which the brief names as acceptable, drives the same
collision and the same canonical body in both modes.

## Verification

| | |
| --- | --- |
| Deterministic suite | 48 files, 445 tests, all passing |
| Typecheck / production build | clean |
| Browser specs | 7/7 against the real client, including the new elevated/observer spec |
| WorldLab | smoke tier PASS (7/7); check tier FAIL on both `main` and this branch — see below |
| Causal traces | `npm run motive:trace` — 4 scenarios, 21 checks, all passing; `npm run social:trace` — 36 checks, all passing |
| Multi-day | 5 seeds × 10 days, measured against `main` back to back — see below |
| Real client | `tools/audit/arpg-visual-check.ts`; screenshots in `docs/v0_10/` |

`npm run motive:trace` is the v0.10 counterpart of `npm run social:trace`. Two of its four
scenarios trigger nothing at all and simply watch what the village does on its own.

### WorldLab: pre-existing check-tier failures, measured on both sides

The `check` tier was already red before this milestone and is still red, with the **same scenarios
and the same violation codes** on both sides. Recorded here rather than absorbed into scope, per
v0.9's finding that it was red before v0.9 too.

| Scenario (3 seeds each) | `main` | v0.10 |
| --- | --- | --- |
| Baseline Village | FAIL ×3 | FAIL ×3 |
| Food Chain | FAIL ×3 | FAIL ×3 |
| Water Survival | FAIL ×3 | FAIL ×3 |
| Logistics | PASS ×3 | PASS ×3 |
| Construction | FAIL, **PASS**, FAIL | FAIL, **FAIL**, FAIL |
| Conflict Resolution | PASS ×3 | PASS ×3 |
| Recover Item | PASS ×3 | PASS ×3 |
| **Overall** | **FAIL** | **FAIL** |

Violation codes are identical in kind on both sides (`HUNGER-DEPRIVED` 12/12, `NUTRITION-DEFICIT`
9/9, `CONSUMER-BACKLOG` 6/6, `ANOMALY-STUCK` 6/6, `PURCHASING-POWER` 3/3, `MONEY-SUPPLY-TREND` 3/3,
`DOWNSTREAM-STARVED` 3/3, `CROP-UNHARVESTED` 2/2, `TIMBER-HORIZON` 2/1).

The one difference is `Construction` on seed 42424242, and the one code whose *count* moves is
`CONSTRUCTION-MATERIAL-STALLED` (88 → 220 emitted lines, though it is emitted once per overlapping
2-day window, so a stall lasting a few days longer produces many more lines). v0.9 already records
this check as pre-existing and **strongly seed-sensitive**, and warns against reading one seed as a
regression signal. Re-running the scenario across the same five extra seeds v0.9 used:

| seeds 7, 101, 555, 90210, 31337 | result |
| --- | --- |
| `main` | FAIL, FAIL, FAIL, **PASS**, FAIL — 1 pass |
| v0.10 | **PASS**, FAIL, FAIL, DEGRADED, **PASS** — 2 passes + 1 degraded |

So across eight seeds in total this branch is not worse on the construction stall; it moves within
the same known band, which is the RNG-stream coupling described in `docs/RNG_ARCHITECTURE.md`.

### Multi-day stability, measured against `main`

Five seeds, ten world-days each, both branches run **alone** on the same machine and back to back
(`tools/audit/baseline-compare.ts`; deprivation integrated by sampling every 30 world-minutes, not read off
a single final instant). Averages over the five seeds:

| | `main` | v0.10 |
| --- | --- | --- |
| `goal_changed` per run | 5819 | 5830 |
| meals eaten | 490 | 489 |
| deaths | 4 on every seed | 4 on every seed |
| person-hours at critical hunger | 721 | 716 |
| person-hours at critical thirst | 171 | 198 |
| person-hours at critical exhaustion | 56 | 38 |

**Goal churn is flat** (+0.2%), which was the headline risk: a persistent purpose that re-proposed
itself every tick would show up here immediately. **Nobody starves for a purpose** — meals, deaths
and critical-hunger hours are all unchanged; critical thirst is up ~15% and critical exhaustion
down ~31%, netting to +0.5% total time in any critical band.

From `tools/audit/motivation-longrun.ts` over the same runs: `pursuit_formed` ≈ `pursuit_resolved`
(e.g. 93/92, 104/99), **no purpose outlived the run window** (`neverEnd = 0` on every seed), live
purposes per person 1–5, `obligation_formed` ≈ `obligation_resolved` (196/193, 190/190), live
obligations 0–6, and the per-person obligation count reaches but never exceeds the cap of 8. In
ordinary village life with nothing triggered, the longest arc anyone sees through is two distinct
goal kinds; the family-responsibility trace, where a real injury is introduced, reaches three
(`provide → help → provide`, five adoptions).

**One attack outlier, investigated and not ours.** Across eight seeds the largest number of blows
between any one pair of people is 5–14 on `main` and 6–13 on this branch — except seed 918271,
where it is 6 on `main` and **122** here. Reading the events directly: 118 of those blows fall
inside about three world-hours of a single `defend`/`robbery` conflict between a hunter and a
bandit, which then resolved; **neither participant held any pursuit or obligation at any point**,
so `forgivenessFor` was 0 and no v0.10 code path took part. It is the single shared RNG stream
(`docs/RNG_ARCHITECTURE.md`) landing differently in pre-existing combat code. Total attacks across
the eight seeds excluding that one: `main` 460, v0.10 440.

## What the trace harness caught that unit tests did not

Every one of these was a real defect, found by watching the actual village and fixed at the
mechanism rather than in the report:

- **A purpose was only credited with goals it had itself proposed.** But a hauler adopts the very
  task they promised to do through the ordinary path (0.68) rather than the purpose's own (≈0.5),
  and the `discharge` purpose does not even exist until the upkeep pass *after* acceptance. On
  seed 42424242 every discharge purpose in a two-day run reported zero attempts while the work it
  stood for was being done throughout. Goals are now matched to purposes by **deliverable**
  (`pursuitForGoal`), at adoption and at upkeep (`linkGoalToPursuit`).
- **A purpose whose condition was already met waited for the upkeep pass.** On seed 4242 a husband
  carrying bread arrived at the shop where he and his wife both work, saw her plainly recovered —
  at which point `pursuitSteps` correctly had nothing left to propose — and then flipped between
  the errand and his work shift every three minutes until the concern behind it was discharged ten
  world-minutes later. `satisfiedNow` ends a purpose at the moment its condition is met.
- **`report` takes a guard as its target**, so someone who owed a favour to a member of the watch
  had "tell the watch about a crime" credited to, and boosted by, the purpose of doing right by
  them. Hence the `PURSUIT_SERVING_GOALS` whitelist rather than a "not forbidden" test.
- **`believedHarm` discounted confidence twice** (the concern layer already does it), so a spouse
  who had been told her husband was beaten never rated it worth bringing anything for.
- **The utility band was set against nothing.** At the first ceiling tried, a villager with bread
  in the larder for her injured husband scored the errand at 0.40 against a 0.55 work shift and
  went to work — a person who "has a purpose" in name only. The band is now stated against what it
  competes with, and the reasoning is in the constant's own comment.
- **`report` clamps to exactly 1.00** for anyone close to the victim of a serious assault — the
  same number a bedtime sleep, a critical thirst and a real threat reach — and then holds it
  through the +0.12 hysteresis margin. Measured on seed 777: fourteen unbroken world hours of
  trying to tell the watch at thirst 1.00 and hunger 1.00, never drinking and never sleeping. This
  predates v0.10 and is precisely the "a social goal becomes absolute and people stop looking
  after themselves" failure the milestone requires protection against, so it gets the same
  treatment purposes do (`bodyRoom`).
- **The obligation bases were too large.** A shared crust of bread cleared the formation threshold
  on its own — the "turn every friendly action into a debt" failure. The bases are now small and
  the weight comes from what actually happened.
- **Magnitude ratcheted.** On seed 1337 a spouse tending a badly-hurt partner repeatedly over one
  evening drove a single obligation from ~0.38 to 0.92 purely by repetition. Reinforcement now has
  a cooldown (so what accumulates is the number of *occasions*) and a ceiling.

## Known limits and disclosed risks

- **The injured-spouse arc is village-dependent.** Measured across ten seeds, the `tend` purpose
  takes visible action in six and completes a multi-step arc in three. In the rest the spouse and
  the injured person simply meet, the concern discharges on the strength of having seen him, and
  the purpose ends satisfied without ever having needed to act. That is a real outcome rather than
  a failure, and it is disclosed here rather than tuned away. Two things drive it: gossip can take
  15+ world hours to cross the village, and a serious wound heals in roughly 13 (v0.9's
  deliberately-chosen rate), so on some seeds the news arrives after the need has passed.
- **`report` is a strong attractor** for hours after a serious crime involving someone close, for
  the reason described above. `bodyRoom` stops it starving anyone; it still crowds out other
  errands. An explicit ceiling on it was tried and reverted, because its only real justification
  was making one scenario's seed pass.
- **`World.requests` still grows without bound** within a run (pre-existing). v0.10 adds an id
  index (`requestById`) and a bounded recent-failure scan (`recentlyFailedRequests`) so the new
  per-tick lookups do not make it worse, but the array itself is not yet pruned.
- **The `heal` goal re-adopts freely**, so a badly hurt person can be tended a dozen times in an
  hour by two people. Pre-existing v0.9 behaviour; v0.10's obligation reinforcement cooldown means
  it no longer inflates a stake, but the event volume is still noticeable in a trace.
- **`gift` significance was raised 0.4 → 0.5** so the event an obligation cites as its cause
  survives `World.compactEvents`. `heal` was left at 0.4 (it is far more frequent), so a
  tending-derived obligation can outlive the event it points at; its `basisKey` belief still
  answers "because of what", which is why the trace harness accepts either link.
- **Cross-kind purpose conflict is rarer than same-kind.** Most people carry more worries than
  promises, so the commonest competition is two `tend` purposes. The conflict trace reports the
  best cross-kind case it can find anywhere in the window alongside the main one.

## Measured cost

Ten world-days of the generated village, five seeds, each branch run alone and back to back
(the v0.9 doc warns that a first timing delta here is usually contention, so this was measured
twice with the order reversed):

| | round 1 | round 2 | mean |
| --- | --- | --- | --- |
| `main` | 100.7 s | 102.2 s | **101.5 s** |
| v0.10 | 120.9 s | 116.6 s | **118.7 s** |

**Roughly +17%**, spent in the coarse 10-minute upkeep pass (`maintainObligations` /
`formPursuits` / `maintainPursuits` / `noticeBrokenPromises`) and in `pursuitSteps` for the people
holding an active purpose at that moment. A shorter two-day run at seed 1337 costs only ~4%
(14.1 s against 13.6 s) because far fewer purposes and obligations have accumulated by then — the
ten-day figure is the honest one to plan against. The full deterministic suite went from 433 s to
521 s, of which ~88 s is the two new suites.

Save schema 13 → 14: `Mind.pursuits` and `Mind.obligations` are persisted, for the same reason
v0.9's `concerns` are — they record that this person has been trying to do something, or has owed
someone, since a particular moment, which no fresh `think()` tick can recompute.
