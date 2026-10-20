import type { Body, Item, ItemType, Person, Vec3 } from '../core/types';
import type { World } from '../core/world';
import type { ArcaneSource, PhysicalArmor } from '../physical/arcana/types';
import { ITEM_DESIGNS, type ItemDesign } from '../content/itemCollection';
import { makeContainer } from '../core/container';
import { makeItem, ITEM_DAMAGE, ITEM_LABEL, ITEM_VALUE } from '../world/factory';
import { BOOKS, ESSENCES, SCROLLS } from '../physical/arcana/catalogue';
import { combatBusy } from '../physical/combatAction';
import { CACHE_TIERS, RESERVE_STOCK, type CacheRecord, type JohnSmithState } from './types';
import { archive, bump, cacheId, cachesGrantedIn, holderRecord, isInterfaceHolder, notice, stableRng } from './state';
import { pick, VOICE } from './voice';

/**
 * The Orchestrator's Reserve: a finite stock of caches per world (RESERVE_STOCK), authored policy
 * fixed by the seed. A cache's contents are a pure function of the world seed and the cache id,
 * so they are the same whoever earns it and whenever it is opened: the seal hides them, it does
 * not decide them. Opening materializes them as ordinary canonical items in an owned container,
 * with provenance naming the reserve and the cache. Nothing here creates currency, heals, grants
 * an ability, raises a rank or changes a rule.
 */

/** Catalog tiers a cache tier draws gear from. Catalog tiers are design identity, never power. */
const CATALOG_TIERS: readonly (readonly string[])[] = [['Normal'], ['Normal', 'Uncommon'], ['Uncommon', 'Rare'], ['Rare', 'Unique'], ['Epic', 'Legendary'], ['Legendary']];
/** Physical quality of reserve-made gear: a modest, bounded edge from better making. */
const WEAPON_QUALITY = [1, 1.04, 1.08, 1.12, 1.16, 1.2];
const ARMOR_ABSORPTION = [2, 3, 4.5, 6, 8, 10];
const VALUE_MULTIPLIER = [1, 1.5, 2.5, 4, 7, 12];
const PROVISION_UNITS = [2, 3, 3, 4, 4, 5];
const PROVISIONS: readonly ItemType[] = ['bread', 'cheese', 'pie', 'stew', 'ale', 'herbs'];
const SIGNETS = ['Archivist\'s Signet', 'Ring of Small Print', 'Band of Correct Filing', 'Seal of the Finite Reserve', 'Ring of the Fourth Drawer', 'Signet of Closed Matters', 'Band of Provenance', 'Ring of the Unremarked'];

const armorCoverage = (d: ItemDesign): PhysicalArmor['coverage'] | null => {
  const t = d.type.toLowerCase();
  if (t.includes('shield')) return ['arm', 'torso'];
  if (t.includes('helmet')) return ['head'];
  if (t.includes('pauldron') || t.includes('bracer')) return ['arm'];
  if (t.includes('greave')) return ['leg'];
  if (t.includes('cuirass')) return ['torso'];
  return null;
};
const WEAPONS = ITEM_DESIGNS.filter(d => d.category === 'Weapon' && d.mechanicalType && ITEM_DAMAGE[d.mechanicalType] !== undefined);
const ARMOR = ITEM_DESIGNS.filter(d => d.category === 'Armor' && armorCoverage(d));
const CURIOS = ITEM_DESIGNS.filter(d => d.mechanicalType && ['lantern', 'key', 'book', 'pickaxe'].includes(d.mechanicalType));
const ESSENCE_IDS = Object.values(ESSENCES).map(e => ({ id: e.skill.id, name: e.skill.name, essence: e.name }));
const BOOK_IDS = Object.values(BOOKS).map(b => ({ id: b.skill.id, title: b.title }));
const SCROLL_IDS = SCROLLS.map(s => ({ id: s.id, name: s.name }));

export interface LootSpec {
  type: ItemType; name: string; quantity: number; description: string; value: number;
  catalogId?: string; damage?: number; condition?: number; armor?: PhysicalArmor; source?: ArcaneSource;
  /** Display grouping only. */
  kind: 'provision' | 'weapon' | 'armor' | 'curio' | 'valuable' | 'scroll' | 'book' | 'essence';
}
const firstSentence = (s: string) => { const i = s.indexOf('. '); return (i > 0 ? s.slice(0, i + 1) : s).slice(0, 240); };

