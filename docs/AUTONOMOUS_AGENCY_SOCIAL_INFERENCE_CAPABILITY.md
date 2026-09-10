# Autonomous Agency, Social Inference & Capability Evolution

The world supplies physical conditions. A person's local evidence and priorities supply an intention. Shared canonical handlers attempt it. Observers interpret the visible consequences. Relevant constitutional authority: sections 5–6 (epistemics/provenance), 9–10 (player parity and personal motivation), and 13–15 (ordered stage metadata).

## Boundaries

- `Person.controlled` is removed. `runtime/controllers.ts` holds weak scheduler metadata. Canonical people, their serialized person records, perception and social claims carry no controller field. Connection routing lives in `runtime/gameSim.ts`; a facade supports multiple independently controlled people. Scheduler and response dispatch suppress autonomous action selection for external controllers. Observations, testimony, physical costs and consequences remain shared. Reattaching a saved controller preserves an already submitted action.
- `World.playerId` remains the legacy **engine/view selection** for the single-client adapter and cognitive LOD scheduling. It is not a person property, a belief, or an input to social reasoning. The save envelope separately retains controller dispatch state. Connections/accounts/network authority are outside this milestone.
- Latent NPC traits remain private canonical substrate. Social interpretation never reads the subject's traits, skills, attributes or goals. Low-level personal evaluation can use the evaluator's dispositions. Human input replaces that evaluator's action selection while attached; no test of the human's personality or intellect exists.
- Event knowledge no longer copies combat intent. Threat assessment and construction occupancy no longer read other people's goal/plan state. Visible movement, work and attacks provide weaker evidence.

## Identity and social interpretation

`mind/people.ts` stores identity claims in ordinary personal knowledge. An entity reference permits following the same perceived individual; it does not supply their canonical name. Introductions carry a spoken name, local audience, event provenance and confidence. Testimony and records can relay that claim. False names can be accepted and corrected; earlier evidence remains. Ordinary conversation consults the speaker’s own memory of introducing themself, allowing reciprocal introductions without repeated self-announcement. Shared surnames only support kinship inference after the surname was actually learned.

Social interpretations are local knowledge items with a family, qualitative characteristic, signed evidential support, confidence, recency, and bounded supporting observations. Support is recomputed from up to twelve remembered premises; causal parents are those observations, not an infinite chain of prior belief revisions. These support values are **belief strength**, not copied canonical personality/attribute/skill values. Repeated evidence accumulates; contradictory behavior can reverse a conclusion. Current intent support decays faster than durable impressions when revised. Readers retain timestamps so stale inferences remain distinguishable.

Implemented observation families include disposition (curiosity, restraint, honesty, generosity, reliability, courage), capability (craftsmanship, dexterity, fighting), standing (being valued), and apparent intent (examining, repairing, altering, attacking). Failed experiments can suggest curiosity to a sympathetic curious observer and poor restraint to a wary observer. Neither interpretation is certified by truth. Testimony is weighted by the listener's relationship and inferred honesty, never the speaker's latent honesty. Missing attribution cannot establish an actor-specific social belief.

## Personal work

The previous farmer branch directly queried canonical ripeness from a scheduled field. It now requires local visible field evidence. That evidence makes harvesting or sowing conceivable; a habitual shift supplies an expectation, not knowledge of distant crops. Work utility also yields to personally known welfare concerns, attachment, fatigue and stress. Existing obligations still enter through the shared motivation bridge rather than another additive bonus. The existing field, production and inventory handlers determine the actual outcome, including stale evidence and missing seeds.

Mechanical maintenance is an ordinary `maintain_mechanism` goal. Nearby damage does not assign anyone a repair. Curiosity, practical stake, relationships, fatigue and remembered failures affect whether it beats other activities. Goal adoption records an intention event; the attempted physical action references that event. No identity/seed case selects a particular person's response.

## Physical capability evolution

- `kernel/evolution.ts` samples accessible physical surfaces into lossy evidence: recognizable parts, conspicuous wear/cracks, discernible joints, loose ends and nearby motion/energy cues. Perception changes discriminable evidence. Unknown component concepts remain unknown. The observation does not return the intended method, exact condition, efficiency or a certified graph.
- `mind/mechanicalReasoning.ts` forms competing hypotheses from that evidence and acquired component concepts. Intellect changes examination time, hypothesis coverage/order and comparison of port roles. Practical skill strongly affects diagnosis and dominates fitting precision. Neither high intellect nor high skill guarantees success.
- Reverse engineering creates a partial or conjectured method. Unseen links may be guessed incorrectly. Complete conjectures may be copied through the existing construction path; incomplete models cannot conjure missing component definitions. The same port, graph, ownership, energy and process kernel validates the result.
- Replacement consumes real labor and tool wear, installs an actual available component, and leaves the removed component as physical property. It does not reset condition. Failed fitting can damage both the original and spare. Incompatible couplings cease to connect; a physically fitted substitute need not function. Test runs consume actual available input and energy.
- Dexterity affects fine fitting; strength affects handling time; current exertion/endurance affect sustained labor. Will bounds persistence after setbacks and never overrides competing needs. A lower-INT veteran can materially outperform a brilliant unskilled novice.
- Existing manufacture is exposed through the same action surface, using known component shapes and actual material stock. Connection/disconnection, dismantling, construction, testing, teaching and record reading reuse canonical handlers. The manufacture handler can also shape a spare for an already completed assembly, retaining per-person, per-definition paid progress. No finished-machine repair recipe or rescue/retry director was added.
- Assemblies retain historical revisions and parent-event provenance. Learned/conjectured methods carry provenance through ordinary knowledge and physical records. Substitution is evaluated by measured output and energy, not by topology novelty. There is no global technology version or shared reputation table.

