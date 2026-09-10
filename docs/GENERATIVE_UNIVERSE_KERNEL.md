# Generative Universe Kernel v0.1

The canonical simulation can now discover and reproduce useful connected mechanisms. The short workshop demonstration starts with no assemblies, projects, or finished methods. One ordinary NPC knows primitive component capabilities, tries a weak transmission, observes a real stall, constructs a different arrangement, and communicates the successful method. A second NPC begins without component capability knowledge, receives the method through `Simulation.tell`, acquires its own physical components, and constructs and operates its own device.

Implementation checkpoint: `db0a9eb`, branch `codex/generative-universe-kernel`. Subsequent hardening enforces installation/join labor at the physical mutation boundary and adds held-out autonomous acceptance. No merge or PR is part of this milestone.

## Acceptance evidence

All seven requested completion criteria are demonstrated by the kernel acceptance and workshop command:

| Criterion | Result | Evidence |
| --- | --- | --- |
| 1. Shared execution, real productive effects | PASS | `operateAssembly` processes existing grain Items into flour through `world/metabolism.transform`, and transfers finite reservoir quantities. |
| 2. Held-out data variant | PASS | `src/headless/kernel/held-out.json` supplies two new component materials, two couplers, and a denser liquid. Weak material stalls; the stronger coupler works. The same NPC search discovers and teaches it. |
| 3. Discovery and reproduction | PASS | No fixture method; first experiment fails; a later arrangement produces output. Recipient has told provenance, separate component-acquisition/construction events, and its own productive trial. |
| 4. Required parts and legitimate failure costs | PASS | Broken transmission controls produce zero. Disconnect, absent membership, duplicate parts, incompatible ports/materials, empty sources, finite output capacity and foreign stock are exercised. A stalled connected trial dissipates energy but consumes no material. |
| 5. Persistence and deterministic replay | PASS | Save schema 21 persists rules, instances, connections, methods, partial labor and accounting. Interrupted construction resumes; loaded physical execution matches the original. Full same-seed autonomous reports compare identically. |
| 6. Ownership, locality and accounting | PASS | Reach/line-of-sight and title checks, source/stock locality, outbound reservations, finite energy, material balance, byproducts and zero money transfers. |
| 7. Matched useful effect and costs | PASS | Same-seed workshops with identical stocks/equipment but broken usable transmissions yield zero output. Tables below include productive output, input consumption, labor and energy. |

Commands, run from the repository root:

```powershell
npm run kernel:demo -- 918271
npm run kernel:demo -- 44017
npm test -- tests/generative-kernel.test.ts
```

Each command simulates five inspectable 80-physical-second workshops: grain treatment/control, water treatment/control, and held-out dense-liquid treatment. Calendar time is explicitly 1:1 in the lab. Output goes to `.debug/kernel/<seed>.json`, with a SHA256 of the complete deterministic report. Existing residents are placed under controlled input during the fixture; the two workshop inhabitants run the ordinary autonomous simulation. The workshop is isolated from long-run survival measurement.

## Seed 918271 measurements

Each inhabitant initially has 30 grain measures, 20 L in an input reservoir, an empty 20 L destination, 5000 J of finite environmental energy, 21 kg of primitive components, and 10 silver. There is no replenishment. The seeded gust boundary supplies at most 118 W; it is an explicit initial energy parcel, not ongoing weather-derived power. There is no water-to-energy feedback binding.

| Workshop / inhabitant | Useful output | Grain consumed | Construction + trial labor, physical s | Input J | Useful J | Dissipated J |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Grain inventor | 4.779 flour measures | 3.58425 | 15.0 | 354 | 143.370 | 210.630 |
| Grain recipient | 4.779 flour measures | 3.58425 | 7.5 | 236 | 143.370 | 92.630 |
| Grain broken control, inventor | 0 | 0 | 15.0 | 118 | 0 | 118 |
| Water inventor | 2.3895 L | 0 | 14.0 | 236 | 71.685 | 164.315 |
| Water recipient | 2.3895 L | 0 | 6.5 | 118 | 71.685 | 46.315 |
| Water broken control, inventor | 0 | 0 | 15.0 | 118 | 0 | 118 |
| Held-out inventor | 2.101875 L at 1.2 kg/L | 0 | 14.4 | 236 | 75.6675 | 160.3325 |
| Held-out recipient | 2.101875 L at 1.2 kg/L | 0 | 6.7 | 118 | 75.6675 | 42.3325 |

