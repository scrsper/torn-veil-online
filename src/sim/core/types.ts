/**
 * The ontology of Torn Veil Online.
 *
 * Everything meaningful is an Entity with identity and history. Persons, items, places,
 * factions and events are all entities. A Body is the physical manifestation of an entity
 * in the voxel world; an entity may have zero, one, or many bodies. Nothing in this file
 * knows about rendering.
 */
export type EntityId = string;
export type EventId = string;
export type Tick = number; // world seconds

export interface Vec3 { x: number; y: number; z: number; }

// ---------------------------------------------------------------- Entities
export type EntityKind = 'person' | 'item' | 'place' | 'faction' | 'body' | 'creature';

export interface Entity {
  id: EntityId;
  kind: EntityKind;
  name: string;
  createdAt: Tick;
  tags: string[];
  /**
   * Stable, human-authored identity for entities that matter across regenerations, code
   * changes, and future world/universe namespacing (Constitution §50 "Stable Identity").
   * `id` is a generation-order counter (`p_7`, `pl_12`, ...) and is NOT safe to hardcode
   * elsewhere, because inserting a new entity earlier in world generation shifts every
   * later counter. `slug` is assigned once, by hand, at authoring time (e.g. cast.ts's
   * `key`, a place's key in village.ts, a faction's short name) and never changes as
   * generation order changes. Use `world.getBySlug('rowan')` instead of remembering an id.
   * Procedurally generated entities (bodies, dropped items, future population-scale NPCs)
   * have no slug; they still get durable persistent `id`s, just not a hand-authored name.
   */
  slug?: string;
}

// ---------------------------------------------------------------- Bodies
// v0.8 "The Legible World" §B: `eat`/`drink`/`haul` are real, distinct canonical actions
// (`ActionType` below) that previously all rendered as an indistinguishable `sit`/`stand`/`work`
// — the player could never tell an eating villager from one merely sitting, or a hauler from an
// idle worker. Each gets its own pose so `game/actors/actors.ts`'s renderer can give it a
// distinct animation.
export type Pose = 'stand' | 'walk' | 'run' | 'sit' | 'sleep' | 'work' | 'attack' | 'hit' | 'dead' | 'talk' | 'pray' | 'downed' | 'eat' | 'drink' | 'haul'
  // v0.8 §16 "visible causality": resource extraction (felling a tree, quarrying stone) gets its
  // own overhead-swing silhouette instead of reusing the generic side-to-side `work` pose, so
  // "someone is chopping/quarrying" is readable at a glance — the same rationale that already
  // gave `eat`/`drink`/`haul` their own poses.
  | 'chop';

export type BodyRegion = 'head' | 'torso' | 'arm' | 'leg';
export interface LocalizedInjury { region: BodyRegion; severity: number; }

export interface Body extends Entity {
  kind: 'body';
  /** Peak functional injury severity per region, 0..1. No treatment model yet. */
  injuries?: Partial<Record<BodyRegion, number>>;
  ownerId: EntityId;            // the entity this body manifests
  shape: 'humanoid' | 'chicken' | 'wisp';
  pos: Vec3;
  vel: Vec3;
  yaw: number;                  // radians, facing
  pose: Pose;
  poseUntil: Tick;              // pose lock (physical seconds timestamp)
  onGround: boolean;
  path: Vec3[] | null;
  pathIndex: number;
  pathGoal: Vec3 | null;
  speed: number;
  health: number;
  maxHealth: number;
  dead: boolean;
  lastHitAt: number;            // physical time
  lastAttackAt: number;
  /** Who this body's current 'attack' pose is actually directed at, or null when not attacking.
   * v0.2.1 Priority 7 fix: nearby bystanders used to read ANY body in 'attack' pose within 3
   * units as "attacking me" (see mind/agent.ts's threat assessment), so an ally fighting a
   * third party in a crowded space (e.g. two bandits sharing a camp, one fighting a guard)
   * could be misread by the other as a personal attack, triggering a real mutual fight between
   * allies that then perpetuated itself indefinitely (each down-and-recover cycle re-entered
   * attack range and re-triggered the same misread). Transient combat state — reset alongside
   * `pose`, never persisted (see persist/save.ts, which already only persists 'dead' vs 'stand'
   * for pose and rebuilds everything else on load). */
  attackTarget: EntityId | null;
  sitAnchor: Vec3 | null;
  present: boolean;             // false when the body is withdrawn from the physical world
  /** v0.2.3: physical-time timestamp until which this body is held incapacitated by a
   * deliberate subdual (Constitution §11 'subdue'/'arrest'), distinct from the brief ~45s
   * knock-down `poseUntil` recovery. While `subduedUntil > physicalTime` the body stays
   * 'downed', does not recover health, and its owner runs no autonomous combat/movement — so a
   * subdued target cannot spring back up and rejoin the fight a few seconds later. Persisted
   * (unlike `attackTarget`) because a subdual that outlasts a save/reload must survive it. 0
   * when not subdued. */
  subduedUntil: number;
}

// ---------------------------------------------------------------- Persons / Minds
export type Occupation =
  | 'smith' | 'apprentice' | 'baker' | 'innkeeper' | 'cook' | 'server' | 'merchant' | 'priest' | 'acolyte'
  | 'guard' | 'captain' | 'farmer' | 'miller' | 'hunter' | 'herbalist' | 'woodcutter' | 'elder' | 'vagrant'
  | 'child' | 'bandit' | 'traveler';

export interface Traits {
  courage: number; sociability: number; honesty: number; aggression: number;
  greed: number; piety: number; curiosity: number; loyalty: number;
}
// 0 = satisfied, 1 = desperate. `thirst` (v0.2.4) rises faster than hunger and is satisfied
// only by drinking at a canonical water source. Both drive utility/goal selection; neither is
// instantly lethal — the point is behavioural pressure, not a survival death-spiral.
// v0.4: `hunger`/`thirst`/`energy` are now DERIVED, user-facing expressions of the underlying
// `Physiology` reserves below (hunger = 1 - physiology.energy, thirst = 1 - hydration, energy
// (sleep pressure) = a blend of fatigue + sleepDebt) — see core/physiology.ts's `syncNeeds`.
// Kept as real fields (not computed getters) because they are read in dozens of places and
// persisted; `stepPhysiology` is the single writer.
export interface Needs { hunger: number; energy: number; social: number; comfort: number; thirst: number; }
export interface Emotions { fear: number; anger: number; joy: number; sadness: number; stress: number; } // 0..1

// ---------------------------------------------------------------- Embodiment (v0.4)
/**
 * Foundational physical attributes (Constitution v0.4 §2). Deliberately minimal — strength and
 * dexterity are the only ones any system currently reads; more (endurance, perception, ...)
 * are added only when a real system needs them. 0..1, like Traits: 0.5 is an ordinary adult.
 * Never gate an action on a hard threshold of these — they feed `getPhysicalCapability`
 * (core/attributes.ts), which turns them into continuous effective capability.
 */
export interface Attributes { strength: number; dexterity: number; }

// ---------------------------------------------------------------- Skills (v0.6 §V)
/**
 * Learned capability, distinct from `Attributes` (physical characteristics someone is born
 * with/grows into) and from `Physiology`/tools (current state / equipment). A strong novice with
 * an axe differs from an experienced woodcutter with the same axe and body — that difference
 * lives here. One skill per materially different kind of work the simulation actually has
 * (Constitution v0.6 §V: "do not create a huge generic skill catalogue"). 0 = complete novice
 * (identical to pre-v0.6 behavior — see `getPhysicalCapability`'s skill terms, which are all
 * identity multipliers at 0), 1 = theoretical mastery (unreached in practice; gains diminish
 * as proficiency rises — see core/skills.ts's `practiceSkill`).
 */
export type SkillId = 'woodcutting' | 'quarrying' | 'hauling' | 'sawing' | 'construction' | 'baking'
  // v0.8: gathering herbs, cooking over a real fire, and crafting a tool from raw components.
  | 'herbalism' | 'cooking' | 'crafting';

/** v0.5 §I.2: individual physiological variation layered on top of a species profile (see
 * core/species.ts). Kept here (not in species.ts) alongside `Physiology`/`Attributes` since it
 * is per-person canonical state, exactly like them. */
export interface PhysiologyTraits { bodySizeFactor: number; conditioning: number; sleepNeedFactor: number; }

/**
 * Small, extensible physiology model (v0.4 §1) — deep enough for real physical causality
 * (a hungry, exhausted, overheated worker is measurably less capable), not a medical
 * simulator. All 0..1 except `sleepDebt` (hours) and `lastSleepAt` (a world-time timestamp).
 * `needs.hunger`/`.thirst`/`.energy` are derived from this every physiology step — see
 * core/physiology.ts.
 */
