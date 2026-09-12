IMPORTANT DESIGN STEER — INNATE FIGHTING VS LEARNED MARTIAL TECHNIQUES

Continue the current implementation. Do not restart or throw away good work.

Lock in this invariant before the martial-learning data model becomes rigid:

A physically capable humanoid DOES NOT need learned martial knowledge to
attempt basic violence.

INNATE MOTOR-COMBAT PRIMITIVES

Every capable humanoid should have access to a small innate vocabulary such as:

- crude/basic punch
- another basic punch
- crude/basic kick
- shove / basic cover
- duck
- sidestep
- backstep

These are physical motor primitives, not learned martial techniques.

Do NOT require a KnowledgeItem or martial manual before someone can throw
a punch or kick.

Prefer representing innate availability explicitly in the technique/action
model rather than seeding fake "learned" knowledge into every person's mind.

An untrained person may attempt sequences like:

L -> L -> H

but this should resolve as something like:

basic punch -> basic punch -> crude kick

with comparatively poor:
- transition quality
- balance
- weight transfer
- precision
- recovery
- stamina efficiency
- defensive positioning

Attributes influence how physically capable those crude actions are.
A very strong untrained person can hit hard.
A highly dexterous untrained person can be less clumsy.

BUT high STR/DEX/PER must never automatically grant learned boxing,
kickboxing, swordsmanship, advanced counters, or complex combinations.

LEARNING EXPANDS THE REPERTOIRE / TRANSITION GRAPH

Martial learning should add specific techniques and better transitions.

Conceptually:

INNATE
basic punch
basic punch
crude kick
basic evasions

BEGINNER LEARNED
jab
cross
basic low kick
basic guard
jab -> cross
cross -> low kick
step -> jab

INTERMEDIATE LEARNED
hook
uppercut
roundhouse
slip/counter
angle changes
longer compatible chains

ADVANCED LEARNED
complex counters
feints
stance transitions
advanced kicking chains
sophisticated branching combinations

Beginner/intermediate/advanced are technique complexity metadata,
NOT global character levels.

A character learns SPECIFIC techniques.
Knowing one intermediate move does not grant every intermediate move.

KEEP THESE CONCEPTS DISTINCT

1. Physical capacity
   Can the body physically perform the motion?

2. Weapon-family proficiency
   How experienced is the person with this general fighting mode?

3. Technique knowledge
   Do they understand this specific movement or transition?

4. Technique mastery
   How reliably/effectively can they execute it?

5. Outcome
   What actually happened against this opponent, at this moment?

COMBOS

Do NOT model combos as canned multi-hit attacks.

A combo is a chain of individually authoritative actions connected by
available transition opportunities.

Each component can independently:
- hit or miss
- be interrupted
- cost effort
- cause contact/injury
- expose the fighter
- be countered

Learned techniques/mastery improve WHICH transitions are available and
HOW efficiently they can be executed.

INPUT COMPATIBILITY

Design this to plug into the parallel realtime combat work's semantic:

Light
Heavy
Dodge
Duck

Example:

Untrained:
L -> L -> H
basic punch -> basic punch -> crude kick

Trained:
L -> L -> H
jab -> cross -> low kick

A more advanced fighter may map the same semantic input sequence into a
different valid learned chain based on stance, previous action, repertoire,
mastery, available limbs and context.

Selection should be deterministic from canonical state except where
legitimate canonical RNG is explicitly appropriate.

PRACTICE

Innate primitives may improve through real experience/general unarmed
proficiency.

However, repeatedly throwing crude punches must NOT automatically unlock
advanced techniques.

New techniques require:
- teaching,
- manuals,
- observation + sufficient understanding,
- meaningful self-discovery,
or another legitimate learning route.

Self-discovery is allowed, but must create canonical provenance and satisfy
real capability/experience conditions.

Implement this within the current milestone rather than merely documenting it.

Preserve the existing separation:
instruction/reading gives understanding;
meaningful practice builds mastery.