import { SpatialIndex, watchGeometry, watchValue } from './spatial';
import { emptyKernel } from '../kernel/types';
import type { Entity, EntityId, WorldEvent, EventId, EventType, EventCategory, Vec3, Person, Body, Item, Place, Faction, Creature, WeatherState, Conflict, Field, HaulTask, ResourceNode, ConstructionProject, Request, Fire, Situation, WorkStint, Household, ChronicleEra, Settlement } from './types';
import { WorldClock } from './time';
import { RNG } from './rng';
import { VoxelGrid } from '../physical/grid';
import { Navigator } from '../physical/nav';
import { B } from '../physical/blocks';
import { effectCentralityDelta, eventHistoricalContributions } from './historicalSignificance';

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
  kernel = emptyKernel();
  /** Save handoff for the attached canonical scheduler. The callback reads its live state;
   * restoredExecution is consumed once on attachment, not a second running scheduler. */
  executionSnapshot: (() => unknown) | null = null;
  restoredExecution: unknown = null;
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
  /** Canonical ongoing social matters (v0.9 §G) — see sim/social/situation.ts. A Situation
   * groups the canonical events that bear on one unresolved matter (an assault, a theft, a
   * noticed absence) and records whether and how it ended. Bounded by real social activity
   * (MAX_SITUATIONS), not calendar time. Persisted: whether a matter is still open, and which
   * canonical event settled it, cannot be reconstructed from present state alone.
   *
   * NOT knowledge: no mind may read `status` off this. See `personalSituationView`. */
  situations: Situation[] = [];
  /** Adaptive Society (v0.5): canonical record of somebody working a productive place they are
   * not the worker of — see `WorkStint` in core/types.ts. Bounded by real activity (one per
   * person per place they have stood in for), never by calendar time. Persisted: who stepped in
   * when a trade fell vacant, how much work they got out of it, and who had taught them cannot
   * be reconstructed from present state alone. NOT a permission: `world/labor.ts` decides who
   * may work from staffing, capability and demand, and never reads this. */
  workStints: WorkStint[] = [];
  /** Materialized historical importance, updated at event emission/effect linking. */
  historicalSignificance = new Map<EntityId, number>();
  /** Era summaries and the detailed Chronicle sources they replace. */
  chronicleEras: ChronicleEra[] = [];
  chronicleCompactedEventIds = new Set<EventId>();
  /** Retired Chronicle source id -> one retained canonical event anchoring its era. */
  chronicleEventAliases = new Map<EventId, EventId>();
  /** v0.2.4: lifetime counts of a few high-frequency, low-significance event types that are
   * dropped by event compaction (crop/food/water/transform) — so a headless run summary can
   * report accurate totals without inflating those events' significance. Purely observational. */
  runTally: Record<string, number> = {};
  clock: WorldClock;
  rng: RNG;
  /**
   * v0.8 §9 RNG coupling investigation: `rng` is one single shared stream consumed, in
   * iteration order, by world generation AND every per-tick runtime system (agent decisions,
   * combat rolls, gossip-line selection, weather, ...) — see docs/RNG_ARCHITECTURE.md. That
   * means an unrelated code change that adds or removes even one `rng.next()` call anywhere
   * shifts every subsequent "random" draw everywhere else in the run, for the rest of the run.
   * This is a first, narrow, low-risk cut at the "derived streams" direction that document
   * recommends: weather is a fully self-contained subsystem (one call site, `strategic()`'s
   * weather block) with no reason to share a stream with anything else, so it gets its own fork
   * — a real, tested decoupling — while the larger job of separating agent/combat/resource
   * streams is documented as a deliberate follow-up rather than attempted here.
   */
  weatherRng: RNG;
  /** Independent stream so births/deaths do not perturb combat, weather, or dialogue draws. */
  demographicRng: RNG;
  /** Optional deterministic generation recipe; absent means authored Ashford. */
  settlementSites?: { id: string; x: number; z: number }[];
  geography?: import('../world/geography').WorldGeography;
  /** Indexed wilderness substrate, independent of presentation residency. */
  wildernessRegions = new Set<string>();
  seed: number;
  grid!: VoxelGrid;
  nav!: Navigator;
  physicalTime = 0; // seconds of physical time elapsed (monotonic)
  weather: WeatherState = { kind: 'clear', intensity: 0, nextChangeAt: 0, wind: 0.3 };
  playerId: EntityId | null = null;
  private counters: Record<string, number> = {};
  private listeners: ((e: WorldEvent) => void)[] = [];
  /** See the call site in `emit`. Set once, by `Simulation`'s constructor. */
  eventObserver: ((e: WorldEvent) => void) | null = null;
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
  private bodySpace = new SpatialIndex<Body>();
  private itemPlaces = new Map<string, Set<Item>>();
  private itemOrder = new Map<Item, number>();
  itemsAtPlaces(ids: readonly string[]): Item[] {
    const result = new Set<Item>();
    for (const id of ids) for (const item of this.itemPlaces.get(id) ?? []) result.add(item);
    return [...result].sort((a, b) => this.itemOrder.get(a)! - this.itemOrder.get(b)!);
  }
  private itemSpace = new SpatialIndex<Item>();
  private placeSpace = new SpatialIndex<Place>();
  nearbyBodies(pos: Vec3, radius: number): Body[] { return this.bodySpace.query(pos, radius).filter(b => this.livingBodiesSet.has(b.id) && Math.hypot(b.pos.x - pos.x, b.pos.z - pos.z) <= radius); }
  nearbyItems(pos: Vec3, radius: number): Item[] { return this.itemSpace.query(pos, radius).filter(i => !i.holderId && i.pos && Math.hypot(i.pos.x - pos.x, i.pos.z - pos.z) <= radius); }
  nearbyPlaces(pos: Vec3, radius: number): Place[] { return this.placeSpace.query(pos, radius).filter(p => Math.hypot(p.inside.x - pos.x, p.inside.z - pos.z) <= radius); }
  spatialStats() { return { bodyCandidates: this.bodySpace.candidates, itemCandidates: this.itemSpace.candidates, placeCandidates: this.placeSpace.candidates }; }
  private byKind = new Map<Entity['kind'], Entity[]>();
  /** Hot-loop indices. Historical buckets above remain append-only and addressable forever. */
  private livingPeople: Person[] = [];
  private livingPeopleSet = new Set<EntityId>();
  private livingBodies: Body[] = [];
  private livingBodiesSet = new Set<EntityId>();
  /** Event count at the last attempted compaction. Storage cleanup is deliberately batched:
   * retaining a little extra recent detail is safe, while re-walking the same retained prefix
   * every weekly clock tick is pure repeated work once the event log is above the threshold. */
  private lastCompactionEventCount = 0;

  constructor(seed: number, clock?: WorldClock) { this.seed = seed; this.rng = new RNG(seed); this.weatherRng = this.rng.fork(97); this.demographicRng = this.rng.fork(151); this.clock = clock ?? new WorldClock(); }

  get now(): number { return this.clock.worldSeconds; }
  nextId(prefix: string): string { const n = (this.counters[prefix] = (this.counters[prefix] ?? 0) + 1); return `${prefix}_${n}`; }
  setCounters(c: Record<string, number>) { this.counters = { ...c }; }
  getCounters() { return { ...this.counters }; }

  add<T extends Entity>(e: T): T {
    this.entities.set(e.id, e);
    if (e.slug) this.slugs.set(e.slug, e.id);
    const bucket = this.byKind.get(e.kind); if (bucket) bucket.push(e); else this.byKind.set(e.kind, [e]);
    if (e.kind === 'person' && (e as unknown as Person).alive) this.addLivingPerson(e as unknown as Person);
    if (e.kind === 'body') {
      const b = e as unknown as Body; const owner = this.person(b.ownerId);
      if (!b.dead && b.present && owner?.alive) this.addLivingBody(b);
    }
    if (e.kind === 'body') { const b = e as unknown as Body; watchGeometry(b, 'pos', ['x', 'z'], () => this.bodySpace.point(b, b.pos)); }
    if (e.kind === 'item') {
      const i = e as unknown as Item; this.itemOrder.set(i, this.itemOrder.size);
      watchGeometry(i, 'pos', ['x', 'z'], () => this.itemSpace.point(i, i.pos));
      watchValue(i, 'placeId', (previous, next) => {
        if (previous) { const bucket = this.itemPlaces.get(previous); bucket?.delete(i); if (!bucket?.size) this.itemPlaces.delete(previous); }
        if (next) { let bucket = this.itemPlaces.get(next); if (!bucket) this.itemPlaces.set(next, bucket = new Set()); bucket.add(i); }
      });
    }
    if (e.kind === 'place') { const p = e as unknown as Place; watchGeometry(p, 'bounds', ['x0', 'x1', 'z0', 'z1'], () => this.placeSpace.update(p, { ...p.bounds, x1: p.bounds.x1 + 1, z1: p.bounds.z1 + 1 })); }
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
  settlements(): Settlement[] { return (this.byKind.get('settlement') as Settlement[] | undefined) ?? []; }
  settlementOf(person: Person): Settlement | undefined { const e = this.get<Settlement>(this.place(person.homeId)?.settlementId); return e?.kind === 'settlement' ? e : undefined; }
  recordSettlementPopulations(event?: WorldEvent): void {
    for (const settlement of this.settlements()) {
      const residents = this.persons().filter(p => this.settlementOf(p)?.id === settlement.id);
      const population = residents.filter(p => p.alive).length;
      for (const p of residents) if (!settlement.formerInhabitantIds.includes(p.id)) settlement.formerInhabitantIds.push(p.id);
      const person = this.person(event?.target);
      const vital = (event?.type === 'birth' || event?.type === 'death') && person && this.settlementOf(person)?.id === settlement.id;
      if (vital || settlement.populationHistory.at(-1)?.population !== population) settlement.populationHistory.push({ tick: event?.tick ?? this.now, population,
        type: vital ? event!.type as 'birth' | 'death' : 'residence', ...(vital ? { personId: person!.id, eventId: event!.id } : {}) });
    }
  }
  households(): Household[] { return (this.byKind.get('household') as Household[] | undefined) ?? []; }
  livingPersons(): readonly Person[] { return this.livingPeople; }
  activeBodies(): readonly Body[] { return this.livingBodies; }
  isLivingIndexed(id: EntityId): boolean { return this.livingPeopleSet.has(id); }
  rebuildLivingIndices(): void {
    this.livingPeople = []; this.livingPeopleSet.clear(); this.livingBodies = []; this.livingBodiesSet.clear();
    for (const p of this.persons()) if (p.alive) this.addLivingPerson(p);
    for (const b of this.bodies()) if (!b.dead && b.present && this.person(b.ownerId)?.alive) this.addLivingBody(b);
  }
  livingIndexErrors(): string[] {
    const errors: string[] = [];
    const expectedPeople = this.persons().filter(p => p.alive).map(p => p.id).sort();
    const indexedPeople = this.livingPeople.map(p => p.id).sort();
    if (JSON.stringify(expectedPeople) !== JSON.stringify(indexedPeople)) errors.push(`living people index differs: expected ${expectedPeople.join(',')} got ${indexedPeople.join(',')}`);
    const expectedBodies = this.bodies().filter(b => !b.dead && b.present && this.person(b.ownerId)?.alive).map(b => b.id).sort();
    const indexedBodies = this.livingBodies.map(b => b.id).sort();
    if (JSON.stringify(expectedBodies) !== JSON.stringify(indexedBodies)) errors.push(`active body index differs: expected ${expectedBodies.join(',')} got ${indexedBodies.join(',')}`);
    return errors;
  }
  private addLivingPerson(p: Person): void { if (!this.livingPeopleSet.has(p.id)) { this.livingPeopleSet.add(p.id); this.livingPeople.push(p); } }
  private addLivingBody(b: Body): void { if (!this.livingBodiesSet.has(b.id)) { this.livingBodiesSet.add(b.id); this.livingBodies.push(b); } }
  /** The single canonical living→dead transition. Idempotent; identities and historical buckets remain. */
  markPersonDead(personOrId: Person | EntityId, tick = this.now): boolean {
    const p = typeof personOrId === 'string' ? this.person(personOrId) : personOrId;
    if (!p || !p.alive) return false;
    p.alive = false; p.deathTick = tick; p.mind.goal = null; p.mind.plan = [];
    // Spliced in place rather than rebuilt with `.filter()`: the index is a hot loop read on
    // every physical step, and a death should cost one removal, not a fresh array of everybody
    // still alive. Order is preserved either way, which is what determinism depends on.
    if (this.livingPeopleSet.delete(p.id)) { const at = this.livingPeople.indexOf(p); if (at >= 0) this.livingPeople.splice(at, 1); }
    for (const bodyId of p.bodies) {
      const b = this.body(bodyId); if (!b) continue;
      b.dead = true; b.health = 0; b.pose = 'dead'; b.present = false;
      if (this.livingBodiesSet.delete(b.id)) { const at = this.livingBodies.indexOf(b); if (at >= 0) this.livingBodies.splice(at, 1); }
    }
    return true;
  }
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
    for (const p of this.placeSpace.query(pos, 0)) {
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
    this.applySignificance(e);
    if (type === 'birth' || type === 'death') this.recordSettlementPopulations(e);
    for (const c of e.causes) { const ce = this.eventIndex.get(c); if (ce) { const before = ce.effects.length; ce.effects.push(id); const delta = ce.actor ? effectCentralityDelta(before, ce.effects.length) : 0; if (ce.actor && delta) this.addSignificance(ce.actor, delta); } }
    if (e.visibility || e.loudness) this.pendingStimuli.push(e);
    // v0.9: one hook, installed by the Simulation, through which EVERY canonical event passes
    // exactly once so ongoing-matter bookkeeping (sim/social/situation.ts) can never miss one or
    // see one twice. Kept as an injected callback rather than a direct import so `core/` stays
    // free of any dependency on `social/` (the same layering rule `sim/` keeps against `game/`).
    // Runs BEFORE listeners so a UI listener already sees a world with the situation opened.
    if (this.eventObserver) this.eventObserver(e);
    for (const l of this.listeners) l(e);
    return e;
  }
  private addSignificance(id: EntityId, amount: number): void { if (amount > 0) this.historicalSignificance.set(id, (this.historicalSignificance.get(id) ?? 0) + amount); }
  private applySignificance(event: WorldEvent): void { for (const [id, amount] of eventHistoricalContributions(event)) this.addSignificance(id, amount); }
  rebuildHistoricalSignificance(): void {
    this.historicalSignificance.clear();
    for (const event of this.events) this.applySignificance(event);
  }
  event(id: EventId | undefined): WorldEvent | undefined {
    if (!id) return undefined;
    return this.eventIndex.get(id) ?? this.eventIndex.get(this.chronicleEventAliases.get(id) ?? '');
  }
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
    const batch = Math.max(1, Math.floor(keep * 0.25));
    if (this.lastCompactionEventCount > 0 && this.events.length - this.lastCompactionEventCount < batch) return;
    const cutoff = this.events.length - keep;
    // v0.2.2 Phase 3 (long-run perf): reuse the current index by reference rather than cloning
    // it — `this.eventIndex` isn't mutated anywhere below until it's reassigned to a fresh Map
    // at the end, so a clone bought nothing but an O(events.length) copy on every call.
    const previousIndex = this.eventIndex;
    // Exact events named by living cognition or conserved provenance remain pinned. Other old
    // operational/cognitive detail may retire once its Chronicle era supplies a causal anchor.
    const referenced = new Set<EventId>();
    const visit = (value: unknown, seen = new Set<object>()): void => {
      if (typeof value === 'string') { if (previousIndex.has(value)) referenced.add(value); return; }
      if (!value || typeof value !== 'object' || seen.has(value as object)) return;
      seen.add(value as object);
      if (value instanceof Set) { for (const v of value) visit(v, seen); return; }
      if (value instanceof Map) { for (const [k, v] of value) { visit(k, seen); visit(v, seen); } return; }
      for (const v of Object.values(value)) visit(v, seen);
    };
    for (const p of this.livingPersons()) visit({ memories: p.memories, knowledge: p.knowledge, mind: p.mind, desires: p.desires,
      lineage: p.lineage, exceptionalDevelopment: p.development.exceptional, ontology: p.ontology });
    for (const item of this.items()) { visit(item.provenance); visit(item.record); }
    visit({ kernel: this.kernel, situations: this.situations, conflicts: this.conflicts, requests: this.requests, haulTasks: this.haulTasks, workStints: this.workStints, eraCauses: this.chronicleEras.map(era => era.causes) });
    const pinCauses = (id: EventId): void => {
      const event = previousIndex.get(id); if (!event) return;
      for (const cause of event.causes) if (!referenced.has(cause)) { referenced.add(cause); pinCauses(cause); }
    };
    for (const id of [...referenced]) pinCauses(id);
    const eraAnchors = new Set(this.chronicleEras.map(era => era.anchorEventId));
    const kept = this.events.filter((e, i) => {
      if (i >= cutoff || referenced.has(e.id) || eraAnchors.has(e.id)) return true;
      // Once an era owns the discoverability and alias contract, its unpinned detailed source
      // can retire regardless of category. Identity/lineage/provenance remain canonical state.
      if (this.chronicleCompactedEventIds.has(e.id)) return false;
      if (e.category === 'history') return true;
      if (e.category === 'cognition') return !this.chronicleEras.length && e.significance >= 0.5;
      return e.significance >= 0.5;
    });
    if (kept.length === this.events.length) { this.lastCompactionEventCount = this.events.length; return; }
    const keptIds = new Set(kept.map(e => e.id));
    const survivingCauses = (id: EventId, visiting = new Set<EventId>()): EventId[] => {
      if (keptIds.has(id)) return [id];
      const alias = this.chronicleEventAliases.get(id);
      if (alias && keptIds.has(alias)) return [alias];
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
    this.lastCompactionEventCount = this.events.length;
    this.eventIndex = new Map(kept.map(event => [event.id, event]));
    for (const event of kept) for (const cause of event.causes) {
      const parent = this.eventIndex.get(cause);
      if (parent && !parent.effects.includes(event.id)) parent.effects.push(event.id);
    }
    // Compaction changes storage detail, not what historically happened. Rebuilding from only
    // the retained detail would erase contributions now represented by an era.
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
  // Causal Society: rate-limited and comparatively rare, but below the compaction retention
  // floor, so a long run needs the tally to report an accurate lifetime count of stoppages.
  'work_blocked',
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
  // v0.10: purpose/obligation transitions are individually low-significance and are dropped by
  // compaction on a long run — the benchmark report needs accurate LIFETIME counts of them to
  // show that purposes actually terminate and obligations actually resolve rather than piling up.
  'pursuit_formed', 'pursuit_resolved', 'obligation_formed', 'obligation_resolved', 'obligation_failed',
  // Generational continuity: these lifetime totals must survive both ordinary event-log
  // pruning and Chronicle era compaction so epoch telemetry never mistakes retained detail
  // for the number of demographic events that actually occurred.
  'birth', 'death', 'marriage', 'inheritance', 'coming_of_age', 'pregnancy_started', 'pregnancy_lost',
]);

