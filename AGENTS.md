# Agent instructions for this repository

This file gives coding agents (and future sessions of the same agent) the context needed to
work on Infinite RPG without breaking its core design.

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
  `game/voxel/`), and A* navigation over the grid.
- `src/sim/mind/` — the agent runtime: perception, memory, knowledge (with provenance),
  relationships, utility-based goal selection + planning, and deterministic dialogue. This is
  the file to read (`agent.ts`) to understand the whole cognitive loop.
- `src/sim/world/` — deterministic generation: terrain, structures (procedural building
  builders in `structures.ts`), the 32-person cast (`cast.ts`), and `village.ts`, which wires
  it all together and seeds pre-history (marriages, grudges, debts, rumors, a decade of
  events) so the world has a past before the player spawns.
- `src/sim/persist/save.ts` — save/load: regenerate the world deterministically from its
  seed, then overlay saved mind/relationship/item/voxel state.
- `src/game/` — everything Three.js: chunked voxel mesher (`voxel/`), atmosphere/weather/sky
  (`render/scene.ts`), procedural actor rigs (`actors/`), the first-person controller +
  interaction targeting (`player/`), procedural WebAudio (`audio/`), and all UI including the
  Simulation Inspector and event feed (`ui/`).
- `src/main.ts` — the only file that owns the frame loop and wires simulation + renderer + UI
  together.

## Commands

```bash
npm run dev         # Vite dev server
npm run typecheck    # tsc --noEmit — run this after any change, it's fast and catches most breakage
npm run build         # typecheck + production build
```

There is no automated test suite checked in. When verifying simulation behavior (perception,
knowledge propagation, goal changes, combat), drive it headlessly: boot the dev server, open
it with Playwright (or similar), and call into `window.game` — `main.ts` assigns the running
`Game` instance there, which exposes `game.world`, `game.sim` (the `Simulation`), and
`game.stepSim(seconds)` to advance simulation time deterministically without waiting on
`requestAnimationFrame`. Assert on actual state (`world.events`, a person's
`mind.goal`/`knowledge`/`memories`/`relationships`), not on log text.

## Working conventions

- Keep `sim/` renderer-agnostic: no `THREE.*` imports, no DOM access, no `window`.
- New event types go in `WorldEvent['type']` in `types.ts` and should carry `causes` (and, if
  perceivable, `visibility`/`loudness`) so they participate in the causal chain the event feed
  displays.
- New NPC behavior should go through the goal/utility system in `agent.ts` (`think()` builds
  candidate goals with `reasons: string[]`, `plan()` turns a chosen goal into an `Action[]`)
  rather than bespoke per-NPC scripting — the whole point of the architecture is that the same
  systems produce different behavior for different people.
- Don't give any entity more than one "current body" assumption in new code — the ontology
  intentionally supports zero-or-many bodies per entity even though every current NPC happens
  to have exactly one.
- This is a single-village vertical slice by design. Prefer depth (more interaction between
  existing systems) over breadth (new mechanics, more world, crafting, multiplayer) unless
  explicitly asked.