export interface Physiology {
  /** Caloric reserve. 1 = full/satiated, 0 = starving. Drained by baseline metabolism +
   * activity (core/physiology.ts's `ACTIVITY_ENERGY_MULT`); restored by eating. */
  energy: number;
  /** 1 = fully hydrated, 0 = dangerously dehydrated. Drained faster by exertion and heat;
   * restored by drinking. */
  hydration: number;
  /** Short/medium-term tiredness from recent exertion. NOT the same as `energy` (calories) —
   * a fed person can still be exhausted. Rises with work, falls with rest/sleep. */
  fatigue: number;
  /** Accumulated hours of unmet sleep need. Rises while awake, falls (substantially) while
   * asleep. Long unpaid sleep debt degrades work rate, dexterity and decision weighting. */
  sleepDebt: number;
  /** World-time of the end of this person's last meaningful sleep (kept for future circadian/
   * species-specific sleep hooks; not yet read for behaviour beyond `sleepDebt` itself). */
  lastSleepAt: Tick;
  /** Body heat load, 0 = comfortable, 1 = dangerously overheated. Rises with exertion and hot
   * environment, falls with passive/rest cooling and (faster, while hydrated) sweat cooling. */
  bodyHeat: number;
  /** v0.7 §Environmental exposure: 0 = dry, 1 = soaked. Rises while outdoors and unsheltered in
   * rain/storm, dries out (falls) indoors or under clear/cloudy/fog skies — a real accumulating
   * consequence of weather, not a per-tick reaction to it (Constitution v0.7: "rain is not an
   * instruction" — see mind/agent.ts's `stepPhysiology` call site and `syncNeeds`, which derives
   * `needs.comfort` from this). */
  wetness: number;
}

export interface Appearance {
  skin: number; hair: number; shirt: number; pants: number; hat?: number; hatStyle?: 'none' | 'helm' | 'hood' | 'cap' | 'wide';
  height: number; // 0.85 .. 1.1 scale
  build: number;  // 0.85 .. 1.15 width
  beard?: number; apron?: number;
}

export interface Relationship {
  trust: number;      // -1..1
  affection: number;  // -1..1
  fear: number;       // 0..1
  respect: number;    // -1..1
  familiarity: number;// 0..1
  grudge: number;     // 0..1
  /**
   * v0.2.3: a durable floor under `grudge` representing an unforgivable, defining grievance —
   * the murder of a loved one, a sustained campaign of assault. Ordinary `grudge` decays over
   * days once a conflict actually ends (mind/relationships.ts `evolveRelationships`); `grudge`
   * never decays *below* `grievance`, and `grievance` itself only erodes over a scale of years.
   * This is what lets "enemies who no longer fight" and "a feud that outlives the fight" both
   * exist without either entity forgetting its history (Constitution §7, §11). Absent/0 for the
   * overwhelming majority of relationships — set only by genuinely severe harm. */
  grievance?: number; // 0..1
  tags: string[];     // spouse, child, parent, sibling, friend, rival, employer, employee, debtor, creditor, sweetheart
  lastUpdated: Tick;
}

export type SourceType = 'witnessed' | 'heard' | 'told' | 'inferred' | 'prior' | 'self';
export interface Source { type: SourceType; from?: EntityId; viaEvent?: EventId; }

export interface Memory {
  id: string;
  tick: Tick;
  type: string;            // event type or 'told', 'observed', ...
  summary: string;
  eventId?: EventId;
  entities: EntityId[];
  significance: number;    // 0..1 — used for retention
  valence: number;         // -1..1 emotional colour
  source: Source;
  placeId?: EntityId;
  recalled: number;        // times recalled; reinforces
}

export interface KnowledgeItem {
  key: string;             // e.g. "ev:e_100", "loc:i_5", "owner:i_5"
  // v0.6 §III: 'service' is what a Place offers — "the bakery sells food," "the well has
  // water" — distinct from 'location' (where an ENTITY currently is) and 'fact' (a general
  // social/institutional fact like a home address). See mind/knowledge.ts's `learnPlace`.
  // v0.7 §Affordances: 'affordance' is what an OBJECT TYPE can be used for — "an axe fells
  // trees" — a real acquired belief distinct from the object's physical affordance, which
  // exists (core/affordance.ts) whether or not any mind has recognized it. See mind/
  // knowledge.ts's `learnAffordance`/`recognizedUses`.
  // Causal Society: 'cause' is a belief about WHY something is the case — "the bakery has no
  // flour because the miller has not been at the mill." It is always acquired by INFERENCE from
  // other beliefs this mind already holds (mind/inference.ts), never observed directly, and it
  // names those beliefs (`claim.effectKey` / `claim.becauseKey`) so the reasoning can be walked
  // back. It is what lets a mind hold "what is so" and "what I believe is behind it" as two
  // separate beliefs with two separate confidences.
  kind: 'event' | 'location' | 'ownership' | 'state' | 'fact' | 'service' | 'affordance' | 'cause';
  claim: Record<string, any>;
  confidence: number;      // 0..1
  learnedAt: Tick;
  source: Source;
  hops: number;            // 0 = first hand
  sharedWith: EntityId[];  // who I have told
  handled?: boolean;       // e.g. guard has investigated
  /** v0.6 §III: world-time this belief was last checked against reality (a purchase attempt,
   * a fresh visit) — distinct from `learnedAt` (when first believed). A belief can go stale
   * (the bakery ran out) without being wrong (the bakery still exists); this is what lets a
   * mind tell "I haven't checked in a while" apart from "I was just told." Absent = never
   * reconfirmed since first learned. */
  lastConfirmedAt?: Tick;
}

export interface Percept {
  entityId: EntityId;      // body owner perceived
  bodyId: EntityId;
  how: 'saw' | 'heard';
  tick: Tick;
  pos: Vec3;
  distance: number;
}

export type GoalType =
  | 'sleep' | 'eat' | 'work' | 'socialize' | 'wander' | 'go_home' | 'flee' | 'report' | 'investigate'
  | 'confront' | 'attack' | 'rob' | 'help' | 'shelter' | 'worship' | 'patrol' | 'drink' | 'shop' | 'mourn' | 'play'
  | 'idle' | 'talk' | 'recover_item' | 'guard_post' | 'follow' | 'return_home_safe'
  // v0.2.3: yield in a losing/hopeless fight rather than fight-to-death or flee-forever; a guard
  // escorting a surrendered/subdued suspect into custody.
  | 'surrender' | 'escort_custody'
  // v0.8 §P0-G/H: distinct from 'recover_item' (an owner going to fetch their OWN known-location
  // item) — this is a THIRD PARTY who has both `wanted:<itemId>` authorization (heard via
  // `maybeAskForHelp`/`hearDesire`) and real `loc:<itemId>` knowledge (from perception/gossip)
  // acting on it: go get it, then physically deliver it to the requester. Without this, an NPC
  // could become authorized and still never have any mechanism to follow through — only a player
  // could ever complete a third-party recovery via the dialogue-only `askAboutItemMenu`.
  | 'help_recover_item'
  // v0.2.4 world metabolism: seek water when thirsty; plant/harvest a field; the existing
  // 'work' goal covers milling/baking/tending.
  | 'drink_water' | 'plant' | 'harvest'
  // v0.3 Living World I — logistics, materials & construction. `haul` moves a resource stack
  // from one Place to another with the actor physically carrying it; `chop`/`gather` extract
  // from a ResourceNode; `build` contributes labour to a ConstructionProject. All shared with
  // the player (Constitution VI).
  | 'haul' | 'chop' | 'gather' | 'build'
  // v0.9 Social Causality: go and see, with your own eyes, how someone you are CONCERNED about
  // actually is (mind/concern.ts). Generic — the concern may come from a witnessed assault, a
  // reported theft, a noticed absence, or a death in the family; this goal only knows "I hold a
  // welfare concern about that person and I do not currently have good information about them."
  | 'check_on'
  // v0.10 Motivated Lives §I.B: obtain something a person I am oriented toward actually needs and
  // physically carry it to them. Deliberately generic — the plan is goto/pickup/goto/give, all
  // pre-existing canonical actions — and deliberately NOT limited to food: `Goal.data.itemId`
  // names whatever the pursuit resolved as the thing needed. This is the "possibly obtain
  // something required -> return/help again" step of a multi-step purpose; without it a `tend`
  // purpose could only ever walk over and look, which is one action, not a life.
  | 'provide';

export interface Goal {
  type: GoalType;
  utility: number;
  targetEntity?: EntityId;
  targetPlace?: EntityId;
  targetPos?: Vec3;
  data?: Record<string, any>;
  reasons: string[];
  createdAt: Tick;
  causeEvent?: EventId;
  key: string;             // identity for hysteresis (type + target)
}

export type ActionType = 'goto' | 'wait' | 'use' | 'sit' | 'sleep' | 'work' | 'talk' | 'tell' | 'attack' | 'look' | 'pickup' | 'face' | 'bark' | 'pray' | 'eat' | 'demand' | 'rob'
  // v0.2.3: yield (drop out of a fight, hands up); take_custody (a guard escorts a
  // surrendered/subdued suspect into detention).
  | 'yield' | 'take_custody'
  // v0.2.4: drink at a water source; plant/harvest a field plot.
  | 'drink' | 'plant' | 'harvest'
  // v0.3: load a haul cargo at the source Place; unload it at the destination; extract from a
  // resource node; contribute one slice of construction labour.
  | 'haul_load' | 'haul_unload' | 'chop' | 'gather' | 'build'
  // v0.8 §P0-G/H: hand a carried item to another person in person — the 'help_recover_item'
  // plan's delivery step (see GoalType). Distinct from the existing NPC-to-player trade/`bought`
  // path; this always uses `Simulation.giveItem` (mind/agent.ts), which pays any owed reward.
  | 'give';
