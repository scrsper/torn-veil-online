import type { Body, Creature, EntityId, EventId, Person, Vec3, WorldEvent } from '../core/types';
import type { World } from '../core/world';
import { isFood } from '../world/factory';
import { towerEncounter } from '../progression/towerEncounters';
import { CHAIN_STAGES, FIRST_HOUR_TOWER_FLOORS, type Objective } from './types';

/**
 * Objectives are read from the World, never stored beside it.
 *
 * Each rule looks at a standing simulated condition (a resident with no food, a settlement
 * without rations, a defensive animal near people, an uncleared Tower floor) and at canonical
 * evidence that the player resolved it (a gift, a kill, a floor-clear receipt). The same World
 * always yields the same list, in the same order. Completion receipts (`objective_completed`
 * events, see settle.ts) are the only quest state, and they live in ordinary history.
 */
export interface DeriveOptions {
  /** Metres from the town anchor within which residents count as the player's neighbours. */
  radius?: number;
  /** Metres from any neighbour within which a defensive animal is a threat to them. */
  threatRadius?: number;
}
const RESIDENT_RADIUS = 150;
const THREAT_RADIUS = 90;
const SILVER = { deliver: 2, gather: 1, hunt: 4, reach_floor: 2 } as const;

interface Ledger {
  /** Event index of the latest receipt for a key, and how many receipts it has. */
  receipts: Map<string, { count: number; last: number }>;
  gifts: { index: number; event: WorldEvent }[];
  kills: { index: number; event: WorldEvent; species: string }[];
  /** Hostile people the player killed, downed or made surrender. */
  defeats: { index: number; event: WorldEvent; personId: EntityId }[];
  clears: Map<number, WorldEvent>;
}
function ledger(w: World, playerId: EntityId): Ledger {
  const out: Ledger = { receipts: new Map(), gifts: [], kills: [], defeats: [], clears: new Map() };
  const hostile = (id: EntityId | undefined) => !!id && !!w.person(id)?.hostile;
  w.events.forEach((e, index) => {
    if (e.type === 'entity_surrendered' && e.target === playerId && hostile(e.actor)) { out.defeats.push({ index, event: e, personId: e.actor! }); return; }
    if (e.actor !== playerId) return;
    if ((e.type === 'kill' || (e.type === 'attack' && e.data.health <= 0)) && hostile(e.target)) out.defeats.push({ index, event: e, personId: e.target! });
    if (e.type === 'objective_completed') {
      const key = String(e.data.key), r = out.receipts.get(key) ?? { count: 0, last: -1 };
      out.receipts.set(key, { count: r.count + 1, last: index });
    } else if (e.type === 'gift' && e.data.itemType && isFood(e.data.itemType)) out.gifts.push({ index, event: e });
    else if (e.type === 'kill') {
      const victim = w.get<Creature>(e.target);
      if (victim?.kind === 'creature' && victim.wildlife) out.kills.push({ index, event: e, species: victim.species });
    } else if (e.type === 'tower_floor_cleared' && Number.isInteger(e.data.floor) && !out.clears.has(e.data.floor)) out.clears.set(e.data.floor, e);
  });
  return out;
}
const since = (l: Ledger, key: string) => l.receipts.get(key)?.last ?? -1;
const idFor = (l: Ledger, key: string) => `${key}#${l.receipts.get(key)?.count ?? 0}`;

function foodHeld(w: World, p: Person): number {
  let n = 0;
  for (const id of p.inventory) { const it = w.item(id); if (it && it.holderId === p.id && it.quantity > 0 && isFood(it.type)) n += it.quantity; }
  return n;
}
/** Where the player's neighbours are reckoned from: the Tower return address while climbing. */
function townAnchor(w: World, player: Person): Vec3 | null {
  const run = w.canonicalTower;
  if (run?.active && run.personId === player.id) return run.returnPos;
  return w.primaryBody(player.id)?.pos ?? null;
}
function neighbours(w: World, player: Person, anchor: Vec3, radius: number): { person: Person; body: Body }[] {
  return w.livingPersons().flatMap(p => {
    if (p.id === player.id || p.hostile || p.tags.includes('tower-warden')) return [];
    const body = w.primaryBody(p.id);
    return body && body.present && !body.dead && w.distance2d(body.pos, anchor) <= radius ? [{ person: p, body }] : [];
  }).sort((a, b) => a.person.id.localeCompare(b.person.id));
}
const hunger = (p: Person) => 1 - Math.max(0, Math.min(1, p.physiology.energy));
const pct = (n: number) => Math.round(n * 100);

