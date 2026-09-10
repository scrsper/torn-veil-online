# Individual Potential, Lineage, Development & Human Advancement

Implemented on `codex/individual-potential-lineage-development`, from the post–Civilizational Capability Continuity head `747c853`. Implementation checkpoints: `60a4306` and `21e53e4`. No merge or PR.

## Canonical layers

Every person has seven developed integer foundations: Strength, Dexterity, Endurance, Vitality, Intellect, Perception and Will. They are separate from potential, fractional development, physiology, practical skills, dispositions, beliefs, genealogy and ontological state. `src/sim/core/human.ts`, `development.ts` and `lineage.ts` own the general model. Simulation remains authoritative; no game/renderer imports enter it.

The ordinary mature reference is **8**. Founders vary over 7–9 per attribute, with integer potential sampled over 8–12, using an identity-local seeded stream that does not consume behavioral RNG. These are starting-world biography assumptions, not birthday or occupation rewards. Young founders begin less developed. Current age affects physical expression independently of instantiation age; healthy minors can mature Vitality toward 8 through the daily demographic sample. Adult idleness grants no foundation growth.

The conceptual bands remain 1–4 severely limited, 5–7 below ordinary, 9–11 above average, 12–14 exceptional mundane development, and 16–19 extreme Normal development. They introduce no binary action gates.

`physicalAttribute(value)` is the sole scale adapter: 8 becomes the former 0.5 physical unit. Carrying, force, coordination and work retain the centralized capability path. END affects exertion/fatigue; VIT affects bodily recovery as well as recovery from exertion, with nutrition, hydration and sleep. Movement combines STR/DEX/END and fatigue with the existing injury, body-speed and terrain mechanics. There is no Speed, Recovery, Charisma, Luck or Spirit primary attribute.

Tissue repair and rest restoration have distinct derived rates. Nutrition and prior sleep loss can impede tissue repair; sleep itself still removes sleep debt at the calibrated ordinary reference rate. END/VIT variation modifies restoration without creating a circular penalty for needing rest.

While Normal, a developed attribute stops at **20**, discarding progress beyond the ceiling. Potential is never a development cap. `ironEligible(person)` requires **all seven >=15** and current Normal status. Eligibility is derived; no duplicated readiness flag or automatic transition exists. `ontology.stage` can represent Normal or Iron, and the reserved breakthrough-event reference provides a future integration point. No breakthrough action, post-Iron numeric progression, essence or magical class system was added. Existing vocation recognition remains separate.

## Integer potential and compact inheritance

For integer parental ordinary potentials L and H, inclusive candidate v has weight:

`min(v - L + 1, H - v + 1)`

Thus parents 6 and 10 produce 6/7/8/9/10 with weights 1/2/3/2/1. Both odd and even ranges are symmetric about the parental midpoint. No fractional parental blend is repeatedly rounded upward. There is no ordinary mutation in this milestone. Different siblings consume distinct deterministic draws from the persisted demographic stream.

An ordinary inheritance example (seed 123, parents with all-seven potentials 6 and 10, no imprints) produces sibling vectors **(7,9,8,9,9,8,7)** and **(8,8,10,6,8,6,7)**, ordered STR/DEX/END/VIT/INT/PER/WILL. Repeating the same causal state reproduces both exactly.

Inheritance runs once, after a real canonical birth and parent assignment; repeated initialization is rejected. It reads parental potential, never developed stats, fatigue, wounds, skills, equipment, profession, wealth or disposition. Explicitly expressed imprint contributions are subtracted before ordinary blending. This prevents one origin being counted both as a permanent baseline bonus and as an ancestral imprint in the next generation.

Each imprint retains its origin person, attribute, magnitude, creation event, transmissibility, generation distance and latest transmission event. Both parents carrying the same origin still transmit a single carrier, with one provenance path. At most seven inherited carriers survive selection, in a deterministic distance/ID order; a person can additionally originate at most one imprint per attribute. No ancestor tree is traversed.

- Transmission probability: 0.85; maximum distance: six generations.
- Conditional expression probability: 0.35, including expression after unexpressed generations.
- Expression strength: uniformly sampled 0.5–1; attenuation: `0.72^(distance - 1)`.
- Each contribution is limited to two; multiple origins combine as `2 * (1 - product(1 - contribution / 2))`, also limited to two per attribute.
- One unbiased stochastic rounding makes the final integer contribution; total potential remains within 1–20. Draws, raw expression details and the final contribution are saved, never rerolled during load.

