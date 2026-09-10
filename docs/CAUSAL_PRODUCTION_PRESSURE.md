# Local production pressure and historical alternatives

Implementation checkpoint: `32999b8` on `codex/generative-universe-kernel`. This extends the existing production requests, ordinary cognition, generative kernel, communication, physiology and persistence. It does not introduce an inventor controller, crisis flag, global unlock, population target or recovery rule.

## What changed

| Previous rigidity | Replacement |
| --- | --- |
| Composition needed a fixture-provided practical goal and had constant utility | A person physically inspecting an owned/held workplace observes stocks and an available production request. Known capabilities support an inferred practical goal. Familiar work and uncertain composition compete through the existing motivation/goal machinery, using deficit, physical capacity, skill, curiosity and estimated labor. |
| A successful method was always offered to the first nearby person | Voluntary teaching depends on the speaker's relationship, sociability and shared work/home. No recipient mind or wallet is inspected. Existing conversation supplies provenance; recipients still acquire components and build. |
| A failed arrangement was excluded regardless of later conditions | Experiment memory includes observed input availability and source conditions. Changed power or input availability permits reconsideration; elapsed time alone does not guarantee a retry. |
| Legacy trade dispatch could operate the first nearby mill instead of the actual work post | The ordinary action passes the actual post, checks physical reach and uses its operator/public stock. Unrelated private goods cannot be consumed. |
| A loaded empty resource/project list could restore generated defaults | Explicitly empty fields, resources and projects remain empty. New voluntary work also retains its already-paid batch progress. |

Existing scheduled work is retained as a competing baseline. The new opportunity does not duplicate a work shift already proposing the same action. New voluntary batches pay their full time before producing. Kernel output fulfills a production request by actual quantity; partial output remains partial, and outstanding pipeline quantity excludes what has already been produced. Legacy whole-batch completion retains its compatibility boundary.

`production_observed` events record the local measurement. Their causes include the request and relevant physical stock change. Goals, construction, transformations, trials and work stoppages retain canonical causes. Observation of changed stock does not teach the observer its production method.

## Reproducible demonstrations

```powershell
npm run pressure:demo -- 918271
npm run pressure:demo -- 44017
npm test -- tests/causal-pressure.test.ts tests/generative-kernel.test.ts tests/adaptive-society.test.ts --maxWorkers=2
```

Each pressure case advances 180 physical seconds / three world hours. All cases start with the same flour demand, idle schedule, ordinary villager label, workplace and accessible components. Only skill, primitive education, available grain or finite environmental energy differs. No practical-need claim, assembly, finished recipe or selected response is supplied. The fixture isolates the workshop from Ashford's unrelated authored shed project and controls other residents; it supplies no replenishment. All physical changes and choices after initialization run through `Simulation.step`.

Authored primitives remain the existing intake, converter, transmissions, work mechanisms and their port/process properties. The low-loss connected arrangement is discovered after trying a lossy transmission. These component definitions are not new inventions authored for this milestone.

### Measured production and costs

Flour is in canonical measures (0.75 kg each); grain is 1 kg/measure. Labor is physical seconds. Environmental energy is J. Physiology separately accounts for bodily exertion in world time. Mechanism labor includes failed trials, construction, operation and dismantling; batch labor counts completed/blocked manual attempts, not walking or subsequent idle time.

| Seed | Initial capability/constraint | Flour produced | Grain consumed | Environmental J consumed | Recorded productive/experimental labor s | Completed requests |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 918271 | Milling skill 0.6 + primitive knowledge | 16 | 12 | 0 | 32 | 4 |
| 918271 | Primitive knowledge, no milling skill | 14.337 | 10.75275 | 826 | 19 | 3 |
| 918271 | Same primitive knowledge, only 260 J | 2.3895 | 1.792125 | 260 | 23.5 | 0 |
| 918271 | Neither capability known | 0 | 0 | 0 | 0 | 0 |
| 918271 | Milling skill, no grain | 0 | 0 | 0 | 8 | 0 |
| 44017 | Milling skill 0.6 + primitive knowledge | 20 | 15 | 0 | 40 | 5 |
| 44017 | Primitive knowledge, no milling skill | 25.92 | 19.44 | 1408 | 23 | 5 |
| 44017 | Same primitive knowledge, only 260 J | 2.592 | 1.944 | 260 | 23.5 | 0 |
| 44017 | Neither capability known | 0 | 0 | 0 | 0 | 0 |
| 44017 | Milling skill, no grain | 0 | 0 | 0 | 8 | 0 |

The practiced person chooses familiar work even with the same primitive education and components available. An unpracticed but educated person considers composition. Its first transmission dissipates power without moving grain. The useful replacement is learned from measured output. The energy-poor household discovers something useful but cannot fulfill even one four-measure request before its source is exhausted. The uninformed household cannot propose either technique. The grain-poor worker attempts the known process, pays time, observes the stoppage and stops repeating it while the input remains absent.

All cases retain total personal/household silver of 10; self-work creates no wage. At seed 918271, bodily caloric reserve ends at 0.627619 for the energy-poor experimenter, below the uninformed control's 0.657143, while the household also loses its 260 J source. Failure is materially worse, and is not repaired.

### Closed feedback

Local stock deficit → observed demand → capability/cost-dependent choice → paid physical processing → lower grain/higher flour → a new stock observation and lower labor pressure → a later different goal.

Seed 918271 leaves 8 measures of the trigger deficit after manual work and 9.663 after invention; idle time and later bodily needs can take priority. Seed 44017's composition reaches 25.92 measures and lowers the existing scarcity quote from 4 to 3. The quote is the inventory-based price before seller-specific terms, not a claim that a trade occurred. There is no price-balancing intervention. In neither case is the amount produced specified in the fixture or engine by seed/name.