export interface Action {
  type: ActionType;
  pos?: Vec3;
  targetEntity?: EntityId;
  placeId?: EntityId;
  duration?: number;       // world seconds
  startedAt?: Tick;
  text?: string;
  data?: Record<string, any>;
  run?: boolean;
  status: 'pending' | 'active' | 'done' | 'failed';
}

export interface DecisionRecord {
  tick: Tick;
  candidates: { type: GoalType; key: string; utility: number; reasons: string[]; }[];
  chosen: string;
  switched: boolean;
  note: string;
}

export interface ScheduleEntry { start: number; end: number; activity: GoalType; placeId?: EntityId; label: string; }

// ---------------------------------------------------------------- Goal commitment (v0.5 §III)
/**
 * How resistant a goal is to being preempted by an ordinary competing goal (Constitution v0.5
 * §9). 'free' goals (socializing, idle wandering) yield to whatever currently scores highest,
 * exactly like pre-v0.5 behavior. 'committed' goals (a multi-trip haul, a construction shift)
 * persist through ordinary utility fluctuation and require a genuinely severe physiological
 * need (or a real emergency) to interrupt. 'emergency_only' (sleep) is even more resistant.
 * 'checkpoint' is reserved for a future finer-grained policy; v0.5 does not use it.
 */
export type Interruptibility = 'free' | 'checkpoint' | 'committed' | 'emergency_only';
export type CommitmentStatus = 'active' | 'suspended' | 'completed' | 'abandoned';

/**
 * A committed goal (Constitution v0.5 §8) — separates DESIRE (a candidate goal scored fresh
 * every think() tick) from COMMITMENT (a goal that has been adopted and should persist). Not a
 * lock: `interruptionSeverityMet`/`EMERGENCY_GOAL_TYPES` (mind/commitment.ts) still allow a
 * genuine physiological emergency or a real threat to interrupt it — the point is stability, not
 * lock-in. See mind/commitment.ts for the full lifecycle (start/suspend/resume/finish) and
 * mind/agent.ts's think() for the fix to the v0.4-disclosed multi-trip-haul hysteresis pathology.
 */
export interface GoalCommitment {
  goalKey: string;              // matches Goal.key — identifies which goal this commits to
  goalType: GoalType;
  startedAt: Tick;
  commitmentStrength: number;   // 0..1, informational/tunable — not currently read as a gate
  interruptibility: Interruptibility;
  status: CommitmentStatus;
  suspendedBy?: string;         // the need/reason that suspended it, e.g. 'drink_water'
  suspendedAt?: Tick;
  targetEntity?: EntityId;
  targetPlace?: EntityId;
  /** A snapshot of the goal's own `data` (e.g. `{ taskId }`/`{ projectId }`) — what
   * `commitmentValidity` reads to check whether the underlying deliverable still exists. */
  data?: Record<string, any>;
}

// ---------------------------------------------------------------- Situations (v0.9)
/**
 * A SITUATION is an ongoing social matter in the world — the thing that a significant event
 * starts and that later events can change or end. It is deliberately NOT a quest, a story beat,
 * or a per-event-type handler: it is a small, generic grouping record over canonical events
 * (`eventIds`), owned by the World (`World.situations`), maintained by sim/social/situation.ts.
 *
 * Why it exists (v0.9 §G "situations age and resolve"): before this, an event was either "in
 * someone's memory" or not, with no representation of whether the matter it started was still
 * live. So a three-week-old assault stayed exactly as newsworthy as this morning's, and nothing
 * in the simulation could express "that was dealt with." A Situation gives the world one honest
 * place to record: this began, these later events bore on it, and it is now (or is not yet)
 * over.
 *
 * CRUCIALLY, a Situation is canonical bookkeeping, NOT shared knowledge. No mind reads
 * `status` directly. What a person believes about a situation is derived from the events THEY
 * actually know about (`personalSituationView` in social/situation.ts) — so a villager who never
 * heard about the arrest still, correctly, thinks the matter is unresolved. Constitution §III
 * (local knowledge) / §5.
 */
export type SituationKind = 'harm' | 'property' | 'loss' | 'disruption' | 'grief' | 'obligation';
export type SituationStatus = 'active' | 'resolved' | 'dormant';
export interface Situation {
  id: string;
  kind: SituationKind;
  /** The canonical event that opened it. */
  rootEventId: EventId;
  rootType: string;
  /** Every canonical event so far judged to bear on this matter, root first. */
  eventIds: EventId[];
  /** Who this is happening TO (the victim, the owner, the absent worker, the deceased). */
  subjectId?: EntityId;
  /** Who is responsible, when the world itself knows (may be unknown to every mind). */
  actorId?: EntityId;
  itemId?: EntityId;
  placeId?: EntityId;
  openedAt: Tick;
  lastEventAt: Tick;
  status: SituationStatus;
  resolvedAt?: Tick;
  /** Short, reason-coded: 'answered_for' | 'recovered' | 'returned' | 'settled' | 'died' |
   * 'returned_to_work' | 'faded'. Never free-form narrative. */
  resolution?: string;
  /** The canonical event that resolved it, when one did — this is what a mind must actually
   * know about before it may believe the matter is over. */
  resolvingEventId?: EventId;
  /** 0..1 canonical severity of the root event (crimeSeverity/significance), independent of who
   * cares about it. Personal significance is `social/appraisal.ts`'s job, not this. */
  severity: number;
}

// ---------------------------------------------------------------- Concerns (v0.9)
/**
 * A CONCERN is knowledge that has acquired behavioural force. v0.9 §B: "knowledge must not exist
 * only so an NPC can repeat it in dialogue." Learning that your husband was beaten is not merely
 * a new row in `knowledge`; it is a thing you now carry around that changes what you do next.
 *
 * Deliberately a very small vocabulary of KINDS (six), because the milestone asks for a few deep
 * generic primitives rather than a reaction handler per event type. The same six cover assault,
 * theft, missing property, work disruption, injury, death and family events — see
 * mind/concern.ts's `CONCERN_RULES`.
 *
 * A concern is personal and epistemic: it is formed from an appraisal of what THIS person
 * believes (a `KnowledgeItem` with real provenance), never from canonical world state they have
 * no access to.
 */
// Causal Society: 'supply' is "the material I depend on is not to be had" — the shortage
// counterpart of 'work' (which is about a PERSON the work depends on). It is what makes a real
// stockout press on a decision instead of merely being true of the world.
export type ConcernKind = 'welfare' | 'safety' | 'justice' | 'property' | 'work' | 'grief' | 'supply';
export type ConcernStatus = 'active' | 'addressed' | 'faded';
export interface Concern {
  id: string;
  kind: ConcernKind;
  /** The person this concern is ABOUT in the caring sense — whose welfare/work/property. */
  subjectId?: EntityId;
  /** The person this concern is DIRECTED at — whom I fear, blame, or want answered for. */
  aboutId?: EntityId;
  itemId?: EntityId;
  placeId?: EntityId;
  /** Causal Society: the MATERIAL a 'supply' concern is about. A resource type is not an entity,
   * so it cannot ride on `itemId`; and a shortage of flour at the bakery is one worry however
   * many separate stacks it happens to involve. Unused by every other kind. */
  resource?: ItemType;
  /** The world Situation this concern answers to, when the concern came from one. Used only to
   * ask "do I personally know of anything that ended this", never to read canonical status. */
  situationId?: string;
  /** Knowledge keys this concern rests on — its evidential basis. If they are all gone, so is
   * the concern's justification. */
  basisKeys: string[];
  /** 0..1 — how much this presses on me right now. Decays; reinforced by fresh evidence. */
  intensity: number;
  createdAt: Tick;
  lastReinforcedAt: Tick;
  status: ConcernStatus;
  /** World-time this concern was last acted on, so a person does not re-walk across the village
   * to check on the same person every think() tick. */
  lastActedAt?: Tick;
  addressedAt?: Tick;
  /** Human-readable, grounded reasons — the same convention `Goal.reasons` uses. */
  reasons: string[];
}

// ---------------------------------------------------------------- Obligations (v0.10)
/**
 * An OBLIGATION is a real, personal, provenance-carrying social stake one person holds toward
 * another (v0.10 §II). It is deliberately NOT "+10 favour points": a favour-point counter can
 * answer "how much do you like them", but it cannot answer *why*, *because of what*, *is it
 * still live*, and *how did it end* — which are exactly the questions the milestone requires the
 * simulation to be able to answer, and exactly the questions a relationship score cannot.
 *
 * Relationship change is a CONSEQUENCE of an obligation being kept or broken
 * (mind/relationships.ts), never the obligation itself. The two are separate on purpose: you can
 * dislike someone and still owe them, and you can be fond of someone you owe nothing.
 *
 * Epistemics: an obligation may only form from something the person actually knows — either
 * their own act (accepting a request is self-knowledge) or a belief with real provenance
 * (`basisKey` names the `KnowledgeItem` it rests on). See social/obligation.ts.
 */
