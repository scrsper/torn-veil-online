TORN VEIL — PARALLEL MARTIAL LEARNING & TECHNIQUES v0.1

Do NOT interrupt or broaden the current responsive-combat/animation task.

I want a second PARALLEL IMPLEMENTATION track, not an architecture audit.

CURRENT COMBAT CHECKPOINT:
31051ecbfc3dc50e2e0e331c804028342566e75d

CANONICAL REPO:
C:\Users\green\Desktop\projects\torn-veil-online

PARALLEL WORKTREE:
C:\Users\green\Desktop\projects\tvo-martial-learning

PARALLEL BRANCH:
astra/martial-learning-techniques-v0-1

SETUP

Create the worktree/branch from checkpoint 31051ec.

Use GIT_LFS_SKIP_SMUDGE while creating it so large Unreal/vendor assets
are not duplicated unnecessarily.

Before parallel work begins, record which files the CURRENT combat task
is modifying or expects to modify. The martial-learning worker must avoid
those hot files where practical. If integration requires one of them,
build the independent module/API and leave the final hookup for merge
integration instead of editing the same file concurrently.

If this environment can launch a SECOND INDEPENDENT agent explicitly
using the SAME Astra model, launch exactly one Astra worker in that
worktree.

If you cannot guarantee that worker is Astra, do NOT substitute Luna,
Spark, or another model. Create the worktree and save this full prompt to:

C:\Users\green\Desktop\projects\tvo-martial-learning\.ai\NEXT_ASTRA_PROMPT.md

Then continue the current task and report that the worktree is ready.

If the second Astra is available, execute the following milestone.

======================================================================
MARTIAL LEARNING & TECHNIQUES v0.1
======================================================================

GOAL

Build the canonical foundation that allows people to:

- possess general weapon-family proficiency;
- know specific combat techniques;
- have separate mastery of those techniques;
- learn techniques from teachers;
- learn understanding from physical manuals;
- practice techniques;
- spar with others;
- improve through meaningful experience;
- observe or discover techniques;
- teach techniques they actually understand/master;
- preserve/copy/trade/steal/destroy martial manuals;
- autonomously choose to learn/practice/teach;
- retain deterministic provenance and history.

This should be a REAL implemented vertical slice with tests and
persistence, not a design document.

Do NOT modify Unreal or current combat animation/prediction/contact code
unless a tiny non-conflicting adapter is absolutely necessary.

Reuse existing Torn Veil systems. Do not create parallel knowledge,
book, skill, memory, goal or AI frameworks.

======================================================================
1. SEPARATE FOUR CONCEPTS
======================================================================

Implement a clean distinction between:

A. PHYSICAL CAPACITY
Existing STR, DEX, PER, END, VIT, INT, WILL.

B. WEAPON-FAMILY PROFICIENCY
General accumulated experience with a family such as:
- unarmed
- one-handed blade
- polearm

Use/extend the existing SkillId / skillOf / practiceSkill architecture
rather than inventing another generic skill system.

C. TECHNIQUE KNOWLEDGE
Whether a person actually knows/understands a particular technique.

Use the existing knowledge/provenance architecture.

D. TECHNIQUE MASTERY
Technique-specific practical competence gained through use/practice.

Knowledge != proficiency != mastery != attributes.

A high-DEX farmer does not automatically know advanced martial arts.
Reading a book does not make someone a master.

======================================================================
2. STABLE TECHNIQUE DEFINITIONS
======================================================================

Add the smallest canonical TechniqueDefinition representation needed for:

- stable techniqueId
- display/name identity
- weapon family
- action category
- prerequisites
- parent/lineage where relevant
- mechanical tags/components
- creator/discoverer where known
- origin/provenance references
- compatibility with future variants/evolution

Do not encode Unreal animation paths as canonical mechanics.

Provide a small initial UNARMED fixture vocabulary sufficient to test the
system, for example basic punch/evasion/kick concepts.

