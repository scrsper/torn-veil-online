# Torn Veil Online — Infinite RPG

A prototype of a *living* voxel RPG village: not Minecraft-with-chatbots, and not a normal
RPG where NPCs stand around waiting for the player. Ashford Vale is a small village of ~32
named people, each with a home, a job, possessions, relationships, memories, and a daily
routine, running underneath a first-person voxel renderer.

The core idea: **the simulation is the canonical world; the voxel game is how you perceive
and interact with it.** People don't know things because the code says so — they know things
because they saw them, heard them, were told them, or inferred them. Attack someone in an
alley and only the people who could actually perceive it will know. A witness may flee, tell
a guard, and that guard will investigate — because the information physically travelled
between two minds, not because the game broadcast an event.

## Starting the game

Requirements: Node.js 18+ and npm.

```bash
git clone https://github.com/scrsper/torn-veil-online.git
cd torn-veil-online
npm install
npm run dev
```

Vite will print a local URL (normally `http://localhost:5173/`) — open it in a browser.
On the title screen:

- **New world** — generate a fresh Ashford Vale from the seed and start playing.
- **Continue** — resume from your last save (disabled until a save exists). Saves autosave
  every 30 seconds and on `F5`; they use save schema 2, so a save from before the schema
  changed will not offer to resume.

Click anywhere on the canvas once the game has loaded to capture the mouse for looking
around, then use the controls below. Press `Esc` to release the mouse at any time (e.g. to
talk to the title-screen buttons or leave dialogue).

### Other commands

```bash
npm run typecheck   # tsc --noEmit
npm test              # vitest — the deterministic simulation test suite
npm run build          # typecheck + production build to dist/
npm run preview        # serve the production build locally
```

No backend, no external services, no LLM API calls — everything (world generation, NPC
cognition, dialogue) runs client-side and deterministically from a seed.

### Controls

| Key | Action |
| --- | --- |
| `WASD` | move |
| `Shift` | sprint |
| `Space` | jump |
| Mouse | look (click the canvas to capture the pointer) |
| `E` / right-click | talk / pick up / use whatever you're looking at |
| Left-click or `X` | attack with whatever you're holding |
| `Q` | drop your last item |
| `V` | toggle first/third person |
| `F` | inspect the person you're looking at |
| `F3` | open the **Simulation Inspector** |
| `F4` | open the **live event feed** |
| `T` | cycle time speed ×1 / ×4 / ×16 |
| `P` | pause |
| `F5` | save (also autosaves every 30s) |
| `Esc` | release the mouse |

## What's actually simulated

