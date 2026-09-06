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
npm run test:browser   # Playwright functional harness against the real client
```

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
- This is a single-village vertical slice by design. Prefer depth (more interaction between
  existing systems) over breadth (new mechanics, more world, crafting, multiplayer) unless
  explicitly asked.
