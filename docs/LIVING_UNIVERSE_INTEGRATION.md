# Living Universe Integration — Resources, Adaptation, Innovation, and Divergence

Implementation checkpoints: `4fd1c9ced44780de3eb208c3371c13954fd891ac` and `85b01ca669a02416538fc1ff3b3ceae1d6155efe` on `codex/generative-universe-kernel`, both pushed. The latter preserves full simulation continuation. All eleven milestone completion criteria pass within the bounded evidence below.

## Ordinary-world path

`generateProceduralWorld` now installs world-scoped mechanical definitions and initializes local primitive education and finite environmental energy. It creates **zero components, assemblies, finished methods, or invention goals**. Every resident remains autonomous.

The existing production request and local stock-observation path can motivate familiar work or an experiment. Candidate search now includes primitives an inhabitant knows how to manufacture, provided they know a plausible material source. Their existing goal, planning, movement, gathering, wholesale purchase, haul, skill, physiological-cost, and communication systems execute the choice. Supplier memories contain locations and resources, not live remote inventories. Prices, available stock and affordability are checked on arrival. Failed offers remain personal evidence; a later local observation can contradict them.

Construction projects retain partial shaping labor. Manufacture consumes real stock at the workplace, preserves mass, uses owned or public materials, wears an accessible tool, and creates one physical component only after the required work. Failure to supply a part does not mint it. The same graph executor then drives canonical grain/flour stock transformations. Flour enters existing freight and bakery processes without a productivity bonus.

The ordinary shift still gets a worker to their workplace. At a reachable production post with a real request and compositional alternatives, that fixed schedule no longer duplicates the grounded work choice. Familiar manual work continues to compete. It can outperform invention.

## Authored primitives versus historical outcomes

Authored: source intake, converter, two transmissions with different loss properties, grinding surface, liquid work mechanism, typed ports, manufacturing hardness constraints, labor/rate/wear constants, and the existing grain-processing primitive. These are small functional shapes, **not finished machine recipes**.

Scoped material adapters connect real logs, planks and stone to the kernel. Logs and planks both satisfy the same wood-working hardness interval; the abrasive surface requires harder material. A held-out data material is also manufactured without a resource-specific engine branch. The actual material's power limit still constrains operation independently of manufacturability.

The procedural sawpit's former 150 kg initial timber budget is partitioned into rough and sawn stock using its local generation RNG. No extra timber mass or machine parts are added. Initial stock is an explicit world condition; this milestone does not claim to have simulated its pre-generation manufacture.

Ordinary inventory grain and flour measures weigh 0.7 kg and 0.65 kg. The settlement adapter re-expresses the mass-conserving grinding output in those measures: 3 grain measures become 42/13 flour measures. The older reference workshop retains its separately declared measures and 3:4 ratio. Existing manual recipes are unchanged; their broader coarse mass/yield assumptions are not presented as newly solved chemistry.

Inhabitants search a bounded graph of their known components, make and connect the actual parts, attempt operation, and learn from measured results. They can infer that a replacement with identical known physical power properties cannot cure an already-observed transmission loss. Different or unknown material limits remain distinct experiments. Cheap available parts influence search order, but no arrangement is certified successful before canonical execution.

The working topology and its reproducible instructions are discovered during the run. Neither acceptance configuration nor runtime code names a winning machine, seed, or person.

## Acceptance conditions and command

```text
npm run living:demo -- 17
```

Each comparison runs 1,800 physical seconds, or 30 ordinary world hours, using 0.25-second steps. Output: `.debug/living/17.json`; console log: `.debug/living/final-demo.log`.

The focused scenario starts generated mill and bakery bins without their initial flour/bread reserves. Existing mill owners start at their existing workplace, with no manual milling proficiency, crafting proficiency 0.5 and curiosity 0.95. This represents inexperienced post-holders facing a shortage. It adds no items, parts, methods, needs, schedules, selected goals or rescue. Primitive education, family relationships, suppliers, wealth, fields, other residents and environmental conditions are generated normally.

The matched control changes only the local kinetic boundary to calm air, 0 W / 0 J. The manual comparison changes milling proficiency to 0.6. The material comparison supplies only prior knowledge of shaping sawn rather than rough timber; it does not supply an arrangement. All comparisons retain every other person's ordinary cognition.

The three-settlement comparison uses the same rules and initial workforce/shortage intervention at sites `(256,128)`, `(1256,128)` and `(2256,128)`, with IDs `site_0`–`site_2`. No outcome is assigned to a site. These are separate, geographically distant local economies in one canonical world.