/** Pure: the sealed contents of one cache. Same seed and id, same objects, always. */
export function cacheContents(seed: number, id: string, tier: number): LootSpec[] {
  const rng = stableRng(seed, 'cache-contents', id), out: LootSpec[] = [], usedDesigns = new Set<string>();
  const stamp = `Drawn from John Smith's finite reserve (${id}).`;
  const fromPool = (pool: readonly ItemDesign[], tiers: readonly string[]): ItemDesign | undefined => {
    let candidates = pool.filter(d => tiers.includes(d.tier) && !usedDesigns.has(d.id));
    // Some catalog families skip a tier (no Rare longswords). Widen rather than return nothing.
    if (!candidates.length) candidates = pool.filter(d => !usedDesigns.has(d.id) && CATALOG_TIERS.slice(Math.max(0, tier - 1), tier + 2).flat().includes(d.tier));
    if (!candidates.length) return undefined;
    const d = rng.pick(candidates); usedDesigns.add(d.id); return d;
  };
  const weapon = (d: ItemDesign): LootSpec => {
    const type = d.mechanicalType as ItemType;
    return { kind: 'weapon', type, name: d.name, quantity: 1, catalogId: d.id, condition: 1,
      damage: Math.round(ITEM_DAMAGE[type]! * WEAPON_QUALITY[tier]), value: Math.round(ITEM_VALUE[type] * VALUE_MULTIPLIER[tier]),
      description: `${firstSentence(d.description)} ${stamp}` };
  };
  const armor = (d: ItemDesign): LootSpec => ({ kind: 'armor', type: 'armor', name: d.name, quantity: 1, catalogId: d.id, condition: 1,
    armor: { version: 1, coverage: armorCoverage(d)!, absorption: ARMOR_ABSORPTION[tier] }, value: Math.round(20 * VALUE_MULTIPLIER[tier]),
    description: `${firstSentence(d.description)} ${stamp}` });
  const curio = (d: ItemDesign): LootSpec => {
    const type = d.mechanicalType as ItemType;
    return { kind: 'curio', type, name: d.name, quantity: 1, catalogId: d.id, condition: type === 'pickaxe' ? 1 : undefined,
      value: Math.round(ITEM_VALUE[type] * VALUE_MULTIPLIER[tier]), description: `${firstSentence(d.description)} ${stamp}` };
  };
  const gear = (tiers: readonly string[]): LootSpec | undefined => {
    const roll = rng.next();
    const d = roll < .5 ? fromPool(WEAPONS, tiers) ?? fromPool(ARMOR, tiers) : fromPool(ARMOR, tiers) ?? fromPool(WEAPONS, tiers);
    return d ? (d.category === 'Armor' ? armor(d) : weapon(d)) : undefined;
  };
  const provisions = (): LootSpec => {
    const type = rng.pick(PROVISIONS);
    return { kind: 'provision', type, name: `Reserve ${ITEM_LABEL[type]}`, quantity: PROVISION_UNITS[tier], value: ITEM_VALUE[type],
      description: `Plain, honest provisions. ${stamp}` };
  };
  const signet = (): LootSpec => ({ kind: 'valuable', type: 'ring', name: rng.pick(SIGNETS), quantity: 1, value: Math.round(ITEM_VALUE.ring * VALUE_MULTIPLIER[tier]),
    description: `A ring of no power whatsoever, valued by those who value such things. ${stamp}` });
  const scroll = (n: number): LootSpec => {
    const s = rng.pick(SCROLL_IDS);
    return { kind: 'scroll', type: 'book', name: s.name, quantity: n, value: 25 * VALUE_MULTIPLIER[tier], source: { version: 1, abilityId: s.id, kind: 'scroll' },
      description: `One strong casting, spent when read. ${stamp}` };
  };
  const book = (): LootSpec => {
    const b = rng.pick(BOOK_IDS);
    return { kind: 'book', type: 'book', name: b.title, quantity: 1, value: Math.round(ITEM_VALUE.book * VALUE_MULTIPLIER[tier]), source: { version: 1, abilityId: b.id, kind: 'book' },
      description: `A source that teaches a form to whoever studies it. ${stamp}` };
  };
  const essence = (): LootSpec => {
    const e = rng.pick(ESSENCE_IDS);
    // Like a Tower award: one learning dose and one integration dose, finite and present now.
    return { kind: 'essence', type: 'book', name: `Essence of ${e.essence}`, quantity: 2, value: Math.round(60 * VALUE_MULTIPLIER[tier]), source: { version: 1, abilityId: e.id, kind: 'essence' },
      description: `${e.name}, condensed. ${stamp}` };
  };
  const tiers = CATALOG_TIERS[tier], add = (spec: LootSpec | undefined) => { if (spec) out.push(spec); };
  switch (tier) {
    case 0: add(provisions()); add(rng.next() < .65 ? gear(tiers) : curio(fromPool(CURIOS, tiers) ?? CURIOS[0])); break;
    case 1: add(provisions()); add(gear(tiers)); add(rng.next() < .5 ? signet() : curio(fromPool(CURIOS, tiers) ?? CURIOS[0])); break;
    case 2: add(provisions()); add(gear(tiers)); add(scroll(1)); if (rng.next() < .5) add(signet()); break;
    case 3: add(provisions()); add(gear(tiers)); add(gear(tiers)); add(scroll(rng.int(1, 2))); if (rng.next() < .35) add(book()); break;
    case 4: add(gear(tiers)); add(gear(tiers)); add(book()); add(scroll(2)); add(signet()); if (rng.next() < .5) add(essence()); break;
    default: {
      // Celestial: three pieces of one named Legendary set, an essence, a tome and a signet.
      const sets = [...new Set(ITEM_DESIGNS.filter(d => d.set_id && d.tier === 'Legendary').map(d => d.set_id!))].sort();
      const set = rng.pick(sets), pieces = ITEM_DESIGNS.filter(d => d.set_id === set && d.tier === 'Legendary' && (WEAPONS.includes(d) || ARMOR.includes(d)));
      for (const d of pieces.slice(0, 3)) { usedDesigns.add(d.id); add(d.category === 'Armor' ? armor(d) : weapon(d)); }
      while (out.length < 3) add(gear(tiers));
      add(essence()); add(book()); add(signet());
    }
  }
  return out;
}

