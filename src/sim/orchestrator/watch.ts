import type { EntityId, Person, WorldEvent } from '../core/types';
import type { World } from '../core/world';
import { ONTOLOGICAL_STAGES } from '../core/stages';
import { knownName } from '../mind/people';
import { ARCANE_DEFINITIONS } from '../physical/arcana/definitions';
import { RealmGrid } from '../world/realms/grid';
import { portalPoint, realmAt, REALMS, REALM_CHUNK, type RealmId } from '../world/realms/layout';
import { interiorSlot } from '../world/interiors/layout';
import { ATTENTION_THRESHOLDS, ATTENTION_TIERS, type JohnSmithState } from './types';
import { FEATS } from './feats';
import { archive, bump, eventSeq, holderRecord, interfaceHolders, isInterfaceHolder, ledgerOf, mark, MAX_ATTENTION, MAX_ITEM_DEEDS, MAX_LANDMARKS, NEVER, notice, stalest } from './state';
import { grantCache } from './reserve';
import { pick, VOICE } from './voice';

/** Places whose existence is public: a traveller can see them and walk in. Homes, farms and
 * worksites are somebody's; John Smith does not send people into them. */
const LANDMARK_TYPES = new Set(['tavern', 'smithy', 'bakery', 'store', 'chapel', 'guardhouse', 'square', 'shrine', 'graveyard', 'bridge', 'gate', 'mill']);
const SEEN_RADIUS = 36;
const PORTAL_SEEN_RADIUS = 30;

export function attentionTierFor(significance: number): number {
  let tier = 0;
  for (let i = 1; i < ATTENTION_THRESHOLDS.length; i++) if (significance >= ATTENTION_THRESHOLDS[i]) tier = i;
  return tier;
}

/** Read every canonical event once, in id order, since the cursor. */
export function readNewEvents(world: World, s: JohnSmithState): Set<EntityId> {
  const touched = new Set<EntityId>(), events = world.events, r: Reading = { world, s, now: world.now, touched };
  let i = events.length;
  while (i > 0 && eventSeq(events[i - 1].id) > s.cursor) i--;
  for (; i < events.length; i++) {
    const e = events[i], seq = eventSeq(e.id);
    if (seq <= s.cursor) continue;
    s.cursor = seq;
    // John Smith's own acts are not deeds of anyone in the world.
    if (e.type !== 'orchestrator') readEvent(r, e);
  }
  return touched;
}

/** One read of new history: the record, the canonical time and who it touched. */
interface Reading { world: World; s: JohnSmithState; now: number; touched: Set<EntityId> }
function inc(r: Reading, id: EntityId | undefined, key: string, n = 1): void {
  if (!id || !(n > 0)) return; const l = ledgerOf(r.s, id, r.now);
  l.counts[key] = (l.counts[key] ?? 0) + n; l.lastAt = r.now; r.touched.add(id);
}
function max(r: Reading, id: EntityId | undefined, key: string, v: number): void {
  if (!id || !Number.isFinite(v)) return; const l = ledgerOf(r.s, id, r.now);
  if ((l.counts[key] ?? -Infinity) < v) { l.counts[key] = v; l.lastAt = r.now; r.touched.add(id); }
}

