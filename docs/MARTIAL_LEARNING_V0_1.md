# Martial learning and techniques v0.1

Branch: `astra/martial-learning-techniques-v0-1`, based on combat checkpoint `31051ec`.

## Delivered scope

The canonical callable slice separates physical attributes, weapon-family proficiency in
`Person.skills`, provenance-bearing `KnowledgeItem` understanding, bounded per-technique
mastery in `Person.martial`, and the actual outcome owned by canonical combat. It implements timed instruction, solo practice, consensual sparring,
repeated observation, one deterministic discovered variant per person/root, and ordinary
physical manuals. The original straight punch/slip/front kick/slip-counter vocabulary now
also includes explicit innate primitives, specific learned beginner movements and transitions.
Armed families have shared skill storage/curves, but armed practice and realtime contact
selection are deliberately outside this slice.

Manuals are ordinary `book` items containing a snapshot of the author's actual belief. They
use existing notation, physical access, substrate consumption, copying, possession, theft,
giving/trade-compatible ownership, condition, weather damage and destruction. Copies retain
mistakes, author and source-event ancestry. Reading, observing, discovering and being taught
never award mastery. Existing record goals already offer studying/writing/copying manuals.

`martialGoals` proposes ordinary work goals. The existing planner's G()/motivation, need,
commitment and hysteresis policy remains the selector. Peers come from current sight
percepts; seeking a teacher/sparring partner requires held evidence, while a competent
teacher can offer instruction to a perceived available peer. It never searches other
people's private knowledge to choose a goal. Canonical action validation checks actual
capability, mutual trust, proximity, line of sight, availability and consent. External
controllers must have an explicit matching martial intention before accepting a partner.

## Canonical APIs and limits

- `core/martialTypes.ts`: additive Person/World module augmentation and the temporary
  `PracticedSkillId = SkillId | WeaponFamily` alias. No parallel skill map.
- `core/martialDefinitions.ts`: immutable fixtures and canonical definition lookup.
- `mind/martialKnowledge.ts`: knowledge queries, learning, observation and authored-background
  seeding. `seedMartialBackground` is a world-generation/test API, never a runtime reward;
  it rejects innate IDs rather than fabricating learned knowledge for bodily availability.
- `mind/martialPractice.ts`: canonical actions, eligibility, execution profile, cancellation,
  shared physiology classification, and the combat evidence consumer.
- `mind/martialGoals.ts`: goal provider and plain, saveable plans.
- `mind/martialSelection.ts`: deterministic one-action semantic selection from innate access,
  specifically known movements/edges, current canonical action and supplied opportunities.
- `persist/martial.ts`: validated JSON save/load adapters and small final-hook helpers.

Actions require their actual owning plan and advancing physical time. Each session costs
60 physical seconds; the configured world-time scale controls calendar/physiology cost.
Call at most once per elapsed slice, with `seconds <= 60`; a gap larger than the submitted
slice interrupts instead of banking idle time. One per-mind chronological ledger prevents
overlapping bodies, partner sessions or replayed combat evidence crediting time twice.
Completion awards bounded diminishing gains from effort, feedback and challenge. Solo or
unresponsive-target feedback caps mastery at 0.30 and family proficiency at 0.35. Sparring
allows feedback without requiring injuries, and rewards both participants' real effort.
Interruption retains paid effort/history but does not award an incomplete practice session.

STR/DEX and current physiology feed force/control and timing uncertainty through existing
capability helpers; PER reads observed timing, END affects fatigue/effort, WILL composure,
INT the rate of lesson comprehension and complex discovery, and VIT retains its existing
resilience/recovery role. None of these grants knowledge. The execution profile and
definition components expose mechanics for later combat consumption; this branch changes
no strikes, collision, animation, prediction or Unreal content.

Observation consumes a real event sighting and exposes demonstrated motion, not private
teacher/origin/lineage details. Repetition gradually builds understanding; a belief watermark
rejects replay. Discovery uses stable seed/person/root identity and the practitioner's held
motion knowledge, preserving mistakes instead of consulting a perfect recipe. It records a
creator, parent, origin event and one modest recovery/transition component, not a new magic
or rank system. These components are definition data pending realtime consumption.

## Exact deferred integration

### Innate and semantic-selection steer

The full supplementary work order is preserved in `.ai/MARTIAL_INNATE_STEER.md`.
`availability: 'innate' | 'learned'` is explicit on fixtures. Missing availability on an old
v1 saved discovery retains **learned** semantics. A capable humanoid can use eight motor
primitives without a KnowledgeItem: basic punch, second punch, crude kick, shove, cover,
duck, sidestep and backstep. Innate practice pays the same effort/time, develops family
proficiency and primitive practical competence, and leaves knowledge empty. This never
unlocks a jab, counter or other learned movement. Explicit sufficiently experienced
self-experimentation remains a separate provenance-bearing discovery route.