export type ObligationKind =
  /** I took on a piece of work/help that someone asked for. The one obligation you can BREAK by
   * simply not doing it — see `failObligation`. */
  | 'accepted_task'
  /** Someone did something materially useful for me at real cost or inconvenience. */
  | 'was_helped'
  /** Someone tended my wounds. */
  | 'was_tended'
  /** Someone gave me, or gave me back, something of real value. */
  | 'was_given'
  /** Someone stepped in physically when I was being harmed. */
  | 'was_protected'
  /** A pre-existing material debt (village generation seeds these; `debt`/`debt_paid` events
   * maintain them). */
  | 'debt';
export type ObligationStatus = 'live' | 'fulfilled' | 'forgiven' | 'failed' | 'lapsed';
/**
 * v0.10.1 §XII — reporting a crime as something a person is GETTING DONE, rather than as a
 * standing urge that reappears at full strength every cognition tick until it happens to succeed.
 *
 * The states are the ones that actually differ in the world and in behaviour: there is somebody
 * to tell and they have been told (`delivered`); there is somebody to tell and this person is on
 * their way (`seeking`, the ordinary case); they went and could not get to them (`unavailable`,
 * which backs off and tries again later); there is nobody appropriate to tell at all
 * (`no_authority`); or it has stopped mattering (`moot` — the matter resolved, or the belief
 * aged out). Everything about which state applies is read from canonical facts: `sharedWith` on
 * the belief, the guards who exist and are known, and the Situation's own resolution as this
 * person sees it (`personalSituationView`).
 */
export type ReportStatus = 'seeking' | 'unavailable' | 'delivered' | 'no_authority' | 'moot';
export interface ReportProgress {
  /** The `KnowledgeItem.key` being reported. */
  key: string;
  status: ReportStatus;
  /** Who they last set out to tell. */
  towardId?: EntityId;
  /** Times they have actually arrived at, or failed to arrive at, an authority for this. */
  attempts: number;
  firstAt: Tick;
  lastAttemptAt: Tick;
  /** While set and in the future, this is not proposed — the back-off after a failed approach. */
  deferUntil?: Tick;
  /** Who it was finally told to, and when. */
  deliveredToId?: EntityId;
  deliveredAt?: Tick;
  /** Why it ended, in words, for the Inspector and the traces. */
  note?: string;
}

export interface Obligation {
  id: string;
  kind: ObligationKind;
  /** Whom I owe. Always another person; an obligation is never toward "the village". */
  towardId: EntityId;
  /** WHY — the canonical event that created it. This is the provenance the milestone requires:
   * `world.event(causeEventId)` is the answer to "because of what". */
  causeEventId?: EventId;
  /** The belief through which I know of it, when it came through the knowledge layer rather than
   * from my own act. */
  basisKey?: string;
  /** The canonical `Request` this discharges, for 'accepted_task'. */
  requestId?: string;
  itemId?: EntityId;
  situationId?: string;
  /** 0..1 — how much I owe. Derived from real context (material cost, risk, inconvenience,
   * relationship), not a flat constant per event type. */
  magnitude: number;
  createdAt: Tick;
  lastReinforcedAt: Tick;
  status: ObligationStatus;
  resolvedAt?: Tick;
  /** Short, reason-coded: 'repaid' | 'work_done' | 'forgiven' | 'abandoned' | 'they_died' |
   * 'faded' | 'settled'. Never free-form narrative. */
  resolution?: string;
  /** Human-readable grounded reasons, same convention as `Goal.reasons`/`Concern.reasons`. */
  reasons: string[];
}

// ---------------------------------------------------------------- Pursuits (v0.10)
/**
 * A PURSUIT is a PERSISTENT PURPOSE — what a person is trying to bring about, as distinct from
 * what they happen to be doing this minute (v0.10 §I).
 *
 * The layering this completes:
 *   `Concern` / `Obligation` / `Desire` — WHY something matters to me;
 *   `Pursuit`                          — WHAT I am trying to achieve, across hours or days;
 *   `Goal` + `Action[]`                — WHAT I am doing right now;
 *   `GoalCommitment`                   — why I do not casually drop the task in hand;
 *   `status`/`resolution`              — how the purpose ended, and what followed.
 *
 * A pursuit does NOT carry a script. It carries an ORIENTATION (kind + subject) and a live
 * SOURCE; `mind/pursuit.ts`'s `pursuitSteps` re-derives, every time it is asked, which ordinary
 * existing goal currently serves it given the actual state of the world and of this person's
 * knowledge. That is what makes "learn she is hurt -> go find her -> fetch food -> bring it ->
 * check again -> conclude she is well" emerge from state rather than from an authored sequence.
 *
 * It is bounded on every axis that could otherwise grow without limit: a maximum count, a
 * per-kind maximum lifetime, an attempt budget, and a source that must remain live.
 */
export type PursuitKind =
  /** See to the welfare of a particular person until I have reason to believe they are alright. */
  | 'tend'
  /** Get a particular thing back to whoever it belongs to (mine, or someone else's). */
  | 'recover'
  /** Carry out a responsibility I actually took on. */
  | 'discharge'
  /** Do right by someone who did right by me — when an ordinary opportunity presents itself. */
  | 'reciprocate';
export type PursuitStatus = 'active' | 'deferred' | 'satisfied' | 'abandoned' | 'impossible';
export interface Pursuit {
  id: string;
  kind: PursuitKind;
  /** The person this purpose is oriented toward (the one I am tending, owe, or am acting for). */
  subjectId?: EntityId;
  itemId?: EntityId;
  placeId?: EntityId;
  /** The live thing that justifies this purpose. If it is gone, so is the purpose — this is what
   * prevents a pursuit from outliving its own reason. */
  source: { kind: 'concern' | 'obligation' | 'desire' | 'request'; id: string };
  /** The canonical event that ultimately caused this, when traceable — "what caused the current
   * purpose" in the observer overlay. */
  causeEventId?: EventId;
  situationId?: string;
  /** 0..1, recomputed from the live source every upkeep. Decides active vs deferred. */
  priority: number;
  createdAt: Tick;
  /** World-time a step of this purpose last actually got somewhere. Drives the no-progress
   * abandonment backstop. */
  lastProgressAt: Tick;
  lastAttemptAt?: Tick;
  /** How many times a step of this purpose has been adopted. Bounded — see MAX_PURSUIT_ATTEMPTS. */
  attempts: number;
  /** Hard world-time ceiling. A purpose that has not resolved by now is abandoned, with a
   * reason. No purpose is immortal. */
  expiresAt: Tick;
  status: PursuitStatus;
  resolvedAt?: Tick;
  /** Reason-coded: 'satisfied' | 'seen_well' | 'delivered' | 'work_done' | 'repaid' | 'expired' |
   * 'no_progress' | 'source_gone' | 'they_died' | 'superseded'. */
  resolution?: string;
  /** The `Goal.key` of the step currently serving this purpose — continuity, and the link the
   * observer overlay follows from "what are they doing" to "why". */
  currentStep?: string;
  /** Bounded record of the step KINDS actually taken, in order — the visible evidence that one
   * purpose produced several different actions. */
  steps: string[];
  reasons: string[];
}

