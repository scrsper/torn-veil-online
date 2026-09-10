# Torn Veil Online — Agent Instructions

This file contains the permanent rules needed to work safely and efficiently in Torn Veil Online.

It is intentionally concise. Detailed subsystem knowledge belongs in `.ai/REPO_MAP.md`, current project status belongs in `.ai/STATE.md`, durable design decisions belong in `.ai/DECISIONS.md`, and deep design authority belongs in `docs/TORN_VEIL_CONSTITUTION.md`.

---

## 1. Constitutional authority

`docs/TORN_VEIL_CONSTITUTION.md` is the highest-level canonical design authority for Torn Veil Online.

It defines what Torn Veil fundamentally is meant to become. Current code is an implementation of that vision, not a specification that supersedes it.

Do not knowingly violate a constitutional invariant merely because another implementation is easier.

If a requested feature conflicts with the Constitution, surface the conflict instead of silently weakening or reinterpreting the principle.

### Constitution reading policy

Do **not** read the full Constitution automatically at the beginning of every task.

The permanent invariants summarized in this file are sufficient for ordinary implementation work.

Consult the relevant Constitution section when:

- introducing or changing a major architectural boundary;
- changing ontology or what counts as canonical truth;
- changing cognition, knowledge, memory, provenance, or epistemic rules;
- changing progression, metaphysics, ranks, powers, or entity/body semantics;
- introducing a major new simulation subsystem;
- making a decision that could change Torn Veil's underlying simulation philosophy;
- existing code and project principles appear to conflict;
- architectural ambiguity cannot be resolved from the code and focused subsystem docs;
- or the user explicitly requests constitutional review.

When consultation is necessary, locate and read the relevant section first.

Read the entire Constitution only when the task genuinely spans the project's overall design philosophy.

Always use the current repository version when consulting it.

---

## 2. What Torn Veil is

Torn Veil is not primarily a scripted RPG with simulation layered on top.

It is a persistent artificial world in which canonical systems produce history, relationships, economies, conflicts, knowledge, consequences, and stories that the developer does not need to author in advance.

The current implementation is a vertical slice of that larger world.

Prefer systems that interact with other systems over isolated mechanics.

Prefer causes, state, incentives, constraints, and consequences over scripted outcomes.

Different initial conditions and seeds should be capable of producing different but structurally plausible histories.

Do not preserve prototype assumptions merely because they happened to be implemented first.

---

## 3. Canonical-world invariant

`src/sim/` is the canonical world.

`src/game/` and Unreal are projections/presentation layers unless an explicitly approved architecture change says otherwise.

### Hard boundary

`src/sim/` must never import from `src/game/`.

Simulation code must not depend on:

- Three.js;
- Unreal;
- DOM state;
- cameras;
- renderer objects;
- UI state;
- presentation-only representations.

Renderer or UI code may request canonical actions through the simulation.

It must not directly mutate canonical world state.

---

## 4. One world, one set of mechanics

NPCs and players should use the same canonical mechanics for equivalent actions.

Combat, movement, inventory changes, communication, ownership, work, knowledge acquisition, and other world actions must not gain separate "player truth" and "NPC truth" implementations.

Presentation may differ.

Canonical mechanics should not.

---

## 5. Truth, knowledge, and causality

Canonical world truth and what an individual believes are different things.

A mind may know something only through supported mechanisms such as perception, communication, inference, memory, institutional knowledge, or another explicit provenance-bearing path.

Do not give agents omniscient access to canonical state merely because that state is convenient to query.

New perceivable events should participate in the causal system.

When applicable, events should carry:

- causes;
- visibility;
- loudness;
- provenance or other information needed for downstream knowledge.

Do not invent causal links in readers, traces, UI, or diagnostics that do not exist in canonical state.

---

## 6. Autonomous behavior

New NPC behavior should normally participate in the existing goal / utility / planning architecture.

Do not solve systemic behavior problems with bespoke scripts for individual NPCs.

Knowledge, relationships, concerns, pursuits, obligations, embodiment, skills, resources, environment, and other state should influence ordinary decision-making rather than bypass it.

A system may influence a decision without automatically dictating it unless the underlying mechanic explicitly requires otherwise.

Avoid accumulating independent hidden utility bonuses when an existing shared motivation path is intended to combine those influences.

---

## 7. Derived state over duplicate truth

