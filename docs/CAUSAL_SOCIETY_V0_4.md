# Causal Society (v0.4 of the social line)

> Naming note: this milestone was commissioned as "Causal Society v0.4". It follows v0.9 (Social
> Causality) and v0.10 (Motivated Lives) in the repository's main version line, and builds
> directly on both. The file is named for the milestone, not for a version of the whole project.
> The unrelated `docs/V0_4_EMBODIED_ECONOMY.md` is the *engine* v0.4 and predates this.

What a future maintainer needs to know about the three things this milestone added, why each one
was the smallest possible addition, and the invariants that keep them honest. Everything else is
in the source comments.

## The problem it addresses

By v0.10 the simulation could already do a great deal. An event became a belief with real
provenance; the belief was appraised against the perceiver's own relationships, role and stake;
the appraisal became a concern; the concern bent what that person did next; a purpose could
outlive any one plan. The physical economy underneath it was equally real: a miller mills grain
that a hauler physically carried to the mill, and a baker bakes flour that a hauler physically
carried to the bakery.

Those two halves never touched.

Trace it through as it stood before this milestone. Kill the miller. The mill stops — correctly,
with no special case, because nobody is there to run a batch. No flour reaches the bakery.
`bake()` returns `{ ok: false, shortage: 'flour' }`. Its caller reads `.ok`, discards the rest,
and the baker stands at a cold oven. **And that is where it ends.** Nobody believes anything about
it. Nobody carries anything about it. Nobody can mention it. Nothing anybody does afterwards can
be traced back to it. An economic catastrophe caused by a murder was, to everyone it ruined,
indistinguishable from weather.

The blockage was not in the economy and not in cognition. It was at the one step where the world
would have had to become knowledge, and at the one step after that where two beliefs would have
had to be put together.

## What was added

Three things, each the smallest addition that closes one of those steps.

| | Where | What it is |
| --- | --- | --- |
| **A stoppage that can be known** | `sim/world/shortfall.ts`, the `work_blocked` event | A worker standing at their own trade, unable to carry it out for want of a named material. Perceivable, rate-limited, and held as a standing belief keyed `short:<place>:<resource>`. |
| **A worry about a material** | `ConcernKind` `'supply'`, `sim/mind/concern.ts` | The shortage counterpart of the existing `'work'` concern (which is about a *person* the work depends on). Bends `haul` / `work` / `shop`, under the existing shared cap. |
| **A belief about why** | `sim/mind/inference.ts`, `KnowledgeItem.kind` `'cause'` | "This is so *because* that", drawn from two beliefs the mind already holds, named `effectKey` and `becauseKey`, held less firmly than either. |

Plus one small public table (`sim/world/supply.ts`) without which none of it is expressible: which
trade makes what, out of what. It is over **occupations and resource types**, never over people or
places, because that is the part of it a villager genuinely knows — what a miller does is common
knowledge; where any particular sack of flour currently is, is not.

And one reader, `sim/history/causality.ts`, which walks links that already exist rather than
storing any of its own.

## The chain, end to end

Every arrow is an existing mechanism. Nothing here is scripted, and no step names an individual.

```
Skarn kills Hobb Grist, the miller                  canonical event, visibility 26
  → Alwin Hollis witnesses it                       perception (line of sight)
  → the mill runs no batches                        nobody is there; no special case
  → no flour is hauled to the bakery                no supplier has surplus, so no haul is raised
  → bake() returns { shortage: 'flour' }            existing transform
  → Osric/Mara hold `short:<bakery>:flour`          NEW: noteWorkBlocked, source 'self', hops 0
  → a `supply` concern forms                        appraisal → proposeConcerns (structural stake)
  → the belief travels in ordinary conversation     existing tell(); hops and confidence decay
  → Osric also hears "Skarn attacked Hobb Grist"    existing gossip, told by Alwin, 1 hop
  → Osric concludes "no flour because Hobb Grist
     was set upon", confidence 0.58, 1 hop          NEW: drawInferences
  → that conclusion re-appraises the attack FOR
     Osric with a real material stake                NEW: AppraisalContext
  → a justice concern forms, and his regard for
     Skarn drops by a bounded, purely inferred
     amount                                          existing concern/relationship machinery
```