Distance attenuation reduces expected expression, not a guarantee that every particular grandchild receives a smaller rounded integer. A 1.43 contribution can round to two, with the corresponding probability. Extinction, non-expression and loss of ancestry knowledge are valid outcomes.

## Development and exceptional adaptation

The centralized development rate, per weighted exposure second at current integer A and potential P, is:

`exp(clamp((P - A - 2) * 0.35, -12, 1)) / (500 * 3600 * (max(1, A) / 8)^2)`

Relevant activity, intensity, credited time, current physiology and bounded instruction multiply this rate. Integration resolves each integer boundary separately, preserving fractional progress and diminishing returns even for a large input dose. A shared daily eight-hour exposure budget bounds overlapping work/body/activity hooks. No regular action gate depends on reaching an attribute band.

Completed hauling, extraction, hunting, construction, crafting, cooking, milling, sawing and herbal practice enter through the existing shared practice hook. Construction supplies credited labor minutes; other completed batches use a **standardized minute of work-equivalent exposure**, not a claim of identical elapsed physical time. Learned skill still has its own existing progression and execution effects. Routine work does not grant Intellect. Experiments and newly acquired complex methods supply conceptual stimuli; repeated familiar reading and trivial facts do not. A bounded 128-entry familiarity memory contains short fingerprints, while existing knowledge/evidence checks remain the first novelty gate. Reacquisition after substantial forgetting/intervening complex experience is possible; this is not a lifetime Bloom filter that eventually prevents all learning.

Vitality conditioning requires health >=90%, adequate food/water, manageable fatigue and sleep debt. Injury itself never supplies a stimulus. Will stimuli come from completed effort or a new legitimate experiment, not a stress/idling counter. Nothing rewards an occupation label, merely owning a tool, a work schedule or adult birthdays.

An imprint requires developed A >= max(15, P+3), at least 8,000 weighted healthy hours at that exceptional level, 1,500 distinct active days and a ten-year span. Only then is there one **8% assessment per attribute per life**. Failure does not trigger another roll on each subsequent action. Creation emits a historical event linked to the recorded onset of exceptional adaptation and any supplied activity cause. Crossing 15 and beginning exceptional adaptation are compact milestones; routine fractional growth emits no events.

## Knowledge, records and cognition

`mind/genealogy.ts` reads learned claims, never the canonical parent graph. Adults involved in a birth obtain evidence-bearing parenthood claims. A newborn receives no genealogy knowledge or parent tags. Later, nearby adults can offer testimony through a `share_family` goal, which uses the ordinary goal competition, planning and tell action. The existing social exposure and relationships supply motivation; no preservation controller forces transmission.

Family claims can be inscribed, copied, read, inherited, loaned or destroyed through the existing physical-record mechanics. They retain testimony/record provenance and confidence. Different claimed parents remain distinct beliefs; neither rumors nor copied inscriptions are certified against canonical genealogy. Acquired parent/ancestor edges support bounded transitive inference with both premises and sources retained. Shared surnames after an actual social encounter support only a low-confidence `possible_kin` belief.

- **INT:** ranks the same bounded hypothesis set using losses inferred from known component properties; changes conceptual reading rate. It adds no knowledge or canonical truth. Search remains 128 visits / 24 candidates at every INT and cognitive LOD.
- **PER:** changes detection and detail of locally visible component wear. Distance/accessibility still governs observation. Repeated unchanged inspection adds no practice.
- **WILL:** moderates the utility effect of actual remembered failed experiments. Higher Will can maintain an investigation, but hunger, social needs and other ordinary goals can still dominate.
- **DEX and skill:** actual component fabrication includes both. DEX 9 / crafting 0.92 completes a tested component faster than DEX 18 / crafting 0.10.
- **Traits:** curiosity changes voluntary investigation; sociability/affection influence testimony. These paths never write potential.

## Deterministic showcase and its resolution limits

Run `npm run individual:demo -- 0`. Output: `.debug/individual/showcase.json`. Tests: `tests/individual-showcase.test.ts`.

Seed 0 demonstrates:

1. Founder `p_38`, STR potential 14 / developed 8, receives thirty years of controlled daily relevant exposure. Developed STR reaches 20; a rare magnitude-two imprint forms through the generic rule.
2. First-generation siblings include potential vectors `(12,10,10,10,10,10,10)` and `(14,10,10,10,10,10,10)`. Carrier `p_40` expresses zero.
3. Grandchild `p_57` expresses the origin at distance two: ordinary STR potential 11 plus a rounded contribution of two gives 13. Sibling `p_53` has STR potential 10 and no expression.
4. The expressing grandchild initially has no genealogy beliefs. Actual parental testimony plus reading the founder's real family inscription supplies two premises for discovering the ancestor. The reading source is record `i_84`, event `e_103`; the derived ancestry uses `e_105`. Inherited potential/expression stays byte-for-byte unchanged.
5. Save/load continuation preserves development, potential, carrier and expression details, genealogy knowledge and demographic RNG. Household consistency passes.
6. A STR-20 specialist remains blocked and ineligible; an all-15 foundation is eligible while still Normal.

The separate motivation comparison runs **25 detailed physical seconds** of the existing autonomous workshop. The disengaged, high-potential person does zero assembly labor; the curious, high-Will person does approximately fourteen seconds. A subsequent **controlled twenty-year exposure-response experiment**, scaled by that observed engagement, produces DEX 8 at potential 18 versus DEX 15 at potential 10.

These long intervals are **bounded acceptance acceleration, not semantically equivalent detailed simulation**. They replay standardized development stimuli under stable healthy conditions, with explicit pregnancy fixtures, favorable access and initial literacy. They do not simulate decades of changing decisions, economic production, food supply, mortality or institutional survival. The long engagement comparison is an extrapolation experiment, not proof that either person would choose the same life for twenty years. The ordinary autonomous tests separately establish the motivation mechanism. Nothing in normal simulation optimizes toward imprint preservation, genealogy discovery, high attributes or Iron.

The pre-existing continuity acceptance also passes with the new person model: eighteen years at its existing daily Epoch cadence, exact nine-year loaded continuation, a real later-born adult reading inherited instructions, then ordinary machine operation. Its favorable study setup explicitly supplies recent social contact as well as physiological reserves and literacy. The separate writing-only short fixture holds the author under observer control so direct teaching cannot preempt the record path. These are declared test conditions, not normal-world AI restrictions.

## Persistence and cost

Save schema **22** explicitly rejects schema 21; it does not silently reinterpret fractional attributes. Whole-person snapshots preserve all added canonical state. Live carrier, development milestone and ontology references participate in event pinning, so compaction preserves their provenance chains.

Development updates seven attributes for the acting person only. New inheritance work is O(7 attributes + at most 28 parental carriers); active carrier state is bounded and full historical ancestry is never rescanned. Genealogy inference uses the existing bounded knowledge store and at most 32 premise comparisons/two additions per invocation. Historical birth-name collision checks and estate settlement retain their pre-existing population scans; this milestone does not claim that the entire demographic subsystem is constant-cost.

## Acceptance evidence

- `individual-development.test.ts`: seven-attribute generation, unbiased integer inheritance, temporary-state independence, development beyond potential, inactivity, fractional progress, END/VIT separation, current-age expression, ceiling/readiness and sustained rare imprint creation.
- `individual-lineage.test.ts`: sibling divergence, dormant transmission, deduplication, distance cutoff, once-only inheritance, compaction provenance, physical family-record discovery, local testimony, uncertain surnames/rumors and exact save/load continuation.
- `individual-cognition.test.ts`: different observations/hypotheses through the existing architecture, actual failed-trial persistence, voluntary curiosity-dependent work and veteran-versus-gifted-novice manufacture.
- `individual-showcase.test.ts`: deterministic multi-generation pathway and explicit long-exposure limits.
- Existing physical, demographic, invention, capability-continuity and persistence tests provide regression coverage. Final command results are recorded in `.ai/STATE.md`.

Final verification against runtime checkpoint `21e53e4`: **754/754 normal tests across 72 files** passed in 645.99 seconds; **2/2 specialized continuity acceptance tests** passed in 53.37 seconds. TypeScript checking and the production build passed (Vite bundle: 1.47 seconds). The normal suite includes twenty new individual-development/lineage/cognition/showcase tests. No runtime changes followed these checks.

## Remaining assumptions and next frontier

This is abstract human development, not genetics. Founder distributions, work-equivalent batch doses, the development curve, imprint rarity/attenuation and healthy-maturation sampling are deliberately explicit initial calibrations. Sensory differences currently cover visible mechanical condition; reasoning covers known linear mechanisms. Broader research, complex teaching, travel/training development and richer biological/environmental adaptation can add meaningful activity hooks to this model. Actual supernatural breakthrough mechanics remain future work.

The next frontier is **Capability Evolution, Repair & Reverse Engineering**, using differing observation, inference, precision, proficiency and persistence to act on real worn or unfamiliar machinery and provenance-bearing evidence.
