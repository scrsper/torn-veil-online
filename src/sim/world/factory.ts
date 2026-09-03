import type { Person, Body, Item, Place, Faction, Creature, Occupation, Traits, Appearance, Vec3, PlaceType, Anchor, ItemType, EntityId } from '../core/types';
import { World } from '../core/world';

export function makeBody(world: World, ownerId: EntityId, pos: Vec3, shape: Body['shape'] = 'humanoid', maxHealth = 80): Body {
  const b: Body = {
    id: world.nextId('b'), kind: 'body', name: `${world.nameOf(ownerId)}'s body`, createdAt: world.now, tags: [],
    ownerId, shape, pos: { ...pos }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pose: 'stand', poseUntil: 0, onGround: true,
    path: null, pathIndex: 0, pathGoal: null, speed: 3.4, health: maxHealth, maxHealth, dead: false, lastHitAt: -99, lastAttackAt: -99, attackTarget: null, sitAnchor: null, present: true,
  };
  world.add(b); return b;
}

export interface PersonSpec {
  name: string; gender: 'm' | 'f'; age: number; occupation: Occupation; title?: string;
  home?: EntityId | null; work?: EntityId | null; traits: Partial<Traits>; appearance: Partial<Appearance>; bio: string; wealth?: number; timeRate?: number; hostile?: boolean; tags?: string[];
  /** Stable authored identity, e.g. cast.ts's `key` ('rowan'). See Entity.slug. */
  slug?: string;
}
export function makePerson(world: World, s: PersonSpec): Person {
  const traits: Traits = { courage: 0.5, sociability: 0.5, honesty: 0.6, aggression: 0.3, greed: 0.4, piety: 0.4, curiosity: 0.5, loyalty: 0.5, ...s.traits };
  const appearance: Appearance = { skin: 0xd9a988, hair: 0x4a2f1a, shirt: 0x8a6a4a, pants: 0x4a3a2a, height: 1, build: 1, hatStyle: 'none', ...s.appearance };
  const p: Person = {
    id: world.nextId('p'), kind: 'person', name: s.name, createdAt: world.now - s.age * 365 * 86400, tags: s.tags ?? [], slug: s.slug,
    gender: s.gender, age: s.age, occupation: s.occupation, title: s.title, homeId: s.home ?? null, workId: s.work ?? null, factionId: null, householdId: null,
    traits, needs: { hunger: 0.3, energy: 0.2, social: 0.3, comfort: 0.2 }, emotions: { fear: 0, anger: 0, joy: 0.3, sadness: 0, stress: 0 },
    appearance, bodies: [], timeRate: s.timeRate ?? 1, relationships: {}, memories: [], knowledge: {}, inventory: [], wealth: s.wealth ?? 20,
    mind: { goal: null, plan: [], decision: null, lastThink: -99, thinkBudget: 0, thinkInterval: 1.5, alarm: 0, percepts: [], attention: null, lastSpokeAt: -99, lastToldAt: {}, investigated: new Set() },
    schedule: [], bio: s.bio, alive: true, controlled: false, desires: [], hostile: !!s.hostile, speech: null, cognitiveLOD: 'full',
  };
  world.add(p); return p;
}

export function makeItem(world: World, type: ItemType, name: string, o: { owner?: EntityId | null; holder?: EntityId | null; pos?: Vec3 | null; placeId?: EntityId | null; value?: number; damage?: number; quantity?: number; description?: string; named?: boolean; tags?: string[] } = {}): Item {
  const it: Item = {
    id: world.nextId('i'), kind: 'item', name, createdAt: world.now, tags: o.tags ?? [], type, ownerId: o.owner ?? null, holderId: o.holder ?? null,
    pos: o.pos ? { ...o.pos } : null, placeId: o.placeId ?? null, provenance: [], value: o.value ?? ITEM_VALUE[type], damage: o.damage ?? ITEM_DAMAGE[type] ?? 0, quantity: o.quantity ?? 1,
    description: o.description ?? '', named: !!o.named,
  };
  if (it.holderId) { const h = world.person(it.holderId); if (h) h.inventory.push(it.id); }
  world.add(it); return it;
}
export const ITEM_VALUE: Record<ItemType, number> = { sword: 60, dagger: 15, hammer: 25, axe: 20, bread: 2, ale: 3, coins: 1, ring: 80, book: 30, herbs: 6, flowers: 1, meat: 5, cheese: 4, lantern: 12, key: 5, pie: 6, wheat: 1 };
export const ITEM_DAMAGE: Partial<Record<ItemType, number>> = { sword: 26, dagger: 14, hammer: 20, axe: 22 };
export const ITEM_LABEL: Record<ItemType, string> = { sword: 'sword', dagger: 'dagger', hammer: 'hammer', axe: 'axe', bread: 'loaf of bread', ale: 'mug of ale', coins: 'silver coins', ring: 'ring', book: 'book', herbs: 'bundle of herbs', flowers: 'flowers', meat: 'cut of venison', cheese: 'wedge of cheese', lantern: 'lantern', key: 'iron key', pie: 'meat pie', wheat: 'sheaf of wheat' };

export function makePlace(world: World, type: PlaceType, name: string, bounds: Place['bounds'], o: { door?: Vec3 | null; inside?: Vec3; anchors?: Anchor[]; owner?: EntityId | null; description?: string; indoor?: boolean; parent?: EntityId | null; fires?: Vec3[]; chimneys?: Vec3[]; tags?: string[]; slug?: string } = {}): Place {
  const p: Place = {
    id: world.nextId('pl'), kind: 'place', name, createdAt: world.now - 20 * 365 * 86400, tags: o.tags ?? [], slug: o.slug, type, bounds, door: o.door ?? null,
    inside: o.inside ?? { x: (bounds.x0 + bounds.x1) / 2, y: bounds.y0, z: (bounds.z0 + bounds.z1) / 2 }, anchors: o.anchors ?? [], ownerId: o.owner ?? null,
    residents: [], workers: [], description: o.description ?? '', indoor: o.indoor ?? true, parentId: o.parent ?? null, fires: o.fires ?? [], chimneys: o.chimneys ?? [], lit: true,
  };
  world.add(p); return p;
}
export function makeFaction(world: World, name: string, description: string, o: { slug?: string; factionType?: Faction['factionType']; leaderId?: EntityId | null } = {}): Faction {
  const f: Faction = { id: world.nextId('f'), kind: 'faction', name, createdAt: world.now - 50 * 365 * 86400, tags: [], slug: o.slug, members: [], description, hostileTo: [], leaderId: o.leaderId ?? null, factionType: o.factionType, knowledge: {} };
  world.add(f); return f;
}
export function makeCreature(world: World, species: Creature['species'], name: string, homeId: EntityId | null, ownerId: EntityId | null): Creature {
  const c: Creature = { id: world.nextId('c'), kind: 'creature', name, createdAt: world.now, tags: [], species, bodies: [], homeId, wanderTimer: 0, ownerId };
  world.add(c); return c;
}