export interface Mind {
  goal: Goal | null;
  plan: Action[];
  decision: DecisionRecord | null;
  lastThink: number;        // physical time
  thinkBudget: number;      // accumulated subjective seconds
  thinkInterval: number;    // subjective seconds between deliberate thoughts
  alarm: number;            // 0..1 urgency that triggers immediate rethink
  percepts: Percept[];      // current perception snapshot
  attention: EntityId | null;
  lastSpokeAt: number;
  lastToldAt: Record<EntityId, number>; // last time I talked to X (for conversation cooldowns)
  // v0.2.2 Phase 3 (long-run perf): a plain array here meant `.includes()` — called once per
  // unresolved-crime candidate on EVERY guard's EVERY think() tick — was an O(length) scan of a
  // set that only ever grows for the life of the guard. On a long/violent run (seed 918271's
  // combat-heavy 918271 village had thousands of violent incidents) this was a real, measured
  // hidden "every tick: scan an ever-growing collection" cost, not a hypothetical one. A Set
  // gives the exact same membership semantics (has/add) at O(1), with no behavior change —
  // still just "have I already investigated this key" — so it changes nothing about which goals
  // get proposed or when, only how cheaply the check is answered. Serialized as a plain array at
  // the save/load boundary (persist/save.ts) since JSON has no native Set.
  investigated: Set<string>;   // event ids handled
  awaitingReplyFrom?: EntityId;
  /** Per-victim cooldown (world-time seconds until) after a completed robbery, so a robber does
   * not immediately re-target a victim who is merely recovering from being downed — this is
   * what actually ends a robbery instead of it silently repeating. See mind/robbery.ts. */
  robCooldowns?: Record<EntityId, number>;
  /** v0.2.3: world-time until which this actor keeps a low profile after being released from
   * custody — they do not initiate fresh robberies/aggression, so a released detainee does not
   * immediately re-offend and cycle straight back into custody. Transient, not persisted. */
  layLowUntil?: number;
  /** v0.2.4: world-time until which this actor has given up looking for food (a search came up
   * empty). Suppresses re-adopting `eat` every tick during a real food shortage — hunger still
   * rises (pressure), but the event log doesn't fill with shortage spam. Transient. */
  noFoodUntil?: number;
  /** v0.2.3: per-target cooldown (world-time seconds until) after abandoning a pursuit that
   * could not physically reach its quarry. Without it, a guard who perceives an unreachable
   * known criminal re-adopts `attack`/`confront` every think tick, replans goto→fails→gives
   * up→re-adopts, producing a path_failure/goal_completed storm (the dominant cost of a
   * conflict where the parties can see but not reach each other). Transient tactical state,
   * not persisted (like `robCooldowns`). */
  pursuitCooldowns?: Record<EntityId, number>;
  /** v0.5 §III: the currently active/suspended/finished goal commitment, if any — see
   * `GoalCommitment` above and mind/commitment.ts. Null for the overwhelming majority of ticks
   * (most goals are 'free' and never get a commitment record at all). */
  commitment?: GoalCommitment | null;
  /**
   * v0.10.1 §XII: how telling the watch about each crime this person knows of is actually GOING —
   * keyed by the same `KnowledgeItem.key` the report goal is raised for. See
   * `mind/reporting.ts`.
   *
   * Persisted, for the reason `concerns` are: "I have tried three times to find a guard and
   * failed" is a fact about this run's history, not something a fresh `think()` tick could
   * recompute. Absent for almost everyone almost always — an entry appears only once someone has
   * actually set out to report something.
   */
  reports?: Record<string, ReportProgress>;
  /** v0.9 §B: the concerns this mind currently carries — see `Concern`. Persisted: a concern
   * depends on what this person learned and when, and cannot be re-derived from present state.
   * Bounded (mind/concern.ts's MAX_CONCERNS); empty for most people most of the time. */
  concerns?: Concern[];
  /** v0.10 §II: the social stakes this person currently holds toward other people — see
   * `Obligation`. Persisted: an obligation depends entirely on this run's history (who did what
   * for whom, and whether it has since been repaid) and cannot be re-derived from present state.
   * Bounded (social/obligation.ts's MAX_OBLIGATIONS); empty for most people most of the time. */
  obligations?: Obligation[];
  /** v0.10 §I: the persistent purposes this person is currently oriented toward — see `Pursuit`.
   * Persisted for the same reason `concerns`/`commitment` are: a purpose records that this person
   * has been trying to do something since a particular moment, which a fresh think() tick cannot
   * recompute. Bounded (mind/pursuit.ts's MAX_PURSUITS). */
  pursuits?: Pursuit[];
  /** v0.6 §VI: the currently held intention, if any — see `Intention` below. Not persisted (it
   * is re-derived fresh every think() tick from current need/knowledge/memory, exactly like
   * `Goal` itself is a fresh candidate every tick — only `commitment` needs to survive a
   * save/reload, since only it depends on history a fresh think() tick cannot recompute). */
  intention?: Intention | null;
}

// ---------------------------------------------------------------- Intention (v0.6 §VI)
/**
 * The missing layer between a raw physiological NEED ("I need calories") and a physical ACTION
 * ("walk to the bakery"): an Intention is what the mind has decided to DO about a need, given
 * what it currently knows/remembers — "I intend to obtain bread from the bakery, because I know
 * it sells bread and I have bought there before." `Goal`/`Action` already carry the mechanical
 * "what am I doing and how" (utility, target, plan); `Intention` carries the COGNITIVE "why this
 * particular target, and on what evidence" — which knowledge/memory resolved it, distinct from a
 * goal's own `reasons` (which are about utility, not epistemic grounding). Kept deliberately thin
 * (Constitution v0.6 §VI: "do not over-generalize") — used only where it materially helps explain
 * a decision (currently: obtaining food), not threaded through every goal type.
 */
export interface Intention {
  type: string;             // e.g. 'obtain_food'
  target?: EntityId;        // the resolved target place/person, if any
  reason: string;           // e.g. "know the bakery sells bread", "bought bread here before", "no known food source — searching"
  createdAt: Tick;
  confidence?: number;      // 0..1 — how sure the mind is this target will actually work out
  grounded: boolean;        // true = resolved from real knowledge/memory; false = an uninformed search
}

export interface Person extends Entity {
  kind: 'person';
  gender: 'm' | 'f';
  age: number;
  occupation: Occupation;
  title?: string;
  homeId: EntityId | null;
  workId: EntityId | null;
  factionId: EntityId | null;
  householdId: EntityId | null;
  traits: Traits;
  /** v0.4: foundational physical attributes — see `Attributes`. */
  attributes: Attributes;
  /** v0.4: the physiology reserves `needs.hunger/.thirst/.energy` are now derived from. */
  physiology: Physiology;
  /** v0.5 §I: which `SpeciesPhysiologyProfile` (core/species.ts) governs this person's
   * metabolism. Every ordinary NPC is 'human' until another species is introduced — never
   * baked into physiology formulas directly, so a future non-human profile is additive. */
  species: string;
  /** v0.5 §I.2: individual variation on top of the species profile — see `PhysiologyTraits`. */
  physiologyTraits: PhysiologyTraits;
  /** v0.6 §V: learned capability per `SkillId`, 0..1. Absent/undefined for a given skill means
   * complete novice (0) — see core/skills.ts's `skillOf`. Seeded modestly for plausible starting
   * professions at village generation (world/village.ts); otherwise improves only through actual
   * successful practice (`practiceSkill`). */
  skills: Partial<Record<SkillId, number>>;
  needs: Needs;
  emotions: Emotions;
  appearance: Appearance;
  bodies: EntityId[];
  timeRate: number;                 // subjective time rate; 1 = human
  relationships: Record<EntityId, Relationship>;
  memories: Memory[];
  knowledge: Record<string, KnowledgeItem>;
  inventory: EntityId[];
  wealth: number;
  mind: Mind;
  schedule: ScheduleEntry[];
  bio: string;
  alive: boolean;
  controlled: boolean;              // player-controlled
  patrol?: Vec3[];
  desires: Desire[];
  hostile: boolean;                 // outlaw by default (bandits)
  /** v0.2.3: this person has yielded in a conflict (Constitution §11). While set, they do not
   * attack, and an aggressor whose intent is not explicitly lethal stops attacking them. Cleared
   * on release/custody-start, or after `SURRENDER_HOLD_SECONDS` of world time with no further
   * aggression (they warily get back up). Canonical and persisted — a surrender is a real state
   * change, not a pose. */
  surrender?: SurrenderState | null;
  /** v0.2.3: this person is being held by an institution (Constitution §11 'arrest'/'capture').
   * While `active`, they run no autonomous combat or movement goals and cannot be freshly
   * arrested again; a maintenance pass releases them at `releaseAt`. Canonical and persisted —
   * custody depends on simulation history and cannot be re-derived from present state. */
  custody?: CustodyState | null;
  speech: { text: string; until: number } | null; // current speech bubble (physical time)
  deathTick?: Tick;
  /** Current cognitive fidelity (default 'full' for every named cast member, matching v0.2
   * scope — see CognitiveLOD). Absent/undefined is treated as 'full' for backward compat
   * with any state created before this field existed (e.g. old saves). */
  cognitiveLOD?: CognitiveLOD;
}

export interface Desire { type: 'recover_item' | 'collect_debt' | 'wants_item'; targetId?: EntityId; itemType?: string; note: string; reward: number; fulfilled: boolean; }

// ---------------------------------------------------------------- World metabolism (v0.2.4)
/**
 * A crop plot: one canonical square of a `Field` (mapped to a real Farmland voxel cell, but the
 * canonical state lives here, not in the block — the renderer projects this onto the block).
 * Lifecycle: fallow → planted → growing → mature → (harvest) → harvested → (regrows to fallow).
 * Growth advances through world time at a rate scaled by the parent field's soil moisture.
 */
export type CropState = 'fallow' | 'planted' | 'growing' | 'mature' | 'harvested';
export interface CropPlot {
  x: number; y: number; z: number;      // the voxel cell this plot occupies (crop block at y)
  crop: 'wheat';                        // only wheat in v0.2.4; the field is generic
  state: CropState;
  growth: number;                       // 0..1 progress toward maturity
  plantedAt: Tick;
  maturedAt?: Tick;
  harvestedAt?: Tick;
  lastYield?: number;                   // grain produced by the last harvest of this plot
}

/**
 * A cultivated field (one per farm `Place`). Carries the plot-level crop lifecycle and a single
 * plot-level `soilMoisture` abstraction (0 dry .. 1 saturated) driven by weather. Rain raises
 * moisture; dry weather lowers it; moisture governs crop growth rate. No per-voxel hydrology.
 */
export interface Field {
  id: EntityId;
  placeId: EntityId;                    // the farm Place
  ownerId: EntityId | null;             // whose grain the harvest becomes
  soilMoisture: number;                 // 0..1
  plots: CropPlot[];
}

// ---------------------------------------------------------------- Logistics (v0.3 Living World I)
/**
 * A haul task: a canonical, world-generated need to move `quantity` units of a material
 * resource from one Place to another, with an actor physically carrying it (Constitution VII —
 * "no teleported transport"). Tasks are generated from world state (supply/demand/distance),
 * not from named-NPC schedules. Owned by `World.haulTasks`; persisted (a task in progress, or
 * cargo in transit, cannot be reconstructed from present state).
 *
 *   needed → claimed → (actor walks to source, loads) → in_transit → (walks to dest, unloads)
 *          → delivered   |   failed (source empty / hauler lost — cargo stays canonical)
 */
