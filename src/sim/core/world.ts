import type { Entity, EntityId, WorldEvent, EventId, EventType, EventCategory, Vec3, Person, Body, Item, Place, Faction, Creature, WeatherState, Conflict, Field, HaulTask, ResourceNode, ConstructionProject, Request, Fire } from './types';
import { WorldClock } from './time';
import { RNG } from './rng';
import { VoxelGrid } from '../physical/grid';
import { Navigator } from '../physical/nav';
import { B } from '../physical/blocks';

export interface EmitOptions {
  actor?: EntityId; target?: EntityId; item?: EntityId; placeId?: EntityId; pos?: Vec3;
  data?: Record<string, any>; causes?: EventId[]; significance?: number; summary?: string;
  visibility?: number; loudness?: number; category?: EventCategory; tick?: number;
}

/**
 * The World is the canonical simulated reality. It holds every entity, the event history
 * with causal links, the clock, the physical voxel substance, and listeners that let the
 * presentation layer watch reality without owning it.
 */
export class World {
  entities = new Map<EntityId, Entity>();
  events: WorldEvent[] = [];
  eventIndex = new Map<EventId, WorldEvent>();
  /** Canonical conflict state (Constitution §11, v0.2.3) — see sim/social/conflict.ts. Owned
   * here so it persists and so telemetry can observe without owning. Append-only within a run
   * (a resolved conflict stays as history); bounded by real social activity, not calendar time. */
  conflicts: Conflict[] = [];
  /** Canonical cultivated-field state (v0.2.4) — see sim/world/metabolism.ts. One `Field` per
   * farm `Place`, each with plot-level crop lifecycle and a soil-moisture abstraction. Bounded
   * by the number of farms, not by time. */
  fields: Field[] = [];
  /** Canonical logistics/materials/construction state (v0.3 Living World I) — see
   * sim/logistics/haul.ts, sim/world/resources.ts, sim/world/construction.ts. Each is bounded
   * by real activity (open tasks, mapped nodes, planned projects), not by calendar time.
   * Persisted: a haul in transit, a depleted tree, a half-supplied project cannot be
   * reconstructed from present state. */
  haulTasks: HaulTask[] = [];
  resourceNodes: ResourceNode[] = [];
  constructionProjects: ConstructionProject[] = [];
  /** Canonical work-request state (v0.4 §9) — the shared acceptance/completion/wage envelope
   * both hauling and construction labour go through. See core/requests.ts. Bounded by real
   * open work, not calendar time. Persisted: an accepted-but-not-yet-completed request cannot
   * be reconstructed from present state. */
  requests: Request[] = [];
  /** Canonical fire state (v0.8 §C) — see sim/world/fire.ts. A fire is a real, bounded world
   * process (fuel/heat/ignition/burning/extinguishing), not a visual status effect; bounded by
   * the number of real hearths/fires actually lit, not calendar time. Persisted: whether a fire
   * is currently lit and how much fuel remains cannot be reconstructed from present state alone. */
  fires: Fire[] = [];
  /** v0.2.4: lifetime counts of a few high-frequency, low-significance event types that are
   * dropped by event compaction (crop/food/water/transform) — so a headless run summary can
   * report accurate totals without inflating those events' significance. Purely observational. */
  runTally: Record<string, number> = {};
  clock: WorldClock;
  rng: RNG;
  seed: number;
  grid!: VoxelGrid;
  nav!: Navigator;
  physicalTime = 0; // seconds of physical time elapsed (monotonic)
  weather: WeatherState = { kind: 'clear', intensity: 0, nextChangeAt: 0, wind: 0.3 };
  playerId: EntityId | null = null;
  private counters: Record<string, number> = {};
  private listeners: ((e: WorldEvent) => void)[] = [];
  /** Events emitted since last perception pass that carry stimulus (visibility/loudness). */
  pendingStimuli: WorldEvent[] = [];
  /** Stable-slug → id registry (Constitution §50 "Stable Identity"). See Entity.slug. */
  private slugs = new Map<string, EntityId>();
  /**
   * Per-kind entity index (v0.2.1 Priority 3 perf pass — Constitution §71 "acceptable to use
   * deterministic... indexed lookup, not acceptable to break canonical consistency"). `entities`
   * is append-only — nothing in the codebase ever removes an entity once added (a dead person
   * or a destroyed item stays in the map, just flagged `dead`/`alive: false`), which is exactly
   * what makes an incrementally-maintained index safe: `add()` appends the new entity to its
   * kind's bucket in the same call, so the index can never drift from `entities`, and every
   * caller only ever reads/filters/sorts a *copy* of what these accessors return (confirmed:
   * no in-place mutation of an accessor's own result anywhere in this codebase), so handing
   * back the live bucket array instead of reallocating and rescanning all ~thousands of
   * entities on every single call is safe. Before this, `persons()`/`bodies()`/`items()`/
   * `places()` — each called every physical step, several times per person, including deep
   * inside per-minute upkeep — did a full generator scan of every entity of every kind just to
   * find the ones matching one kind; that scan cost was the dominant cost of a headless run.
   */
  private byKind = new Map<Entity['kind'], Entity[]>();

