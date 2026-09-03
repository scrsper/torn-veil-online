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
export interface Needs { hunger: number; energy: number; social: number; comfort: number; } // 0 = satisfied, 1 = desperate
export interface Emotions { fear: number; anger: number; joy: number; sadness: number; stress: number; } // 0..1

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
  | 'idle' | 'talk' | 'recover_item' | 'guard_post' | 'follow' | 'return_home_safe';

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

export type ActionType = 'goto' | 'wait' | 'use' | 'sit' | 'sleep' | 'work' | 'talk' | 'tell' | 'attack' | 'look' | 'pickup' | 'face' | 'bark' | 'pray' | 'eat' | 'demand' | 'rob';
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
  investigated: string[];   // event ids handled
  awaitingReplyFrom?: EntityId;
  /** Per-victim cooldown (world-time seconds until) after a completed robbery, so a robber does
   * not immediately re-target a victim who is merely recovering from being downed — this is
   * what actually ends a robbery instead of it silently repeating. See mind/robbery.ts. */
  robCooldowns?: Record<EntityId, number>;
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
  speech: { text: string; until: number } | null; // current speech bubble (physical time)
  deathTick?: Tick;
  /** Current cognitive fidelity (default 'full' for every named cast member, matching v0.2
   * scope — see CognitiveLOD). Absent/undefined is treated as 'full' for backward compat
   * with any state created before this field existed (e.g. old saves). */
  cognitiveLOD?: CognitiveLOD;
}

export interface Desire { type: 'recover_item' | 'collect_debt' | 'wants_item'; targetId?: EntityId; itemType?: string; note: string; reward: number; fulfilled: boolean; }

/**
 * Explicit conflict intent (Constitution §11 "Conflict Must Have Intent"). Hostility is not
 * lethal intent: a hostile faction member (a bandit) or an armed defender does not default
 * to killing whoever they fight. Only `'kill'` may end a fight in death; every other intent
 * downs, drives off, or otherwise incapacitates without automatically ending a life. See
 * `conflictIntentFor` in mind/conflict.ts for how intent is chosen, and `Simulation.applyHit`
 * in mind/agent.ts for how it governs lethality.
 */
export type ConflictIntent = 'avoid' | 'threaten' | 'rob' | 'defend' | 'subdue' | 'arrest' | 'drive_off' | 'injure' | 'kill';

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
export type ItemType = 'sword' | 'dagger' | 'hammer' | 'axe' | 'bread' | 'ale' | 'coins' | 'ring' | 'book' | 'herbs' | 'flowers' | 'meat' | 'cheese' | 'lantern' | 'key' | 'pie' | 'wheat';
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
}

// ---------------------------------------------------------------- Places
export type PlaceType = 'house' | 'tavern' | 'smithy' | 'bakery' | 'store' | 'chapel' | 'guardhouse' | 'farm' | 'mill' | 'square' | 'well' | 'stall' | 'camp' | 'shrine' | 'graveyard' | 'wilderness' | 'hut' | 'bridge' | 'gate';
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
  | 'path_failure' | 'leadership_changed' | 'institutional_report' | 'cognitive_lod_changed';

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