Do NOT attempt to replace the combat system being edited in the other
worktree. Technique definitions should expose a clean API that the
realtime combat layer can consume later.

Keep future supernatural/rank operators extensible but implement no
magic or rank progression now.

======================================================================
3. TECHNIQUE KNOWLEDGE
======================================================================

Use ordinary KnowledgeItem/provenance machinery.

Implement helpers such as conceptually:

knowsTechnique(person, techniqueId)
techniqueKnowledge(person, techniqueId)
learnTechnique(...)

Exact APIs may follow repository conventions.

Knowledge must preserve:
- source
- teacher/manual/observation provenance
- confidence
- learned time
- causal event
- technique lineage when applicable

Do not silently grant unknown techniques because attributes are high.

======================================================================
4. TECHNIQUE MASTERY
======================================================================

Add minimal persistent per-technique mastery.

Bound it similarly to existing skills and use diminishing returns.

Mastery should improve only through meaningful execution/practice.

Prevent:
- standing idle to train;
- repeatedly issuing rejected actions;
- zero-effort spam;
- rereading the same manual to farm mastery;
- infinite mastery from attacking a motionless dummy with no meaningful
  challenge or feedback.

Practice can still benefit from instruction and understanding.

Failed attempts MAY teach when they produced meaningful feedback.
A no-op should not.

Implement the smallest principled learning-value calculation necessary,
not a giant XP system.

======================================================================
5. ATTRIBUTES AFFECT EXECUTION, NOT KNOWLEDGE
======================================================================

Integrate existing attributes coherently where this new subsystem needs
them.

General responsibilities:

STR:
force, acceleration, grip, resistance to displacement.

DEX:
coordination, precision, balance, transitions.

PER:
reading observable threats, timing and distance.

END:
sustained combat effort and recovery.

VIT:
physical resilience/recovery, not martial knowledge.

INT:
understanding, analysis and learning complex techniques.

WILL:
composure, commitment, pain/fear control where relevant.

Do not turn these into arbitrary "+5% damage" bonuses.

Do not rewrite current combat physics in this branch.

======================================================================
6. TEACHING
======================================================================

Extend/reuse apprenticeship instead of building CombatTeacherAI.

A teacher must actually know the technique and possess enough mastery/
relevant proficiency to teach it credibly.

Teaching:
- creates/reinforces technique knowledge;
- records who taught whom;
- may improve later practice efficiency;
- does NOT directly grant mastery.

Relationships, trust, proximity, availability and ordinary needs still
matter.

Include deterministic tests showing:
teacher lesson -> student knows technique -> mastery unchanged until
practice.

======================================================================
7. MARTIAL MANUALS / SKILL BOOKS
======================================================================

Reuse the existing physical record system.

A martial manual is a physical record containing technique knowledge,
not a magic consumable unlock item.

Support through existing record mechanics:
- physical possession/location
- readable notation
- author
- provenance
- copying
- condition/deterioration
- theft
- transfer/trade compatibility
- destruction
- inaccurate/incomplete knowledge where ordinary knowledge supports it

Reading a manual should grant/reinforce understanding with provenance.

It must NOT directly increase mastery.

A copied manual should preserve its causal lineage and any mistakes in
the source, consistent with existing records.

Do not create a parallel "skill book inventory."

======================================================================
8. PRACTICE AND SPARRING
======================================================================

Implement canonical practice sufficient to prove:

known technique
→ meaningful practice
→ technique mastery increases
→ relevant weapon-family proficiency increases

Sparring should allow two people to practice without requiring a real
injury outcome for every repetition.

Use ordinary physical presence, relationships and availability.

Practice has real time/effort costs and competes with other activities.

Do not create free abstract XP ticks.

Keep actual realtime strike/contact implementation out of this parallel
branch if touching it would conflict with the current combat work.
Use a clear adapter/event interface so real combat can later submit
meaningful technique-use evidence.

======================================================================
9. OBSERVATION / SELF-DISCOVERY
======================================================================