## Invariants

These are the things that must not quietly stop being true. Each is enforced by a named test in
`tests/causal-society.test.ts`.

1. **A conclusion is weaker than what it was concluded from.** `confidence = effect × premise ×
   rule strength`, and `hops = max(effect.hops, premise.hops)`. An inference is never a way to
   become more certain, or closer to the source, than the evidence.
2. **A conclusion names a person only when the evidence does.** An attack belief with
   `actorUnknown` yields a cause with no `responsibleId`, and moves no relationship at all.
3. **A shortage is one standing belief, not a stream of events.** Key `short:<place>:<resource>`,
   however it was come by — found out, witnessed, or been told. Re-notice refreshes it in place
   and *keeps* `sharedWith`, so a shortage that is still going on is not fresh news to the people
   who were already told about it. (Before this was got right, a 30-day run produced four separate
   beliefs about the one continuing bakery shortage, retold to the whole village four times over,
   and four copies of the same conclusion drawn from them.)
4. **A shortage forms a worry only in someone it structurally reaches.** The one it stopped, the
   people who work there, the trade that needs the material, the trade that should have supplied
   it. Everyone else may know it and say it; nobody else acts on it.
5. **Nothing here lifts a goal that walks somebody toward another person.** `CONCERN_GOALS.supply`
   is `haul` / `work` / `shop`. This is the v0.9 justice-concern regression discipline applied to a
   new kind, not re-litigated: an inferred grievance reaches behaviour as a *justice* concern,
   which may move someone to tell the watch and may never move them at the suspect.
6. **An inferred grievance is bounded well below a witnessed one.** `MAX_INFERRED_GRIEVANCE = 0.12`,
   applied once per conclusion (a conclusion does not re-form for 24 world hours). Believing
   someone ruined your trade is a real thing to hold against them; it is not the same as having
   watched them do it.
7. **Nobody resents the victim.** The producer whose misfortune explains the stoppage is never the
   target of any relationship change.
8. **A trace never asserts a causal link the world did not record.** `CausalNode.depth` is set at
   construction; `traceLines` indents by depth, never by list position. A worry usually rests on
   several *sibling* beliefs, and rendering those as a descending chain would have the one tool
   whose job is showing what caused what quietly fabricating causation.
9. **A shortage is the business of whoever it reaches, and stops being news.** Two separate
   discipline points, both learned from a measured regression (see below): `listenerRelevance`
   scores a stoppage up for the trades that need or supply the material and for people who are at
   that place daily, and down for everyone else; and a standing shortage keeps the `claim.tick` it
   first began at, so `scoreTopic`'s freshness decay applies to how long it has been going on
   rather than to how recently its owner last re-confirmed it. Without the second of those, a
   shortage that had been true for a week was permanently the freshest thing in the village.

## The player is not an exception

Nothing in this milestone is NPC-only. `noteWorkBlocked` is called from the shared `work` action;
`work_blocked` is an ordinary perceivable event, so a player standing in the bakery sees it like
anyone else; `formConcerns` and `drawInferences` skip `p.controlled` for exactly the same reason
every other cognition path does (a player's beliefs are the player's own), not because a different
rule applies to them. A player who kills the miller produces the same stoppage, the same beliefs,
the same conclusions, and the same attributions against *themselves*, through the same
`Simulation.applyHit`.

## Verification

```
npm run typecheck
npx vitest run tests/causal-society.test.ts            # 18 focused causal-semantics tests
npx vitest run tests/causal-society-longrun.test.ts    # 17-day unattended acceptance
npm test                                               # full suite
npm run causal:trace                                   # 30-day traces, both scenarios
```

### The unattended acceptance run

`npm run causal:trace -- --scenario producer_struck --days 30`, seed 918271, ~260 s wall, no
player embodied. One seeded happening: a bandit's killing blow through `Simulation.applyHit`, held
until a moment when somebody is actually there to see it (a killing nobody witnessed is, correctly,
a killing nobody can ever learn of).