- **Entities, not sprites.** Every person, item, and place is a persistent entity with an id
  and history (`src/sim/core/types.ts`). A body is just the physical manifestation of an
  entity — the ontology doesn't assume one entity has exactly one body. Dead or otherwise
  historical people (e.g. a village elder's late spouse) exist as zero-body entities so
  graves, memories, and item provenance can reference them properly.
- **Layered time** (`src/sim/core/time.ts`): real time → physical time → world/calendar time,
  plus a per-mind `timeRate` so cognition can in principle run faster or slower than the body
  it's attached to.
- **Perception** (`src/sim/mind/agent.ts`): line-of-sight sight cones and loudness-radius
  hearing, sampled ~5Hz per NPC, gated by the actual voxel geometry (raycast through the
  grid), daylight, doors, and whether the NPC is asleep.
- **Knowledge with provenance** (`src/sim/mind/knowledge.ts`): every belief an NPC holds is
  tagged with how they got it — witnessed, heard, told (and by whom), inferred, or prior —
  plus a confidence and a hop count. An NPC who only *heard* a crime remembers an unknown
  attacker until they're told (or witness) something that actually identifies one; gossip
  degrades in reliability as it spreads, and stronger evidence can later refine a vaguer
  belief without corrupting it.
- **Episodic memory** (`src/sim/mind/memory.ts`): a bounded, significance-ranked memory store
  per person, not an infinite transcript.
- **Directional relationships** (`src/sim/mind/relationships.ts`): trust, affection, fear,
  respect, familiarity, grudge — per pair, per direction, updated by what actually happened
  to whom.
- **Utility-based goal selection with hysteresis** (`src/sim/mind/agent.ts`): NPCs score goals
  (sleep, eat, work, flee, report, investigate, confront, socialize, worship, mourn, …) from
  needs, schedule, emotions, relationships, and knowledge, and record *why* they chose what
  they chose — visible directly in the inspector.
- **A* pathfinding over the voxel grid** (`src/sim/physical/nav.ts`) so NPCs actually walk
  their routines through streets, doorways, and stairs rather than teleporting between poses.
  Doors have authoritative open/closed state that both NPCs and the player interact with.
- **Deterministic dialogue** (`src/sim/mind/dialogue.ts`): what an NPC says is generated from
  their identity, memories, knowledge, relationship to you, and current goal — no LLM
  required at runtime.
- **Persistence** (`src/sim/persist/save.ts`): the village regenerates deterministically from
  its seed, then saved state (minds, relationships, memories, knowledge, items, doors, voxel
  edits, event log) is overlaid on top, so consequences survive a reload.
- **A deterministic test suite** (`tests/`, run with `npm test`) exercises the epistemic chain
  end to end: witnessed attack → perception → knowledge → memory → relationship/emotion
  change → report → telling → second-hand guard knowledge with provenance → guard response —
  plus unseen-crime isolation, heard-but-unidentified crimes, knowledge refinement, trading,
  doors, navigation, and save/reload of consequences.

## Architecture

```
src/sim/            canonical simulation — no rendering concerns
  core/              entity/event ontology, world registry + causal event log, RNG, time
  physical/          voxel grid, block palette, doors, A* navigation
  mind/              perception, memory, knowledge, relationships, goals/planning, dialogue
  world/             deterministic world generation (terrain, buildings, the 32-person cast,
                     pre-seeded history: marriages, grudges, debts, rumors, a decade of events)
  persist/           save/load (schema-versioned)

src/game/            the voxel game — a presentation layer over the World
  voxel/             chunked mesher (ambient occlusion, emissive blocks) + renderer
  render/             sky, sun/moon, weather, fog, smoke/embers, dynamic lighting
  actors/            procedural voxel humanoid/chicken rigs, pose-driven animation
  player/            first-person controller + collision, interaction targeting
  audio/             procedural WebAudio ambience and sound effects (no asset files)
  ui/                HUD, dialogue UI, live event feed, Simulation Inspector

src/main.ts          wires simulation + renderer + UI together, owns the frame loop
tests/               vitest suite covering the simulation below the rendering layer
```

The dependency direction is one-way: `sim/` never imports from `game/`. The renderer reads
the World every frame; it never owns state the simulation needs. See `AGENTS.md` for the
conventions this rule implies when extending the codebase.

## The Simulation Inspector (`F3`)

Select any villager (or look at them and press `F`) to see, live: their current goal and why
it beat the alternatives, their active plan/action, their schedule, every relationship with a
meter for trust/affection/fear/grudge/respect, their episodic memories with source and
recency, everything they know with its provenance chain, what they're currently perceiving,
their needs/emotions, and their inventory with full item provenance (who made it, who's owned
it, how it changed hands). A **go to** action on a selected, present person moves the player
to a nearby walkable, line-of-sight spot next to them — handy for testing dialogue and
consequences without hunting through the village.

## The event feed (`F4`)

A structured, filterable log of every world/social/cognition/history event, each carrying
causal links to what caused it and what it caused. Click any event to see its full causal
chain — e.g. *attack → perceived by Mara → knowledge_gained → relationship_changed →
goal_changed (report) → told (Mara → guard) → guard's knowledge_gained (secondhand,
provenance: told by Mara) → guard's goal_changed (investigate) → investigation*.

## Status

This is a single-village vertical slice, not a finished game. It's built to demonstrate that
the underlying architecture — persistent entities, causal events, perception-gated knowledge,
directional relationships, utility-driven autonomous behavior — actually produces the kind of
emergent, observable social behavior it's designed for, at a scale small enough to inspect by
hand. See `docs/CODEX_FIRST_PASS.md` for a detailed record of the most recent hardening pass,
including known limitations.