  constructor(seed: number, clock?: WorldClock) { this.seed = seed; this.rng = new RNG(seed); this.clock = clock ?? new WorldClock(); }

  get now(): number { return this.clock.worldSeconds; }
  nextId(prefix: string): string { const n = (this.counters[prefix] = (this.counters[prefix] ?? 0) + 1); return `${prefix}_${n}`; }
  setCounters(c: Record<string, number>) { this.counters = { ...c }; }
  getCounters() { return { ...this.counters }; }

  add<T extends Entity>(e: T): T {
    this.entities.set(e.id, e);
    if (e.slug) this.slugs.set(e.slug, e.id);
    const bucket = this.byKind.get(e.kind); if (bucket) bucket.push(e); else this.byKind.set(e.kind, [e]);
    return e;
  }
  /** Look up an authored entity by its stable slug (e.g. 'rowan', 'ashford-vale', 'watch').
   * Prefer this over hardcoding a generation-order id anywhere outside world generation. */
  getBySlug<T extends Entity = Entity>(slug: string): T | undefined { const id = this.slugs.get(slug); return id ? this.get<T>(id) : undefined; }
  /** Assign a stable slug to an already-added entity (for builders that decide the slug
   * after construction, e.g. village.ts's place registry). Prefer passing `slug` at
   * creation time (PersonSpec.slug, makeFaction's opts, ...) when possible. */
  bindSlug<T extends Entity>(e: T, slug: string): T { e.slug = slug; this.slugs.set(slug, e.id); return e; }
  get<T extends Entity = Entity>(id: EntityId | null | undefined): T | undefined { if (!id) return undefined; return this.entities.get(id) as T | undefined; }
  person(id: EntityId | null | undefined): Person | undefined { const e = this.get(id); return e && e.kind === 'person' ? (e as Person) : undefined; }
  body(id: EntityId | null | undefined): Body | undefined { const e = this.get(id); return e && e.kind === 'body' ? (e as Body) : undefined; }
  item(id: EntityId | null | undefined): Item | undefined { const e = this.get(id); return e && e.kind === 'item' ? (e as Item) : undefined; }
  place(id: EntityId | null | undefined): Place | undefined { const e = this.get(id); return e && e.kind === 'place' ? (e as Place) : undefined; }
  faction(id: EntityId | null | undefined): Faction | undefined { const e = this.get(id); return e && e.kind === 'faction' ? (e as Faction) : undefined; }
  /** Backed by the per-kind index (see `byKind` above) — O(matching entities), not O(all
   * entities). Kept as a generator for existing callers/signature compatibility. */
  *ofKind<T extends Entity>(kind: T['kind']): IterableIterator<T> { const bucket = this.byKind.get(kind) as T[] | undefined; if (bucket) yield* bucket; }
  /** Returns the live indexed array, not a copy — safe because `entities`/`byKind` are
   * append-only (see `byKind`'s own comment) and no caller mutates an accessor's result in
   * place; callers that filter/sort/map already produce their own independent array. */
  persons(): Person[] { return (this.byKind.get('person') as Person[] | undefined) ?? []; }
  bodies(): Body[] { return (this.byKind.get('body') as Body[] | undefined) ?? []; }
  items(): Item[] { return (this.byKind.get('item') as Item[] | undefined) ?? []; }
  places(): Place[] { return (this.byKind.get('place') as Place[] | undefined) ?? []; }
  creatures(): Creature[] { return (this.byKind.get('creature') as Creature[] | undefined) ?? []; }
  nameOf(id: EntityId | null | undefined): string { if (!id) return '?'; return this.get(id)?.name ?? id; }

