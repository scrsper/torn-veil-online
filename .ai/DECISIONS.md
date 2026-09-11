# Durable design decisions

## Disposable local prediction and applied acknowledgment

- TypeScript remains sole authority. Native confirmed, predicted and rendered state are distinct.
  The shared movement specification and equivalent pure evaluators permit local actor movement;
  CharacterMovement stays disabled because its stock replication has no TypeScript adapter.
- Protocol 2 receipt is not application. Reconcile from explicit owning-controller local state
  and its resolved frontier, replaying only pure movement. Command epochs/IDs bound replay and
  duplicate effects; separate world combat ordering is never used as input acknowledgment.
- Canonical collision windows exclude decorative PCG. Unknown geometry blocks prediction;
  door opening happens through the existing authoritative mechanic before passage is confirmed.
- This supersedes blanket statements below that all local root movement must stay off.
  Choreography itself still must not move canonical/predicted roots. Live attack/contact migration
  remains pending; no renderer animation may determine injury or manufacture a hit.
- See `docs/REALTIME_INTERACTION_PREDICTION_V0_1.md` for the partial checkpoint and limits.

## Combat execution projection and choreography

- Combat semantics project immutable execution facts from existing causal attack events.
  The replay cache is disposable, bounded and observation-gated; body counters remain diagnostics.
  No occupation, private plan or trade skill is represented as combat mastery.
- One pure native planner and shared character component handle player and NPC bodies.
  Skeletal offsets, explicit animation time and foot IK remain presentation only; animation
  never drives the actor/capsule. Mesh deviation is capped at 22 cm; measured
  presentation-induced actor-root drift is zero.
- Persistent technique/lineage inputs are currently labeled fixtures only. Their stable
  signature anchors a primary gesture; event variation adjusts timing within that vocabulary.
  Real magic, martial progression and displacement operators require canonical mechanics first.
- Details and acceptance: `docs/EMERGENT_COMBAT_CHOREOGRAPHY_V0_1.md`.

## Humanoid presentation and bounded dwelling geometry

- Renderer-neutral per-body attackSeq/hitSeq count canonical accepted swings/applied hits.
  They persist with bodies; older v24 saves establish zero baselines. Timestamps retain
  recovery/recency semantics. Visual speed is actual velocity; sprint tuning is not sent.
- Unreal represents possessed and NPC bodies through the same ATVCharacter, keyed by
  bodyId. Animation queues are presentation history; local movement/combat authority stays off.
- Single-node combat playback uses owned full-pose clips. The additive vendor hit is baked
  onto idle; the short death lead-in gains a keyframed prone settle without local physics.
- The isolated 6 × 8 m dwelling permits at most 20 cm presentation excursion per side.
  Native PCG output is measured and hashed after regeneration/disk reload. It supplies
  no canonical collision, navigation, existence or settlement truth. See
  `docs/PLAYABLE_HUMANOID_PCG_DWELLING.md` for implementation and evidence.

## Individual potential, lineage and development

- Seven integer human foundations use an ordinary baseline of 8; `human.ts` centralizes old physical-unit adaptation. Current biological age affects expression, never a creation-age multiplier on newly developed adult ability. Normal 20 is a hard developed-attribute ceiling; all-seven-15 readiness is derived and does not change ontology.
- Potential is soft developmental resistance. Parental ordinary potential uses a symmetric discrete triangular law; explicit imprint expression is subtracted before blending to avoid double-counting the same origin. No ordinary mutation or automatic upward rounding.
- Completed activity and genuinely new complex evidence feed one diminishing-returns development model. Skills, dispositions, knowledge, temporary physiology and ontological stage remain separate. No occupation/idle-adult growth.
- Rare imprints require sustained exceptional exposure and one conservative lifetime assessment per attribute. Compact carriers deduplicate origins, attenuate over six generations and saturate at a two-point expressed contribution per attribute. All draws/outcomes and causal references persist.
- Canonical parentIds never initialize a newborn's mind. Testimony, physical records and bounded inference supply uncertain genealogy beliefs through existing knowledge/provenance mechanics. Inheritance can express unknown ancestry; later discovery changes only knowledge.
- Long exposure demonstrations are explicitly controlled model experiments, not detailed autonomous lifetime simulation. Formulae, acceptance evidence, costs and resolution limits: `docs/INDIVIDUAL_POTENTIAL_LINEAGE_DEVELOPMENT.md`.

