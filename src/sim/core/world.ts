import type { Entity, EntityId, WorldEvent, EventId, EventType, EventCategory, Vec3, Person, Body, Item, Place, Faction, Creature, WeatherState } from './types';
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
    const previousIndex = new Map(this.eventIndex);
    const kept = this.events.filter((e, i) => i >= cutoff || e.significance >= 0.5 || e.category === 'history');
    const keptIds = new Set(kept.map(e => e.id));
    const survivingCauses = (id: EventId, visiting = new Set<EventId>()): EventId[] => {
      if (keptIds.has(id)) return [id];
      if (visiting.has(id)) return [];
      const removed = previousIndex.get(id); if (!removed) return [];
      const next = new Set(visiting); next.add(id);
      return removed.causes.flatMap(cause => survivingCauses(cause, next));
    };
    for (const event of kept) {
      event.causes = [...new Set(event.causes.flatMap(cause => survivingCauses(cause)))];
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

function defaultCategory(t: EventType): EventCategory {
  switch (t) {
    case 'perceived': case 'memory_formed': case 'knowledge_gained': case 'relationship_changed': case 'emotion_changed': case 'goal_changed': case 'goal_completed': case 'arrived': return 'cognition';
    case 'told': case 'conversation': case 'rumor': case 'greeting': case 'gift': case 'apology': case 'trade': return 'social';
    case 'birth': case 'death': case 'marriage': case 'debt': case 'dispute': return 'history';
    default: return 'world';
  }
}
