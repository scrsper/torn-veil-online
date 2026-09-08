# Agent instructions for this repository

This file gives coding agents (and future sessions of the same agent) the context needed to
work on Torn Veil Online without breaking its core design.

## Constitutional Authority

**`docs/TORN_VEIL_CONSTITUTION.md` is the highest-level canonical design authority for Torn
Veil Online.** It defines the project's ontology, simulation philosophy, and long-term
architectural direction — the artificial-world universe Torn Veil is ultimately meant to
become, not just the current single-village prototype.

Every AI development agent — and every human contributor — must read the Constitution before
undertaking significant architectural, simulation, ontology, progression, cognition,
world-generation, faction, economy, metaphysics, LLM, or scaling work. This applies whether
the work is a small change to an existing system or the introduction of a new one, if that
system touches how Torn Veil represents entities, truth, knowledge, power, or history.

Priority relationships in this repository, from highest conceptual authority to most
concrete evidence:

```
docs/TORN_VEIL_CONSTITUTION.md
      → project philosophy / ontology / long-term architectural authority
                    ↓
AGENTS.md (this file)
      → practical coding and repository conventions
                    ↓
Current implementation (src/)
      → experimental implementation of those principles
                    ↓
Tests (tests/)
      → evidence that particular implemented behavior actually works
```

The current implementation is a vertical slice of the Constitution's vision, not a
specification that supersedes it. Existing implementation details — including everything
described later in this file — do not override constitutional principles merely because
they already exist in code. Do not let the current prototype become an accidental
specification simply because it was built first.

Agents must not knowingly violate a constitutional invariant (see the Constitution's
"Constitutional Invariants" section) merely because a different implementation is easier or
faster to build. If a requested feature appears to conflict with the Constitution, identify
and surface that conflict rather than silently working around the principle or silently
reinterpreting the document.

The Constitution is expected to evolve — it may be amended by the project's creator over
time. Agents should always read the current version of `docs/TORN_VEIL_CONSTITUTION.md` in
this repository rather than relying on a remembered or cached summary of it.

AGENTS.md (this file) provides day-to-day implementation conventions for working in this
codebase. The Constitution defines what Torn Veil fundamentally is and is intended to
become. When the two appear to disagree, the Constitution wins, and the disagreement should
be raised rather than silently resolved.

## What this project is

A browser-based, client-only prototype (TypeScript + Vite + Three.js, no backend, no LLM
calls at runtime) simulating one voxel village whose people are autonomous, only know what
they've perceived/been told/inferred, and remember and react accordingly. See `README.md`
for the player-facing overview and `src/sim/core/types.ts` for the full ontology.

## Non-negotiable architectural rule

**`src/sim/` must never import from `src/game/`.** The simulation (`sim/`) is the canonical
world — entities, events, minds, physics, navigation. The renderer (`game/`) is a read-mostly
projection of that world onto Three.js. If you need the renderer to trigger a world change
(attack, pickup, dialogue choice), do it by calling into `Simulation` /
`sim/mind/agent.ts` methods, the same methods NPCs call on themselves — never by mutating
World state directly from UI code, and never by giving `sim/` a reference to a THREE object,
the DOM, or the camera.

Corollary: an NPC and the player should always go through the same code path for the same
action (e.g. `Simulation.applyHit`, `Simulation.takeItem`, `Simulation.tell`). Don't special-
case the player's combat/inventory/knowledge logic — that's how "player attacks NPC, only
witnesses learn about it" stays true instead of becoming a scripted one-off.

## Where things live

- `src/sim/core/` — entity/event ontology (`types.ts`), the `World` registry + causal event
  log (`world.ts`), RNG/noise (`rng.ts`), layered time (`time.ts`).
- `src/sim/physical/` — voxel grid + block palette (no mesh/material concerns — that's
  `game/voxel/`), doors (authoritative open/closed state, collision, and line-of-sight
  behavior), and A* navigation over the grid.
- `src/sim/mind/` — the agent runtime: perception, memory, knowledge (with provenance),
  relationships, utility-based goal selection + planning, and deterministic dialogue. This is
  the file to read (`agent.ts`) to understand the whole cognitive loop.