function readEvent(r: Reading, e: WorldEvent): void {
  const { world, s, now } = r;
  const actor = e.actor, target = e.target;
  switch (e.type) {
    case 'attack': {
      // People report `damage`; a creature's blow reports its physical `impact` (ecology/defense.ts).
      const damage = Number(e.data.damage ?? e.data.impact) || 0, down = typeof e.data.health === 'number' && e.data.health <= 0;
      if (damage <= 0) break;
      inc(r, actor, 'blows'); inc(r, actor, 'damageDealt', damage);
      if (e.data.arcaneEventId) inc(r, actor, 'arcaneHits');
      if (down) inc(r, actor, 'downs');
      if (target) { inc(r, target, 'blowsTaken'); const floor = s.ledgers[target]?.floor; if (floor) floor.taken += damage; }
      const weaponId = e.data.combat?.weaponId;
      if (typeof weaponId === 'string' && actor) itemDeed(world, s, weaponId, actor, d => { d.hits++; d.damage += damage; if (down) d.downs++; });
      break;
    }
    case 'kill': {
      inc(r, actor, 'kills');
      if (world.get(target)?.kind === 'creature') inc(r, actor, 'beastKills');
      const blow = e.causes.map(id => world.event(id)).find(c => c?.type === 'attack');
      const weaponId = blow?.data.combat?.weaponId;
      if (typeof weaponId === 'string' && actor) itemDeed(world, s, weaponId, actor, d => { d.kills++; });
      break;
    }
    // The actor is the one knocked down; `data.by` is whoever did it.
    case 'downed': if (typeof e.data.by === 'string') inc(r, e.data.by, 'downs'); break;
    case 'tower_entered': inc(r, actor, 'towerEntries'); break;
    case 'tower_floor_opened':
      if (actor) ledgerOf(s, actor, now).floor = { runId: String(e.data.runId), floor: Number(e.data.floor), taken: 0 };
      break;
    case 'tower_floor_cleared': {
      if (!actor) break;
      inc(r, actor, 'floorsCleared'); max(r, actor, 'highestFloor', Number(e.data.floor));
      const l = ledgerOf(s, actor, now), body = world.primaryBody(actor);
      if (l.floor && l.floor.runId === e.data.runId && l.floor.floor === e.data.floor && l.floor.taken === 0) inc(r, actor, 'flawlessFloors');
      if (body && body.health > 0 && body.health / body.maxHealth < .15) inc(r, actor, 'nearDeathClears');
      delete l.floor;
      break;
    }
    case 'tower_fallen': inc(r, actor, 'falls'); break;
    case 'realm_crossed': inc(r, actor, 'crossings'); break;
    case 'arcane_learned': inc(r, actor, 'sourcesLearned'); break;
    case 'arcane_cast': inc(r, actor, 'casts'); break;
    case 'ontological_advancement': max(r, actor, 'stage', ONTOLOGICAL_STAGES.indexOf(e.data.to)); break;
    case 'returned_item': inc(r, actor, 'returned'); break;
    case 'gift': inc(r, actor, 'gifts'); break;
    case 'heal': inc(r, actor, 'heals'); break;
    case 'theft': inc(r, actor, 'thefts'); break;
    case 'entity_surrendered': inc(r, actor, 'surrenders'); break;
    case 'entity_arrested': inc(r, target, 'arrested'); break;
    case 'item_crafted': inc(r, actor, 'crafted'); break;
    case 'debt_paid': inc(r, actor, 'debtsPaid'); break;
    case 'container_transfer': {
      const container = world.container(target);
      if (e.data.direction === 'out' && container?.tags.includes('tower-award')) inc(r, actor, 'awardsClaimed');
      if (container?.tags.includes('veil-cache')) bump(s);
      break;
    }
  }
  if (actor && isInterfaceHolder(world, actor)) {
    const record = holderRecord(s, actor);
    if (e.type === 'realm_crossed') mark(record, 'realm_crossed', e.id);
    if (e.type === 'kill' && e.target) mark(record, `kill:${e.target}`, e.id);
    if ((e.type === 'returned_item' || e.type === 'gift') && e.item) mark(record, `${e.type === 'gift' ? 'gift' : 'returned'}:${e.item}`, e.id);
    const text = describeOwnDeed(world, world.person(actor)!, e);
    if (text) archive(world, s, actor, { kind: e.type, text, eventId: e.id });
  }
}

function itemDeed(world: World, s: JohnSmithState, itemId: string, wielder: EntityId, apply: (d: JohnSmithState['items'][string]) => void): void {
  if (!world.item(itemId)) return;
  let d = s.items[itemId];
  if (!d) {
    if (Object.keys(s.items).length >= MAX_ITEM_DEEDS) delete s.items[stalest(s.items)!];
    d = s.items[itemId] = { hits: 0, downs: 0, kills: 0, damage: 0, wielders: [], firstAt: world.now, lastAt: world.now };
  }
  apply(d); d.lastAt = world.now;
  if (!d.wielders.includes(wielder)) { d.wielders.push(wielder); if (d.wielders.length > 16) d.wielders.shift(); }
}

