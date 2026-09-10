# Generative Universe Kernel v0.1

Current branch: `codex/generative-universe-kernel`; implementation checkpoint `db0a9eb` plus final hardening/report in branch HEAD. All seven bounded milestone completion criteria PASS. Detailed architecture, measurements, commands and limits: `docs/GENERATIVE_UNIVERSE_KERNEL.md`.

## Implemented and demonstrated

World-scoped validated material/component/process definitions; actual owned/local component instances; typed acyclic connections; finite environmental energy and reservoirs; power, losses, wear, labor and mass accounting; existing grain-to-flour production through a narrow stock adapter. No finished-device ItemType, occupational gate, authored winning blueprint, or parallel inventor AI.

Ordinary NPC goals search known primitive capabilities, construct and test a candidate, remember failure, try another arrangement, learn observed topology, and teach it through the existing conversation system. The recipient acquires separate components and constructs an assembly without an automatic skill award. Schema 21 persists definitions, topology, learned methods, finite stores and partial labor. Relevant Constitution sections were consulted; decisions are in `.ai/DECISIONS.md`.

Commands: `npm run kernel:demo -- 918271` and `npm run kernel:demo -- 44017`. Each covers grain/water treatment and broken-transmission controls plus an autonomous held-out JSON variant, 80 physical seconds per workshop. Seed 918271: each inhabitant produces 4.779 flour measures or transfers 2.3895 L of water; held-out dense liquid transfers 2.101875 L. Controls produce zero. Full resource/labor/energy costs and seed 44017 results are in the milestone report.

## Verification

- Final focused kernel: 12/12 PASS (`.debug/kernel-final-focused.log`).
- Focused persistence 5/5 PASS; earlier kernel/metabolism integration 29/29 PASS, including the eight-day metabolism check.
- Typecheck/build PASS on the current runtime (`.debug/kernel-final-build.log`). No runtime changes after that build.
- Default-concurrency full regression: 697/703 PASS, six five-second timeouts across four files (`.debug/kernel-final-regression.log`). All six checks PASS with one worker, unchanged assertions/timeouts (`.debug/kernel-timeout-recheck.log`).
- Final complete regression with two workers: **703/703 across 65 files PASS**, 528.30 seconds (`.debug/kernel-final-regression-limited.log`). No assertions/timeouts/config exclusions changed. Final demo commands for both seeds exit 0 with stable report hashes.
- Verification is complete. No runtime edits after the successful final build/regression; documentation changes do not invalidate them. No intentional jobs remain. Specialized long-run acceptance and browser/Unreal checks were not relevant to this opt-in canonical kernel.

## Deliberate limits and unrelated existing failures

This is a local workshop extension point. Practical quantity needs and primitive education are seeded. Automatic economy-wide demand adoption, primitive manufacture, distant component procurement, full fluids/rotational dynamics, branching graphs, continuous weather capture, and reservoir-backed drinking remain future work. Search does not yet systematically revisit failed candidates when circumstances change. No multiple universes, chemistry, species expansion, magic, migration or survival rebalance.

Previously recorded Living Economy & Survival primary target remains unmet: Ashford's last 30-day run ended with 25/32 residents at zero caloric reserve. Zero reserve is not death. Its prior specialized adaptive acceptance was 8/9 with unresolved `shortageEased` failure at `tests/adaptive-society-longrun.test.ts:132`; it was not diagnosed or repaired here. Full evidence: `docs/LIVING_ECONOMY_SURVIVAL.md`. Do not claim this workshop establishes settlement viability. The specialized long-run survival/adaptive scenarios are not rerun for this bounded kernel milestone.