Learned vocabulary includes jab, cross, low kick, basic guard, hook and a specific feint
counter. Jab→cross, cross→low kick, step→jab and a more demanding cross→feint-counter are
specific **transition techniques**, with ordinary teachable/readable knowledge and their
own practical mastery. Complexity belongs to a definition; it is never a character level.
Knowing a hook does not grant other movements of comparable complexity. Knowing both
endpoints does not automatically grant their learned connecting edge.

`selectMartialAction(world,person,input,context)` returns one `single-action` selection or
null. It never returns a multi-hit sequence, grants an outcome, changes the current action,
charges effort, or mutates knowledge. Repeated semantic inputs therefore require repeated
canonical action acceptance and independent contact/miss/interruption/cost resolution.
Untrained Light→Light→Heavy selects basic punch→second punch→crude kick; the specifically
trained repertoire selects jab→cross→low kick. The selector derives body availability
from the existing humanoid shape, coarse regional injuries and physical capability; it
does not invent left/right limb state. STR/DEX may make crude execution stronger/less
clumsy while repertoire stays innate. Mastery separately affects precision, balance,
weight transfer, recovery/stamina efficiency, defensive positioning and transition quality.
These are execution inputs, never permission to bypass the combat timing operator.

At merge, the semantic-input adapter should obtain the actual transition opportunity from
the current combat operator, then call this selector. `MartialSelectionContext` carries
canonical stance, selected body, opportunity bounds and allowed inputs. Current
`Body.combatAction` remains the sole predecessor truth; its additive `techniqueId` and
`transitionTechniqueId` fields record the producer's accepted selection, not a combo counter.
The selector independently rejects commitment/contact-phase chaining, stale predecessor IDs,
closed/disallowed windows and cancelled/interrupted actions that have not finished recovery.
The actual operator must still revalidate its window when accepting the chosen action.

Current combat input kinds are `attack|sidestep|backstep|duck`, with `direct|hook|kick` attack
variants. Map individual selected motions into those canonical primitives only where an
actual mechanic exists. A selected punch/kick/dodge/duck is still one action. Shove/cover
remain selectable/practicable canonical vocabulary but need an appropriate physical action
adapter before realtime use; do not pretend they are ordinary damaging attacks. Learned
movement and transition identities should accompany the accepted action into provenance;
the present practice/lesson/manual paths already train specific edges, while realtime
transition-use credit needs the same actual evidence translation as movement-use credit.

The steer delta passed `martial-learning` (20) plus `martial-selection` (9), 29 tests total,
and the final `npm run build` (TypeScript plus Vite, 131 modules). The earlier 16
`significance-chronicle` and 73 shared-system tests remain valid: those implementations did
not change in this steer. The independent delta review found no blocking issue. Cases
include blank knowledge, both semantic chains, specifically
known edges/mastery, phase/window blocks, one-action/no-outcome results, body/limb/stance
gates, stronger crude execution without knowledge, innate practice without unlocks,
transition teaching/manual/practice and old v1 discovery compatibility.

### Reserved production hooks

The following files were reserved by `.ai/PARALLEL_COMBAT_HOT_FILES.md`; none was edited.
The APIs are tested and usable now, but automatic runtime registration and the production
save path need these explicit merge-time hooks. Do not claim live combat is teaching yet.

1. **`src/sim/core/types.ts`**: optionally fold `WeaponFamily` into `SkillId` and replace
   `PracticedSkillId` at shared skill/development boundaries with `SkillId`. Person/World
   module augmentation can remain additive. Run typecheck for any exhaustive skill tables.
2. **`src/sim/mind/agent.ts`, `think()`**, at the provider loop currently containing
   `recordGoals(w,p)` (checkpoint line 1194): append `...martialGoals(w,p)` inside the
   `!threat` branch. Route every proposal through the existing `G()` exactly once. Its
   existing `data.needKey` key construction already distinguishes technique/mode/partner.
   Do not append record goals twice; the existing record provider handles manuals.
3. **`agent.ts`, `plan()`**: before the generic goal switch, use
   `const martial = martialPlan(w,g); if (martial) return martial;`.
4. **`agent.ts`, `act()`**: after obtaining/activating the first pending action and before
   the action switch, call
   `if (actOnMartial(w,p,a,physDt,{physiology:'scheduler'})) return;`.
   The action retains the explicitly selected body ID; do not replace it with a permanent
   one-body assumption. Set a presentation work pose only on participating selected bodies.