## Civilizational capability continuity

- Practical records are ordinary physical items carrying snapshots of fallible knowledge, source provenance and notation. Read/write/copy use local access, intelligibility, labor and actual wood. Reading and teaching transfer information only. Item possession, title, condition and location determine access; dead minds and archived kernel plans are not learning sources.
- Workplace permission, machine ownership, method knowledge and physical ability are separate. Employee operations preserve the input owner's output title. Explicit personal haul buyers retain the goods they procure at shared workplaces. Estates transfer place title as well as physical equipment and records.
- Practice reservoirs are derived from existing workplace/home membership, living knowledge, records, working examples and canonical operations. They are observability, never a global technology registry or an extra institutional mind.
- Settlement wind is an explicit weather-driven open boundary with geographical exposure, imported/escaped energy and a bounded two-second parcel. This supersedes the finite seeded settlement wind parcel; finite reference sources remain supported. Known machines survive temporary lack of power/input but cannot work without energy or functioning parts.
- Teaching goals include the lesson key in their identity. Personal procurement inspects the work bin locally before ordering again. Instruction is preferred over untried arrangements when affordable, but may fail physically or be abandoned.
- Evidence and controlled conditions: `docs/CIVILIZATIONAL_CAPABILITY_CONTINUITY.md`. Eighteen-year acceptance uses existing daily Epoch cadence between fine-grained demonstrations, not a claim of fully resolved multigenerational provisioning.

## Living universe integration

- Procedural worlds install scoped primitive definitions, finite explicit environmental energy and local prior education, with zero finished components/assemblies/methods. Ordinary production pressure can motivate manufacture and experimentation through the existing mind and action systems.
- Manufacture reuses canonical raw stock, material hardness, skills, tools, ownership and physiological labor. Logs and planks can satisfy the same constraints. Their initial procedural timber stock is a mass-preserving partition of the existing endowment. The settlement grinding adapter uses canonical inventory masses; the reference workshop retains its own declared measures.
- Supplier locations are personal beliefs. Procurement performs a real visit, extraction if known, affordability/payment, carrying and delivery. Failed supply observations can be revised locally. Known equivalent physical properties allow avoiding a repeated ineffective power arrangement; there is no certified winning recipe.
- Connected components inherit as one physical asset. Assembly creator identity separates construction intent from title: inheritance transfers hardware, not knowledge. Methods spread by existing communication and do not grant skill or parts.
- Component reuse, freight and downstream transforms carry recorded material ancestry. Kernel references participate in event compaction.
- Simulation save checkpoints retain scheduler phase/caches, stimuli, plans, intent, physical paths/poses and queued speech rather than restarting neighboring agents. The attached scheduler is the single live owner; a read-only snapshot callback and one-time restore handoff avoid duplicate ticking state.
- Details, scoped evidence and remaining assumptions: `docs/LIVING_UNIVERSE_INTEGRATION.md`. No reserve rebalance, global innovation controller, guaranteed recovery or survival target was introduced.

## Local production pressure and historical alternatives

- Production requests and on-site stock observations supply a reason to consider familiar work or compositional experiments through the existing goal/motivation loop. Successful invention is not an objective of a separate controller. Capacity, knowledge, curiosity, cost and competing needs can leave work undone.
- Voluntary method teaching reads the speaker's relationships and shared work/home context, never the recipient's private cognition. Physical success is still canonical evidence; a communicated method can be wrong. Death does not globally publish a holder's knowledge.
- New voluntary work pays its first batch time; its paid progress and partial request quantities survive save/load. Empty canonical fields, resources and projects must remain empty after load rather than restoring generated defaults.
- A trade action names its actual work post and consumes operator/public stock there. This closes a first-nearby-place dispatch defect without replacing legacy process definitions.
- No fixed outcome, guaranteed retry/recovery, reserve rebalance or automatic knowledge unlock. Bounded evidence, limitations and verification: `docs/CAUSAL_PRODUCTION_PRESSURE.md`.