/** One's own deeds are self-knowledge. Names of others go through what the holder knows. */
export function describeOwnDeed(world: World, holder: Person, e: WorldEvent): string | null {
  const who = (id?: string) => {
    if (!id) return 'someone';
    const p = world.person(id);
    if (p) return p.tags.includes('tower-warden') ? 'a trial warden' : knownName(holder, id);
    return `the ${world.nameOf(id)}`;
  };
  const item = (id?: string) => world.item(id)?.name ?? 'something';
  switch (e.type) {
    case 'attack': return typeof e.data.health === 'number' && e.data.health <= 0 && e.target ? `Put ${who(e.target)} on the ground.` : null;
    case 'kill': return `Ended ${who(e.target)}.`;
    case 'downed': return `Knocked down by ${typeof e.data.by === 'string' ? who(e.data.by) : 'something'}.`;
    case 'tower_entered': return e.data.resumed ? 'Returned to the Tower and resumed the climb.' : 'Entered the Tower of Chrysanthus.';
    case 'tower_floor_cleared': { const t = Math.max(0, Math.round(Number(e.data.seconds) || 0)); return `Cleared Tower floor ${e.data.floor} in ${Math.floor(t / 60)}m ${t % 60}s.`; }
    case 'tower_fallen': return `Fell on Tower floor ${e.data.floor}.`;
    case 'tower_returned': return `Came back down from floor ${e.data.floor}.`;
    case 'realm_crossed': return `Crossed the Veil into ${REALMS[e.data.toRealm as RealmId]?.name ?? 'another realm'}.`;
    case 'arcane_learned': return `Learned ${ARCANE_DEFINITIONS.get(e.data.abilityId)?.name ?? 'a form'} from ${item(e.item)}.`;
    case 'ontological_advancement': return `Advanced from ${e.data.from} to ${e.data.to}.`;
    case 'returned_item': return `Returned ${item(e.item)} to ${who(e.target)}.`;
    case 'gift': return `Gave ${item(e.item)} to ${who(e.target)}.`;
    case 'heal': return `Tended ${who(e.target)}'s wounds.`;
    case 'theft': return e.item ? `Took ${item(e.item)} from ${who(e.target)}.` : `Robbed ${who(e.target)}.`;
    case 'item_crafted': return `Made ${item(e.item)}.`;
    case 'entity_surrendered': return `Yielded to ${who(e.target)}.`;
    case 'debt_paid': return `Settled a debt with ${who(e.target)}.`;
  }
  return null;
}

// ---------------------------------------------------------------- feats

export function evaluateFeats(world: World, s: JohnSmithState, id: EntityId): void {
  const l = s.ledgers[id]; if (!l) return;
  const holder = isInterfaceHolder(world, id) ? world.person(id)! : null;
  for (const feat of FEATS) {
    if (l.feats[feat.id] || (l.counts[feat.counter] ?? 0) < feat.at) continue;
    const record = l.feats[feat.id] = { at: world.now, tier: feat.tier } as JohnSmithState['ledgers'][string]['feats'][string];
    if (!holder) continue;
    // A recognition for an interface holder is delivered: noticed, archived and, while the
    // reserve lasts, rewarded. Anyone else's is kept in the archive only.
    notice(world, s, id, { kind: 'feat', title: feat.name, text: feat.line, tier: feat.tier, ref: feat.id });
    archive(world, s, id, { kind: 'feat', text: `Recognized: ${feat.name}.` });
    if (!feat.reward) continue;
    const cache = grantCache(world, s, holder, feat.tier, `feat:${feat.id}`, { featId: feat.id });
    record.cacheId = cache?.id ?? null; record.eventId = cache?.grantEventId;
  }
}

// ---------------------------------------------------------------- attention and renown

export function readAttention(world: World, s: JohnSmithState): void {
  const silent = s.attentionAt === NEVER, holders = interfaceHolders(world), now = world.now;
  const raise = (id: EntityId, tier: number, significance: number) => {
    const rec = s.attention[id];
    if (rec && rec.tier >= tier) { rec.significance = significance; return; }
    const before = rec?.tier ?? 0;
    s.attention[id] = { tier, since: now, significance };
    if (silent || tier <= before) return;
    bump(s);
    for (const h of holders) {
      if (h.id === id) {
        if (tier >= 2) notice(world, s, h.id, { kind: 'attention', title: `Attention: ${ATTENTION_TIERS[tier]}`, text: pick(world.seed, `attention:${id}:${tier}`, VOICE.attentionSelf(tier)), tier });
        const l = ledgerOf(s, id, now); if ((l.counts.attention ?? 0) < tier) { l.counts.attention = tier; evaluateFeats(world, s, id); }
      } else if (tier >= 2) {
        const name = nameIfKnown(world, h, id);
        if (name) notice(world, s, h.id, { kind: 'attention', title: `Attention: ${name}`, text: pick(world.seed, `attention:${id}:${tier}:${h.id}`, VOICE.attentionOther(name, tier)), tier });
      }
    }
  };
  for (const [id, significance] of world.historicalSignificance) {
    if (significance < ATTENTION_THRESHOLDS[1] && !s.attention[id]) continue;
    const kind = world.get(id)?.kind; if (kind !== 'person' && kind !== 'creature') continue;
    raise(id, Math.max(attentionTierFor(significance), isInterfaceHolder(world, id) ? 1 : 0), significance);
  }
  // The interface is itself attention: a holder is Noted before they have done anything.
  for (const h of holders) if (!s.attention[h.id]) raise(h.id, 1, world.historicalSignificance.get(h.id) ?? 0);
  const ids = Object.keys(s.attention);
  if (ids.length > MAX_ATTENTION) {
    const drop = ids.filter(id => !isInterfaceHolder(world, id)).sort((a, b) => s.attention[a].significance - s.attention[b].significance || (a < b ? -1 : 1));
    for (const id of drop.slice(0, ids.length - MAX_ATTENTION)) delete s.attention[id];
  }
  s.attentionAt = world.physicalTime;
}