The recipients in broken controls acquire no method or components, perform no construction, and produce zero. Inventors acquire eight components across their two attempts; recipients acquire four for one arrangement. Dismantling returns the actual worn components, preserving their ownership and condition. Reuse never restores condition. Successful baseline arrangements contain 16 kg of components; the held-out arrangement contains 15 kg. Initial equipment includes alternatives and the unused work mechanism; it is not newly manufactured during the experiment.

Steady productive throughput at these initial conditions is 2.3895 flour measures/s or 2.3895 L/s. Grain runs for two productive seconds per inhabitant because the target is three flour measures. Water runs for one productive second because the target is two litres. Inventors also spend one second on the failed experiment. The held-out productive flow is 2.101875 L/s. These are supervised operating rates, not 80-second average production rates. Labor totals include installation, joints, experimental operation, and dismantling; they exclude walking, conversation and idle time. Existing physiology recognizes construction and operation as activity and charges exertion separately. No proficiency increase is granted by instruction or these v0.1 trials.

Both water reservoirs conserve their combined volume. For grain, one input measure is modeled as 1 kg and one flour measure as 0.75 kg; the legacy 3:4 transform therefore conserves mass. These are documented compatibility units for the prototype's coarse Items, not a claim about historical sack sizes. The default process has no byproduct; a mass-balanced variation with unprocessed grain as a byproduct is exercised by the focused tests.

Seed `44017` supplies 128 W. Each inhabitant produces 5.184 flour measures from 3.888 grain, transfers 2.592 L of water, or transfers 2.28 L of held-out dense liquid. Labor is unchanged. Grain inventor/recipient use 384/256 J; water and held-out inventor/recipient use 256/128 J. Broken controls again yield zero. Report SHA256 values: seed `918271`, `addb2d9024da0bce7679c7190beb9033686005cedb262b81f1ccd6941d854a80`; seed `44017`, `a822ccf403cc1c9560ff6ac6a3b3c67390cafbae8b07674f63548e9f8a4c61d4`.

## Authored primitives versus discovered arrangements

Authored: validated material properties, typed ports, finite energy sources, converter/transmission efficiencies, power/condition limits, installation costs, grinding's input/output relation, and a generic phase-restricted material-transfer interaction. The test fixture supplies an unmet quantity goal, local resources and primitive capability beliefs with prior provenance.

Discovered: a sequence and its connections. `candidateMethods` searches only the inhabitant's capability beliefs and locally observable, obtainable components. It explores at most 128 search nodes, six components per path and 24 candidates. It joins compatible ports and orders alternatives by mass with stable-id tie breaking; it does not evaluate aggregate output power, run the physics in advance, or receive a winning recipe. Actual execution distinguishes the slipping cord from the useful belt. Names never enter physical execution.

The learned instruction is reconstructed from actual participating components and connections after productive execution, not copied from intended topology. It contains scoped definition ids and connection indices, with no source instance ids or ready-made device. `learn`/`remember` retain experimental costs and outcomes. Successful methods are ordinary `technique` knowledge. The existing conversation path records the teaching event and source/hops; the recipient's own confirmation adds a verified event without erasing who taught it. Skills remain unchanged.

## Canonical extension boundary

- `src/sim/kernel/types.ts`: world-scoped definitions, single-component instances, material/energy stores, assemblies, bindings, and methods. Each component is one countable physical instance; its mass comes from its definition.
- `definitions.ts`: complete-ruleset validation, primitive data and save-boundary validation. Runtime worlds own their definitions; there is no global registry of inventions. Rulesets are installed before instances and cannot be replaced after instantiation through the installation API.
- `mechanics.ts`: shared reach/title checks, acquisition, paid installation/joining, connection validation, and physical execution. It never reads occupation, knowledge, a desired method, or narrative names to decide success. Its action helpers are callable for any embodied actor; reach supports any present eligible body.
- `src/sim/mind/invention.ts`: bounded proposals and ordinary construction/operation actions. `agent.ts` sends the goals through its existing `G()` motivation bridge, hysteresis and planning loop. There is no separately scheduled inventor AI or named-character behavior.
- `world/metabolism.transform` and `world/stock.takePlaceStock`: optional exact-owner input filtering. Existing callers preserve their existing behavior. Outputs remain ordinary Items usable by downstream production, trade and eating. Reserved outbound input is excluded by the kernel adapter.
- `persist/save.ts`: schema 21. Kernel state and dynamic Place definitions survive loading; schema 20 is rejected explicitly. Partial construction progress resides in canonical assemblies and survives the existing tactical-plan reset.

