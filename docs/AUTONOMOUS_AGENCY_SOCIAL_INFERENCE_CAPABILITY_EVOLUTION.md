# Autonomous Agency, Social Inference & Capability Evolution v0.1

This slice extends the already merged agency frontier. It does not replace KMSI, the utility planner, physiology, martial learning, or the Character Foundry. Constitutional authority consulted: sections 5–7 (evidence and memory), 9–10 (player equality and motivation), 12–15 (capability and tiers), 21–24 (cognitive LOD), and 44 (LLM boundary).

## Repository and stacked dependency

The branch is `codex/autonomous-agency-social-inference-v0-1`, temporarily stacked on PR #48, `codex/character-foundry-real-assets-v0-1`. It was created from remote HEAD `7eb6b6666459c4d92ecb16b23be3fca57a18469c`. A final fetch found its documentation-only update `709e6b5dd8698bc097f8e1dae67349a4cec4751a`; that updated base was integrated into the feature branch without rewriting published history. Remote main remained `fba11534c3c6cd7e6eec300df2b726a2ff2f916d`.

PR #47's two commits, `29dd44b` and `d72913c`, are patch-equivalent to commits already in #48 (`ecd2ec9` and `cda5d61`). `git cherry` marked both `-`; nothing from #47 was independently merged or cherry-picked. The remote branch inventory and open PR list contained no newer relevant foundation than #48. Other older integration/WIP branches were not combined speculatively.

Implementation uses the separate `TornVeilOnline-agency` worktree. The original checkout's edits to `src/bridge/regions.ts` and `tests/playable-world.test.ts`, its licensed Fab content, ignored Unreal assets, and the existing Foundry worktree remain untouched. This branch changes no Unreal assets. Both pull requests remain unmerged. Rebase this branch onto the resulting main when #48 merges; no force push is authorized.

## Existing systems extended

* `mind/knowledge.ts`: structured claims, source, confidence, event time, acquisition time, hop count, corrections, and bounded retention.
* `mind/memory.ts`: significance, valence, entity/source references, and 60-memory retention.
* `mind/people.ts`: introductions, fallible identities and evidence-backed social interpretation.
* `mind/conversation.ts`, `agent.ts`: situated topic selection, local telling, appraisals, concerns, relationship consequences, ordinary goals/actions.
* `mind/pursuit.ts`: one capped motivation path for concerns, obligations, purposes and cooperation evidence.
* `core/skills.ts`, `development.ts`, `kernel/evolution.ts`: proficiency and attribute development from actual paid fitting work, including reduced feedback after a damaging attempt.
* `runtime/controllers.ts`, `GameSim`: external control authority, multiple independent connections, shared actions.
* `persist/save.ts`, `World.compactEvents`, existing WorldLab and Chronicle: continuation, bounded provenance retention, headless evidence and meaningful historical events.

## Perception and recognition

Existing spatial body queries, facing, distance, voxel line of sight, fog, day/night visibility and sound determine percepts. Sensing now visits each present living body of a person; a sleeping primary body does not hide an awake second manifestation. Sleeping/downed observers cannot see. Hearing does not identify an attacker. Visibility does not automatically disclose an inaudible introduction.

`mind/encounter.ts` retains allowlisted appearance cues, body shape, visible activity, approximate age band, position, place and observation time. It excludes canonical name, occupation, wealth, private inventory, exact attributes, skills, plans, control metadata and Foundry asset/archetype information. Clothing is visible appearance. There is no independent equipped-versus-concealed inventory model here, so carrying an inventory item is not treated as proof that it is visible.

Stable entity/body IDs remain internal physical handles. They do not supply a social name or sufficient recognition evidence. Coarse appearance signatures use physical appearance cues, not IDs, locations or activities. First sight is **unknown**; separated retained observations make someone **familiar**, then **recognized**. A claimed name anchored to observed appearance permits **identified**. A changed signature can invalidate the current visual match while the old identity belief remains remembered. Name/description testimony can relay that appearance anchor without looking up the subject's current canonical appearance.