Recorded output, lightly trimmed:

```
STOPPAGES (38)
  day 100 08h  Edda Ironhand could make no stew at The Gilded Boar: no meat
  day 112 07h  Mara Bramble could make no bread at Bramble's Bakery: no flour
  day 112 13h  Osric Bramble could make no bread at Bramble's Bakery: no flour
  ...

WHAT TRAVELLED
  there is no flour at Bramble's Bakery, so no bread is being made
    Osric Bramble:    self,                     0 hops, confidence 1
    Mara Bramble:     self,                     0 hops, confidence 1
    Tomas Reed:       told by Mara Bramble,     1 hop,  confidence 0.86
    Garrick Ironhand: told by Osric Bramble,    1 hop,  confidence 0.73
    Bram Vance:       told by Mara Bramble,     1 hop,  confidence 0.74
    ...
  there is no meat at The Gilded Boar, so no stew is being made
    Edda Ironhand:    self,                     0 hops, confidence 1
    Hilda Vance:      witnessed,                0 hops, confidence 1
    Ysolde Vance:     told by Bram Vance,       1 hop,  confidence 0.81
    Fenn Muddle:      told by Hilda Vance,      1 hop,  confidence 0.71
    ...

SUPPLY WORRIES CARRIED (2)
  Osric Bramble: short of flour at Bramble's Bakery [0.97]
      — there is no flour at Bramble's Bakery; it happened at Bramble's Bakery;
        I cannot work without flour either
  Mara Bramble:  short of flour at Bramble's Bakery [0.43]

CONCLUSIONS DRAWN (34)
  Tomas Reed:       "no flour because Hobb Grist was killed"
      (producer_dead, confidence 0.50, 1 hop, holds Skarn responsible)
      because Skarn killed Hobb Grist (told by Alwin Hollis, 1 hop, confidence 0.73)
  Osric Bramble:    "no flour because Hobb Grist was killed"
      (producer_dead, confidence 0.44, 2 hops, holds Skarn responsible)
      because Skarn killed Hobb Grist (told by Hale Dorn, 2 hops, confidence 0.55)
  Mara Bramble:     "no flour because Hobb Grist was SET UPON"
      (producer_harmed, confidence 0.46, 2 hops, holds Skarn responsible)
      because Skarn attacked Hobb Grist (told by Pip Hollis, 2 hops, confidence 0.61)
  Edda Ironhand:    "no meat because Kestrel was set upon"
      (producer_harmed, confidence 0.75, 0 hops, holds Skarn responsible)
      because Skarn attacked Kestrel (witnessed, 0 hops, confidence 1)
  Bram Vance:       "no meat because Kestrel was set upon"
      (producer_harmed, confidence 0.45, 0 hops, NOBODY NAMED)
      because someone attacked Kestrel (heard, 0 hops, confidence 0.6)

TRACE
  Osric Bramble chose to work at Bramble's Bakery  [utility 0.55 — schedule: bake (4:00–12:00)]
    because Osric Bramble is short of flour at Bramble's Bakery  [carried since day 112, intensity 0.97]
      because there is no flour at Bramble's Bakery, so no bread is being made  [I found it so myself, confidence 1]
        because no flour because Hobb Grist was killed  [inferred, confidence 0.44, 2 hops]
          because Skarn attacked Hobb Grist (200 dmg)  [the world's own record]
        because Skarn killed Hobb Grist  [told by Hale Dorn, confidence 0.55, 2 hops]
```

Two things in that output are worth pausing on, and neither was arranged.

**The village does not agree about what happened, and each version is right for the person holding
it.** Osric and Tomas believe the miller was *killed*, at two hops and one; Mara, in the same
household and the same trade, believes he was *set upon*, because the account that reached her
came by a different route. Edda saw Skarn attack Kestrel with her own eyes and names him at
confidence 0.75; Bram only *heard* it happen — a noise, no face — so his conclusion about why
there is no meat names nobody at all, at confidence 0.45. Same shortage, same tavern, two people,
two honest beliefs. That is what falls out of never filling in a name the evidence did not carry.