- `src/sim/social/` — the cross-cutting social layer: canonical ongoing matters
  (`situation.ts` — what is unresolved, and what settled it), personal significance
  (`appraisal.ts` — what an event means to a particular person), and the "you were not where I
  expected you" inference (`absence.ts`). `situation.ts`'s `personalSituationView` is the ONLY
  sanctioned way a mind may form a belief about whether a matter is over — never
  `Situation.status`. Also holds the pre-existing conflict/custody state machines. See
  `docs/V0_9_SOCIAL_CAUSALITY.md` for the invariants.
- `src/sim/world/` — deterministic generation: terrain, structures (procedural building
  builders in `structures.ts`), the 32-person cast (`cast.ts`), and `village.ts`, which wires
  it all together and seeds pre-history (marriages, grudges, debts, rumors, a decade of
  events) so the world has a past before the player spawns.
- `src/sim/mind/livelihood.ts` — generational continuity: the consumer of `coming_of_age`. A
  READING in the same shape as `mind/vocation.ts`'s `recogniseClass`, never an assignment — it asks
  whether what has actually happened to somebody (been shown the trade, practised it, got batches
  out of the place, grown up in the household that works it, and room at the work) adds up to a
  trade. Acquired basis is a HARD GATE on holding one; household proximity gates only being at the
  work at all, which is the door instruction comes through. Recognition writes `workId` and the
  place's own `workers` — the canonical record `world/labor.ts` reads — and the occupation label
  LAST, as a summary. Nothing in the labour path reads that label. See
  `docs/DEMOGRAPHIC_CONTINUITY_YEAR_SCALE.md` Revision 2 §5.
- `src/sim/world/locality.ts` — `nearestPlaceOfType`, the shape a "which place of this kind"
  question should take: nearest to the asker, not `world.places().find(p => p.type === X)` (which
  means "the first place of this type anywhere in the world" and silently binds every caller to
  settlement A the moment a second settlement exists). Straight-line today; reachability over the
  navigator later, without a signature change. Deliberately NOT a settlement-id filter.
- `src/sim/mind/pursuit.ts` / `src/sim/social/obligation.ts` — the v0.10 "Motivated Lives" layer.
  A `Pursuit` is a PERSISTENT PURPOSE (what someone is trying to bring about, across hours or
  days) sitting between a concern and a goal; it carries no plan — `pursuitSteps` re-derives which
  ordinary existing goal serves it from current world state every time it is asked. An
  `Obligation` is a social stake with real provenance (who owes whom, why, because of which
  canonical event, whether it is live, how it ended) — deliberately NOT a favour-point score.
  Both reach goal utility through the ONE bridge `motivationBoost`, which folds them together with
  concerns under a single cap. See `docs/V0_10_MOTIVATED_LIVES.md` for the invariants; the two
  that matter most are that a purpose may never propose or boost an approach/combat goal, and
  that every purpose-driven candidate is multiplied by an embodiment factor so nobody starves for
  a social purpose.
- `src/sim/world/shortfall.ts` / `src/sim/mind/inference.ts` / `src/sim/world/supply.ts` — the
  Causal Society layer, which connects the physical economy to cognition. `shortfall.ts` turns a
  trade standing idle for want of its input into a perceivable `work_blocked` event and a STANDING
  belief keyed `short:<place>:<resource>` (one belief per continuing shortage, however it was come
  by — never one per re-notice, and a re-notice keeps `sharedWith`). `inference.ts` is the only
  place a mind draws a conclusion from two beliefs it already holds: a `'cause'` KnowledgeItem
  naming `effectKey` and `becauseKey`, always weaker and never closer to the source than either
  premise, naming a responsible party only when the evidence does. `supply.ts` is the small public
  table of which trade makes what out of what — over OCCUPATIONS and RESOURCE TYPES only, never
  over people or places, and every row must name the canonical process it describes — a row with
  no process behind it is a second, contradictory account of what the village produces
  (Constitution §IX), and `tests/causal-society.test.ts` fails loudly when the table and the real
  transforms / production specs / consumer demands drift apart. See `docs/CAUSAL_SOCIETY_V0_4.md`
  for the invariants; the ones that matter
  most are that an inference may never make a mind more certain than its evidence, that a
  `'supply'` concern reaches only goals that move materials (never one that walks somebody toward a
  person), and that an inferred grievance is capped far below a witnessed one.
