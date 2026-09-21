# Food performance harness

`runner.mjs` provisions the four files beside this README into the target worktree's ignored `.debug/food-performance/`, then runs the two existing stress selectors in fresh sequential Vitest processes.

Run from the repository root (dependencies must be installed or linked in each target):

```sh
node scripts/food-performance/runner.mjs --worktree ../TornVeilOnline-food-base --label base --samples 3 --output .debug/food-performance/reproduction/base
node scripts/food-performance/runner.mjs --worktree . --label feature --samples 3 --output .debug/food-performance/reproduction/feature
node scripts/food-performance/runner.mjs --worktree . --label feature-profile --profile --output .debug/food-performance/reproduction/profile
```

Use clean worktrees at the exact revisions recorded in the evidence. Keep timed processes
sequential, alternate A/B order for a new attribution study, and record background load.
Existing per-sample outputs are refused; choose a fresh output directory to repeat a run.

Normal timing runs leave both instrumentation and CPU profiling disabled. Profile runs enable the opt-in AST transform and V8 CPU profile. The workload and test fixtures are unchanged.

The runner continues after failed workloads, writes an incremental samples file after every selector, and records exit status, assertion count, report presence, HEAD, working-tree status, diff hash and a source digest including untracked source files. A failed sample is retained for diagnosis rather than discarded; final process exit status is nonzero if any sample fails. The exact existing test selectors, fixtures, assertions and 60-second budgets remain authoritative.

Body wall time is the primary comparison. Process RSS is lifetime peak. CPU time can exceed wall time because garbage collection and other runtime threads contribute. Continuation comparison uses the existing save/reload replay; its known alias behavior remains a limitation of that check.

The hook captures full saved-state hashes before advancing both the live and reloaded worlds
20 additional steps. Only the nondeterministic `savedAt` envelope is omitted. Both ordered-JSON
and sorted-object-key hashes retain array order. RNG states and any continuation differences
are recorded explicitly. Compare before/after on **both** continuation trajectories; do not
discard differing fields to claim reload equality. Hashing, serialization and this probe are
outside the body timing boundary.

Profile output includes the existing tick buckets, nested inclusive/self counters, work counts
and a `.cpuprofile` readable in developer tools. Inclusive times overlap; they are not additive.
Instrumentation changes runtime cost, so never mix profile runs into timing min/median/max.
Normal runs do not install the emit counter or transform simulation functions. The harness
and profiling state are never imported by production simulation or stored in a World.