/** The name an interface holder may see for a watched entity, or null when they could not. */
export function nameIfKnown(world: World, holder: Person, id: EntityId): string | null {
  const entity = world.get(id);
  if (entity?.kind === 'person') { const name = knownName(holder, id); return name === 'an unfamiliar person' ? null : name; }
  if (entity?.kind === 'creature') return holder.knowledge[`loc:${id}`] ? `the ${entity.name}` : null;
  return null;
}

/** How many living minds besides the holder carry a belief about something the holder did. */
export function readRenown(world: World, s: JohnSmithState): void {
  for (const h of interfaceHolders(world)) {
    let count = 0;
    for (const p of world.livingPersons()) {
      if (p.id === h.id) continue;
      for (const k of Object.values(p.knowledge)) if (k.kind === 'event' && k.claim.actor === h.id) { count++; break; }
    }
    const record = holderRecord(s, h.id);
    if (record.renown !== count) { record.renown = count; bump(s); }
    const l = ledgerOf(s, h.id, world.now);
    if ((l.counts.renown ?? 0) < count) { l.counts.renown = count; evaluateFeats(world, s, h.id); }
  }
  s.renownAt = world.physicalTime;
}

// ---------------------------------------------------------------- the holder's own travels

/** Landmarks and wards are the holder's own experience: where their body has been. */
export function readTravels(world: World, s: JohnSmithState, holder: Person): void {
  const body = world.primaryBody(holder.id); if (!body || !body.present || body.dead) return;
  const record = holderRecord(s, holder.id);
  const add = (list: string[], key: string) => { if (list.includes(key) || list.length >= MAX_LANDMARKS) return false; list.push(key); bump(s); return true; };
  const here = world.placeAt(body.pos);
  for (const place of world.nearbyPlaces(body.pos, SEEN_RADIUS + 20)) {
    if (!LANDMARK_TYPES.has(place.type) || interiorSlot(place.inside.x, place.inside.z) !== null) continue;
    if (Math.hypot(place.inside.x - body.pos.x, place.inside.z - body.pos.z) <= SEEN_RADIUS || here?.id === place.id) add(record.seen, place.id);
  }
  if (here && LANDMARK_TYPES.has(here.type) && interiorSlot(here.inside.x, here.inside.z) === null && add(record.entered, here.id)) {
    add(record.seen, here.id);
    const l = ledgerOf(s, holder.id, world.now); l.counts.landmarks = record.entered.length; evaluateFeats(world, s, holder.id);
  }
  const realm = world.realmSpec ? realmAt(body.pos.x, body.pos.z) : null;
  if (!realm || !(world.grid instanceof RealmGrid)) return;
  if (Math.hypot(body.pos.x - portalPoint(realm).x, body.pos.z - portalPoint(realm).z) <= PORTAL_SEEN_RADIUS) add(record.seen, `portal:${realm}`);
  const chunk = world.grid.chunk(realm, Math.floor((body.pos.x - REALMS[realm].offset) / REALM_CHUNK), Math.floor(body.pos.z / REALM_CHUNK));
  if (add(record.wards, `${realm}:${chunk.district}`)) {
    const per = (Object.keys(REALMS) as RealmId[]).map(r => record.wards.filter(w => w.startsWith(`${r}:`)).length);
    const l = ledgerOf(s, holder.id, world.now);
    l.counts.wardsBest = Math.max(...per); l.counts.realmsWalked = per.filter(n => n >= REALMS.aether.districts.length).length;
    evaluateFeats(world, s, holder.id);
  }
}