## Player test surface

`new GameSim(simulation)` supports `attach`, `detach`, `spawn`, `intend`, `perceive` and `beliefs`. A controlled avatar is created by the normal person/body factories with ordinary attributes, potential, physiology, development, lineage, skills, knowledge, inventory and property state. The old browser Traveler's special base speed/health are removed.

Intent kinds: ask, introduce, yield, inspect, diagnose, reverse_engineer, replace, connect, disconnect, dismantle, test, manufacture, reconstruct, teach, read and abandon. Invalid fields cannot inject progress, labor, outcomes or private knowledge into actions. Reach, permission and actual resources are checked during execution. The client supplies no successful repair result.

Normal knowledge views use explicit allowlists and detached copies. They expose visible mechanism/component handles, learned identity, observed acts and uncertain social/mechanical beliefs, including sources. Exact NPC traits, skills, attributes, ancestry, goals and private knowledge are absent. `debugTruth` and `BridgeSession.developerSnapshot()` expose canonical comparison separately. `/snapshot` is epistemic; `/debug/snapshot` is the explicit developer projection. The loopback bridge accepts `person_action` intents. There is no networking/authentication expansion.

In the browser, `window.game.playerSession` exposes the facade. Ordinary **F** inspection opens an avatar-belief panel; **F3** remains the developer inspector. HUD labels and dialogue headers use learned names; normal labels no longer display NPC goals. No Unreal visual overhaul or mechanical mesh authoring was performed.

## Evidence and limits

`npm run agency:demo -- 741` writes `.debug/agency/showcase.json`. It discloses favorable workshop stock, primitive education, prior hardware, permissions and quiet immediate needs. Other village residents are held offstage with absent bodies by the existing laboratory harness; the three workshop NPCs use ordinary autonomy. No repair intention is planted in them.

Orla notices the broken transmission, forms hypotheses, fits a replacement and tests it. Bren and Cora choose social activity. The avatar enters unknown, introduces themself, learns Orla's identity through the existing dialogue action, then inspects and tests the same assembly. NPC observations create impressions of the avatar. The report separates world truth, each observer's knowledge and the player view, and includes recorded causal links.

Focused tests cover opposing interpretations, contradiction, anonymous evidence, false identity, human control, real costs, successful and failed fitting, skill/attribute effects, incomplete and wrong reconstructed graphs, a lower-output substitute, multiconnection routing, partial-action persistence, and exact same-seed/save-load continuation. Save schema **23** rejects schema 22 explicitly. A pre-existing missing creature-state overlay was repaired after whole-world replay exposed reset wandering timers.

This is a bounded mechanical/social frontier, not a complete psychology or engineering simulation. Material failure is still component condition and coupling state; there is no spatial crack propagation, hidden enclosure geometry, complete physics of tolerances, fluid-network solver or unrestricted mechanism graph. Social inference is deterministic and rule-based; it has no full dialogue/deception model or universal catalog of personality traits. Kinship can remain uncertain. Concealed actors and false testimony can produce errors; identification across disguise/body changes is a future extension.

Remaining artificial selection paths include canonical occupation/hostility shortcuts in legacy combat and supplier/labor candidate selection, batch-triggered apprenticeship, crisis logistics, and some historical initialization facts. Construction material discovery still inspects more canonical regional supply than an ideal local mind would know. These are not declared converted by this milestone. Existing long-run economy/adaptive limitations remain as recorded in earlier milestone reports.

The next visual-testbed step is to expose the current mechanism evidence and action handles as a small selection panel alongside the avatar-belief panel, then render actual components/connections and the observable work poses. Keep developer graph/trait inspection behind its explicit mode.

## Verification record

- Initial kernel/knowledge/bridge/new frontier integration: 54/54 passed.
- Foundation checkpoint: 43/43 passed across new frontier, all four individual milestone test files, and persistence.
- Final frontier: 22/22 passed. Kernel/pressure/cognition integration: 51/51 passed. Interaction identity projection: 31/31 passed. Browser avatar-knowledge inspection: 1/1 passed. Typecheck and production build passed.
- Generational capability continuity: 2/2 passed in 48.39 seconds.
- The first full checkpoint found five timeout failures plus changed-contract fixtures and real control-dispatch errors. Explicit names in fixtures now require introductions; haul eligibility is physical; unfamiliar operation is possible. Unspecified attacks remain nonlethal for all controller origins. Human-controlled people may inspect livelihood prospects but are not assigned a trade.
- The isolated workshop now holds background bodies offstage; this replaces the old assumption that externally controlled people do not perceive. Production comparisons declare steady wind and veteran manual skill. All behavioral assertions remain intact. The eight-day test has a 600-second wall-clock budget following a measured 575-second checkpoint; other timeouts are unchanged. The normal suite uses one worker.
- Broader regression results are recorded in `.ai/STATE.md` once complete.