export function nextCacheIndex(s: JohnSmithState, tier: number): number | null {
  const used = new Set(s.caches.filter(c => c.tier === tier).map(c => c.id));
  for (let i = 1; i <= RESERVE_STOCK[tier]; i++) if (!used.has(cacheId(tier, i))) return i;
  return null;
}

/** Draw a cache from the reserve for an interface holder. A spent tier substitutes the next
 * lower tier with stock; when every lower tier is spent, nothing is granted. */
export function grantCache(world: World, s: JohnSmithState, holder: Person, requested: number, reason: string, refs: { featId?: string; questId?: string } = {}): CacheRecord | null {
  if (!isInterfaceHolder(world, holder.id)) return null;
  let tier = Math.max(0, Math.min(5, Math.floor(requested)));
  while (tier >= 0 && nextCacheIndex(s, tier) === null) tier--;
  if (tier < 0) {
    notice(world, s, holder.id, { kind: 'reserve', title: 'Reserve exhausted', text: pick(world.seed, `exhausted:${reason}`, VOICE.reserveExhausted()), tier: requested });
    return null;
  }
  const id = cacheId(tier, nextCacheIndex(s, tier)!);
  // No actor, target or position: an orchestrator act adds nothing to anyone's historical
  // significance and is not a stimulus any mind can perceive.
  const ev = world.emit('orchestrator', { significance: .3, data: { act: 'cache_granted', cacheId: id, tier, requested, recipientId: holder.id, reason, ...refs },
    summary: `John Smith drew ${CACHE_TIERS[tier]} cache ${id} from the finite reserve for ${holder.name} (${reason})` });
  const record: CacheRecord = { id, tier, requested, recipientId: holder.id, reason, ...refs, grantedAt: world.now, grantEventId: ev.id };
  s.caches.push(record);
  const remaining = RESERVE_STOCK[tier] - cachesGrantedIn(s, tier);
  const text = tier < requested ? `${pick(world.seed, `substitute:${id}`, VOICE.cacheSubstituted(requested, tier))} ${pick(world.seed, `granted:${id}`, VOICE.cacheGranted(tier, remaining))}`
    : pick(world.seed, `granted:${id}`, VOICE.cacheGranted(tier, remaining));
  notice(world, s, holder.id, { kind: 'cache', title: `${CACHE_TIERS[tier]} cache`, text, tier, ref: id });
  return record;
}

