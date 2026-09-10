# Torn Veil Online — Verification Policy

Testing should provide strong evidence without spending unnecessary agent time repeatedly proving unchanged behavior.

Use verification proportional to the blast radius of the change.

---

# General rule

Default workflow:

```text
coherent implementation slice (several related edits)
    → targeted/affected tests
    → continue implementation
    → occasional typecheck/integration check
    → full regression suite near completion
    → only relevant milestone acceptance/world/browser/Unreal checks
```

Tests validate a coherent implementation. Do not run them after every tiny edit as a substitute for reasoning. Bare `npm test` is a checkpoint/final-verification command, not an edit-loop command. Config/docs-only work may need only inspection and cheap command/config validation; not every task requires a full suite.

A successful check remains valid until relevant code, tests, dependencies, configuration, or execution conditions change. Keep a brief verification record (command/scope, result, and relevant changes since it ran). Committing, pushing, or editing unrelated files does not invalidate that evidence. Do not rerun expensive unchanged verification for reassurance or duplicate already-valid targeted checks at final verification.

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
# Or select normal-suite tests through Vitest's dependency graph:
npm run test:changed
npm run test:branch
```

`test:changed` covers staged, unstaged, and untracked changes. `test:branch` also includes committed changes since the merge base with the local `origin/main` ref; fetch origin when that baseline needs refreshing, not on every edit. Both are one-shot runs and exit successfully when no tests are affected; that means no tests ran, not that behavior was verified.

Affected selection follows imports, not every behavioral dependency. Choose explicit relevant tests for dependencies it cannot discover. Shared modules can select many tests; package/config changes can select the entire normal suite. Preview without executing tests when scope is uncertain:

```bash
npm exec -- vitest list --changed --filesOnly
npm exec -- vitest list --changed origin/main --filesOnly
```

If selection is broad during active development, use explicit relevant files until a meaningful checkpoint. Affected commands use the existing default exclusions: specialized acceptance and browser suites remain separate and must be selected explicitly when relevant.

Use targeted tests after each logical implementation slice.

If a new behavior has no appropriate test, add one to the existing test structure rather than creating an unrelated parallel harness.

---

# Full deterministic simulation suite

```bash
npm test
```

The simulation suite operates headlessly over canonical `World` / `Simulation` state.

Run the full suite at a meaningful integration checkpoint or near completion when the blast radius warrants it, particularly after:

- shared simulation behavior changed;
- several simulation subsystems were modified;
- a change touches a heavily reused primitive;
- targeted tests indicate possible cross-system regression;

These scope indicators justify checkpoint coverage, not an immediate full run after each edit. Do not require the full suite merely because a file lives under `src/sim/`. Do not launch several expensive suites concurrently and create avoidable CPU contention or timeout failures.

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

Follow the default workflow above. Broaden only to answer a concrete unresolved regression or integration question; do not advance through every command as a checklist. Preserve the specialized acceptance configurations and their coverage. WorldLab, long traces, browser, and Unreal checks belong only to milestones that can affect their scenarios.

---

# Failure handling

If a test fails:

1. determine whether the failure is caused by the current change;
2. inspect the smallest relevant evidence;
3. fix the underlying issue;
4. rerun the failed/relevant test first;
5. rerun the full suite only after failing/relevant tests pass and the implementation reaches a meaningful checkpoint.

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