- `src/sim/world/labor.ts` / `src/sim/mind/succession.ts` / `src/sim/mind/apprenticeship.ts` — the
  Adaptive Society layer, which lets a village lose a worker and sometimes get the work done again.
  `labor.ts` DERIVES whether a productive place's work is going undone, from canonical staffing,
  capability and output — there is no vacancy flag anywhere, `p.occupation` is not read in the file
  at all, and `workAuthorization` (you work here, or the work is going undone and you are fit) is
  what replaced `p.occupation === 'miller'` as the gate on whether a batch happens. `succession.ts`
  scores how plausible it is that a given person would take up that work and returns a number and
  its reasons; it decides nothing, and `mind/agent.ts` turns the number into ONE ordinary `work`
  candidate that competes with everything else. `apprenticeship.ts` is the whole teaching path: a
  `'technique'` belief with the teacher on its `source`, which grants NO proficiency and only makes
  later real practice count for more. A `WorkStint` (`World.workStints`) is opened only AFTER a
  successful batch, which is what keeps it provenance rather than permission — nothing in the
  authorization path reads one. See `docs/ADAPTIVE_SOCIETY_V0_5.md` for the invariants; the ones
  that matter most are that no candidacy exists without real acquired knowledge of the shortage
  (so the nearest idle NPC is usually not the responder), that a lesson never writes to `skills`,
  that a settled tradesman pays no novice penalty (so the working village is unchanged), and that a
  village with nobody plausible simply stays short — societies are allowed to fail.
- `src/sim/history/causality.ts` — the causal trace: a READER over links that already exist
  (goal → concern → belief → cause-belief → event), used by tests, the trace harness and
  developers. It stores nothing of its own, and `CausalNode.depth` exists so sibling reasons are
  never rendered as a chain — a trace must not invent causation.
- `src/sim/mind/concern.ts` / `conversation.ts` — knowledge that has acquired behavioural force
  (a `Concern` bends goal utility through `concernGoalBoost`, capped so it never dictates a
  decision), and whether anything is worth saying to a given listener at all (`selectTopic`
  returns null — silence — as a normal outcome).
- `src/sim/persist/save.ts` — save/load: regenerate the world deterministically from its
  seed, then overlay saved mind/relationship/item/voxel state. Saves carry a schema version;
  bump it (and accept that older saves stop being offered as resumable) rather than silently
  changing what a save's fields mean.
- `src/game/` — everything Three.js: chunked voxel mesher (`voxel/`), atmosphere/weather/sky
  (`render/scene.ts`), procedural actor rigs (`actors/`), the first-person controller +
  interaction targeting (`player/`), procedural WebAudio (`audio/`), and all UI including the
  Simulation Inspector and event feed (`ui/`). v0.10 adds a SECOND CAMERA over the same world —
  `render/arpgCamera.ts` (elevated/angled, F2) and `ui/observer.ts` (the developer overlay, F6) —
  not a second simulation. `PlayerController.aimOrigin()/aimDir()` is the one place that knows how
  the current camera turns "the player is reaching for that" into a ray; everything below it,
  including reach and ownership rules, is identical in both modes.
- `src/main.ts` — the only file that owns the frame loop and wires simulation + renderer + UI
  together.

## Commands