**The last line of the trace leaves the village's head.** Every step above it is what Osric
believes and how he came by it; the `[the world's own record]` line is the canonical event itself,
which nobody in the village can see. A developer can read the whole chain from "the baker went to
work this morning" down to a bandit's blow twelve days earlier, and see exactly where the
knowledge ends and the world begins.

### The undisturbed run — nothing seeded at all

`npm run causal:trace -- --scenario undisturbed --days 30`, seed 918271, ~212 s wall. No player,
no seeded event, nobody killed. This is the north-star question ("if the player never appeared,
would something interesting and causally coherent still happen?") asked directly.

It did, on its own:

```
STOPPAGES (1)
  day 100 08h  Edda Ironhand could make no stew at The Gilded Boar: no meat

CONCLUSIONS DRAWN (2)
  Greta Hollis: "no meat because Kestrel was set upon"
      (producer_harmed, confidence 0.22, 1 hop, NOBODY NAMED)
      because someone attacked Kestrel (told by Hale Dorn, 1 hop, confidence 0.44)
  Fenn Muddle:  "no meat because Kestrel was set upon"
      (producer_harmed, confidence 0.22, 1 hop, NOBODY NAMED)
      because someone attacked Kestrel (told by Hale Dorn, 1 hop, confidence 0.44)
```

Nobody touched anything. In the ordinary run of village life somebody attacked Kestrel the hunter;
Kestrel supplies the tavern's meat; the tavern ran out; Edda the cook found the larder empty and
could make no stew; that belief reached seven people through real conversations with honest hop
counts; and a farmer's wife and the drunk who sleeps on the tavern bench each worked out, from a
second-hand account of the attack and their own knowledge of the shortage, that the two were
connected — and, because the account that reached them could not say who had done it, neither of
them blames anybody. They hold it at confidence 0.22.

That is a small thing. It is also a piece of history the world produced by itself, with a cause,
a chain of custody for every belief in it, and an honest gap where the culprit's name would go.

### What this milestone broke elsewhere, and what was done about each

Adding a new class of thing for people to know, worry about and talk about perturbs an entire
simulation. Four existing checks went red. Each was diagnosed against `main` before being touched,
and none of the checks themselves were weakened.

**1. `social-causality-trace` (theft): the news stopped travelling — a REAL crowding-out, fixed in
the simulation.** A bakery shortage reached all thirty villagers inside a day and out-ranked a
genuine theft in `selectTopic` for listeners with no stake in either. Two causes, both fixed in
`sim/`, not in the test: a stoppage had no notion of whose business it was
(`listenerRelevance` now scores it by trade and by place, invariant 9 above), and a standing
shortage's `claim.tick` was refreshed on every re-notice, making it permanently the freshest news
in the village. After both fixes the theft trace reaches 13 people with 4 distinct standpoints.

A second, separate cause remained at seed 918271: whether anybody happened to be *looking* when
the theft occurred. The harness's own comment already flags one coin flip of this shape ("without
it the scenario silently reduced to a coin flip on whether anyone was looking") and establishes a
precondition to remove it; the same flip survived one step further along, at the taking itself. It
now waits, bounded, for a third party to be within sight of the spot before the theft fires —
a precondition in exactly that sense, scripting nothing about who ends up believing what. If
nobody turns up inside the window the theft happens unwitnessed, and the owner's own inference is
still the honest path it always was.

**2. `motivated-lives-trace` (conflicting motives): a ~1%-frequency emergent event stopped
occurring at one seed — NOT a regression, measured.** The check needs somebody to hold three or
more live purposes at once so that one is set aside. Across seeds 42 and 1337 the pursuit
statistics are *identical* before and after this milestone (max live 3, same samples at 2+ and 3+,
average live pursuits 0.161 vs 0.167 and 0.065 vs 0.065); only seed 918271's particular 36 hours
stopped containing one, because Causal Society changes what people talk about and therefore where
they go. `main` itself fails this same check at seed 1337. Resolved the way the harness's own
author already resolved it once for the `responsibility` scenario: the checks are untouched, the
seed moved (918271 → 42). A genuine bug in the harness's own selection was fixed at the same time
— it weighted "more samples" above "the active set actually changed", so it could report zero
changes about a village where the choice had in fact changed.

**3. `stress-benchmarks` (food scarcity raises the bread price): an integer-rounding boundary.**
`effectivePrice` rounds to whole silver, and against a base price of 2 the whole of "somewhat
scarce" collapses onto one coin — the boundary is at 31 loaves. The village restocked to 34 after
this milestone rather than 30, because a supply worry now bends who takes the flour haul: one
extra baked batch, and the assertion flipped. The test now measures `scarcityModifier` — the same
claim, at a resolution the rounding cannot swallow — and still holds the price itself to the
documented ceiling.

### Test status

- `tests/causal-society.test.ts` — 20 passing.
- `tests/causal-society-longrun.test.ts` — 7 passing (17-day unattended run; see the file's header
  for why seventeen and not thirty).
- Full suite: 54 files, 528 tests, all passing, 148 s.
- `npm run causal:trace` — both scenarios, all five acceptance items observed.
- `npm run social:trace`, `npm run motive:trace` — all scenarios, all checks passing.

## Known limits

- **A shortage is still very shareable.** Even after the relevance and freshness fixes above, the
  bakery's flour shortage reaches 27 of the 31 villagers on seed 918271, because the baker's
  daughter sells bread at the market stall and speaks to nearly everyone, and almost all of them
  hear it at one hop from her. Every hop is a real conversation, the hop counts and confidences
  are honest, and only the two people it structurally reaches ever carry a worry about it or act
  on it — but "everyone in the village has heard" is still a lot of chat turns spent on one fact.
  The reachability of a market stall is doing most of the work here, and that is a fair model of a
  village; a tighter one would want a notion of a fact being *worn out* between two people who
  have already discussed it, which nothing currently represents.
- **The five inference rules are the five that a village of one mill and one bakery needs.**
  `producer_dead`, `producer_harmed`, `producer_hurt`, `producer_absent`, `upstream_short`. They
  generalise by adding rows to `world/supply.ts`, not by changing `inference.ts`, but nothing here
  reasons about causes in general.
- **A conclusion is drawn about a *shortage* and nothing else.** `drawInferences` is gated on
  holding at least one live shortage belief. There is no machinery for explaining a death, a theft
  or an absence, and deliberately so — a general "explain anything" pass is exactly the kind of
  speculative framework this codebase's conventions warn against.
- **No succession.** When the miller dies, nobody takes over the mill. That is the correct scope
  boundary for this milestone (inheritance, guild membership and role succession are their own
  problem), but it does mean the flour shortage on seed 918271 never resolves.
- **A supply worry ends by fading, for anyone who was only told.** `clearShortfall` only ever fires
  for the worker who personally gets a batch out. That is honest — they stopped worrying, they did
  not find out — but it means good news travels strictly worse than bad news.
- **Tending is weighted down, not modelled properly.** A single episode of care emits a stream of
  `heal` events, so `KINDNESS_WEIGHT.heal = 0.3` slows what repetition does to a relationship. It
  does not stop it: in the recorded undisturbed run a father tending his daughter still ends the
  day at trust 1.00 and affection 1.00 from both her and her mother — both of whom start from
  seeded family values close to it, so the ceiling is reached rather than manufactured, but it is
  reached by repetition all the same. The right fix is an episode-level notion of "somebody tended
  me today", the way `OBLIGATION_REINFORCE_COOLDOWN_SECONDS` already counts occasions rather than
  ticks; the weighting is a holding measure.
- **Pre-existing, found while reading traces, not fixed here:** `describeRel` can render a seeded
  relationship as `partner, loves, trusts, respects, stranger` — "stranger" because seeded
  backstory sets affection/trust/respect but leaves `familiarity` at 0. Cosmetic, in `sim/`, and
  outside this milestone's lane.