export type HaulStatus = 'needed' | 'claimed' | 'in_transit' | 'delivered' | 'failed' | 'cancelled';
export interface HaulTask {
  id: EntityId;
  resource: ItemType;
  quantity: number;                    // units this trip should move
  carried: number;                     // units currently on the claimant
  delivered: number;                   // units deposited at the destination
  sourcePlaceId: EntityId;
  destPlaceId: EntityId;
  reason: string;                      // "mill low on grain", "storage shed needs planks", ...
  requesterId: EntityId | null;        // beneficiary (institution/person), for future wages
  projectId?: EntityId;                // set when the destination is a ConstructionProject site
  claimantId: EntityId | null;
  cargoItemId?: EntityId;              // the real Item stack travelling with the claimant
  status: HaulStatus;
  priority: number;                    // 0..1 — higher = more urgent (deeper deficit)
  createdAt: Tick;
  updatedAt: Tick;
  /** v0.4: the shared Request this task's acceptance/wage lifecycle goes through — see
   * core/requests.ts and the `Request` doc comment above. */
  requestId?: EntityId;
  /** v0.7 §A: the person who actually owned this cargo's stock at the source Place, captured at
   * first pickup (before hauling's own ownership-reassignment to the requester would otherwise
   * erase it) — see logistics/haul.ts's `loadHaulCargo` and world/trade.ts's `settleWholesale`.
   * Lets a real wholesale sale (grain delivered to the mill, flour to the bakery, planks/stone
   * to a construction site) pay the actual producer, not just "whoever asked for it." */
  materialSellerId?: EntityId | null;
}

// ---------------------------------------------------------------- Resource nodes (v0.3)
/**
 * A renewable or non-renewable resource patch (Constitution: materials come from somewhere).
 * v0.3 covers trees (renewable, → `log`) and stone outcrops (slow/non-renewable, → `stone`).
 * The node owns its canonical state; the voxel blocks it lists are a projection of that state
 * (a depleted tree's blocks are cleared; a regrown one's are restored). Owned by
 * `World.resourceNodes`; persisted (depletion/regrowth is history).
 */
export type ResourceNodeKind = 'tree' | 'stone';
export interface ResourceNodeBlock { x: number; y: number; z: number; id: number; }
export interface ResourceNode {
  id: EntityId;
  kind: ResourceNodeKind;
  yield: ItemType;                     // 'log' | 'stone'
  pos: Vec3;                           // a walkable cell a harvester stands at
  blocks: ResourceNodeBlock[];         // canonical voxels (id = block to restore on regrow)
  remaining: number;                   // units of yield left before depletion
  capacity: number;
  renewable: boolean;
  regrowHours: number;                 // world-hours from depletion to available again
  state: 'available' | 'depleted' | 'regrowing';
  depletedAt?: Tick;
  regrowAt?: Tick;
  dropPlaceId: EntityId;               // Place where extracted items are stacked
  placeId?: EntityId;                  // wilderness/worksite area it belongs to
  /** v0.4 Priority 14: canonical lifecycle stage for a renewable (tree) node — replaces a bare
   * depleted→available flip with felled → sapling → young → mature, so "the forest hasn't
   * magically returned" is a real, inspectable state, not just a long timer. Only `mature`
   * nodes are harvestable (`state` flips to 'available' exactly when `growthStage` reaches
   * 'mature'). Undefined/absent (non-renewable stone nodes) means the concept doesn't apply. */
  growthStage?: TreeGrowthStage;
}
export type TreeGrowthStage = 'felled' | 'sapling' | 'young' | 'mature';

// ---------------------------------------------------------------- Fire (v0.8 §C)
/**
 * A real, canonical fire — fuel/heat/ignition/burning/extinguishing, not a visual status effect
 * (Constitution v0.8 §C). One per real hearth/campfire actually in use; see world/fire.ts for
 * the lifecycle (`igniteFire`/`feedFire`/`stepFire`/`extinguishFire`) and world/village.ts for
 * where fires are pre-registered (at an existing fireplace, unlit until someone lights it).
 */
export interface Fire {
  id: EntityId;
  placeId: EntityId;
  pos: Vec3;
  lit: boolean;
  /** World-seconds of burn time remaining from currently-loaded fuel. 0 when unlit. */
  fuelRemaining: number;
  /** 0..1 current burn strength — ramps toward 1 as fuel is added, decays toward 0 as it runs
   * out. Read by world/cooking.ts (a process needs real heat, not just "lit === true") and by
   * mind/agent.ts's physiology step (nearby warmth). */
  intensity: number;
  /** Outdoor and rain-exposed (mirrors `!Place.indoor` at creation) — an exposed fire can be
   * suppressed by rain (Constitution v0.7/v0.8: "rain suppresses exposed fire"); a hearth under
   * a roof cannot. */
  exposed: boolean;
  createdAt: Tick;
  litAt?: Tick;
  extinguishedAt?: Tick;
}

// ---------------------------------------------------------------- Construction (v0.3)
/**
 * A construction project: a place-bound material manifest plus a labour requirement. The
 * structure is NOT created when the project is made — the required materials must physically
 * arrive at `sitePlaceId` (via haul tasks) and actual `build` labour must be performed before
 * the world lays the permanent structure. Owned by `World.constructionProjects`; persisted.
 *
 *   gathering (waiting on materials) → ready (materials in) → building (labour underway)
 *            → complete (structure raised, site Place becomes usable)  |  cancelled
 */
export type ConstructionStatus = 'gathering' | 'ready' | 'building' | 'complete' | 'cancelled';
export interface ConstructionRequirement { type: ItemType; quantity: number; }
export interface ConstructionProject {
  id: EntityId;
  name: string;
  template: 'storage_shed';
  siteBounds: { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number };
  sitePlaceId: EntityId;               // the site Place; materials accrue here, becomes the structure
  required: ConstructionRequirement[];
  laborRequired: number;               // person-seconds of `build` work
  laborDone: number;
  /** person-seconds contributed per worker — the hook a future wage system reads
   * (Constitution: separate resource availability from labour availability). */
  contributions: Record<EntityId, number>;
  status: ConstructionStatus;
  ownerId: EntityId | null;            // requester (an institution or person)
  createdAt: Tick;
  startedAt?: Tick;
  completedAt?: Tick;
  resultPlaceId?: EntityId;            // the Place the finished structure is (== sitePlaceId)
}

// ---------------------------------------------------------------- Work requests (v0.4)
/**
 * The generalized shape of paid work (Constitution v0.4 §9). Before v0.4, hauling
 * (`HaulTask`) and construction labour (`ConstructionProject.contributions`) each invented
 * their own ad hoc "who's doing this and are they done" bookkeeping, with no way to pay a
 * worker for either. A `Request` is the shared acceptance/completion/payment envelope both
 * now go through — it does NOT replace `HaulTask`/`ConstructionProject`, which still own the
 * physical fulfillment mechanics (a haul's load/carry/deposit steps; a project's material
 * manifest); a `Request`'s `payload` references the underlying task/project by id. This is the
 * minimal real migration the milestone asks for: two materially different systems (logistics,
 * construction) share one acceptance-and-wage record, instead of each growing its own.
 *
 *   open → accepted → completed (pays `reward`, conserved currency — see mind/economy.ts)
 *        → accepted → failed (no payment)  |  cancelled (no payment, e.g. source dried up)
 */
// v0.5 §IV: 'production' is the new autonomous-demand request kind — a producer Place (a
// bakery) whose stock has fallen below its desired reserve raises one, which a worker with the
// right capability/workplace accepts and fulfills by actually performing the production
// transform (see world/production.ts). Mirrors haul/construction_labor's "world demand → shared
// Request → real work → wage" shape rather than inventing a fourth ad hoc mechanism.
export type RequestType = 'haul' | 'construction_labor' | 'production';
export type RequestStatus = 'open' | 'accepted' | 'completed' | 'failed' | 'cancelled';
export interface RequestPayload {
  haulTaskId?: EntityId;
  projectId?: EntityId;
  resource?: ItemType;
  quantity?: number;
  /** construction_labor: person-seconds of labour this request represents. */
  seconds?: number;
  /** production: the Place where the production batch happens (a bakery, ...). */
  placeId?: EntityId;
}
export interface Request {
  id: EntityId;
  type: RequestType;
  status: RequestStatus;
  /** Who benefits from the work and (when solvent) pays for it — a business owner, a project's
   * sponsor. Null means the work is communal/unpaid (e.g. no owner resolved). */
  requesterId: EntityId | null;
  requesterPlaceId?: EntityId;
  createdAt: Tick;
  acceptedAt?: Tick;
  completedAt?: Tick;
  acceptedBy?: EntityId;
  /** Wage paid to the worker on completion. May be reduced from the nominal rate if the payer
   * cannot afford it in full — payment never creates or destroys currency (Constitution v0.4
   * §10: `totalCurrencyBefore === totalCurrencyAfter` for ordinary transactions). */
  reward: number;
  cause: string;
  payload: RequestPayload;
}