/** Why a holder cannot open a cache right now, or 'ok'. A safe moment is a canonical reading of
 * the holder's own situation: able, unrestrained, not mid-action, not in a trial or a live fight. */
export function cacheSafety(world: World, p: Person): string {
  const b = world.primaryBody(p.id);
  if (!p.alive) return 'dead';
  if (!b || !b.present || b.dead) return 'absent';
  if (b.pose === 'downed' || b.pose === 'sleep' || b.subduedUntil > world.physicalTime) return 'incapacitated';
  if (p.surrender || p.custody?.active) return 'restrained';
  if (combatBusy(b, world.physicalTime) || b.recoil || (b.arcana?.cast && !b.arcana.cast.cancelled && b.arcana.cast.completeAt > world.physicalTime)) return 'busy';
  if (p.combatTrial && !p.combatTrial.endedEventId) return 'trial_active';
  const fights = world.conflicts.filter(c => c.participants.includes(p.id) && c.status !== 'resolved');
  if (fights.some(c => c.status === 'active' && world.now - c.lastMeaningfulInteraction < 30)) return 'in_combat';
  const opponents = new Set(fights.flatMap(c => c.participants.filter(id => id !== p.id)));
  if (world.nearbyPhysicalBodies(b.pos, 10).some(o => opponents.has(o.ownerId) && !o.dead && o.pose !== 'downed')) return 'threat_near';
  return 'ok';
}

/** Ground in front of the body where the holder can reach a coffer; otherwise at their feet. */
function cofferPosition(world: World, b: Body): Vec3 | null {
  const eye = { ...b.pos, y: b.pos.y + 1.2 };
  for (const [ahead, side] of [[1.1, 0], [1.1, .8], [1.1, -.8], [0, 1.1], [0, -1.1]]) {
    const x = b.pos.x - Math.sin(b.yaw) * ahead + Math.cos(b.yaw) * side, z = b.pos.z - Math.cos(b.yaw) * ahead - Math.sin(b.yaw) * side;
    const geometry = world.grid.movementGeometryAt(x, z);
    const y = geometry ? geometry.supportAt(x, z, b.pos.y) : b.pos.y;
    if (y === null || Math.abs(y - b.pos.y) > .6) continue;
    const pos = { x, y, z };
    if (geometry ? !geometry.fits(x, y, z, .25, .6) : !world.nav.isWalkable(Math.floor(x), Math.floor(z))) continue;
    if (world.grid.lineOfPassage(eye, { ...pos, y: pos.y + .7 }, 3)) return pos;
  }
  return world.grid.lineOfPassage(eye, { ...b.pos, y: b.pos.y + .7 }, 3) ? { ...b.pos } : null;
}