/** Every objective the World currently gives rise to for this player, chain-ordered. */
export function deriveObjectives(w: World, playerId: EntityId, options: DeriveOptions = {}): Objective[] {
  const player = w.person(playerId); if (!player?.alive) return [];
  const anchor = townAnchor(w, player); if (!anchor) return [];
  const l = ledger(w, playerId), near = neighbours(w, player, anchor, options.radius ?? RESIDENT_RADIUS);
  const threatRadius = options.threatRadius ?? THREAT_RADIUS;
  const out: Objective[] = [...townObjectives(w, player, near, l), ...huntObjectives(w, player, near, anchor, l, threatRadius),
    ...outlawObjectives(w, player, near, anchor, l, threatRadius), ...towerObjectives(w, player, near, l)];
  out.sort((a, b) => CHAIN_STAGES.indexOf(a.stage) - CHAIN_STAGES.indexOf(b.stage) || a.id.localeCompare(b.id));
  const tracked = out.find(o => !o.complete); if (tracked) tracked.tracked = true;
  return out;
}

function townObjectives(w: World, player: Person, near: { person: Person; body: Body }[], l: Ledger): Objective[] {
  if (!near.length) return [];
  const out: Objective[] = [];
  const stock = near.map(n => ({ ...n, food: foodHeld(w, n.person) }));
  // NPC need: one neighbour without food, the hungriest first. Evidence is a food gift from the
  // player made while they had none (recorded on the gift itself, see physical/hand.ts).
  const needy = stock.filter(n => n.food === 0).sort((a, b) => hunger(b.person) - hunger(a.person) || a.person.id.localeCompare(b.person.id));
  const fed = stock.flatMap(n => {
    const key = `need:food:${n.person.id}`, evidence = l.gifts.filter(g => g.index > since(l, key) && g.event.target === n.person.id && g.event.data.recipientFoodBefore === 0);
    return evidence.length ? [{ ...n, key, evidence }] : [];
  });
  for (const n of fed) out.push(deliver(w, n.person, n.body, n.key, idFor(l, n.key), n.evidence.map(g => g.event.id)));
  const open = needy.find(n => !fed.some(f => f.person.id === n.person.id));
  if (open) { const key = `need:food:${open.person.id}`; out.push(deliver(w, open.person, open.body, key, idFor(l, key), [])); }

  // Resource shortage: fewer rations held across the neighbourhood than there are neighbours.
  // It is the player's to close only if a player gift contributed since the last receipt.
  const rations = stock.reduce((s, n) => s + n.food, 0), key = `shortage:food:${near[0].person.homeId ?? 'settlement'}`;
  const contributed = l.gifts.filter(g => g.index > since(l, key) && near.some(n => n.person.id === g.event.target)).map(g => g.event.id);
  const done = rations >= near.length && contributed.length > 0;
  if (rations < near.length || done) {
    const payer = [...near].sort((a, b) => b.person.wealth - a.person.wealth || a.person.id.localeCompare(b.person.id))[0].person;
    const place = near[0].person.homeId ? w.nameOf(near[0].person.homeId) : 'the settlement';
    out.push({ id: idFor(l, key), key, kind: 'gather', cause: 'resource_shortage', stage: 'town',
      title: `Provision ${place}`,
      detail: `${near.length} neighbours hold ${rations} ration${rations === 1 ? '' : 's'} between them. Gather food and hand it to those without.`,
      giverId: payer.id, giverName: payer.name, target: { resource: 'food' }, progress: { current: Math.min(rations, near.length), required: near.length },
      complete: done, evidence: done ? contributed : [], causes: [], facts: { neighbours: near.length, rations, place },
      reward: { silver: SILVER.gather, from: payer.id }, tracked: false });
  }
  return out;
}
function deliver(w: World, p: Person, body: Body, key: string, id: string, evidence: EventId[]): Objective {
  const h = hunger(p);
  return { id, key, kind: 'deliver', cause: 'npc_need', stage: 'town',
    title: `Bring food to ${p.name}`,
    detail: `${p.name} carries no food${h > .25 ? ` and is ${pct(h)}% hungry` : ''}. Hand them something to eat.`,
    giverId: p.id, giverName: p.name, target: { personId: p.id, bodyIds: [body.id], pos: { ...body.pos } },
    progress: { current: evidence.length ? 1 : 0, required: 1 }, complete: evidence.length > 0, evidence, causes: [],
    facts: { hunger: pct(h), food: 0, occupation: p.occupation }, reward: { silver: SILVER.deliver, from: p.id }, tracked: false };
}

