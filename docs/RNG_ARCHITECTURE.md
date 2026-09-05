# RNG Architecture — investigation and recommendation (v0.8 §9)

**Status:** investigation complete; one narrow, low-risk fix implemented; full separation
recommended as follow-up, not attempted here.

## The symptom

Across several v0.8 iterations, a benchmark like "construction completes around day 12" has been
observed to drift to "day 35" after changes that had no obvious causal connection to
construction — a dialogue phrasing tweak, an actor pose change. Widening the test's tolerance
(e.g. accepting up to 35 days) treats the symptom, not the cause, and was explicitly rejected as
a fix for this milestone.

## What actually consumes `World.rng`

`World.rng` is **one single `RNG` instance**, seeded once in the constructor, and — before this
change — used as the *only* source of randomness for the entire life of a world. Two use classes
share it:

1. **One-time generation** (`world/village.ts`, `world/structures.ts`, `world/cast.ts`): terrain,
   building placement, the 32-person cast, seeded pre-history (marriages, grudges, a decade of
   authored events). Runs once, before the simulation loop starts.
2. **Ongoing runtime** (`mind/agent.ts`, `mind/robbery.ts`, `game/player/interaction.ts`): NPC
   wander-target jitter, work/socialize duration jitter, gossip-line and chatter-line selection,
   patrol start index, combat damage rolls and lethal-intent rolls, per-substep idle body-yaw
   jitter (`if (w.rng.next() < physDt * 0.15)` — called every physical step for every walking
   body), and (until this change) weather transitions.

`RNG.fork(salt)` already exists (`core/rng.ts`) and is used exactly once, in `village.ts`, to give
procedural building placement (`BuildCtx.rng`) its own derived stream — so the "derived streams"
direction this document recommends is not a new idea for this codebase, just an incompletely
applied one.

## Why this causes the observed drift

`RNG.next()` advances a single internal counter. Every call anywhere in the codebase that shares
`world.rng` is one more sequential draw from that same counter. Because generation and runtime
randomness interleave (runtime draws happen throughout a multi-day run, across all ~32 people,
every tick, in whatever order the simulation loop visits them), **the exact sequence of values any
one system receives depends on how many draws every other system made before it, all the way back
to world generation.**

Concretely: if a code change anywhere adds, removes, or reorders even one `rng.next()` call — in
dialogue, in an actor's idle jitter, in gossip-line selection, in weather — every subsequent
"random" decision for the rest of that run shifts by one position in the shared sequence. A
different random number picked for, say, "does this bandit's attack roll for lethal intent"
several simulated days later is not a coincidence; it is the direct, mechanical consequence of a
shared, order-dependent stream. This is precisely the kind of instability the milestone brief
asked to be investigated rather than tolerated with a wider test bound.

## What this milestone changes

**Weather now has its own stream.** `World.weatherRng` is forked once from `world.rng` in the
constructor (`this.weatherRng = this.rng.fork(97)`), and `Simulation`'s weather-transition block
(`mind/agent.ts`, `strategic()`) is the only place that reads it. Weather was chosen first because
it is fully self-contained — one call site, no other system reads or writes `wt` — so isolating it
is a genuinely safe, easily-verified change: see `tests/rng-stream-separation.test.ts`, which
proves that consuming `weatherRng` any number of times never changes what `world.rng` yields next.
Save/load needs no change: a saved world is always reconstructed by `new World(seed)` +
`generateVillage(world)` (see `persist/save.ts`), so `weatherRng` is deterministically re-derived
exactly like everything else generation touches.

This is a *narrow* fix. It removes one concrete, easily-isolated source of coupling. It does not
make the runtime stream (agent decisions, combat, gossip, resource extraction) independent of
generation, or independent of each other.

## What this milestone deliberately does NOT change