## Generative Universe Kernel v0.1

- Each canonical `World` owns its material/component/process definitions under a scoped ruleset id. There is no global invention registry or new finished-device ItemType. This is an extension boundary for differing future rulesets, not a multiple-universe implementation.
- Mechanical power, work and labor rates use physical seconds, J, W, kg and metres. Calendar event timestamps retain world seconds. Existing grain/flour measures are mapped to explicit mass units at the legacy stock adapter.
- v0.1 connects typed ports in bounded linear acyclic graphs. General branching, fluid dynamics and energy regeneration are deferred. Finite environmental input and explicit losses prevent feedback energy creation.
- Component capabilities, actual instances and inhabitants' knowledge remain separate. Invention uses ordinary goal utility, planning/actions, knowledge/memory and conversation; a successful recipe is observed instance-independent topology, not an authored device lookup. Receiving instructions neither creates objects nor grants skill.
- Relevant constitutional authority consulted: sections 5–6 (epistemics), 10 (motivation), 33 (universe architecture), 47 (clocks), 61 (discovery), and 65 (composition). Evidence and limitations: `docs/GENERATIVE_UNIVERSE_KERNEL.md`.

## Autonomous agency, epistemic identity and mechanical evolution

- Controller origin belongs to engine metadata, never a Person field or observer claim. External intention bypasses autonomous selection but uses ordinary canonical action handlers. Save envelopes preserve routing independently of the Person snapshot.
- Canonical identity, latent traits, attributes, skills and private intentions are not observer knowledge. Names require evidence; qualitative social beliefs remain local, biased, uncertain and revisable. Public gameplay projections are allowlists, with explicit separate developer truth.
- Familiar schedules supply personal expectations, weighted alongside needs and concerns. Field opportunities require local observations. Existing selection paths outside this bounded conversion remain documented, not treated as architectural authority.
- Mechanical reasoning consumes a lossy observation, not a canonical method graph. Paid fitting changes actual components/connections; the shared kernel adjudicates behavior. Method and assembly ancestry follows causal events rather than a global technology version.
- Future ranks are ordered extension names only; Normal ceiling 20 and all-seven-15 Iron readiness remain unchanged. No post-Iron mechanics are implied.

## Playable seeded world

- A versioned world geography composes with existing settlement-local seeds. All settlements inhabit one registry, clock and physical coordinate space; the billion-metre locality reference is retained separately.
- Regional presentation residency never owns canonical lifetime. Wilderness indexing follows every active body, not Unreal requests. No distant NPC LOD or coarse stepping is introduced.
- Baseline terrain/resources are pure local-seed queries; meaningful physical edits and indexed lifecycles persist. Canonical positions never rebase; only client-relative transforms do.
- Runtime geometry is an allowlist distinct from avatar knowledge and explicit developer truth. Visibility is body-specific, not inferred for all bodies from seeing their owner once.
- Quaternius/Poly Haven are replaceable prototype presentation assets. PCG grass/bush output is collision-free decoration and cannot create resources, stock, ownership or routes.
- Playable clock rate is explicitly 6×. Save schema 24 rejects older baselines rather than silently reinterpreting them. No offline elapsed-time simulation is claimed.
- Regional generation retains the existing primitive-education model. It does not seed a guaranteed successful mechanism merely to make a showcase pass; this remains an explicit acceptance gap.

## Native startup and regional transport

- Canonical liveness cannot depend on completing presentation. Hello/metadata/snapshot precede progressive center-first geometry. Regional protocol 2 bounds wire messages and assembly separately, with one acknowledged presentation chunk in flight per connection.
- Presentation application and transport/snapshot health are distinct. Canonical motion remains in TypeScript; Unreal input expires/pauses on stale canonical state, never falls back to local physics.
- Launch performs an incremental native build. Current source in a checkout does not prove its untracked DLL is current. A stale executable or incompatible bridge must fail visibly rather than silently entering an empty world.