## Measured results, seed 17

| Comparison | Manufactured parts | Mechanical flour | Assembly labor, physical s | Source energy, J | Bread produced | Method holders |
|---|---:|---:|---:|---:|---:|---:|
| Novice / ordinary energy | 5 | 11.427139 | 69.922744 | 785.993711 | 15 | 3 |
| Matched calm air | 4 | 0 | 48.000568 | 0 | 5 | 0 |
| Experienced manual worker | 0 | 0 | 0 | 0 | 35 | 0 |
| Sawn-timber substitution | 5 | 8.570355 | 67.922744 | 611.328442 | 20 | 3 |

Assembly labor includes manufacture, installation, joining, supervised experiments and dismantling. It excludes the separately executed travel, gathering and freight actions; those still consume ordinary time and physiology and are not free. The source and material ledgers account for failures too. The successful sequence incorporates 17 kg of real material, including the unused lossy transmission, rather than consuming only the winning arrangement's inputs. Its initial failed power experiment moves no grain but draws and dissipates a real 87.333 J. Initial material procurement includes an actual paid-time quarrying action and physical freight from supplier locations.

The normal run delivers 11 flour measures to the bakery. Its 15 bread all have recorded mechanical-production ancestry. The calm control's 5 bread arise from other ordinary work. The manual case produces more bread than the invention case. More mechanical output also need not imply more bread within the short horizon: transport, batch timing, manual work and competing needs remain consequential.

In the shared world, Juniperstead produces 8.570355 mechanical flour, supplies 15 bread, and has three method holders. Stonehaven and Ivesford produce no mechanical flour and each produces 5 bread. Stonehaven's mill owner has no primitive knowledge; no discovery elsewhere grants it. Ivesford's educated owner encounters an empty remembered timber supplier and does not complete manufacture. Their available source powers are respectively 87.333, 22.021 and 40.211 W; the latter two are not secretly upgraded. Ending household food stocks are 235, 227 and 297 bread/cheese measures, with populations 13, 16 and 15. These differences are outcomes, not population or prosperity targets.

## Knowledge, ownership and history

Normal communication takes the discovered method from one holder to three. Recipients receive component instructions and provenance, not hardware or crafting proficiency. Knowledge remains selective; other residents and isolated settlements do not receive a global unlock.

An explicit mortality intervention kills the sole holder at physical second 1,057, before teaching. After another 300 seconds there are zero living method holders, while the deceased's evidence remains archived. Five physical components pass through the ordinary estate mechanism. Connected parts inherit together; material, condition and stored energy are unchanged. The project's creator identity prevents inherited construction intent from becoming the heir's knowledge. **This demonstrates the consequence of mortality, not spontaneous death caused by the shortage.**

Manufacture, acquisition and reuse carry component provenance. Freight pickup/deposit carries the ancestry of the actual debited stock. Downstream transformations retain those edges. Thus the Chronicle and causal readers can follow extraction → manufacture → failed attempt/reused components → mechanical flour → freight → bread. Compaction pins the kernel's references rather than reconstructing that history in the report.

## Plumbing fixes

- Scheduled productive work meets the explicit stock-access point. Previously a work anchor elsewhere in the room could put a worker outside the strict stock API's reach and silently prevent batches.
- Procedural load regenerates geometry before restoring the saved kernel. Regeneration cannot replace an already-instantiated ruleset or resurrect a spent source.
- Physical component assets participate in inheritance without copying a mind's knowledge or project intent to an heir.
- Saves with an attached simulation preserve scheduler cadence, pending perception/speech, work caches, plans, intent, body paths/poses, and tallies. Resetting those previously changed later physical production despite an intact kernel snapshot. Older saves without execution checkpoints retain their legacy fallback.
- The ordinary material adapter uses existing inventory masses and a mass-conserving process output, avoiding a hidden mass gain from reusing the reference workshop's different measures.

## Verification

Final normal regression passed **726/726 tests across 67 files** in 570.57 seconds (`npm test -- --maxWorkers=2`). `npm run typecheck` and `npm run build` passed. Logs: `.debug/living/regression.log`, `.debug/living/build.log`.

`npm run living:demo -- 17` passed with same-seed replay, exact knowledge/kernel restoration, deterministic loaded branches, and continuation matching the uninterrupted result. The focused integration test additionally compares the complete kernel and all 2,159 events after loading at physical second 90 and continuing to second 1,800. Normal report SHA-256: `cc91972946b81a941982c1520533e00d48151349773310f976d2936134f4d410`. Continued settlement-state SHA-256: `517fd2925b2a30d5c69713d3ae54e83bfd6d1bb945aae4ca51d41fef28b3a7c2`.