```bash
npm run dev          # Vite dev server
npm run typecheck    # tsc --noEmit — run this after any change, it's fast and catches most breakage
npm test              # vitest — the deterministic simulation test suite (tests/)
npm run build          # typecheck + production build
npm run social:trace   # v0.9 deterministic causal traces on the real generated village
npm run motive:trace   # v0.10 motivated-life causal traces (the four acceptance scenarios)
npm run causal:trace   # Causal Society long-run unattended traces (30 world days, no player)
npm run causal:accept  # the Causal Society acceptance run as pass/fail (17 world days, ~4 min)
npm run adapt:trace    # Adaptive Society succession/recovery trace (30 world days, no player)
npm run adapt:accept   # the Adaptive Society acceptance run as pass/fail (30 world days, ~9 min)
npm run world:epoch    # the year-scale WorldLab tier (--seed <n> --years 1|5|25)
npm run epoch:accept   # the epoch acceptance run: the whole seed matrix at 5 years, plus 25 years
                       #   (~8 min). READ docs/DEMOGRAPHIC_CONTINUITY_YEAR_SCALE.md Revision 2 §4
                       #   before drawing any conclusion from it about demography, economy or
                       #   behaviour: at one step per calendar day every person in the world sits
                       #   at zero food and water reserve and never forms a work goal, so it is a
                       #   regression tripwire for accumulated-state growth and nothing more.
npm run test:browser   # Playwright functional harness against the real client
```

The two `*:accept` runs are deliberately NOT part of `npm test` (see the note in
`vite.config.ts`): each simulates weeks of unattended world time in a single file, and left in the
default suite they starve the other vitest workers until a neighbour with a tight per-test budget
fails for want of a core rather than for want of correctness. Run them when you have touched the
economy, cognition, or the labour/succession layer.

Run `npm test` after touching anything in `src/sim/`. The suite in `tests/` (see
`tests/helpers/world.ts` for the shared setup) drives the simulation headlessly through
`Simulation`/`World` directly — no browser, no rendering — and asserts on actual state
(`world.events`, a person's `mind.goal`/`knowledge`/`memories`/`relationships`), not on log
text. It already covers the witness→report→secondhand-knowledge→investigation chain, unseen-
crime isolation, heard-but-unidentified crimes and their later refinement, trading, doors,
navigation, and save/reload of consequences — extend those files rather than starting a
parallel test setup.

For anything that needs the actual renderer/UI (interaction targeting, HUD, inspector
rendering), drive it headlessly instead: boot the dev server, open it with Playwright (or
similar), and call into `window.game` — `main.ts` assigns the running `Game` instance there,
which exposes `game.world`, `game.sim` (the `Simulation`), and `game.stepSim(seconds)` to
advance simulation time deterministically without waiting on `requestAnimationFrame`.

## Working conventions

- Keep `sim/` renderer-agnostic: no `THREE.*` imports, no DOM access, no `window`.
- New event types go in `WorldEvent['type']` in `types.ts` and should carry `causes` (and, if
  perceivable, `visibility`/`loudness`) so they participate in the causal chain the event feed
  displays.
- New NPC behavior should go through the goal/utility system in `agent.ts` (`think()` builds
  candidate goals with `reasons: string[]`, `plan()` turns a chosen goal into an `Action[]`)
  rather than bespoke per-NPC scripting — the whole point of the architecture is that the same
  systems produce different behavior for different people.
- Anything that makes a goal more attractive because of what someone knows, owes, or is trying to
  do goes through `motivationBoost` (`mind/pursuit.ts`) and inherits its single shared cap. Adding
  a fourth independent bonus somewhere else is how "a concern bends a decision, it never dictates
  one" quietly stops being true. And nothing in that path may ever lift a goal that walks somebody
  toward a fight: that is the v0.9 justice-concern regression, and `PURSUIT_FORBIDDEN_GOALS` /
  `PURSUIT_SERVING_GOALS` exist to make reintroducing it require deleting a test.
- Don't give any entity more than one "current body" assumption in new code — the ontology
  intentionally supports zero-or-many bodies per entity even though every current NPC happens
  to have exactly one.
- A canonical outcome must never depend on how often the world is observed. Every extended act
  carries a duration and consumes however much of it the caller's step covers; combat was the one
  exception (one blow per call however long the call represented, and a stop condition that read a
  45-second pose) and it made fights unendable at the epoch tier's cadence. If you add a mechanism
  whose ENDING is an instantaneous observation of a transient, record the ending instead — see
  `Conflict.downed`.
- This is a single-village vertical slice by design. Prefer depth (more interaction between
  existing systems) over breadth (new mechanics, more world, crafting, multiplayer) unless
  explicitly asked.
