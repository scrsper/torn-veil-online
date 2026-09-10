# Civilizational Capability Continuity

Branch: `codex/civilizational-capability-continuity`, based on the merged Living Universe Integration. Implementation checkpoint: `7ff4df3`. No PR or merge is part of this milestone.

## Canonical mechanisms

Practical instructions can be inscribed on an ordinary owned `book` item, represented here as a wooden tablet. Its 0.5 kg substrate comes from physical plank stock. Writing and copying require interruptible physical labor, bodily capacity, access to the worksite and knowledge of the notation. The item holds a snapshot of the author's belief, its original provenance, confidence and transmission depth. Copies preserve mistakes; no canonical method registry validates a written claim.

Reading requires physical possession or authorized local access, line of sight and intelligible notation. It produces a `read` knowledge source naming the item and the actual reading event. Reading and teaching do not confer skills, components or materials. Theft changes possession without erasing title. Ordinary pickup, gifts, drops, inheritance and save/load apply to the same item. Rain damages exposed writing; nearby fire can destroy it. Unreadable substrate and its historical provenance remain physical rather than vanishing from mass accounting.

Workplace assignments permit use of the employer's machinery and stock while keeping ownership distinct from operation. Non-owners need the method, physical access and exertion capacity. Processing preserves the input owner's output title. Construction still uses the builder's own or public material. Personal haul contracts name the buyer explicitly, so a learner can buy materials delivered to somebody else's workplace. Returning from a supply trip now requires inspecting the work bin before ordering more material; being away is no longer mistaken for an empty bin.

Records, living holders, functioning examples and repeated successful operations at existing workplaces form a **derived** practice reservoir. There is no new Guild/School entity or invisible institutional mind. The observability layer distinguishes shared practice, a fragile living holder, dormant records, uninterpreted working examples and loss. Membership changes and movement of sources divide reservoirs; death, forgetting, destruction and broken machinery weaken them. Existing shared-work/home relationships motivate instruction, and curiosity/usefulness motivate reading or writing through the ordinary goal competition.

Workplace and household property now passes through the existing estate process along with records and machinery. A dead owner's title no longer permanently blocks access to inherited assets. Hardware inheritance does not teach its recipient anything.

## Environmental energy

Generated workplaces expose a 2 m² wind collection boundary with local geographical exposure derived from the settlement's moisture. Actual weather wind determines local speed and kinetic flux: `0.5 × air density × area × speed³`. This is an open environmental boundary, not a simulation of atmospheric fluid dynamics.

Only simulation time imports energy. Assemblies draw from the resulting bounded two-second air parcel; unused energy escapes. Calm air empties the parcel and stops work. Unsuitable exposure, inadequate power and broken components also stop production. A known machine is retained through temporary power/input failure instead of automatically dismantled.

The ledger is `initial + imported = remaining + escaped + assembly input`; each assembly separately preserves `input = useful + dissipated`. Reference kernel scenarios can still use explicit finite sources.

## Evidence and scenario conditions

`tests/capability-continuity.test.ts` uses a generated settlement and ordinary `Simulation` cognition/actions. Its initial discovery scenario supplies a favorable steady wind interval, novice milling pressure and sawn-stock education. The inventor autonomously procures material, manufactures, experiments and writes a record. Subsequent demonstrations use disclosed healthy starts of shift, work assignments, literacy and raw material availability. They do not install selected construction goals, finished parts, skill transfers or working layouts.

- **Independent reproduction:** Orla Thorne reads Perrin Nettle's record with zero crafting skill, operates Perrin's machine without taking title, then builds at the sawpit. Four separately manufactured components use timber and physically extracted/hauled stone. Explicit personal buying preserves ownership of the delivered stone. The new assembly produces flour; reading does not change skills, and crafting practice increases proficiency only after manufacture.
- **Physical transmission:** a reader autonomously copies the record using personal wood and paid labor. The tests exercise possession, movement, theft, intelligibility, distance, inheritance, incomplete instructions and destructive weather.
- **Shared practice and regression:** repeated work by two people forms a derived shared reservoir. A controlled loss scenario kills every living method holder, destroys the records and breaks the examples. Living access and working capability disappear; the next ordinary simulation interval does not automatically restore either. Archived dead minds remain historical evidence, never learning sources.
- **Replay and short continuation:** autonomous discovery/record creation replay exactly from seed 17. Saving during subsequent record work preserves plans, knowledge, physical items, assemblies, wind, derived reservoirs and the complete event stream through continued execution.

