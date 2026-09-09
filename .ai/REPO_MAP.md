# Torn Veil Online — Repository Map

Use this document to locate the relevant system before exploring the repository.

This is a map, not a requirement to read every referenced file.

Read only the section relevant to the current task.

---

# Core simulation

## `src/sim/core/`

Canonical entity/event/world foundations.

Important files:

- `types.ts` — core ontology and canonical types.
- `world.ts` — World registry and causal event log.
- `rng.ts` — deterministic RNG/noise.
- `time.ts` — layered simulation time.

Read when:

- adding/changing canonical entity types;
- adding event types;
- changing world registration;
- changing deterministic randomness;
- changing fundamental time behavior.

Potential Constitution consultation:
ontology, canonical truth, entity semantics.

---

# Physical world

## `src/sim/physical/`

Authoritative physical simulation.

Includes:

- voxel grid;
- block palette;
- doors;
- collision-relevant state;
- line of sight;
- navigation / A*.

Rendering equivalents belong under `src/game/`, not here.

Read when:

- changing movement/pathing;
- changing physical accessibility;
- changing doors or collision;
- changing authoritative world geometry.

---

# Minds and autonomous agents

## `src/sim/mind/`

Core cognition and behavior.

Important areas include:

- `agent.ts` — main cognitive loop, goal selection and planning;
- `knowledge.ts` — knowledge with provenance;
- `memory.ts` — memory;
- relationships;
- concerns;
- conversation;
- inference;
- pursuits;
- succession;
- apprenticeship.

### `agent.ts`

Read this first when modifying general NPC decision-making.

`think()` constructs candidate goals.

`plan()` converts selected goals into ordinary actions.

New systemic NPC behavior should normally enter through this architecture rather than through bespoke character scripting.

### Knowledge

A person's knowledge is not equivalent to canonical world truth.

Preserve provenance and uncertainty.

### `inference.ts`

Inference should operate on beliefs a mind actually possesses.

An inference must not become stronger or more authoritative than its supporting evidence without an explicit mechanic that justifies doing so.

---

# Social causality

## `src/sim/social/`

Canonical social state and interpretation.

Important files:

- `situation.ts`
- `appraisal.ts`
- `absence.ts`
- conflict/custody state machines

### Situations

A mind must not inspect canonical `Situation.status` to determine whether a matter is resolved.

Use the sanctioned personal view mechanism.

### Appraisal

Represents what an event means to a particular person rather than changing what canonically happened.

### Deeper design

Read when needed:

`docs/V0_9_SOCIAL_CAUSALITY.md`

Do not read automatically for unrelated tasks.

---

# Motivation and obligations

## `src/sim/mind/pursuit.ts`

Persistent purposes.

A pursuit represents what someone is trying to bring about across time.

It should not become a parallel scripting/planning system.

Ordinary goals remain the execution mechanism.

## `src/sim/social/obligation.ts`

Canonical social obligations with provenance.

Do not reduce obligations to generic favour points when provenance and reason matter.

## Motivation bridge

Use the established shared motivation path rather than creating independent stacking bonus systems.

Read deeper design when needed:

`docs/V0_10_MOTIVATED_LIVES.md`

---

# World generation

## `src/sim/world/`

Canonical deterministic world generation and world-scale simulation.

Important areas include:

- terrain;
- structures;
- settlements;
- population/cast;
- economy;
- resources;
- production;
- labor;
- shortages;
- supply;
- procedural pre-history.

### `structures.ts`

Procedural building/structure generation.

### `village.ts`

Historically wires the authored Ashford settlement and its initial world state.

Do not assume authored Ashford architecture defines all future settlements.

Ashford may remain an explicit regression/reference scenario.

### `cast.ts`

Historically contains authored population/cast data for Ashford.

Procedural population systems should not require every world seed to reproduce the same social graph.

---

# Economy and supply

## `src/sim/world/supply.ts`

Public mapping between occupations, resources, and canonical production processes.

The table should describe processes that actually exist in the simulation.

Do not allow it to become a second contradictory account of village production.

When deriving settlement economic requirements, prefer canonical production relationships over manually duplicating occupational needs.

## `src/sim/world/shortfall.ts`

Derives continuing production/resource shortages from real canonical state.

Avoid duplicating shortage truth with independent flags.

Read deeper design when needed:

`docs/CAUSAL_SOCIETY_V0_4.md`

---

# Labor and adaptive society

## `src/sim/world/labor.ts`

Determines whether productive work is actually going undone from canonical staffing, capability, and output.

Do not treat occupation labels alone as proof that work is being performed.

Do not introduce a redundant vacancy flag if the condition can be derived.

## `src/sim/mind/succession.ts`

Scores plausible responses to missing labor.

It should provide evidence/utility to the normal decision system rather than independently deciding behavior.

## `src/sim/mind/apprenticeship.ts`

Teaching/learning path.

Knowledge of a technique is not automatically equivalent to proficiency.

Practice and canonical skill state remain meaningful.

## Work provenance

`World.workStints` represent successful work history/provenance.

Do not use historical work provenance as a hidden permission system unless explicitly redesigned.

Read deeper design when needed:

`docs/ADAPTIVE_SOCIETY_V0_5.md`

---

# Causal history

## `src/sim/history/causality.ts`

Reader over existing canonical causal links.

It must not create causal relationships merely for presentation.

Typical chain:

goal
→ motivation/concern
→ belief
→ causal belief
→ canonical event

Sibling reasons must remain siblings rather than being rendered as a false causal chain.

---

# Persistence

## `src/sim/persist/save.ts`

Save/load system.

General model:

1. regenerate deterministic world from seed;
2. overlay persisted state.

Saves carry schema versions.

When changing field meaning incompatibly, prefer an explicit version bump over silently reinterpreting old data.

---

# Rendering / browser client

## `src/game/`

Three.js presentation layer.

Contains:

- voxel rendering;
- atmosphere/weather/sky;
- actor rigs;
- player controller;
- cameras;
- WebAudio;
- UI;
- inspectors;
- event feed.

This is not canonical simulation truth.

Renderer interaction should request world actions through simulation APIs.

---

# Player interaction

Player input may originate in presentation code.

The resulting world action should use the same canonical simulation path used by NPCs where the mechanics are equivalent.

Camera-specific targeting belongs in the presentation/controller layer.

Reach, ownership, combat resolution, knowledge effects, and other canonical consequences belong below it.

---

# Unreal

Unreal is a projection/presentation target over the canonical Torn Veil simulation unless architecture is explicitly changed.

Do not move world authority into Unreal merely because a feature is being visualized there.

Bridge/projection contracts should expose canonical simulation state rather than duplicate it.

---

# Application wiring

## `src/main.ts`

Owns the browser frame loop and wires:

- simulation;
- renderer;
- input;
- UI.

Avoid moving canonical simulation rules here.

---

# Tests

## `tests/`

Deterministic simulation tests.

Prefer extending existing test infrastructure rather than creating parallel harnesses.

Useful shared setup:

`tests/helpers/world.ts`

For verification strategy and expensive acceptance commands, see:

`.ai/TESTING.md`

---

# Project documentation

## `docs/TORN_VEIL_CONSTITUTION.md`

Highest conceptual authority.

Read relevant sections only when required by `AGENTS.md`.

## `.ai/STATE.md`

Current project state.

Should answer things such as:

- current milestone;
- current branch/head if useful;
- systems currently being changed;
- known failures;
- temporary constraints;
- immediate next work.

Keep this document current and concise.

It is operational state, not architectural doctrine.

## `.ai/DECISIONS.md`

Durable architectural decisions already made.

Use this to avoid repeatedly reopening settled questions.

Entries should capture:

- decision;
- reason;
- important alternatives rejected;
- consequences/invariants.

Do not fill it with session logs.

---

# Documentation routing

Use this order when additional context is needed:

1. relevant source;
2. relevant tests;
3. this repository map;
4. `.ai/STATE.md` for current status;
5. `.ai/DECISIONS.md` for settled architecture;
6. one relevant subsystem design document;
7. relevant Constitution section;
8. full Constitution only for genuinely cross-cutting constitutional work.

Do not recursively read all documentation.

---

# Search discipline

Prefer targeted searches.

Examples:

```bash
rg "SettlementSpec|createVillage|generateVillage" src tests
rg "occupation|SUPPLY|production" src/sim/world tests
rg --files src/sim/world
```

Do not begin ordinary tasks by dumping entire directories or reading every architecture document.

Let the task determine the search surface.