  /** Primary body of an entity (ordinary beings have exactly one). */
  primaryBody(id: EntityId | null | undefined): Body | undefined {
    const e = this.get(id) as any; if (!e || !e.bodies) return undefined;
    for (const bid of e.bodies as EntityId[]) { const b = this.body(bid); if (b && b.present) return b; }
    return undefined;
  }
  positionOf(id: EntityId): Vec3 | undefined { return this.primaryBody(id)?.pos; }

  isDoorOpen(pos: Vec3): boolean { return this.grid.isDoorOpen(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)); }
  setDoorOpen(pos: Vec3, open: boolean, actor?: EntityId): WorldEvent | null {
    const x = Math.floor(pos.x), y = Math.floor(pos.y), z = Math.floor(pos.z);
    if (this.grid.get(x, y, z) !== B.Door || !this.grid.setDoorOpen(x, y, z, open)) return null;
    return this.emit('block_changed', { actor, pos: { x, y, z }, significance: 0.08, visibility: 8, loudness: 3, data: { block: 'door', open }, summary: `${actor ? this.nameOf(actor) : 'Someone'} ${open ? 'opened' : 'closed'} a door` });
  }
  toggleDoor(pos: Vec3, actor?: EntityId): WorldEvent | null { return this.setDoorOpen(pos, !this.isDoorOpen(pos), actor); }

  placeAt(pos: Vec3): Place | undefined {
    let best: Place | undefined; let bestArea = Infinity;
    for (const p of this.ofKind<Place>('place')) {
      const b = p.bounds;
      if (pos.x >= b.x0 && pos.x <= b.x1 + 1 && pos.z >= b.z0 && pos.z <= b.z1 + 1 && pos.y >= b.y0 - 1 && pos.y <= b.y1 + 2) {
        const area = (b.x1 - b.x0) * (b.z1 - b.z0); if (area < bestArea) { best = p; bestArea = area; }
      }
    }
    return best;
  }
  isIndoors(pos: Vec3): boolean { const p = this.placeAt(pos); return !!p && p.indoor; }

  onEvent(fn: (e: WorldEvent) => void): void { this.listeners.push(fn); }

  emit(type: EventType, o: EmitOptions = {}): WorldEvent {
    const id = this.nextId('e');
    const category = o.category ?? defaultCategory(type);
    const e: WorldEvent = {
      id, tick: o.tick ?? this.now, type, category, actor: o.actor, target: o.target, item: o.item, placeId: o.placeId,
      pos: o.pos ? { x: o.pos.x, y: o.pos.y, z: o.pos.z } : undefined, data: o.data ?? {}, causes: o.causes ?? [], effects: [],
      perceivedBy: [], significance: o.significance ?? 0.2, summary: o.summary ?? type, visibility: o.visibility, loudness: o.loudness,
    };
    if (!e.placeId && e.pos) e.placeId = this.placeAt(e.pos)?.id;
    if (TALLIED_TYPES.has(type)) this.runTally[type] = (this.runTally[type] ?? 0) + 1;
    this.events.push(e); this.eventIndex.set(id, e);
    for (const c of e.causes) { const ce = this.eventIndex.get(c); if (ce) ce.effects.push(id); }
    if (e.visibility || e.loudness) this.pendingStimuli.push(e);
    for (const l of this.listeners) l(e);
    return e;
  }
  event(id: EventId | undefined): WorldEvent | undefined { return id ? this.eventIndex.get(id) : undefined; }
  /**
   * Compact old low-significance events to bound memory (Constitution §51 "Causal History",
   * v0.2 Part 15). A recent window is always kept verbatim; beyond that, only events judged
   * significant survive as themselves — everything else is dropped, but the causal path
   * leading to a surviving event is preserved by re-parenting it onto the nearest surviving
   * ancestor (`survivingCauses` below), so "why did this happen" never dead-ends.
   *
   * `category === 'history'` is always kept (birth/death/marriage/... are definitionally
   * significant). Every OTHER category — including 'world', which is the default bucket for
   * ordinary physical events (meals, work shifts, door state, weather, and also genuinely
   * important ones like attacks and kills) — is judged by `significance` like anything else.
   * Blanket-keeping all 'world' events was a bug: it made compaction a near no-op once a
   * headless run's routine-event volume (meals, work shifts, sleep, ...) crossed the
   * threshold, since those routine events dominate the 'world' category numerically. A
   * one-off low-significance event (a meal, significance 0.05) is correctly dropped once
   * old; an attack or theft (significance >= 0.4-0.7) still clears the 0.5 bar or survives
   * via the causal-ancestor walk if it fed into something that did.
   */
  compactEvents(keep = 4000): void {
    if (this.events.length <= keep * 1.5) return;
    const cutoff = this.events.length - keep;
    // v0.2.2 Phase 3 (long-run perf): reuse the current index by reference rather than cloning
    // it — `this.eventIndex` isn't mutated anywhere below until it's reassigned to a fresh Map
    // at the end, so a clone bought nothing but an O(events.length) copy on every call.
    const previousIndex = this.eventIndex;
    const kept = this.events.filter((e, i) => i >= cutoff || e.significance >= 0.5 || e.category === 'history');
    const keptIds = new Set(kept.map(e => e.id));
    const survivingCauses = (id: EventId, visiting = new Set<EventId>()): EventId[] => {
      if (keptIds.has(id)) return [id];
      if (visiting.has(id)) return [];
      const removed = previousIndex.get(id); if (!removed) return [];
      const next = new Set(visiting); next.add(id);
      return removed.causes.flatMap(cause => survivingCauses(cause, next));
    };
    // v0.2.2 Phase 3: a permanently-kept event (significance >= 0.5 or category 'history')
    // never becomes un-kept by a later compaction pass, so once its `causes` already resolve
    // entirely within the current `keptIds`, re-walking its causal ancestry on every subsequent
    // hourly call is pure repeated work — on a long, event-heavy run the "already permanent"
    // portion of `kept` dwarfs the freshly-decided tail, and this was measured as a real,
    // growing cost (compact's wall-time share rose faster than the run length). Skipping the
    // walk when nothing changed produces byte-for-byte identical `causes`/`effects` to always
    // walking — it only avoids recomputing an answer that can't have changed.
    for (const event of kept) {
      if (!event.causes.every(c => keptIds.has(c))) {
        event.causes = [...new Set(event.causes.flatMap(cause => survivingCauses(cause)))];
      }
      event.effects = [];
    }
    this.events = kept;
    this.eventIndex = new Map(kept.map(event => [event.id, event]));
    for (const event of kept) for (const cause of event.causes) {
      const parent = this.eventIndex.get(cause);
      if (parent && !parent.effects.includes(event.id)) parent.effects.push(event.id);
    }
    this.pendingStimuli = this.pendingStimuli.filter(event => keptIds.has(event.id));
  }
  distance(a: Vec3, b: Vec3): number { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
  distance2d(a: Vec3, b: Vec3): number { return Math.hypot(a.x - b.x, a.z - b.z); }

  initPhysical(W: number, H: number, D: number): void { this.grid = new VoxelGrid(W, H, D); }
  initNav(): void { this.nav = new Navigator(this.grid); }
}