### Local knowledge histories

The same command also runs three 80-second water-workshop histories, saving/loading at 40 seconds. This comparison reuses the kernel's bounded water-need fixture, with zero initial methods; it does not seed a winning arrangement.

| Social/history condition | Living method holders | Recipient water transferred, seed 918271 / 44017 |
| --- | ---: | ---: |
| Shared household, ordinary relationship | 2 | 2.3895 / 2.592 L |
| Speaker distrusts the other inhabitant | 1 | 0 / 0 L |
| Sole holder dies before sharing | 0 | 0 / 0 L |

The death is an explicit controlled demographic intervention, not a naturally occurring death claimed by this short test. The dead person's historical evidence remains archived; living agents receive no access or successor assignment. The shared recipient acquires four real components, pays 6.5 seconds of construction/operation and uses 118/128 J. No skill is awarded by the message. Additional acceptance tests communicate an incorrect inferred method: incompatible joins fail observably, dismantling costs labor, source energy and material stocks are unchanged, and the method remains unverified.

## Acceptance and verification

| Criterion | Result | Evidence |
| --- | --- | --- |
| 1. One pressure, multiple plausible responses | PASS | Familiar practice, experimentation and inaction under the same production request machinery. |
| 2. Success and understandable failure | PASS | Real flour output versus empty inputs, power stalls and an exhausted source. |
| 3. No seed/character response script | PASS | Both seeds run identical logic; renamed-person replay preserves physical results. |
| 4. Plausible knowledge/access | PASS for the changed paths | On-site observation, known craft/primitive capabilities, own relationship and explicit communication. Remote stock changes do not update beliefs. |
| 5. Costs, ownership and risk | PASS for modeled costs | Mass/energy/silver checks, paid manual and assembly labor, physiology, private-stock and remote-post rejection. No new injury-risk model is claimed. |
| 6. Spread, privacy and loss | PASS | Three contrasting histories plus incorrect-instruction failure. |
| 7. Worsening is permitted | PASS | Depleted energy and bodily reserves, unfulfilled contracts, zero-output households; no replenishment or reassignment. |
| 8. Deterministic replay | PASS | Same-seed causal-report equality and existing kernel replay checks. |
| 9. Save/load causal continuation | PASS | Knowledge, experiment contexts, partial requests, assemblies, labor, empty canonical lists and loss of the holder survive. |
| 10. Regression/invariants/typecheck/build | PASS for the normal suite | 715/715 across 66 files, including conservation, locality, demographics and history; typecheck/build pass. Prior specialized long-run failure remains separately recorded below. |

Demonstration output: `.debug/pressure/918271.json`, `.debug/pressure/44017.json`. Complete report hashes:

- `918271`: `7c61dc05155f0f3833b9c08af897dcaa311f97738051542db996ec16825b57e7`
- `44017`: `ab56a5e7e40257a36fdf3655847586c9ad4602ccfb05e3beaa805be9f53fb6d8`

Focused final verification: 46/46 across pressure, kernel and adaptive-society tests; typecheck passed. A real regression during implementation—new voluntary-work planning replacing an already scheduled work action—was fixed by retaining the existing shift path. Assertions and timeouts were not weakened.

Final `npm test -- --maxWorkers=2`: **715/715 tests across 66 files PASS**, 494.39 seconds. This includes the existing conservation/economy, locality, demographic, historical/causal and persistence regressions. Log: `.debug/pressure-final-regression.log`. Production build (including typecheck) passed: `.debug/pressure-final-build.log`. No runtime changes followed this checkpoint; documentation edits do not invalidate its verification. Specialized long-run, browser and Unreal suites were not added to the normal suite or rerun for this bounded canonical change.

## Scope and remaining artificial assumptions

- These are bounded demonstrations of local production and knowledge histories, not evidence of a flourishing settlement or guaranteed industrial adoption. Components still begin as explicit fixture stock; general component manufacture/procurement and employee machinery contracts are future work.
- Existing reserve quantities, scheduled occupations, traditional process ratios and scheduled work's immediate first-batch shortcut remain. New voluntary batches pay before output. Legacy direct transform callers retain their older lookup boundary; normal trade actions now pass an explicit local post. Mixed public/operator input stacks are not combined within one strict-title batch.
- Ordinary production knowledge currently observes owned/held workplaces at reach; it does not implement distant opportunity search, commercial negotiation or a complete belief model of access. Primitive education treats process identifiers as a known capability vocabulary. Search is bounded, and estimated costs/curiosity remain authored cognition parameters.
- Existing construction pipeline queries, occupation lists and concurrency caps remain worthwhile next targets; they are not generalized by this change. No broad audit or economy rebalance was attempted.
- Finite gusts are explicit starting boundary energy, without automatic recharge. Weather capture, full engineering, chemistry and reservoir-backed drinking remain outside this slice.
- Learned methods use existing memory pruning; this milestone proves loss with a holder and private non-spread, not a new universal forgetting model. Save/load retains this work's causal state; general tactical replanning elsewhere is unchanged, so complete uninterrupted-versus-loaded world-event identity is not claimed.
- Previously recorded Ashford survival/adaptive long-run failures remain unresolved: the older 30-day run had 25/32 people at zero caloric reserve, and specialized adaptive acceptance had an unresolved `shortageEased` assertion. They are documented in `LIVING_ECONOMY_SURVIVAL.md`, were not repaired or reclassified as regressions here, and are not grounds for invisible rescue. No assertion of all specialized long-run scenarios being green is made.

Constitutional authority: sections 5–6 (belief/provenance), 10 (motivation), 39 (economy), 49 (continuity), 51 (causal history), and the existing kernel's composition/discovery decisions.
