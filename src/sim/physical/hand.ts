import type { Body, Person, ResourceNode, Vec3 } from '../core/types';
import type { Simulation } from '../mind/agent';
import { actionsForCarriedItem, actionsForWorldItem, SELLER_REACH } from '../core/interaction';
import { B } from './blocks';
import { waterSourceAtHand } from '../logistics/participation';

/** Reach for an external hand, in canonical metres (the browser's item ray has this range). */
export const ITEM_REACH = 2.4;
export interface HandInteraction { id: string; kind: string; label: string; slot: 'nearby' | 'consume' | 'drop'; }
function canAct(sim: Simulation, p: Person): boolean {
  const b = sim.world.primaryBody(p.id);
  return !!b && b.present && !b.dead && p.alive && b.pose !== 'downed' && b.subduedUntil <= sim.world.physicalTime && !p.surrender && !p.custody?.active;
}
function reachable(sim: Simulation, p: Person, pos: Vec3, range: number, height: number): boolean {
  const b = sim.world.primaryBody(p.id);
  return !!b && Math.hypot(b.pos.x - pos.x, b.pos.y - pos.y, b.pos.z - pos.z) <= range
    && sim.world.grid.lineOfPassage({ ...b.pos, y: b.pos.y + 1.2 }, { ...pos, y: pos.y + height }, range + 1.2);
}
/** Display items store the counter's floor coordinate; reach above that supporting voxel. */
function itemHeight(sim: Simulation, pos: Vec3): number {
  const block = sim.world.grid.get(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
  return block === B.Counter || block === B.Table ? 1.15 : 0.15;
}
/** The old Unreal interact intent aimed 1.5 m in front of the canonical body. Keep that same
 * target derivation so resource gathering remains a presentation-neutral hand interaction. */
function frontInteractionPos(body: Body): Vec3 {
  return { x: body.pos.x - Math.sin(body.yaw) * 1.5, y: body.pos.y, z: body.pos.z - Math.cos(body.yaw) * 1.5 };
}
function resourceAtHand(sim: Simulation, p: Person): ResourceNode | undefined {
  const body = sim.world.primaryBody(p.id);
  if (!body) return undefined;
  const pos = frontInteractionPos(body);
  const cx = Math.floor(pos.x), cy = Math.floor(pos.y), cz = Math.floor(pos.z);
  return sim.world.resourceNodes
    .filter(n => n.state === 'available' && n.remaining > 0
      && reachable(sim, p, n.pos, ITEM_REACH, 0.15)
      && (n.blocks.some(b => b.x === cx && b.z === cz && Math.abs(b.y - cy) <= 5)
        || Math.hypot(n.pos.x - pos.x, n.pos.z - pos.z) < 2.5))
    .sort((a, b) => Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z) - Math.hypot(b.pos.x - pos.x, b.pos.z - pos.z) || a.id.localeCompare(b.id))[0];
}
function dropPositionAtHand(sim: Simulation, p: Person): Vec3 | undefined {
  const body = sim.world.primaryBody(p.id);
  if (!body) return undefined;
  const pos = frontInteractionPos(body);
  const floor = sim.world.nav.floorY(Math.floor(pos.x), Math.floor(pos.z));
  if (floor < 0) return undefined;
  const drop = { ...pos, y: floor };
  return reachable(sim, p, drop, ITEM_REACH, 0.15) ? drop : undefined;
}
/** A projection of existing action derivation, not a client-owned menu. Recomputed on intent. */
export function handInteractions(sim: Simulation, p: Person): HandInteraction[] {
  if (!canAct(sim, p)) return [];
  const w = sim.world, b = w.primaryBody(p.id)!;
  const out: HandInteraction[] = [];
  const nearby = w.items().filter(it => it.quantity > 0 && !it.holderId && it.pos && reachable(sim, p, it.pos, ITEM_REACH, itemHeight(sim, it.pos)))
    .sort((a, c) => Math.hypot(a.pos!.x - b.pos.x, a.pos!.z - b.pos.z) - Math.hypot(c.pos!.x - b.pos.x, c.pos!.z - b.pos.z) || a.id.localeCompare(c.id));
  for (const it of nearby) {
    const action = actionsForWorldItem(w, p, it).find(a => a.kind === 'buy' || a.kind === 'take' || a.kind === 'steal' || a.kind === 'recover');
    if (!action) continue;
    if (action.kind === 'buy') {
      const seller = action.ownerId ? w.primaryBody(action.ownerId) : null;
      if (seller && reachable(sim, p, seller.pos, SELLER_REACH, 1.2)) out.push({ id: `buy:${it.id}`, kind: action.kind, label: action.label, slot: 'nearby' });
    } else out.push({ id: `${action.kind}:${it.id}`, kind: action.kind, label: action.label, slot: 'nearby' });
  }
  const water = waterSourceAtHand(w, b.pos);
  if (water) out.push({ id: `drink:${water.id}`, kind: 'drink', label: `Drink — ${water.name}`, slot: 'nearby' });
  const resource = resourceAtHand(sim, p);
  if (resource) out.push({ id: `gather:${resource.id}`, kind: 'gather', label: `Gather ${resource.yield}`, slot: 'nearby' });
  const carried = p.inventory[p.inventory.length - 1];
  const carriedItem = carried ? w.item(carried) : undefined;
  const drop = carriedItem && carriedItem.holderId === p.id && carriedItem.quantity > 0
    ? actionsForCarriedItem(w, p, carriedItem).find(a => a.kind === 'drop') : undefined;
  if (carriedItem && drop && dropPositionAtHand(sim, p)) out.push({ id: `drop:${carriedItem.id}`, kind: drop.kind, label: drop.label, slot: 'drop' });
  for (const id of p.inventory) {
    const it = w.item(id);
    if (!it || it.holderId !== p.id || it.quantity <= 0) continue;
    const action = actionsForCarriedItem(w, p, it).find(a => a.kind === 'eat' || a.kind === 'drink');
    if (action) out.push({ id: `consume:${it.id}`, kind: action.kind, label: action.label, slot: 'consume' });
  }
  return out;
}
export function performHandInteraction(sim: Simulation, p: Person, id: unknown): string {
  if (typeof id !== 'string' || !/^(buy|take|steal|recover|consume|drink|gather|drop):.+$/.test(id)) return 'invalid_interaction';
  if (!canAct(sim, p)) return 'incapacitated';
  const split = id.indexOf(':'), kind = id.slice(0, split), target = id.slice(split + 1);
  if (kind === 'gather') {
    const resource = resourceAtHand(sim, p);
    if (!resource || resource.id !== target) return 'interaction_unavailable';
    const body = sim.world.primaryBody(p.id)!;
    return sim.extractResourceAt(p, frontInteractionPos(body)) > 0 ? 'accepted' : 'unavailable_resource';
  }
  const w = sim.world, it = w.item(target);
  if (kind === 'drop') {
    if (!it || it.holderId !== p.id || !p.inventory.includes(it.id) || it.quantity <= 0) return 'not_carried';
    if (!handInteractions(sim, p).some(a => a.id === id)) return 'interaction_unavailable';
    if (!actionsForCarriedItem(w, p, it).some(a => a.kind === 'drop')) return 'interaction_unavailable';
    const pos = dropPositionAtHand(sim, p);
    if (!pos) return 'out_of_reach';
    sim.dropItem(p, it, pos);
    return 'accepted';
  }
  if (kind !== 'drink' && (!it || it.quantity <= 0)) return 'unavailable_stock';
  if (kind === 'consume' && (it!.holderId !== p.id || !p.inventory.includes(target))) return 'not_carried';
  if (!handInteractions(sim, p).some(a => a.id === id)) return 'interaction_unavailable';
  if (kind === 'drink') return sim.drinkHere(p) ? 'accepted' : 'out_of_reach';
  if (kind === 'consume') return sim.consumeItem(p, it!) ? 'accepted' : 'not_consumable';
  if (kind === 'take' || kind === 'steal' || kind === 'recover') {
    const action = actionsForWorldItem(w, p, it!).find(a => a.kind === kind);
    if (!action) return 'interaction_unavailable';
    sim.takeItem(p, it!, kind === 'steal' ? 'theft' : kind === 'recover' ? 'recovered' : 'pickup');
    return 'accepted';
  }
  const action = actionsForWorldItem(w, p, it!).find(a => a.kind === 'buy')!;
  const seller = w.person(action.ownerId!)!;
  const result = sim.buyUnits(p, seller, it!, 1);
  return result.units === 1 ? 'accepted' : result.refused ?? (p.wealth < action.price! ? 'insufficient_funds' : 'unavailable_stock');
}