Prefer deriving facts from canonical state over creating new flags that can disagree with it.

Examples:

- derive whether labor is missing from actual staffing/capability/output;
- derive shortages from actual resources and production;
- derive knowledge from provenance-bearing evidence;
- derive consequences from canonical events.

Do not introduce a second representation of a fact when an authoritative representation already exists.

---

## 8. Determinism and procedural systems

Simulation behavior intended to be deterministic must remain reproducible from the same canonical inputs and seed.

Do not use uncontrolled randomness in canonical simulation paths.

Procedural generation should create meaningful variation while preserving systemic plausibility.

Do not merely randomize cosmetic output while keeping the underlying society, economy, history, or relationships identical when the feature is intended to be procedural.

Authored scenarios may remain as explicit regression/reference scenarios instead of defining the only possible world.

---

## 9. Entity assumptions

Do not introduce new assumptions that an entity can have exactly one current body.

The ontology supports zero-or-many bodies even when the current prototype commonly uses one.

Avoid encoding current prototype cardinalities as permanent ontology.

---

## 10. Systemic depth

Prefer systemic depth over disconnected feature breadth.

New mechanics should connect to existing world systems where appropriate.

Expansion to additional settlements, populations, regions, species, economies, or other content should come from reusable canonical systems rather than parallel hard-coded implementations.

Do not use "the current village already works" as a reason to preserve architecture that prevents broader procedural worlds.

---

## 11. Context and exploration discipline

Do not perform a broad repository audit at the start of every task.

Start with:

1. the user's requested outcome;
2. this file;
3. `.ai/REPO_MAP.md` when subsystem location is needed;
4. targeted `rg` / `rg --files` searches;
5. directly relevant source and tests;
6. subsystem documentation only when required;
7. relevant Constitution sections only when architectural uncertainty requires them.

Do not recursively read:

- every document in `docs/`;
- previous milestone reports;
- historical planning documents;
- the full Constitution;
- unrelated systems;
- large source trees;

merely to establish general context.

Search narrowly before opening large files.

Reuse repository structure already described in `.ai/REPO_MAP.md` rather than rediscovering it.

Read `.ai/STATE.md` when current milestone/branch/system status matters.

Read `.ai/DECISIONS.md` when a task touches a previously settled architectural decision.

---

## 12. Implementation discipline

Inspect the existing implementation before creating a parallel abstraction.

Prefer extending canonical systems over duplicating them.

Before adding a new table, registry, flag, service, or source of truth, determine whether the information can be derived from existing canonical state.

Make the smallest coherent architectural change that solves the actual problem.

Do not artificially constrain a solution to the exact implementation proposed in a work order when repository evidence supports a cleaner design that preserves the requested outcome and invariants.

When implementation evidence contradicts an assumption in the work order, follow the evidence and explain the adjustment.

---

## 13. Repository map

Use `.ai/REPO_MAP.md` to locate systems and their deeper documentation.

Do not duplicate detailed subsystem documentation into this file.

---

## 14. Testing

Use the testing policy in `.ai/TESTING.md`.

Default behavior:

1. complete a coherent implementation slice; several related edits may precede verification;
2. during implementation, run one or a few directly relevant test files, `npm run test:changed`, or `npm run test:branch`; inspect selection if shared code/config changes could select most tests;
3. run typecheck relatively often when TypeScript changes warrant it; expand integration checks at meaningful checkpoints;
4. reserve bare `npm test` for checkpoint/final regression verification, **not the edit loop**; run only the specialized acceptance/world/browser/Unreal checks relevant to the milestone.

A successful verification remains valid until relevant code, tests, dependencies, configuration, or execution conditions change. Keep a brief record of what passed and what changed afterward; a commit, push, or unrelated edit does not invalidate it. Do not rerun expensive unchanged verification merely for reassurance.

After a failure, fix and rerun the failing/relevant tests first. Rerun the full suite only once those pass and the implementation reaches a meaningful checkpoint. Tests validate a coherent implementation; running them after every tiny edit is not a substitute for reasoning. Never weaken assertions or fold specialized long-run suites into normal tests to make this workflow faster.

---

## 15. Working principle

Preserve Torn Veil's defining focus:

**The world should increasingly explain its own history through canonical interacting systems rather than through authored outcomes.**

Implementation convenience must not quietly replace that objective.