export interface OpenResult { result: string; cofferId?: string; itemIds?: string[] }
export function openCache(world: World, s: JohnSmithState, holder: Person, id: string): OpenResult {
  const record = s.caches.find(c => c.id === id && c.recipientId === holder.id);
  if (!record) return { result: 'unknown_cache' };
  if (record.openedAt !== undefined) return { result: 'already_opened' };
  const safety = cacheSafety(world, holder), body = world.primaryBody(holder.id);
  const pos = safety === 'ok' && body ? cofferPosition(world, body) : null;
  const refusal = safety !== 'ok' ? safety : !pos ? 'no_room' : null;
  if (refusal) {
    // One explanation per cache per few seconds; repeated attempts are answered, not re-announced.
    const last = holderRecord(s, holder.id).notices.at(-1);
    if (!(last?.title === 'Not here' && last.ref === id && world.now - last.at < 10))
      notice(world, s, holder.id, { kind: 'cache', title: 'Not here', text: pick(world.seed, `unsafe:${refusal}`, VOICE.unsafe(refusal)), tier: record.tier, ref: id });
    return { result: `unsafe:${refusal}` };
  }
  const specs = cacheContents(world.seed, record.id, record.tier);
  const ev = world.emit('orchestrator', { significance: .35, data: { act: 'cache_opened', cacheId: record.id, tier: record.tier, recipientId: holder.id },
    summary: `${holder.name} unsealed ${CACHE_TIERS[record.tier]} cache ${record.id}` });
  const place = world.placeAt(pos!);
  const coffer = makeContainer(world, { name: `${CACHE_TIERS[record.tier]} Veil cache`, capacity: 64, open: true, ownerId: holder.id,
    pos: pos!, placeId: place?.id ?? null, tags: ['veil-cache', record.id, `loot:${CACHE_TIERS[record.tier].toLowerCase()}`] });
  const items: Item[] = specs.map(spec => {
    const item = makeItem(world, spec.type, spec.name, { owner: holder.id, container: coffer.id, quantity: spec.quantity, value: spec.value,
      ...(spec.damage !== undefined ? { damage: spec.damage } : {}), ...(spec.condition !== undefined ? { condition: spec.condition } : {}),
      ...(spec.catalogId ? { catalogId: spec.catalogId } : {}), description: spec.description, named: true,
      tags: ['veil-cache', record.id, `loot:${CACHE_TIERS[record.tier].toLowerCase()}`, `loot-kind:${spec.kind}`] });
    if (spec.armor) item.physicalArmor = structuredClone(spec.armor);
    if (spec.source) item.arcaneSource = structuredClone(spec.source);
    item.provenance.push({ tick: world.now, eventId: ev.id, from: null, to: holder.id, how: 'finite orchestrator reserve' });
    return item;
  });
  ev.data.cofferId = coffer.id; ev.data.itemIds = items.map(i => i.id);
  record.openedAt = world.now; record.openEventId = ev.id; record.cofferId = coffer.id; record.itemIds = items.map(i => i.id);
  notice(world, s, holder.id, { kind: 'cache', title: `${CACHE_TIERS[record.tier]} cache unsealed`, text: pick(world.seed, `opened:${record.id}`, VOICE.cacheOpened(record.tier, items.length)), tier: record.tier, ref: record.id });
  archive(world, s, holder.id, { kind: 'cache', text: `Unsealed ${CACHE_TIERS[record.tier]} cache: ${items.map(i => i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name).join(', ')}.`, eventId: ev.id });
  return { result: 'opened', cofferId: coffer.id, itemIds: record.itemIds };
}

/** An emptied coffer has done its work; it leaves the physical world rather than littering it. */
export function withdrawEmptyCoffers(world: World, s: JohnSmithState): void {
  for (const c of s.caches) {
    if (!c.cofferId || c.withdrawnAt !== undefined) continue;
    const coffer = world.container(c.cofferId);
    if (!coffer || !coffer.pos || coffer.itemIds.length) continue;
    coffer.open = false; coffer.pos = null; coffer.placeId = null; c.withdrawnAt = world.now;
    world.emit('orchestrator', { significance: .1, data: { act: 'coffer_withdrawn', cacheId: c.id, cofferId: coffer.id },
      summary: `The emptied ${coffer.name} folded back into the Veil` });
    bump(s);
  }
}

// ---------------------------------------------------------------- appraisal: rarity is history

export const LEGEND_TIERS = ['Unremarkable', 'Storied', 'Renowned', 'Legendary'] as const;
/** A weapon's legend comes from what it has actually done, not from how it was made. */
export function itemLegend(s: JohnSmithState, itemId: string): { tier: number; score: number } {
  const d = s.items[itemId]; if (!d) return { tier: 0, score: 0 };
  const score = d.hits * .2 + d.downs + d.kills * 3 + Math.max(0, d.wielders.length - 1) * .5;
  return { tier: score >= 60 ? 3 : score >= 15 ? 2 : score >= 4 ? 1 : 0, score: Math.round(score * 10) / 10 };
}