function huntObjectives(w: World, player: Person, near: { person: Person; body: Body }[], anchor: Vec3, l: Ledger, radius: number): Objective[] {
  const species = w.ecology?.species; if (!species) return [];
  const people = [...near.map(n => n.body), w.primaryBody(player.id)].filter((b): b is Body => !!b);
  // A defensive animal is a threat when it is close to people, or is already menacing or was provoked.
  const threats = w.creatures().filter(c => c.wildlife && species[c.species]?.defense).flatMap(c => c.bodies.flatMap(id => {
    const b = w.body(id), state = c.wildlife!.embodiments[id];
    if (!b || !b.present || b.dead || b.health <= 0 || !state) return [];
    const nearest = Math.min(...people.map(p => w.distance2d(p.pos, b.pos)), w.distance2d(anchor, b.pos));
    const menacing = !!state.defense && ['warn', 'charge', 'strike'].includes(state.defense.mode);
    const provoked = !!state.provokedBy && state.provokedBy.until > w.physicalTime;
    return nearest <= radius || menacing || provoked ? [{ creature: c, body: b, nearest, menacing, provoked }] : [];
  })).sort((a, b) => a.creature.species.localeCompare(b.creature.species) || a.nearest - b.nearest || a.body.id.localeCompare(b.body.id));
  const bySpecies = new Map<string, typeof threats>();
  for (const t of threats) bySpecies.set(t.creature.species, [...(bySpecies.get(t.creature.species) ?? []), t]);
  // Kills of a defensive species close the objective even if the last animal is gone.
  for (const k of l.kills) if (species[k.species]?.defense && !bySpecies.has(k.species)) bySpecies.set(k.species, []);
  const out: Objective[] = [];
  for (const [id, group] of bySpecies) {
    const key = `threat:${id}`, evidence = l.kills.filter(k => k.species === id && k.index > since(l, key)).map(k => k.event.id);
    if (!group.length && !evidence.length) continue;
    const closest = group[0], spec = species[id];
    // The neighbour nearest the animals is the one who asks.
    const giver = closest ? [...near].sort((a, b) => w.distance2d(a.body.pos, closest.body.pos) - w.distance2d(b.body.pos, closest.body.pos) || a.person.id.localeCompare(b.person.id))[0]?.person : near[0]?.person;
    const menacing = group.filter(g => g.menacing).length, provoked = group.filter(g => g.provoked).length;
    const attacks = w.events.filter(e => e.type === 'attack' && e.data.attackerBodyId && group.some(g => g.body.id === e.data.attackerBodyId) && near.some(n => n.person.id === e.target)).map(e => e.id);
    out.push({ id: idFor(l, key), key, kind: 'hunt', cause: 'wildlife_threat', stage: 'forest',
      title: `Deal with the ${spec.name}${group.length > 1 ? 's' : ''}`,
      detail: group.length
        ? `${group.length} ${spec.name}${group.length > 1 ? 's' : ''} within ${Math.round(closest.nearest)} m of people${menacing ? `, ${menacing} menacing` : ''}${provoked ? `, ${provoked} provoked` : ''}. ${giver ? `${giver.name} wants it dealt with.` : ''}`.trim()
        : `The ${spec.name} has been dealt with.`,
      giverId: giver?.id ?? null, giverName: giver?.name ?? null,
      target: { species: id, bodyIds: group.slice(0, 3).map(g => g.body.id), pos: closest ? { ...closest.body.pos } : null },
      progress: { current: Math.min(1, evidence.length), required: 1 }, complete: evidence.length > 0, evidence, causes: attacks.slice(-4),
      facts: { animals: group.length, nearestMetres: closest ? Math.round(closest.nearest) : -1, menacing, provoked, attacks: attacks.length },
      reward: { silver: SILVER.hunt, from: giver?.id ?? null }, tracked: false });
  }
  return out;
}