`npm run continuity:accept` is separate from the normal test suite. It writes `.debug/continuity/generation.json` and `divergence.json`.

The generation scenario creates Gareth Nettle through the canonical birth mechanism **after** discovery, then kills the inventor. Maren Nettle inherits record `i_277` and the workplace. Eighteen years run through the existing Epoch cadence of one ordinary `Simulation.step` per calendar day; the child remains ignorant of the method throughout. At age 18, an accessible living teacher teaches notation through conversation, and Gareth then independently reads the inherited record. Favorable raw grain and a healthy workplace encounter let him operate the existing machine through the ordinary goal/action loop. This resolves the actual learning and operation at the normal quarter-second cadence; the intervening epoch does not resolve every physical action.

Recorded method ancestry: discovery `e_996` → record `i_277` → reading `e_139275` → useful operation `e_139285`. The reading event additionally traces inventor death `e_1013` through inheritance. Gareth's separate notation lesson `e_139257` names its living teacher; no causal edge from discovery to birth or from inheritance to that lesson is inferred. Gareth produces 1.4283924169701452 flour measures from 1.3263643871865638 grain measures, using 87.33263454726344 J input, 53.05457548746255 J useful work and 34.27805905980089 J dissipation. Saving at year nine and loading for the remaining nine years yields identical kernel, records, knowledge and full event stream. The final environmental ledger error is 5.64e-8 J.

Three generated settlements use the same runtime rules and ordinary changing weather, with no outcome selected by settlement identity. At 1,800 physical seconds:

| Settlement | Mechanical flour | Bread produced | Method holders | Components manufactured |
| --- | ---: | ---: | ---: | ---: |
| Juniperstead | 17.394586 | 20 | 2 | 5 |
| Stonehaven | 0 | 5 | 0 | 0 |
| Ivesford | 8.828571 | 20 | 1 | 5 |

## Verification

- Final focused capability checks: 8/8 passed. Earlier combined capability/demographic checks: 12/12 passed.
- Typecheck passed at the implementation checkpoint and in the final production build.
- Final separate continuity acceptance: 2/2 passed in 43.75 seconds, including eighteen-year continuity, nine-year loaded continuation, operation provenance and settlement divergence.
- Final full normal regression: **734/734 tests across 68 files passed** in 610.30 seconds. Production build passed (109 modules, 1.49 seconds after TypeScript checking).
- The first full run had six CPU-contention timeouts and no assertion failures. The affected files plus capability checks passed 97/97 after bounding the normal suite at two workers. The final full run uses the original timeouts and assertions. Logs: `.debug/continuity-final-focused.log`, `continuity-final-accept.log`, `continuity-final-regression.log`, and `continuity-build.log`.

No promise of settlement viability, inevitable adoption, automatic record copying, guaranteed institutions, monotonic progress or inevitable rediscovery is made.

## Most limiting remaining abstractions

1. The method language is still a bounded linear mechanical graph, with a limited primitive/material vocabulary. There is no autonomous reverse engineering of abandoned machines or general repair profession.
2. Notation is a provenance-bearing declarative belief, not a detailed literacy/language proficiency model. Generated adults still receive prior education and supplier-location beliefs. Later-born learners do not automatically receive those priors.
3. Workplaces preserve practice through ordinary relationships, assignments, records and tools. The reservoir view does not yet model charters, budgets, collective decisions, formal succession or deliberate institutional splitting.
4. Wind uses global weather scaled by local geographical exposure and a two-second numerical parcel. It does not simulate terrain airflow, hydrology or fuel-powered engines.
5. The eighteen-year proof uses the existing coarse Epoch cadence between fine-grained demonstrations, plus a favorable adult encounter and raw input. It does not establish eighteen years of continuously resolved household provisioning or machine maintenance. Existing reserve constants, occupational schedules and economic approximations still constrain autonomous long-run emergence.

Constitution sections consulted: 5–6 (knowledge/provenance), 36–38 (institutions/culture) and 49–52 (continuity/causal history). `src/sim/` remains authoritative; no presentation dependency or global technology unlock was introduced.
