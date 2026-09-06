# v0.9 — Social Causality Vertical Slice

What a future maintainer needs to know about the four primitives this milestone added, and the
invariants that keep them honest. Everything else about them is in the source comments.

## The problem it addresses

Torn Veil had all the parts of a social simulation — perception, provenance-carrying knowledge,
memory, relationships, utility-driven goals — and they did not compose into situations. An event
was learned and then repeated. It produced the same reaction in everyone, changed nothing about
what anyone did next, and stayed exactly as newsworthy a fortnight later as on the day.

## The four primitives

Deliberately few and deep. There are **no per-event-type reaction handlers** anywhere in this
milestone; every new mechanism is table-driven or structural, and none of them names an
individual, a place, or a storyline.

| Primitive | Where | What it is |
| --- | --- | --- |
| **Situation** | `sim/social/situation.ts`, `World.situations` | An ongoing matter in the world: what opened it, which later events bore on it, and whether and how it ended. |
| **Appraisal** | `sim/social/appraisal.ts` | "What does this mean to *me*" — personal significance from relationship, involvement, role, material stake, traits and provenance. |
| **Concern** | `sim/mind/concern.ts`, `Mind.concerns` | Knowledge that has acquired behavioural force: a live worry that bends goal utility, decides what is worth saying, and discharges when its holder learns the matter was settled. |
| **Topic selection** | `sim/mind/conversation.ts` | Whether something is worth saying to *this* listener at all — with silence as a normal outcome. |

Two smaller supporting mechanisms:

- `sim/social/absence.ts` — the generic "you were not where I expected you" inference. It is how
  ordinary life becomes able to *notice* a consequence at all; there is no canonical event for
  "did not turn up," so this is an inference from an information gap, stamped `source: 'inferred'`.
- `woundSeverity` / `SERIOUS_WOUND` in `sim/core/attributes.ts` — injury as a real, continuous,
  persistent physical limit rather than a number only combat reads.

## Invariants

These are the properties that make the above trustworthy rather than merely elaborate. Each is
asserted structurally in `tests/social-causality.test.ts`.

1. **A mind never reads `Situation.status`.** What a person believes about whether a matter is
   settled comes from `personalSituationView`, which looks only at whether *they* hold knowledge
   of the root event and of the resolving event. A villager who never heard about the arrest
   still, correctly, believes nothing has been done. Reading canonical status directly anywhere
   in `sim/mind/` would be omniscience wearing a social costume.

2. **A concern cannot exist without a belief with provenance behind it.** `formConcerns` is only
   ever called with a real `KnowledgeItem`, at the two places a mind actually learns something
   (perception in `onPerceived`, hearsay in `tell`). `Concern.basisKeys` records which beliefs
   justify it.

3. **A concern bends a decision; it never dictates one.** `concernGoalBoost` is capped at `0.3`
   and is added to goals the simulation was already proposing. Nothing in this milestone
   introduces a "concerned mode" that replaces ordinary behaviour.

4. **Harm is not automatically a wrong.** `Appraisal.crime` (from `isCrime`) gates the justice
   and safety concerns, and `situation.ts`'s opener gates on the same predicate. Without this the
   watch's own lawful subduals generate justice concerns *against the watch* — the same
   conflation `isCrime` already exists to prevent for beliefs, arriving by a different door.

5. **Realization may paraphrase; it may not invent.** `realizeTopic` composes only: the claim
   itself, one other belief the speaker actually holds, and a settled/unsettled clause backed by
   `personalSituationView` or a live concern. `tests/dialogue-grounding.test.ts` asserts the
   underlying property, and the browser spec asserts it against speakers' real knowledge maps.

6. **Absence is inferred, never read.** `noticeAbsences` uses the observer's own `loc:` knowledge
   as its evidence and asserts only "they were not here" — never a cause. Someone the observer
   has never laid eyes on produces no inference at all.

## Situations are bookkeeping, not events

`situation_opened` / `situation_resolved` are excluded from the Chronicle (`BOOKKEEPING_TYPES` in
`history/chronicle.ts`). The matter itself is already a canonical event that stands or falls on
its own significance; including both double-counts everything notable, the same way including
every retelling of an event used to.

## Verification

- `npm run social:trace` — deterministic causal traces on the real generated village, for the
  four required scenarios (assault, theft, work disruption, family harm). Participants are chosen
  *structurally* (relationship shape, occupation), never by name, so the traces demonstrate that
  the mechanisms are generic. Also run in the suite as `tests/social-causality-trace.test.ts`.
- `npm run test:browser` — `social-aftermath.spec.ts` drives the real client through the real
  dialogue UI and asserts that several people carry materially different concerns and give
  different grounded accounts of the same matter.

## What the trace harness caught that unit tests did not

Recorded because each one is a class of defect a future maintainer will hit again:

- **Decades-old backstory read as today's news.** Conversation recency was keyed off
  `KnowledgeItem.learnedAt`, but world generation seeds a century of pre-history with a
  `learnedAt` of "now". Every villager cheerfully volunteered their own long-past marriage while
  a theft from their workshop that morning went unmentioned. News value now decays with when the
  event HAPPENED (`claim.tick`), with a small bonus for having only just heard it and a heavy
  discount for `source: 'prior'`. The concern and unresolved-situation terms are added *after*
  that decay, which is exactly what keeps an old-but-unsettled matter tellable while old-and-
  settled backstory is not.
- **Beliefs acquired by INFERENCE formed no concerns.** `formConcerns` was wired into perception
  and hearsay but not into the two inference sites (`item_missing`, `absence_noticed`) — so the
  only path by which an unwitnessed theft is ever discovered produced a belief that changed
  nothing and was never worth mentioning. All three acquisition paths now form concerns.
- **A synthesized event as a causal parent.** An earlier version emitted an `arrived` event purely
  so a resolved absence had something to cite. `arrived` is excluded from the telemetry stream,
  so every `situation_resolved` citing one became a genuinely broken causal reference (WorldLab's
  `dangling_cause`). Never invent an event to have a cause; a matter no one can know is settled
  correctly reads as still open to everyone else.
- **A worry out-competing the day's work.** An uncapped `check_on` utility diverted enough
  ordinary labour that the village's only building project stalled. It is now capped below a
  claimed haul and below an occupational shift, and requires a concern of real intensity.
- **A concern boosting an APPROACH goal created a combat feedback loop.** The single worst defect
  of the milestone, and invisible to every unit test: giving a justice concern a bonus on
  `investigate`/`confront` drove attacks at seed 918271 from 34 to 1442 over five days, 1255 of
  them between one pair, against a baseline range of 33-86 across five seeds. An approach goal
  brings the guard back into contact; the renewed fight emits fresh crime events; those become
  fresh justice-concern evidence; which boosts the approach goal again. **A concern may motivate
  inquiry, reporting, aid and avoidance. It must never add weight to a goal that walks someone
  toward a fight** — think()'s threat assessment already scores that, with v0.2.3's re-engagement
  gating, and an external bonus walks straight past the gating. Found by bisecting one concern
  kind at a time against the seed-918271 benchmark.
- **A new event type flooding the Chronicle.** `absence_noticed` defaulted to category `world`,
  which put it in front of the Chronicle's significance filter; 815 of 891 entries became "X
  noticed Y has not been at Z". A conclusion one mind draws is `cognition`, like `perceived` and
  `memory_formed` — canonical and consequential, but not a historical turning point.
- **Slowing healing all the way to zero health pinned combatants in a knock-down loop.** The
  slowdown now applies only above `INCAPACITATED_FRACTION`: getting back on your feet runs at the
  original rate, mending is the slow part.

## Measured cost

At seed 918271 over 10 world days, measured against the immediately preceding commit on the same
machine: runtime 66.9s -> 63.6s, canonical events 6737 -> 5530, Chronicle entries 90 -> 86,
conflicts 67 -> 47, knowledge transfers 597 -> 480, deaths 0 -> 0. Knowledge transfers falling is
the intended effect of relevance-gated conversation, not a loss of information flow — the traces
show news still reaching 26-29 people. (A first measurement suggested a 40% slowdown; re-running
the baseline on a quiet machine showed that number was contention, not cost. Re-measure both
sides, back to back, before believing a timing delta here.)

## Verification findings

WorldLab's `check` tier was already red before this milestone — `Baseline Village`, `Food Chain`
and `Water Survival` fail on every seed on both sides of the change. `CONSTRUCTION-MATERIAL-
STALLED` in particular is pre-existing and strongly seed-sensitive: measured across five
additional seeds (7, 101, 555, 90210, 31337), the pre-v0.9 code passed 1 and the post-v0.9 code
passed 3, so the construction stall tracks the known single-shared-RNG-stream coupling
(`docs/RNG_ARCHITECTURE.md`) rather than anything this milestone did. Do not read a construction
FAIL on one seed as a regression signal without running several.

## Known limits

- **Injury heals in about a day.** A serious wound now costs a full working shift and is
  noticed by others, but it is still not a multi-day condition. Nothing models lasting
  impairment, infection, or a wound reopening.
- **Absence is inferred only for workmates and housemates.** Those are the two publicly
  observable expectations the village actually has. A missing acquaintance with no shared
  workplace or roof goes unnoticed.
- **Listener relevance is judged from public structure** (occupation, shared household, shared
  workplace, the speaker's own relationship to the listener). A speaker cannot know that the
  listener is the victim's cousin unless one of those holds — which is correct, but means some
  genuinely relevant news does not travel as directly as a human would expect.
- **`Mind.concerns` is capped at 10** and low-value ones are trimmed under pressure, like
  memories and knowledge. Under an unusually eventful stretch a person can drop a concern they
  arguably should still hold.