/**
 * Explicit conflict intent (Constitution §11 "Conflict Must Have Intent"). Hostility is not
 * lethal intent: a hostile faction member (a bandit) or an armed defender does not default
 * to killing whoever they fight. Only `'kill'` may end a fight in death; every other intent
 * downs, drives off, or otherwise incapacitates without automatically ending a life. See
 * `conflictIntentFor` in mind/conflict.ts for how intent is chosen, and `Simulation.applyHit`
 * in mind/agent.ts for how it governs lethality.
 */
export type ConflictIntent = 'avoid' | 'threaten' | 'rob' | 'defend' | 'subdue' | 'arrest' | 'drive_off' | 'injure' | 'kill';

// ---------------------------------------------------------------- Conflict (v0.2.3)
/**
 * Explicit, canonical conflict state (Constitution §11). Torn Veil had rich mechanics for
 * *starting* conflicts (hostility, fear/grudge thresholds, robbery, arrest intent) but no
 * general mechanic for *ending* them — the v0.2.2 scale-readiness audit showed an ordinary
 * guard/bandit encounter at seed 918271 generating 150+ retained attack events while never
 * resolving, and an 8-day headless run becoming pathological as a result. A `Conflict` is the
 * simulation's canonical answer to "are these two currently in an unresolved fight, why did it
 * start, and how did it end". Telemetry may read it; it does not own it. Lives on `World.conflicts`.
 */
export type ConflictCause =
  | 'robbery' | 'crime_response' | 'self_defense' | 'faction_hostility'
  | 'retaliation' | 'dispute' | 'territorial' | 'unknown';

export type ConflictStatus =
  | 'active'       // blows being exchanged or an aggressor actively pursuing
  | 'disengaging'  // one side has broken off; a short grace before it counts as over
  | 'suspended'    // no longer a fight, but not reconciled — persistent nonviolent hostility
  | 'resolved';    // ended, with an outcome

export type ConflictOutcome =
  | 'objective_completed' | 'robbery_completed' | 'target_fled' | 'aggressor_fled'
  | 'surrender' | 'subdual' | 'arrest' | 'custody' | 'withdrawal' | 'deterrence'
  | 'reconciliation' | 'death';

export interface Conflict {
  id: EntityId;
  /** The principal parties. v0.2.3 tracks pairwise conflicts (two ids); the array shape leaves
   * room for multi-party without a schema change. */
  participants: EntityId[];
  initiator: EntityId;
  cause: ConflictCause;
  /** Current dominant intent of the aggressor side — hardens (rob → subdue → injure → kill) or
   * softens over the life of the conflict; `conflict_escalated` fires when it hardens. */
  intent: ConflictIntent;
  status: ConflictStatus;
  escalation: number;               // 0..1, rises with each exchanged blow
  attackCount: number;              // exchanged attack events, for chronicle consolidation / anomaly
  startedAt: Tick;
  lastMeaningfulInteraction: Tick;   // last blow, demand, confrontation, or pursuit step
  resolvedAt?: Tick;
  outcome?: ConflictOutcome;
  startEventId?: EventId;
  resolveEventId?: EventId;
  /** Transient hint (who last broke off) used by `maintainConflicts` to pick a disengagement
   * outcome. Recomputed behaviour — safe to lose across a save/reload, so it is not required to
   * persist even though it lives on the persisted object. */
  data_disengagedBy?: EntityId;
}

export interface SurrenderState { toId: EntityId; at: Tick; conflictId?: EntityId; reason: string; }
export interface CustodyState {
  active: boolean;
  byFactionId: EntityId | null;
  byId: EntityId | null;             // the arresting individual
  reason: string;
  crimeKey?: string;                 // the knowledge key of the crime that justified detention
  since: Tick;
  releaseAt: Tick;
  conflictId?: EntityId;
}

/** Cognitive Level of Detail (Constitution §21-27): how deeply an entity's mind is currently
 * being simulated. This is independent of power and of historical significance (§20) — a
 * Normal-tier farmer can be Full while a dormant threat is Aggregate. v0.2 implements the
 * mechanism (fidelity can change, cheaply, reversibly, without altering what an entity
 * already knows) rather than a civilization-scale population system. */
export type CognitiveLOD = 'aggregate' | 'lightweight' | 'full' | 'deep';

export interface Creature extends Entity {
  kind: 'creature';
  species: 'chicken';
  bodies: EntityId[];
  homeId: EntityId | null;
  wanderTimer: number;
  ownerId: EntityId | null;
}

// ---------------------------------------------------------------- Items
export type ItemType = 'sword' | 'dagger' | 'hammer' | 'axe' | 'bread' | 'ale' | 'coins' | 'ring' | 'book' | 'herbs' | 'flowers' | 'meat' | 'cheese' | 'lantern' | 'key' | 'pie' | 'wheat'
  // v0.2.4 world-metabolism resources. `grain` is threshed harvested wheat; `flour` is milled
  // grain; `bread` (already present) is baked flour. See RESOURCE_CATEGORY / metabolism.ts.
  | 'grain' | 'flour'
  // v0.3 building materials. `log` is a felled tree section (from a tree ResourceNode); `plank`
  // is sawn lumber (log → plank via transform()); `stone` is quarried rock (from a stone node).
  | 'log' | 'plank' | 'stone'
  // v0.4: new functional tools — `axe` and `hammer` already existed as cosmetic/weapon items
  // and now double as real tools (see core/tools.ts); `pickaxe` and `saw` are new.
  | 'pickaxe' | 'saw'
  // v0.8: `stick` is a real byproduct of felling a tree (core/materials.ts's wood, alongside
  // `log`); `stew` is a fire-cooked dish (world/cooking.ts's `cook()`, meat -> stew, requiring
  // an actual lit Fire — Part D/E's "at least one production process uses real fire/heat");
  // `stoneaxe` is the practical-crafting vertical slice's result (world/crafting.ts) — a real,
  // weaker-than-forged tool built from stick + suitable stone + herbs (binding), not spawned
  // from a recipe match alone.
  | 'stick' | 'stew' | 'stoneaxe';

/**
 * v0.2.4: a coarse category for an item type, so production/consumption logic can reason about
 * "is this food", "is this a raw material", etc. without a per-type `switch`. Deliberately
 * minimal — extended (not redesigned) when trees/ore/hides arrive.
 */
export type ResourceCategory = 'food' | 'material' | 'crop_yield' | 'tool' | 'valuable' | 'misc';
export interface ProvenanceEntry { tick: Tick; eventId?: EventId; from: EntityId | null; to: EntityId | null; how: string; }
export interface Item extends Entity {
  kind: 'item';
  type: ItemType;
  ownerId: EntityId | null;         // rightful owner (as the world has it)
  holderId: EntityId | null;        // person carrying it
  pos: Vec3 | null;                 // when lying in the world
  placeId: EntityId | null;
  provenance: ProvenanceEntry[];
  value: number;
  damage: number;
  quantity: number;
  description: string;
  named: boolean;
  /** v0.3: this stack is a haul cargo currently being carried between two Places for the named
   * task. Set when a hauler loads at the source, cleared when it is deposited at the
   * destination. If the hauler is interrupted/killed the stack simply stays in their inventory
   * (or is dropped) — the resource is never destroyed (Constitution VII "no materials from
   * nowhere", and its inverse). */
  haulTaskId?: EntityId;
  /** v0.3: fractional spoilage carried between spoilage passes so perishables lose whole units
   * without per-unit-per-tick simulation. Only ever set on perishable food stacks.
   * v0.4 Priority 14: age-based, not accumulator-based (see world/stock.ts's `addPlaceStock`) —
   * each perishable delivery is now its own stack (its `createdAt` IS its batch age), so
   * `spoilAccum` only smooths integer-unit rounding within one stack's own lifetime and no
   * longer front-loads risk onto freshly delivered units merged into an older, riskier stack. */
  spoilAccum?: number;
  /** v0.4: tool durability, 0..1 (1 = new/unused). Only meaningful on tool-category items (see
   * core/tools.ts's `TOOL_KINDS`); absent/undefined is treated as 1 (a tool with no recorded
   * wear, or a non-tool item for which condition is meaningless). Work slowly reduces it; a
   * poor-condition tool is less effective (see `toolWorkMultiplier`). No repair profession yet
   * — decay is deliberately slow so tools don't feel disposable within one milestone's play. */
  condition?: number;
}

// ---------------------------------------------------------------- Places
export type PlaceType = 'house' | 'tavern' | 'smithy' | 'bakery' | 'store' | 'chapel' | 'guardhouse' | 'farm' | 'mill' | 'square' | 'well' | 'stall' | 'camp' | 'shrine' | 'graveyard' | 'wilderness' | 'hut' | 'bridge' | 'gate'
  // v0.3: a worksite where felled logs are sawn into planks; an open rock outcrop worked for
  // stone; a construction site where materials accumulate before a structure is raised.
  | 'sawpit' | 'quarry' | 'construction';
export interface Anchor { pos: Vec3; ownerId?: EntityId; entityId?: EntityId; kind: 'bed' | 'seat' | 'work' | 'counter' | 'fire' | 'altar' | 'grave' | 'stall' | 'inside' | 'post' | 'display'; label?: string; }
export interface Place extends Entity {
  kind: 'place';
  type: PlaceType;
  bounds: { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; };
  door: Vec3 | null;                // cell just outside the door
  inside: Vec3;                     // a walkable interior/representative cell
  anchors: Anchor[];
  ownerId: EntityId | null;
  residents: EntityId[];
  workers: EntityId[];
  description: string;
  indoor: boolean;
  parentId: EntityId | null;
  fires: Vec3[];                    // fire blocks (light/smoke)
  chimneys: Vec3[];
  lit: boolean;                     // lights on at night
}

