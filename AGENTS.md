# Torn Veil Online — Agent Instructions

Shared permanent instructions for Claude Code, Codex, and other coding agents.
Work in the current checkout. Do not assume a particular machine path.

## 1. Read first

Before substantive work, read `docs/TORN_VEIL_CONSTITUTION.md`.

## 2. Design rules

- **The simulation is authoritative.** World outcomes come from canonical
  simulation systems. No scripted quest triggers or bespoke outcomes that bypass
  the sim; presentation and tooling project simulation state, they do not author it.
- **No LLM in the canonical simulation path.** Canonical state must not depend on
  LLM output.
- **John Smith is never a reachable rank.** John Smith is an orchestrator outside
  the progression ontology. No XP, rank, or progression path may lead to it.

## 3. Verification

Default verification:

```bash
npx tsc --noEmit
npx vitest run <targeted test files>
```

Do **not** run full browser suites (`npm run test:browser`) or
`npm run play:build` unless explicitly asked. See `.ai/TESTING.md`.

## 4. Key docs

| File | Purpose |
| --- | --- |
| `docs/TORN_VEIL_CONSTITUTION.md` | Design authority |
| `.ai/STATE.md` | Current project state |
| `.ai/DECISIONS.md` | Recorded decisions |
| `.ai/REPO_MAP.md` | Repository layout |
| `.ai/TESTING.md` | Verification policy |

All four `.ai/` docs listed above exist on this branch.

## 5. Git

Commit locally when work is complete. Never push unless explicitly asked.