All comparisons preserve currency (delta 0), manufactured-material mass (error 0 kg), finite energy (maximum ledger error 1.819e-12 J), nonnegative finite stocks, household consistency, validated kernel state and resolvable causal references. Existing normal tests supply the broader conservation, locality, demographic and history regression coverage. The new grain/flour adapter additionally checks canonical input/output mass; it does not claim every old manual recipe is a complete mass model.

Earlier focused verification passed 64 tests across living integration, kernel, causal pressure, procedural generation and adaptive society; the complete new integration file passed 11/11. After the continuation refinement, living/kernel/pressure/demographic checks passed **40/40**. That includes equality of the uninterrupted and loaded settlement report, kernel state and complete event stream after a checkpoint at physical second 90. Manufacture guard checks passed. One broad run was deliberately interrupted for the continuation fix; its log is retained as `.debug/living/regression-interrupted-for-continuation.log`, not counted as a pass. Specialized historical long-run and browser/Unreal suites were not rerun.

| Completion criterion | Result | Evidence |
|---|---|---|
| 1. Ordinary component supply | PASS | Starts with zero parts; actual quarrying, supplier purchase, freight and workplace shaping produce five components. |
| 2. Canonical useful operation | PASS | Shared kernel converts real grain; flour is delivered to an ordinary bakery. |
| 3. General substitution | PASS | Logs and planks satisfy common hardness constraints; sawn-only knowledge produces a working assembly. A held-out material tests the data boundary. |
| 4. Diverse pressure responses | PASS | Experimentation, familiar manual work, substitution and unsuccessful supply seeking compete through existing cognition. |
| 5. Successful knowledge spread | PASS | The discovered method reaches three living people through local communication, with no granted proficiency or hardware. |
| 6. Knowledge can disappear | PASS | Sole-holder mortality leaves zero living method holders despite inherited physical parts. |
| 7. Downstream consequence | PASS | Eleven flour measures reach the bakery; fifteen bread have canonical mechanical ancestry. |
| 8. Settlement divergence | PASS | One shared-world settlement manufactures and operates; another lacks primitive knowledge; another encounters unavailable timber. |
| 9. Failure stays real | PASS | Calm air prevents productive operation, a lossy transmission dissipates energy without output, and an empty supplier blocks manufacture. |
| 10. Invariants and continuation | PASS | Focused tests cover mass, finite energy, locality/title, causal ancestry, estates, deterministic replay and exact uninterrupted versus loaded execution. |
| 11. Regression/typecheck/build | PASS | Normal regression 726/726 across 67 files; typecheck and build passed. |

The ordinary-settlement run demonstrates instruction spreading, not construction of a second machine by a recipient. Recipients still need ownership/access, resources, labor and sufficient motivation; the earlier kernel reproduction tests remain the narrower evidence for that action path. The present milestone's normal-world method spread does not imply universal adoption.

## Remaining boundaries

- Environmental energy is a finite explicit kinetic budget (air density, capture area, speed and parcel duration are reported), not ongoing weather-driven replenishment or full wind geometry. Exhaustion remains possible. There is no feedback route into that source.
- Primitive education is a generated personal prior. There is no education institution, written-method carrier, automatic reverse engineering of inherited hardware, or general manufacturing market for finished components.
- Current compositional production is owner-operated. Employee machine contracts, household-owned workshop access, and recognizing an inherited machine as an actionable affordance remain important next steps.
- Existing reserve targets, many occupational schedules, supplier-location priors and traditional recipes remain authored approximations. Procurement utility estimates do not yet price complete route risk and opportunity cost. Knowledge of a remembered supplier is not a guarantee of available stock or successful coordination.
- No full chemistry, fluid dynamics, migration, market equilibrium, technology tree, guaranteed recovery, or settlement survival result is claimed. Only the bounded mechanical family is integrated.
- Previously recorded failures remain unresolved evidence: the older Ashford 30-day run had 25/32 residents at zero caloric reserve (not death), and specialized adaptive acceptance was 8/9 with `shortageEased` failing at `tests/adaptive-society-longrun.test.ts:132`. Those runs are not silently relabeled fixed by this milestone. See `docs/LIVING_ECONOMY_SURVIVAL.md`.
