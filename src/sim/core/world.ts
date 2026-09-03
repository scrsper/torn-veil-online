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

  constructor(seed: number, clock?: WorldClock) { this.seed = seed; this.rng = new RNG(seed); this.clock = clock ?? new WorldClock(); }

  get now(): number { return this.clock.worldSeconds; }
  nextId(prefix: string): string { const n = (this.counters[prefix] = (this.counters[prefix] ?? 0) + 1); return `${prefix}_${n}`; }
  setCounters(c: Record<string, number>) { this.counters = { ...c }; }
  getCounters() { return { ...this.counters }; }

  add<T extends Entity>(e: T): T { this.entities.set(e.id, e); return e; }
  get<T extends Entity = Entity>(id: EntityId | null | undefined): T | undefined { if (!id) return undefined; return this.entities.get(id) as T | undefined; }
  person(id: EntityId | null | undefined): Person | undefined { const e = this.get(id); return e && e.kind === 'person' ? (e as Person) : undefined; }
  body(id: EntityId | null | undefined): Body | undefined { const e = this.get(id); return e && e.kind === 'body' ? (e as Body) : undefined; }
  item(id: EntityId | null | undefined): Item | undefined { const e = this.get(id); return e && e.kind === 'item' ? (e as Item) : undefined; }
  place(id: EntityId | null | undefined): Place | undefined { const e = this.get(id); return e && e.kind === 'place' ? (e as Place) : undefined; }
  faction(id: EntityId | null | undefined): Faction | undefined { const e = this.get(id); return e && e.kind === 'faction' ? (e as Faction) : undefined; }
  *ofKind<T extends Entity>(kind: T['kind']): IterableIterator<T> { for (const e of this.entities.values()) if (e.kind === kind) yield e as T; }
  persons(): Person[] { return [...this.ofKind<Person>('person')]; }
  bodies(): Body[] { return [...this.ofKind<Body>('body')]; }
  items(): Item[] { return [...this.ofKind<Item>('item')]; }
  places(): Place[] { return [...this.ofKind<Place>('place')]; }
  creatures(): Creature[] { return [...this.ofKind<Creature>('creature')]; }
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
  /** Compact old low-significance cognition events to bound memory. */
  compactEvents(keep = 4000): void {
    if (this.events.length <= keep * 1.5) return;
    const cutoff = this.events.length - keep;
    const previousIndex = new Map(this.eventIndex);
    const kept = this.events.filter((e, i) => i >= cutoff || e.significance >= 0.5 || e.category === 'history' || e.category === 'world');
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