Encounter records keep at most eight observations. Repeated calls in one tick cannot build familiarity. Initial familiarity samples are separated by at least 60 world seconds (300 for lightweight minds). After three samples, unchanged re-encounters create at most one retained episode per world hour and require an absence; changed appearance remains salient immediately. The latest seen location/activity can update without another historical event. Each retained encounter uses an actual `perceived` event and an ordinary KMSI memory. Encounter evidence about established relationships receives the existing reusable-identity retention priority, preventing a flood of routine episodes from erasing a familiar face.

Limits: appearance matching is conservative and coarse, not facial recognition. Physical subject tracking still uses the existing body's handle. False reassociation between different people, disguise expertise, voice recognition, face injury modelling and sensory-organ capabilities are not implemented. Clothing changes alone do not erase face/body familiarity. Existing perception supplies environmental/facing constraints; this slice does not add a second attention or sensory simulation.

## Beliefs, memory and inference

Knowledge remains `KnowledgeItem`: structured `claim`, `confidence`, `source { type, from, viaEvent }`, `learnedAt`, `hops`, `sharedWith`, and optional reconfirmation. Event claims retain occurrence time separately. Sources distinguish observation, hearing, telling, reading, inference, prior knowledge and self experience. False names and uncertain accusations can be held without changing the named person's canonical identity or creating the alleged event.

Social impressions retain at most twelve weighted premise references. Existing generosity, honesty, reliability, restraint, observed intent and qualitative capability impressions remain fallible. Paid mechanism work additionally supports a weak **possible craftsperson** interpretation; it does not expose the worker's canonical occupation. A missed strike can support caution without fabricating a successful hit. Inference uses held observations, not hidden target skills or motives.

Memory retention stays at 60 entries, scored by significance, age and recall. Knowledge uses the existing 400-entry pruning target plus its batching margin. Evidence referenced by the existing eight-entry obligation ledger receives reusable-evidence priority while that reference survives, including recent resolutions. Once the obligation leaves the ledger, its episode competes under ordinary retention again. This changes eviction priority, not the finite budget. There is no new full-world fact copy or independent memory store.

## Communication and relationships

`Simulation.tell` now requires a belief actually held by the speaker and an awake, present listener within four metres with a clear local communication path. It cannot accept a fabricated copied claim as the speaker's knowledge. Multiple bodies may provide the physical path. Eight transmission hops is the v0.1 propagation horizon; it bounds relay chains without broadcasting to the population.

The `told` event links both the speaker's acquisition event and the retained underlying occurrence when available. It records source, confidence, acquisition time, original occurrence time and hop count. The listener gets `source.type = told`, the immediate speaker, a new acquisition event and attenuated confidence. Hearing an unidentified sound can later be refined by a witness's testimony; the attribution remains hearsay. Relayed introductions retain claimed names and appearance evidence. Multi-body conversations record the actual reachable speaker/listener pair.

Topic selection uses the speaker's own record of previous transmissions instead of inspecting the listener's private knowledge map. Known requests drive item-location replies. Existing appraisal, concerns, social context and personality still decide whether to speak. Evidence suggesting danger can make a warning worth raising. Silence remains possible. Dialogue variation uses a person/time/salt keyed sample and does not draw from world/combat/weather RNG.

Relationships reuse familiarity, trust, affection, respect, fear, grudge and grievance. Actual observations and communicated experiences feed the existing appraisal and relationship path; their causes remain inspectable. Externally controlled people now receive those same cognitive/relationship consequences. Only autonomous speech/response dispatch is skipped for external controllers.

Limits: legacy public-role, household and trade heuristics in conversation/planning still consult canonical metadata, as documented in the preceding agency milestone. This slice removes recipient mind inspection on the changed gossip path; it does not claim every legacy economic, legal or combat selector has been converted to belief-only queries.

## Agency and player equality

`socialEvidence` derives caution, cooperation and esteem from a mind's own impressions with recency/confidence weighting. It uses maxima for overlapping caution signals rather than stacking multiple interpretations of one action into certainty. Caution can propose an ordinary `flee` goal even in the absence of a current attack or pre-existing fear flag. It competes with needs, work and other commitments. Cooperation enters the existing shared motivation cap; social impressions also influence conversational partner selection. Goal records retain major belief keys and actual causal parents.