const TALLIED_TYPES = new Set<EventType>([
  'crop_planted', 'crop_matured', 'crop_harvested', 'resource_transformed', 'food_consumed', 'water_consumed', 'resource_shortage', 'meal',
  // v0.3: these are frequent + low-significance (dropped by compaction), so a headless run
  // summary needs the tally to report accurate lifetime totals.
  'haul_requested', 'haul_started', 'resource_picked_up', 'resource_delivered', 'haul_failed',
  'resource_extracted', 'resource_depleted', 'resource_regrew',
  'construction_material_delivered', 'construction_progress', 'construction_completed', 'resource_spoiled',
  // v0.4: request/wage/purchase/tool events — frequent + low-significance, needed for accurate
  // lifetime economy totals in the run summary (world/history/summary.ts).
  'request_created', 'request_accepted', 'request_completed', 'request_failed',
  'wage_paid', 'purchase_made', 'tool_broke', 'collapsed_from_exhaustion', 'heat_forced_rest', 'sleep_completed',
  // v0.5: goal-commitment transitions are rare relative to other tallied types but still worth
  // an accurate lifetime count for the benchmark report (§XII "goal suspensions/resumptions/
  // abandonments") even after compaction drops the low-significance ones.
  'goal_committed', 'goal_suspended', 'goal_resumed', 'goal_abandoned',
  // v0.6: knowledge/memory/intention formation is frequent + low-significance (the overwhelming
  // majority get dropped by compaction on a long run) — an accurate LIFETIME count for the
  // benchmark report needs the tally, exactly like v0.4/v0.5's own frequent event types above.
  'knowledge_gained', 'knowledge_forgotten', 'memory_formed', 'intention_formed',
  // v0.8: fire lifecycle + crafting are semantic milestones, not per-tick, but still frequent
  // enough over a long run that an accurate lifetime count needs the tally (world/fire.ts's
  // `fireSummary`, world/crafting.ts).
  'fire_lit', 'fire_extinguished', 'item_crafted',
]);