function defaultCategory(t: EventType): EventCategory {
  switch (t) {
    case 'perceived': case 'memory_formed': case 'knowledge_gained': case 'knowledge_forgotten': case 'relationship_changed': case 'emotion_changed': case 'goal_changed': case 'goal_completed': case 'arrived': return 'cognition';
    // v0.9: one person CONCLUDING that someone was not where they expected them is a cognitive
    // act — a belief formed from an information gap (social/absence.ts) — not a happening in the
    // world. Classifying it as 'world' put it in front of the Chronicle's significance filter,
    // where it promptly buried the village's actual history: measured at seed 918271 over 10
    // days, 815 of 891 Chronicle entries were "X noticed Y has not been at Z". The absence is
    // still fully canonical, still opens a real ongoing matter, and still travels as gossip — it
    // simply is not a historical turning point, the same way `perceived` and `memory_formed`
    // are not.
    case 'absence_noticed': case 'concern_formed': case 'concern_resolved': return 'cognition';
    // v0.10: forming or ending a persistent purpose is a cognitive transition, like a concern.
    // Forming or discharging an obligation is a SOCIAL fact between two people. BREAKING one is
    // an ordinary 'world' event judged by significance — real, minor, and consequential, the same
    // tier `goal_abandoned` already sits at.
    case 'pursuit_formed': case 'pursuit_resolved': return 'cognition';
    case 'obligation_formed': case 'obligation_resolved': return 'social';
    case 'obligation_failed': return 'world';
    case 'told': case 'conversation': case 'rumor': case 'greeting': case 'gift': case 'apology': case 'trade': return 'social';
    case 'birth': case 'death': case 'marriage': case 'inheritance': case 'coming_of_age': case 'pregnancy_started': case 'pregnancy_lost': case 'debt': case 'dispute': return 'history';
    // v0.2.3: the terminal / status-change conflict events are real history and always kept;
    // conflict_started / _escalated / _disengaged are ordinary 'world' events judged by significance.
    case 'conflict_resolved': case 'entity_surrendered': case 'entity_arrested': case 'custody_started': case 'custody_ended': return 'history';
    // v0.2.4 metabolism events are ordinary 'world' events judged by significance (crop_matured /
    // crop_harvested carry enough significance to survive compaction; the rest are operational).
    case 'crop_planted': case 'crop_matured': case 'crop_harvested': case 'resource_transformed':
    case 'food_consumed': case 'water_consumed': case 'resource_shortage': return 'world';
    // Causal Society: a trade standing idle for want of its input is an ordinary 'world' event
    // judged by significance — real and consequential, but not in itself a historical turning
    // point. What makes it matter is what minds do with it, which is cognition and social.
    case 'work_blocked': return 'world';
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
