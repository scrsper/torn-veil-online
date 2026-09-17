# Isolated bridge save profile

Read-only diagnostic captured 2026-09-14 from `.debug/playable-repair-test.save.json` in an isolated `BridgeSession`. The save was read once and never written. No live bridge, production source, canonical scheduler, or tests were changed.

Configuration: `new BridgeSession(918271, { playable: true, save })`, then 120 `stepInteraction()` calls at `1/60` seconds. Node CPU sampling profile: `.debug/bridge-save-step.cpuprofile`; bounded summary: `.debug/bridge-save-step-summary.json`.

Observed:

- Save input: 61,776,334 file bytes (61,776,064 UTF-16 JavaScript string units).
- Construction/deserialization: 4,979.5 ms.
- 120 steps: 7,906.5 ms total; p50 0.033 ms; p95 301.0 ms; maximum 394.0 ms.
- Simulation timing buckets: `think` 7,471.3 ms; `perceive` 275.3 ms; `act` 104.6 ms; `bodyPhysics` 12.1 ms; `creatures` 0.18 ms.
- CPU samples most concentrated in `Simulation.step` (3,776) and `Simulation.think` (770). Named hot descendants include `laborIncentive`, `inventionGoals`, `pruneKnowledge`, `knownFoodPlace`, `findAccessibleFood`, `observeMaterialSources`, and spatial `query`.

Interpretation: this reproduces a canonical simulation workload bottleneck in the loaded save. Without a comparable earlier profile, it does not date the introduction of that bottleneck. The dominant cost is scheduled mind cognition, not wildlife or transport serialization. The 120 interaction ticks trigger 40 coarse scheduled simulation passes; the p95/max spikes are therefore compatible with cognition/perception work landing on those passes. This does not establish that scheduler wake dispatch is the sole cause of live debt, nor does it authorize changes to scheduler/core mechanics.