Fully separating the remaining domains — so that, say, a change to gossip-line count can never
again shift a bandit's attack roll — requires touching every one of the ~20 remaining `w.rng.*`
call sites in `mind/agent.ts`/`mind/robbery.ts`/`game/player/interaction.ts`, several of which sit
inside the hot per-substep tick loop. Beyond raw call-site count, a correct fix needs a design
decision this milestone should not make unilaterally: **should each Person get their own forked
stream (keyed by entity id), so one person's decisions never perturb another's?** That is almost
certainly the right long-term answer (see below), but it changes the meaning of "the same seed
produces the same history" in a way that deserves its own dedicated pass with its own tests, not
a rider on a hardening milestone already touching recovery/reward/dialogue/WorldLab. The explicit
instruction for this milestone was "do not recklessly rewrite the whole RNG architecture" — a
one-line-per-call-site mechanical change across two files, each call site individually low-risk
but the *aggregate* behavior-changing (every seed's exact history changes, invalidating every
existing "seed 918271 does X" expectation in tests/docs), is exactly the kind of change that
warrants its own reviewed milestone rather than being folded in here.

## Recommended long-term architecture

```
root world seed
   │
   ├── worldgen stream        (terrain, structures, cast, pre-history — already the case today
   │                            via world.rng itself, since generation runs before anything else
   │                            reads it)
   ├── weather stream         (world.weatherRng — DONE this milestone)
   ├── per-entity agent streams  (Person.rng = world.rng.fork(hash(person.id)) at creation —
   │                            wander jitter, work/social duration jitter, patrol start index,
   │                            gossip/chatter line selection; a change to one person's dialogue
   │                            variety would then be provably unable to affect another person's
   │                            combat roll)
   ├── combat stream          (mind/agent.ts's applyHit/executeRobbery damage & lethal-intent
   │                            rolls — arguably still per-encounter-deterministic if forked by
   │                            (attacker id, victim id, tick) rather than global)
   ├── resource stream        (extraction yield variance, if any is ever added — none currently
   │                            observed as a distinct roll, but reserved for when it is)
   └── presentation-only stream  (any future purely-cosmetic variation — e.g. idle animation
                                 flavor — that must NEVER be able to affect canonical outcomes;
                                 today's per-substep idle body-yaw jitter, mind/agent.ts line
                                 ~956, is a candidate: it currently reads `w.rng` and therefore
                                 CAN perturb canonical timing even though it is purely cosmetic)
```

Migration path, in priority order (each independently testable the same way this milestone's
weather fix was):

1. **Cosmetic-only draws first** (idle body-yaw jitter): moving these off the shared stream is
   the highest safety-to-effort ratio, since by construction they should never have been able to
   affect canonical outcomes in the first place, and isolating them removes another source of
   drift with essentially zero behavioral risk.
2. **Per-entity agent streams**: the biggest win for the "unrelated change perturbs everything"
   problem, and the biggest single change — needs its own migration (give every `Person` a
   `rng: RNG` at creation, forked from `world.rng` by a stable hash of `person.id` so it survives
   save/reload the same deterministic way everything else does) plus a full re-baseline of any
   test or doc that asserts a specific outcome for a specific seed, since every seed's exact
   history will change once agent decisions stop sharing one global sequence.
3. **Combat stream** and **resource stream**: lower call-site count, can follow once (2) has
   proven the pattern.

## What this means for benchmark/test stability today

Until (2) above happens, tests and docs that assert a specific numeric outcome for a specific
seed (e.g. "construction completes around day N") remain sensitive to unrelated runtime changes,
by design of the current architecture — this is a known, documented limitation, not a bug in any
individual test. Prefer bounded/liveness-style assertions (WorldLab's `LivenessCheck`s: "eventually
progresses, does not stay stuck for more than N hours") over exact-day assertions for any new test
that exercises multi-day emergent behavior — this is exactly why WorldLab (`src/headless/worldlab/`)
checks liveness as bounded progress rather than brittle exact counts.