function outlawObjectives(w: World, player: Person, near: { person: Person; body: Body }[], anchor: Vec3, l: Ledger, radius: number): Objective[] {
  if (player.hostile) return [];
  const people = [...near.map(n => n.body), w.primaryBody(player.id)].filter((b): b is Body => !!b);
  const outlaws = w.livingPersons().flatMap(p => {
    const b = w.primaryBody(p.id);
    if (!p.hostile || !b || !b.present || b.dead || b.pose === 'downed' || p.surrender || p.custody?.active) return [];
    const nearest = Math.min(...people.map(q => w.distance2d(q.pos, b.pos)), w.distance2d(anchor, b.pos));
    return nearest <= radius ? [{ person: p, body: b, nearest }] : [];
  }).sort((a, b) => a.nearest - b.nearest || a.person.id.localeCompare(b.person.id));
  const key = 'threat:outlaws', evidence = l.defeats.filter(d => d.index > since(l, key));
  if (!outlaws.length && !evidence.length) return [];
  const closest = outlaws[0];
  const giver = closest ? [...near].sort((a, b) => w.distance2d(a.body.pos, closest.body.pos) - w.distance2d(b.body.pos, closest.body.pos) || a.person.id.localeCompare(b.person.id))[0]?.person : near[0]?.person;
  const robberies = w.events.filter(e => (e.type === 'theft' || e.type === 'attack') && outlaws.some(o => o.person.id === e.actor) && e.target !== undefined && !w.person(e.target)?.hostile).map(e => e.id);
  return [{ id: idFor(l, key), key, kind: 'hunt', cause: 'outlaw_threat', stage: 'forest',
    title: closest ? `Stop ${closest.person.name}` : 'The road is clear',
    detail: closest ? `${closest.person.name} (${closest.person.occupation}) is armed and ${Math.round(closest.nearest)} m from people${robberies.length ? `, with ${robberies.length} attacks or thefts to their name` : ''}. Drive them off, make them yield, or put them down.`
      : 'The outlaw troubling the path has been dealt with.',
    giverId: giver?.id ?? null, giverName: giver?.name ?? null,
    target: { personId: closest?.person.id, bodyIds: outlaws.slice(0, 3).map(o => o.body.id), pos: closest ? { ...closest.body.pos } : null },
    progress: { current: Math.min(1, evidence.length), required: 1 }, complete: evidence.length > 0, evidence: evidence.map(d => d.event.id), causes: robberies.slice(-4),
    facts: { outlaws: outlaws.length, nearestMetres: closest ? Math.round(closest.nearest) : -1, offences: robberies.length },
    reward: { silver: SILVER.hunt, from: giver?.id ?? null }, tracked: false }];
}

function towerObjectives(w: World, player: Person, near: { person: Person; body: Body }[], l: Ledger): Objective[] {
  // Only a realm World has the Tower of Chrysanthus; a run belonging to someone else is not the player's.
  if (!w.realmSpec || (w.canonicalTower && w.canonicalTower.personId !== player.id)) return [];
  let highest = 0; while (l.clears.has(highest + 1)) highest++;
  const out: Objective[] = [];
  // Floors cleared without a receipt yet settle in order; then the next uncleared floor is the rumour.
  for (let floor = 1; floor <= FIRST_HOUR_TOWER_FLOORS; floor++) {
    const key = `tower:floor:${floor}`, receipted = l.receipts.has(key), clear = l.clears.get(floor);
    if (receipted || (!clear && floor !== highest + 1)) continue;
    const teller = near[(floor - 1) % Math.max(1, near.length)]?.person, enc = towerEncounter(floor), run = w.canonicalTower;
    const reached = run?.floor ?? 0;
    out.push({ id: idFor(l, key), key, kind: 'reach_floor', cause: 'tower_rumor', stage: 'tower',
      title: `Clear Tower floor ${floor}`,
      detail: clear ? `Floor ${floor} of the Tower of Chrysanthus is cleared.`
        : `${teller ? `${teller.name} says` : 'Word is'} ${enc.enemies} wardens hold floor ${floor} of the Tower of Chrysanthus${reached >= floor ? ', and you stand on it' : ''}.`,
      giverId: teller?.id ?? null, giverName: teller?.name ?? null, target: { floor },
      progress: { current: clear ? 1 : 0, required: 1 }, complete: !!clear, evidence: clear ? [clear.id] : [], causes: run ? [run.openedEventId] : [],
      facts: { floor, wardens: enc.enemies, highestCleared: highest, currentFloor: reached },
      reward: { silver: SILVER.reach_floor, from: teller?.id ?? null }, tracked: false });
    if (!clear) break;
  }
  return out;
}
