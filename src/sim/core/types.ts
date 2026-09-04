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
export type Pose = 'stand' | 'walk' | 'run' | 'sit' | 'sleep' | 'work' | 'attack' | 'hit' | 'dead' | 'talk' | 'pray' | 'downed';

export interface Body extends Entity {
  kind: 'body';
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
  kind: 'event' | 'location' | 'ownership' | 'state' | 'fact';
  claim: Record<string, any>;
  confidence: number;      // 0..1
  learnedAt: Tick;
  source: Source;
  hops: number;            // 0 = first hand
  sharedWith: EntityId[];  // who I have told
  handled?: boolean;       // e.g. guard has investigated
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
  // v0.2.4 world metabolism: seek water when thirsty; plant/harvest a field; the existing
  // 'work' goal covers milling/baking/tending.
  | 'drink_water' | 'plant' | 'harvest'
  // v0.3 Living World I — logistics, materials & construction. `haul` moves a resource stack
  // from one Place to another with the actor physically carrying it; `chop`/`gather` extract
  // from a ResourceNode; `build` contributes labour to a ConstructionProject. All shared with
  // the player (Constitution VI).
  | 'haul' | 'chop' | 'gather' | 'build';

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
  | 'haul_load' | 'haul_unload' | 'chop' | 'gather' | 'build';
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
export type RequestType = 'haul' | 'construction_labor';
export type RequestStatus = 'open' | 'accepted' | 'completed' | 'failed' | 'cancelled';
export interface RequestPayload {
  haulTaskId?: EntityId;
  projectId?: EntityId;
  resource?: ItemType;
  quantity?: number;
  /** construction_labor: person-seconds of labour this request represents. */
  seconds?: number;
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
  | 'pickaxe' | 'saw';

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
  | 'wage_paid' | 'purchase_made' | 'tool_broke' | 'tree_growth_stage';

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