/**
 * A faction is an institution, not a hostility flag (Constitution §36 "Factions Are
 * Entities"). It carries its own leadership and institutional knowledge, separate from any
 * one member's mind: `knowledge` is what the institution as a body has been told or has
 * recorded — populated deliberately (a report reaching leadership, a meeting), never by
 * silently mirroring every member's private knowledge (Constitution §37, "one member knows
 * something must not mean all members instantly know it").
 */
export interface Faction extends Entity {
  kind: 'faction';
  members: EntityId[];
  description: string;
  hostileTo: EntityId[];
  /** Current leader, if any. May change via factionLeadershipSuccession on death. */
  leaderId: EntityId | null;
  /** Broad category for future faction-type-specific behavior (kept optional/free-form for v0.2). */
  factionType?: 'civic' | 'watch' | 'outlaw' | 'religious' | 'guild' | 'other';
  /** Institutional memory: knowledge the faction as a body holds, keyed like KnowledgeItem.
   * Distinct from any member's personal `knowledge` map. */
  knowledge: Record<string, KnowledgeItem>;
}

// ---------------------------------------------------------------- Events
export type EventType =
  | 'attack' | 'kill' | 'theft' | 'pickup' | 'drop' | 'give' | 'trade' | 'told' | 'conversation' | 'perceived'
  | 'memory_formed' | 'knowledge_gained' | 'relationship_changed' | 'emotion_changed' | 'goal_changed'
  | 'goal_completed' | 'arrived' | 'investigation' | 'confrontation' | 'arrest_attempt' | 'fled' | 'hid'
  | 'meal' | 'sleep' | 'work_shift' | 'service' | 'rumor' | 'weather' | 'birth' | 'death' | 'marriage'
  | 'debt' | 'dispute' | 'gift' | 'heal' | 'recovered' | 'apology' | 'player_spawn' | 'player_death'
  | 'block_changed' | 'item_missing' | 'threat_spotted' | 'returned_item' | 'debt_paid' | 'greeting' | 'prayer' | 'mourning'
  // v0.2 world-engine additions: purely observational/institutional, never gameplay-load-bearing
  // in the sense that removing them changes no canonical outcome by itself.
  | 'path_failure' | 'leadership_changed' | 'institutional_report' | 'cognitive_lod_changed'
  // v0.2.3 conflict resolution: each is a real canonical state change on a Conflict / a Person's
  // surrender or custody state — never emitted just to make telemetry read better.
  | 'conflict_started' | 'conflict_escalated' | 'conflict_disengaged' | 'conflict_resolved'
  | 'entity_surrendered' | 'entity_subdued' | 'entity_arrested' | 'custody_started' | 'custody_ended'
  // v0.2.2: emitted when bounded-knowledge eviction (mind/knowledge.ts) removes an entry that
  // was still materially relevant to cognition (an unresolved crime report, or knowledge an
  // active goal/plan step references by key) — purely observational, never a behavior change
  // by itself (the eviction already happened; this just makes it visible instead of silent).
  | 'knowledge_forgotten'
  // v0.2.4 world metabolism — semantic transitions only, never a per-tick growth event.
  | 'crop_planted' | 'crop_matured' | 'crop_harvested'
  | 'resource_transformed' | 'food_consumed' | 'water_consumed' | 'resource_shortage'
  // v0.3 Living World I — logistics, extraction, construction, spoilage. Semantic milestones
  // only: never a per-step "walking with cargo" event.
  | 'haul_requested' | 'haul_started' | 'resource_picked_up' | 'resource_delivered' | 'haul_failed'
  | 'resource_extracted' | 'resource_depleted' | 'resource_regrew'
  | 'construction_started' | 'construction_material_delivered' | 'construction_progress'
  | 'construction_completed' | 'construction_cancelled' | 'resource_spoiled'
  // v0.4 Embodied Economy — physiology, requests, wages, tools. Semantic milestones only (no
  // per-tick physiology event); `wage_paid`/`purchase_made` are the currency-conservation
  // record a headless run/test can sum to verify no currency was created or destroyed.
  | 'collapsed_from_exhaustion' | 'sleep_completed' | 'heat_forced_rest'
  | 'request_created' | 'request_accepted' | 'request_completed' | 'request_failed'
  | 'wage_paid' | 'purchase_made' | 'tool_broke' | 'tree_growth_stage'
  // v0.8 §1B: a fulfilled recover_item desire pays a real, conserved reward — see
  // `core/requests.ts`'s `payRecoveryReward` (the same honest-transfer semantics `wage_paid`
  // already uses).
  | 'reward_paid'
  // v0.5 Human Physiology / Autonomous Economy — goal commitment lifecycle transitions
  // (Constitution v0.5 §12: "canonical, observable, reason-coded... avoid event spam", so only
  // real transitions, never a per-tick "still committed" heartbeat) and the new production
  // request kind's creation, which reuses the existing request_* events above.
  | 'goal_committed' | 'goal_suspended' | 'goal_resumed' | 'goal_abandoned'
  // v0.6 Knowledge, Memory, Skills & Intentional Action — a mind forming (or changing) an
  // intention about how to answer a need. Fired only on a real change, exactly like
  // `goal_changed`, never per-tick. No per-practice skill event (Constitution v0.6 §V.9's
  // "avoid grindy XP popups" / event-spam avoidance) — skill state is inspectable directly.
  | 'intention_formed'
  // v0.8 Materials, Fire, Processes & Practical Crafting — a real, canonical fire being lit or
  // going out (fuel depletion, a storm suppressing an exposed one, or being put out) and a
  // completed crafting act. Semantic milestones only, matching v0.3's own construction/
  // extraction events — never a per-tick "still burning" heartbeat.
  | 'fire_lit' | 'fire_extinguished' | 'item_crafted'
  // v0.9 Social Causality Vertical Slice — the canonical state changes this milestone adds.
  // `situation_opened`/`situation_resolved` are real transitions on `World.situations`
  // (sim/social/situation.ts): a significant event opening an ongoing social matter, and a later
  // canonical event (an arrest, a healing, a returned item, a death, an apology) actually ending
  // it. `concern_formed`/`concern_resolved` are real transitions on a `Mind.concerns` entry
  // (sim/mind/concern.ts) — knowledge acquiring behavioural force, or losing it. `absence_noticed`
  // is a real INFERENCE from a real information gap (I expected you here and you were not), with
  // provenance, never an omniscient read of where you actually are.
  | 'situation_opened' | 'situation_resolved' | 'concern_formed' | 'concern_resolved' | 'absence_noticed'
  // v0.10 Motivated Lives — the canonical state changes this milestone adds.
  // `pursuit_formed`/`pursuit_resolved` are real transitions on a `Mind.pursuits` entry
  // (mind/pursuit.ts): a person becoming oriented toward a purpose that outlives any one plan,
  // and that purpose ending (satisfied, abandoned, made impossible, superseded).
  // `obligation_formed`/`obligation_resolved`/`obligation_failed` are real transitions on a
  // `Mind.obligations` entry (social/obligation.ts): a social stake coming into being with real
  // provenance, being discharged, or being BROKEN — the last of which is a genuine social event
  // other people can learn about and react to through the ordinary v0.9 machinery.
  // As with v0.5's commitment events and v0.9's concern events: only real transitions, never a
  // per-tick "still pursuing" heartbeat.
  | 'pursuit_formed' | 'pursuit_resolved' | 'obligation_formed' | 'obligation_resolved' | 'obligation_failed'
  // Causal Society — a worker stood at their own trade and could not carry it out because a
  // specific material input was not there. Deliberately a DISTINCT type from the pre-existing,
  // high-frequency `resource_shortage` (which fires from any failed transform or failed food
  // search, and is bounded as ordinary operational friction by WorldLab's
  // `throughput-consumer-backlog` check). `work_blocked` is the rare, socially legible version:
  // it is PERCEIVABLE (it carries a position and a small visibility radius), it is rate-limited
  // by the worker's own standing belief about the shortage, and it is the door through which an
  // economic stoppage becomes something minds can know, carry, say, and reason backwards from.
  | 'work_blocked';

export type EventCategory = 'world' | 'social' | 'cognition' | 'history';

export interface WorldEvent {
  id: EventId;
  tick: Tick;
  type: EventType;
  category: EventCategory;
  actor?: EntityId;
  target?: EntityId;
  item?: EntityId;
  placeId?: EntityId;
  pos?: Vec3;
  data: Record<string, any>;
  causes: EventId[];
  effects: EventId[];
  perceivedBy: { who: EntityId; how: 'saw' | 'heard'; tick: Tick }[];
  significance: number;  // 0..1
  summary: string;
  /** physical stimulus properties, for perception */
  visibility?: number;   // range in blocks at which it can be seen
  loudness?: number;     // range in blocks at which it can be heard
}

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';
export interface WeatherState { kind: WeatherKind; intensity: number; nextChangeAt: Tick; wind: number; }