function defaultCategory(t: EventType): EventCategory {
  switch (t) {
    case 'perceived': case 'memory_formed': case 'knowledge_gained': case 'knowledge_forgotten': case 'relationship_changed': case 'emotion_changed': case 'goal_changed': case 'goal_completed': case 'arrived': return 'cognition';
    case 'told': case 'conversation': case 'rumor': case 'greeting': case 'gift': case 'apology': case 'trade': return 'social';
    case 'birth': case 'death': case 'marriage': case 'debt': case 'dispute': return 'history';
    // v0.2.3: the terminal / status-change conflict events are real history and always kept;
    // conflict_started / _escalated / _disengaged are ordinary 'world' events judged by significance.
    case 'conflict_resolved': case 'entity_surrendered': case 'entity_arrested': case 'custody_started': case 'custody_ended': return 'history';
    // v0.2.4 metabolism events are ordinary 'world' events judged by significance (crop_matured /
    // crop_harvested carry enough significance to survive compaction; the rest are operational).
    case 'crop_planted': case 'crop_matured': case 'crop_harvested': case 'resource_transformed':
    case 'food_consumed': case 'water_consumed': case 'resource_shortage': return 'world';
    // v0.3: a completed structure and a depleted notable resource are real, retained history;
    // the rest (haul steps, deliveries, spoilage) are ordinary 'world' events judged by significance.
    case 'construction_completed': case 'resource_depleted': return 'history';
    case 'haul_requested': case 'haul_started': case 'resource_picked_up': case 'resource_delivered':
    case 'haul_failed': case 'resource_extracted': case 'resource_regrew': case 'construction_started':
    case 'construction_material_delivered': case 'construction_progress': case 'construction_cancelled':
    case 'resource_spoiled': return 'world';
    // v0.4: request/wage/purchase lifecycle events are ordinary 'world' events judged by
    // significance; a broken tool or a forced-rest/exhaustion collapse is worth keeping.
    case 'tool_broke': case 'collapsed_from_exhaustion': case 'heat_forced_rest': return 'world';
    case 'request_created': case 'request_accepted': case 'request_completed': case 'request_failed':
    case 'wage_paid': case 'purchase_made': case 'sleep_completed': case 'tree_growth_stage': return 'world';
    // v0.5: a genuine abandonment is worth keeping as real (if minor) history — a request/task
    // that a person gave up on is a small but real causal fact; commit/suspend/resume are
    // ordinary, frequent 'cognition' events (like goal_changed), judged by significance.
    case 'goal_committed': case 'goal_suspended': case 'goal_resumed': return 'cognition';
    case 'goal_abandoned': return 'world';
    // v0.8: fire lighting/extinguishing are ordinary, frequent 'world' events judged by
    // significance; a completed craft (a real, rare, made-by-hand object entering the world) is
    // worth keeping as history, the same tier construction_completed already gets.
    case 'item_crafted': return 'history';
    default: return 'world';
  }
}