Canonical execution still decides what happens. A false accusation can cause avoidance without an attack existing in world history. A believed opportunity can fail when attempted.

Controller identity stays in engine metadata, never on Person or in an observation/social claim. Two GameSim connections can independently control ordinary people. Perception, identity, memory, relationships, work and progression have the same rules. Headless controlled `goto` intentions now receive the same physical movement integration as NPC movement; direct controller leases retain their existing movement path. The legacy single `World.playerId` remains an engine/view focus, not social knowledge or a constraint on GameSim's connection map.

## Capability experience and advancement

`core/capability.ts` adds a bounded evidence ledger, not a replacement skill score. The reference adapter accepts only a real paid `mechanism_worked` event belonging to the actor. The event supplies duration, operation and success/damage; caller-supplied award hints cannot grant arbitrary progress. Zero work, empty dismantling, failed graph operations that change nothing, and unrelated event/skill pairs earn no credit. Completed fitting consumes its action progress, so retries pay fresh labor. Damaging fitting attempts provide 35% feedback. Existing skill and instruction curves determine the actual proficiency/attribute change.

Repeated operation contexts diminish by `max(0.2, 1 / sqrt(1 + repeats * 0.1))`; proficiency's existing diminishing curve also applies. Raw paid exposure is capped at eight hours per world day, each action at one credited hour. The four fitting operation contexts are bounded, alongside 96 recent entries, 256 recent consumed IDs and sixteen causal samples per skill. The source event's consumed marker prevents duplicate awards after recent-ledger eviction. Three cross-day evidence samples survive alongside recency. Event compaction pins only these bounded samples. Existing trade and martial practice remains authoritative and is not double credited; adapters for those systems' richer experience ledgers are deferred.

The sequential ontology remains Normal → Iron → Bronze → Silver → Gold, with the later existing names unchanged. Only **Normal → Iron** has an enabled path. Its v0.1 embodied adaptation requires:

* all seven existing developed foundations at least 15;
* relevant proficiency at least 0.55 and eight hours of effective recorded fitting practice;
* retained canonical evidence spanning at least three days;
* relevant, provenance-bearing technique knowledge with confidence at least 0.4;
* an awake, present, sufficiently healthy body, no serious localized wound, and recovered energy/hydration/fatigue/sleep state.

An ordinary `advance` goal or human intention runs the same sixty-world-second `attempt_breakthrough` action. Completion rechecks readiness. It consumes 0.2 energy and hydration, adds 0.35 fatigue, and improves the existing physiological conditioning factor by up to 0.05, capped at 1.25 without reducing better existing conditioning. The rank itself supplies no combat multiplier. Developed attributes may continue toward the unchanged ceiling of 20 after Iron; no post-Normal attribute scale is invented. The resulting causal history event is Chronicle-eligible.

Bronze, Silver and Gold paths remain blocked pending concrete resources, techniques and metaphysical mechanics. They cannot be reached by XP totals or enum order. Diamond and beyond receive no content. The readiness evaluator is deliberately a single reference path with an extension boundary, not a complete advancement doctrine.

## Diagnostics and projection

`runtime/agencyInspection.ts` produces detached developer data: canonical identity, the observer's understood identity, significant memories, knowledge/confidence/provenance, relationships and supporting experiences, considered/selected goals, experience and advancement blockers. It is also available in each body of `BridgeSession.developerSnapshot().debug.agency` for future Unreal inspection. It is never fed back into cognition.

Normal `knowledgeView` uses a detached appearance allowlist and recognition-dependent labels. Unknown visual matches do not expose a previously learned name merely through the canonical handle. Speech is shown only within the local speaking range. Character Foundry remains presentation-only; no native UI or asset changes are required by this slice.

## Persistence and migration