5. **`agent.ts`, `setGoal()` and any direct active-plan cancellation**: call
   `cancelMartial(w,p,reason)` before replacing a live martial plan. Also cancel an affected
   initiator if combat/death prevents that plan from receiving further act calls. This
   releases the consenting peer, retains the effort ledger, and records interruption.
6. **`src/sim/core/physiology.ts`, `activityLevelFor()`**: before pose/action fallback,
   use `const martial = world && martialActivityLevel(world,p); if (martial) return martial;`.
   This classifier covers both initiator and consenting peer from the single owning
   session. The scheduler charges its normal elapsed world-time physiology once. Standalone
   `actOnMartial` defaults to owning physiology and must not be combined with that scheduler
   charging. Keep the existing 60:1 time scale behavior; do not substitute wall-clock time.
7. **`agent.ts`, event perception**: immediately after adding a supported `saw` entry to
   `event.perceivedBy` (checkpoint line 354), call `observeTechnique(w,p,event.id)` when
   `event.data.martialDemonstration` exists. Heard-only events cannot teach observed motion.
   Demonstrations already carry position, visibility, loudness and causes.
8. **`src/sim/persist/save.ts`**: add
   `martialLearning: martialPersistenceState(world)` to the serialized envelope. Validate
   the parsed envelope with `validMartialSave(data)` before restoration, and call
   `restoreMartialPersistence(world,data)` after people/bodies/events are restored.
   No version bump is needed for this optional v1 payload. Person spreading already preserves
   skills, knowledge, mastery and ledgers; the helper additionally restores definitions and
   the exact owning plan of unfinished paid martial sessions. Until merged, use the tested
   `serializeMartial`/`deserializeMartial` pair. Ordinary `serialize` alone loses discovered
   definitions and ordinary `deserialize` drops transient training plans. The helper module
   currently imports those functions for wrappers; if importing helpers back into save.ts,
   move wrappers to a separate file to keep the final persistence dependency acyclic.
9. **Reserved realtime combat producer**, after actual paid execution resolves: attach
   `TechniqueUseEvidence` to `combat_action.data.techniqueUse` on a terminal `complete`,
   `missed`, or meaningfully `interrupted` event. Retain its actual `actorBodyId` and phase.
   Evidence contains technique/body IDs, paid physical interval, effort, feedback and
   challenge in 0..1; `responsiveTarget` must be assessed canonically at execution time.
   Then call `submitTechniqueUse(w,person,event.id)`. Never copy client XP, quality or
   responsiveness fields into this contract. Nonresponsive feedback stays capped even
   after endless valid repetitions. Add a visible `martialDemonstration` only when a
   completed motion was actually perceivable; no reader reconstructs lost causal evidence.

These are registration/translation boundaries, not permission to merge either worktree.
The production adapter must translate real contact evidence and selected technique identity;
this branch deliberately does not infer them from animation names or invent missing contact.

## Verification

- Seven directly relevant suites passed: 89 tests total (`martial-learning`, `knowledge`,
  `knowledge-retention`, `knowledge-memory-skills-intent`, `individual-development`,
  `adaptive-society`, `capability-continuity`).
- After martial-only refinements, all 18 martial tests and `npm run typecheck` passed.
  The autonomous test registers only the deferred provider via a test spy; the real existing
  think()/G()/need-selection logic chooses practice and switches to an available well for
  urgent thirst. It does not substitute a second planner.
- The independent final review found that event compaction could retire mastery/discovery
  origin events after forgetting or death. `core/world.ts` was checked against the active
  combat checkout and was not hot. Its existing reference traversal now pins martial data
  for all saved people, including the dead, and world technique definitions; the existing
  ancestor traversal retains the exact causal chain. No separate retention registry was added.
- Final post-review validation: `martial-learning` (20 tests) plus `significance-chronicle`
  (16 tests) passed, 36 total. `npm run build` passed, including TypeScript and Vite (131 modules).
- Tests cover timed teaching/practice, no instant mastery, dual sparring effort, urgent
  needs/occupied/distrusted/distant/occluded partners, multiple bodies, cancellation, paused
  clocks, idle gaps, rejected/zero-effort/replayed evidence, bounded dummy feedback, physical
  manuals and mistakes, repeated sightings, deterministic lineage, actual JSON round trips,
  corrupt save rejection, resumed actions, and replay rejection after a second load.
- No full regression, family regression, world/Unreal/browser suite, assets or LFS pull.

Merge risks are localized to the reserved hooks above and shared `skills`, `development`,
`knowledge`, `apprenticeship`, `records` and event-compaction code. The root author completed
one independent final review; its provenance-retention finding is fixed and tested.
Combat integration needs its own contact/physiology
validation after both tracks finish.
