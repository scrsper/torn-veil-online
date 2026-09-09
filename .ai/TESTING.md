# Torn Veil Online — Verification Policy

Testing should provide strong evidence without spending unnecessary agent time repeatedly proving unchanged behavior.

Use verification proportional to the blast radius of the change.

---

# General rule

During implementation:

**targeted tests first.**

At meaningful integration points:

**broader tests.**

At milestone completion:

**full relevant verification.**

Do not repeatedly run an expensive suite when no relevant code has changed since the previous successful run.

---

# Fast baseline

## TypeScript

```bash
npm run typecheck
```

Use after TypeScript changes when type correctness may have been affected.

It is generally cheap enough to run frequently.

---

# Targeted tests

Prefer the smallest relevant Vitest scope while developing.

Examples:

```bash
npm test -- tests/<relevant-file>.test.ts
```

or another appropriately targeted Vitest invocation already supported by the repository.

Use targeted tests after each logical implementation slice.

If a new behavior has no appropriate test, add one to the existing test structure rather than creating an unrelated parallel harness.

---

# Full deterministic simulation suite

```bash
npm test
```

The simulation suite operates headlessly over canonical `World` / `Simulation` state.

Use the full suite when:

- shared simulation behavior changed;
- several simulation subsystems were modified;
- a change touches a heavily reused primitive;
- targeted tests indicate possible cross-system regression;
- preparing a meaningful checkpoint;
- performing final milestone verification.

Do not require the full suite after every trivial edit merely because a file lives under `src/sim/`.

---

# Production build

```bash
npm run build
```

Use when:

- changes affect compilation/bundling;
- browser-facing code changed materially;
- preparing final integration verification;
- preparing a milestone handoff.

Do not reflexively rebuild after every small simulation-only edit if typecheck and targeted tests already provide sufficient evidence.

---

# Social trace

```bash
npm run social:trace
```

Use when work can materially affect v0.9 social causal behavior or when investigating those scenarios.

---

# Motivated-life trace

```bash
npm run motive:trace
```

Use when work can materially affect:

- pursuits;
- obligations;
- concerns;
- motivation integration;
- embodiment constraints on motivated behavior.

---

# Causal Society trace

```bash
npm run causal:trace
```

Long unattended simulation.

Use when work can materially affect:

- economic shortfalls;
- supply chains;
- shortage perception;
- economic inference;
- related cognition over long world periods.

Not required for unrelated economy-adjacent edits.

---

# Causal Society acceptance

```bash
npm run causal:accept
```

Expensive acceptance run.

Use when:

- changed behavior can plausibly alter its acceptance scenario;
- validating a substantial Causal Society integration;
- performing final verification of a milestone that touches those systems.

Do not run automatically after every change to an economy file.

---

# Adaptive Society trace

```bash
npm run adapt:trace
```

Use when work can materially affect:

- missing labor;
- succession;
- replacement workers;
- apprenticeship;
- long-run economic recovery.

---

# Adaptive Society acceptance

```bash
npm run adapt:accept
```

Expensive acceptance run.

Use when:

- changed behavior can plausibly alter Adaptive Society recovery;
- validating substantial labor/succession work;
- performing final verification of a milestone touching those systems.

Do not run merely because a nearby source file changed.

---

# Browser functional harness

```bash
npm run test:browser
```

Use for behavior requiring the actual browser/client layer, including:

- interaction targeting;
- HUD/UI;
- renderer integration;
- client wiring;
- camera behavior;
- browser-facing controls.

When appropriate, use the existing headless client path and `window.game` rather than inventing another browser harness.

The running game exposes canonical simulation objects for deterministic advancement.

---

# Unreal verification

When a task changes the Unreal projection/presentation layer, verify the projection using the available Unreal-specific tooling and acceptance workflow for that milestone.

Do not substitute screenshots alone for canonical simulation verification.

Likewise, do not run Unreal merely to verify simulation code that can be established headlessly.

---

# Verification escalation

A useful default progression is:

```text
changed code
    ↓
targeted test
    ↓
typecheck
    ↓
broader relevant tests
    ↓
full npm test when blast radius warrants it
    ↓
relevant long trace/acceptance when behavior warrants it
    ↓
build / browser / Unreal integration when presentation warrants it
```

Not every change needs every step.

---

# Failure handling

If a test fails:

1. determine whether the failure is caused by the current change;
2. inspect the smallest relevant evidence;
3. fix the underlying issue;
4. rerun the failed/relevant test first;
5. expand verification only after the narrow failure is resolved.

Do not rerun the complete suite repeatedly while a known targeted failure remains.

Do not weaken assertions merely to make a new implementation pass.

If an existing unrelated failure is confirmed, report it clearly rather than silently modifying unrelated behavior.

---

# Final milestone verification

For substantial milestones, final verification should normally include:

- relevant targeted tests;
- `npm run typecheck`;
- `npm test`;
- the specific trace/acceptance suites genuinely affected by the milestone;
- `npm run build` when client/build integration matters;
- browser or Unreal verification when the milestone has presentation acceptance criteria.

This is where broad verification belongs.

---

# Principle

Verification should answer:

**"What evidence is necessary to establish that this change works and did not break the systems it can realistically affect?"**

It should not answer:

**"What is every command in the repository that we could possibly run?"**