Save schema remains **24**. New data is additive: optional `Person.capability`, encounter/identity evidence inside existing knowledge claims, event credit/source metadata, and the new goal/action types inside the existing scheduler snapshot. Old schema-24 people start with no new experience ledger or encounter history. Existing skills, memories and ontological stage are preserved; past practice is not invented from a skill number. Older schema versions retain the existing explicit rejection policy. A legacy name belief without an observed appearance anchor is retained as testimony but does not manufacture visual identification.

No new global RNG state is needed. New recognition, social interpretation and adaptation are deterministic. Speech choices use stateless scoped sampling. Existing action execution can still consume its established RNG; an extra repair legitimately affects that repair stream. Tests separately establish that recording cognition/adaptation and reading projections do not consume unrelated RNG.

## WorldLab evidence

Reproduce with `npm run agency:worldlab -- 741`. Generated detailed reports are `.debug/worldlab/agency.json` and `.debug/worldlab/capability.json`; checked-in evidence lives under `docs/evidence/autonomous-agency/`.

The scenario discloses a supplied damaged workshop, tools/spares, prior primitive education, quiet immediate needs, a sociable courageous witness, a quieter resident, and a stone partition with an open route around it. Existing village people are offstage using the established lab harness. Human inputs are introduction, one shared canonical combat request, and departure/return movement. No NPC goal, testimony or final outcome is injected after setup.

Seed 741: the stranger was initially unnamed. A direct introduction established a claimed identity. A canonical attack occurred; A and C saw it, while B only heard it behind the partition. A subsequently chose to tell B about it. B's attribution was `told`, one hop, confidence **0.61625**, with the original occurrence time preserved. B also received the introduction indirectly. A resident selected flight through the ordinary planner. The stranger moved behind the partition, was absent from A's visible percepts, then returned and was identified. Exact same-seed digest and a three-second save/reload continuation matched.

The separate seed-912 capability probe performed four paid fitting attempts. Crafting changed from **0.95 to 0.9501816918735619**; unrelated skills were unchanged and the natural actor remained Normal. The ledger and skills survived reload. A separate explicitly synthetic near-Iron history demonstrated readiness crossing after another actual paid attempt and the physiological transition costs. It is a threshold fixture, not a claim that four repairs produce Iron or that three days of life were fully simulated.

## Scaling and remaining gaps

Spatial neighborhoods are reused; no global rumor broadcast or all-pairs social census is introduced. Additional cognition is bounded by a person's existing knowledge budget and local percept count. Social decision inputs use direct lookup of eight relevant belief keys. New inference runs on acquired evidence; continuous observation stops allocating encounter memories once sufficient familiarity exists. Appearance attention samples occur at most once per physical second (three for lightweight minds), matching the existing physical perception cadence; physical visibility checks still run normally. Evidence timestamps and retained familiarity use world time: initial samples are at least sixty/three hundred seconds apart, established unchanged re-encounters at most hourly. Both clocks persist, so the gate survives reload and works under calendar acceleration. Developer inspection intentionally scans historical events and is not a per-tick gameplay path.

The finite ledger/knowledge bounds are established in code; this slice makes no thousand-person or century-scale performance claim. Existing event causal ancestry can retain older history; pinning sixteen practice samples per skill limits the new direct roots, not necessarily the ancestry size of a complex machine's history.

Remaining cognition work: sensory acuity/attention modelling, cross-person mistaken recognition, retention of competing identity hypotheses, and remaining legacy canonical lookups. Social work: explicit occupation/household disclosures and replacing those legacy role heuristics. Progression work: additional real-action adapters, mentorship/conditioning paths and concrete post-Iron mechanics. Player control: connection/account authority and ownership across multiple GameSim facades remain separate future work. Presentation: the detached debug contract exists; no native inspector panel or visual acceptance is claimed.

The smallest next slice is a focused profile of the existing deterministic food-abundance/scarcity workload. Those two final checks exceeded their unchanged runtime budgets despite reporting no assertion failures. Remove the measured bottleneck while preserving simulation duration, assertions, cognition and replay semantics before adding further features.

## Verification

The final verification record and independent review findings are recorded in `docs/evidence/autonomous-agency/VERIFICATION.md`. Successful tests remain valid across documentation changes, commits and pushes. No merge is part of this delivery.