All mechanical rates use physical seconds, watts and joules. Positions/lift use metres; material definitions declare quantity units and kg per unit. Component conversion and material strength constrain transmitted power. Unused throughput is throttled at the source; energy drawn but not made useful is explicitly reported as dissipation. Transfer work includes declared friction plus 9.81 J/kg per metre of upward lift. Descending transfer does not regenerate energy. Wear lowers condition according to transmitted energy and never replenishes mass or energy.

Physical graphs are intentionally unbranched, directed and acyclic in v0.1; fan-in, fan-out, reused component instances, incompatible ports and cycles are rejected. Unconnected and broken assemblies produce no material output and draw no energy. Connected underpowered attempts dissipate their finite source draw. Missing material and full destinations prevent source draw. No assembly writes energy back to its source, so closing a material circuit cannot produce energy.

## Deliberate limits

This is a short local workshop foundation, not economy-wide invention adoption. Practical quantity goals and primitive education are explicitly seeded; ordinary residents are not yet automatically educated or prompted by every economic shortage. Search currently handles local linear arrangements, avoids candidates with retained failed experiments, and does not systematically revise all failed hypotheses after environmental changes. Component manufacture, long-distance procurement, commerce in components, teaching curricula and skill progression are future work.

Operation is a supervised one-second functional trial/action. This is not continuous rigid-body engineering, full fluids, rotational dynamics, or weather capture. Reservoirs are finite canonical material stores; existing well/river drinking does not yet consume them. Legacy process inputs/outputs use the existing Item adapter; arbitrary new reservoir chemistry is not implemented. Material wear is abstract condition loss, not debris mass. Fixtures supply component capital and finite external energy as reported initial conditions; they do not demonstrate manufacturing those primitives.

Whole-simulation save/load still resets navigation/tactical plans and Simulation maintenance accumulators according to the existing persistence model. The milestone proves kernel state preservation, resumed construction, exact resumed physical execution, and same-seed fresh demonstrations; it does not claim bitwise continuation of every unrelated NPC clock after a reload.

Previously recorded survival failure remains outside scope: Ashford's last 30-day economy run had 25/32 residents at the caloric floor. The last specialized adaptive acceptance had an unresolved `shortageEased` failure. This milestone neither repairs nor re-measures those long-run outcomes. The workshop must not be cited as evidence of settlement viability.

## Verification record

- Focused kernel: 12/12 PASS; includes both autonomous families, held-out autonomous reproduction, controls, persistence and determinism.
- Persistence: 5/5 PASS in focused run.
- Kernel + metabolism integration: 29/29 PASS at the earlier 10-test kernel checkpoint, including the existing eight-day metabolism check.
- Typecheck PASS after implementation/hardening.
- Final full regression: **703/703 across 65 files PASS**, `npm test -- --maxWorkers=2`, 528.30 seconds, `.debug/kernel-final-regression-limited.log`.
- Final build (including TypeScript): **PASS**, `.debug/kernel-final-build.log`. Build completed after the last runtime edit and remains valid.
- The first default-concurrency regression run had 697 passes and six five-second timeouts across persistence, logistics, embodied economy and metabolism. Every failure was a timeout, not an assertion mismatch. The exact six checks passed with one worker (14.62 seconds, `.debug/kernel-timeout-recheck.log`), then the complete suite passed with two workers. No assertion, timeout, exclusion or default configuration was weakened. This distinguishes resource contention from a claimed code regression while preserving the original failure evidence.
- Final demo commands for seeds 918271 and 44017 both exit 0. Their report hashes match those recorded above.

Detailed generated evidence lives in `.debug/kernel/`, `.debug/kernel-final-regression.log`, and `.debug/kernel-final-build.log`. Generated artifacts are ignored by git; this report preserves the measurements and commands.