Implement a bounded foundation for:

- learning that a technique exists by observing it;
- understanding improving through repeated/high-quality observation;
- self-experimentation producing a discovery under appropriate
  capability/knowledge conditions.

Observation should not automatically grant mastery.

Do not let everyone copy every move after seeing it once.

Self-discovery must be deterministic under the same world seed/state and
must create provenance identifying the discoverer/origin event.

Keep technique evolution modest in v0.1; prove the identity/lineage path
rather than generating hundreds of random moves.

======================================================================
10. AUTONOMOUS NPC LEARNING
======================================================================

Integrate with ordinary goals/planning where possible without touching
files actively being edited by the other Astra run.

NPCs should be able to consider:

- study an accessible relevant manual
- seek/accept instruction
- practice a known weak technique
- spar with a suitable person
- teach someone
- experiment when sufficiently motivated/capable

These goals compete normally with:
food, hydration, sleep, work, danger, relationships, obligations, etc.

Do NOT create a separate combat-training scheduler or combat AI brain.

If the central planner file is currently hot in the other worktree,
implement goal providers/plans in a new isolated module plus tests and
leave only the final registration hook for integration after merge.

======================================================================
11. END-TO-END ACCEPTANCE STORY
======================================================================

Create deterministic tests proving at minimum:

Person A knows and is competent in a basic technique.

Person B does not know it.

A teaches B.
→ B gains knowledge with A as provenance.
→ B does NOT gain instant mastery.

B practices.
→ mastery rises gradually.
→ relevant family proficiency rises.
→ physical effort/time is consumed.

A writes or copies a martial manual.
B or Person C physically obtains and reads it.
→ technique understanding transfers with record provenance.
→ mastery remains unchanged until practice.

A manual can be copied and destroyed using existing physical rules.

A person with strong attributes but no knowledge cannot magically use an
advanced technique merely because their stats are high.

A knowledgeable but unpracticed person differs mechanically from a
master.

Save/load preserves:
- family proficiency
- technique knowledge
- technique mastery
- provenance/lineage
- physical manuals

Same seed/actions produce the same result.

At least one autonomous scenario should demonstrate an NPC choosing a
learning/practice opportunity when competing needs permit it.

======================================================================
12. CODE/TEST DISCIPLINE
======================================================================

Start by reading only the relevant repository map and targeted files.

Reuse:
- core/skills.ts
- core/development.ts
- mind/apprenticeship.ts
- mind/knowledge.ts
- mind/records.ts
- existing goal/action architecture
- persistence machinery

Do not repeatedly reread the repository.

Do not run tests after every edit.
Implement coherent slices, then run targeted tests.

Run:
- new martial-learning tests
- directly affected skill/knowledge/records/apprenticeship tests
- typecheck/build if appropriate

Do NOT run the entire long full regression in this parallel branch unless
explicitly authorized later.

No Unreal.
No PCG.
No vendor assets.
No family-regression investigation.
No government/religion/gods/ranks.
No swords-as-rendered-content.
No large combat animation work.

======================================================================
13. GIT / PARALLEL SAFETY
======================================================================

All implementation stays on:

astra/martial-learning-techniques-v0-1

in:

C:\Users\green\Desktop\projects\tvo-martial-learning

Never edit the canonical combat worktree from this agent.

Never force-push.
Never merge.
Never modify main.
Never discard unrelated work.

Commit logical implementation slices and push the feature branch normally.

If a required integration file is actively being changed by the combat
Astra run, do NOT race it. Isolate the functionality and document the
small integration patch needed after both branches finish.

======================================================================
FINAL REPORT
======================================================================

Report:

- branch/head
- data model added
- existing systems reused
- learning routes implemented
- manual/book behavior
- teaching/practice behavior
- autonomous behavior
- persistence/determinism
- targeted tests/results
- files deliberately left for post-combat integration
- exact merge/integration risks

Keep the report concise.

Do not merge either branch.
Stop for review when v0.1 is complete.