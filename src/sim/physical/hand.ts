import type { Body, Container, Creature, Person, ResourceNode, Vec3 } from '../core/types';
import type { World } from '../core/world';
import { makeItem } from '../world/factory';
import { recordCapabilityPractice } from '../core/capability';
import type { Simulation } from '../mind/agent';
import { actionsForCarriedItem, actionsForWorldItem, SELLER_REACH } from '../core/interaction';
import { B } from './blocks';
import { waterSourceAtHand, naturalWaterAtHand } from '../logistics/participation';
import { containerAccessAllowed, setContainerOpen, takeItemFromContainer, transferItemToContainer } from '../core/container';

/** Reach for an external hand, in canonical metres (the browser's item ray has this range). */
export const ITEM_REACH = 2.4;
export interface HandInteraction { id: string; kind: string; label: string; slot: 'nearby' | 'consume' | 'drop'; target?: { id: string; kind: string; pos: Vec3 }; }
export interface OpenContainerProjection { id: string; name: string; capacity: number; used: number; items: { id: string; name: string; type: string; quantity: number }[]; }
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
    .filter(n => n.kind !== 'forage' && n.kind !== 'surface_water' && n.state === 'available' && n.remaining > 0
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
function reachableContainers(sim: Simulation, p: Person): Container[] {
  const body = sim.world.primaryBody(p.id); if (!body) return [];
  return sim.world.containers().filter(c => c.pos && reachable(sim, p, c.pos, ITEM_REACH, 0.7))
    .sort((a, b) => Math.hypot(a.pos!.x - body.pos.x, a.pos!.z - body.pos.z) - Math.hypot(b.pos!.x - body.pos.x, b.pos!.z - body.pos.z) || a.id.localeCompare(b.id));
}
/** Current observable contents of the nearest open physical container. This is a projection,
 * not a second inventory; every row is rebuilt from canonical container/item state. */
export function openContainerProjection(sim: Simulation, p: Person): OpenContainerProjection | null {
  if (!canAct(sim, p)) return null;
  const container = reachableContainers(sim, p).find(c => c.open); if (!container) return null;
  const items = container.itemIds.flatMap(id => { const i = sim.world.item(id); return i && i.containerId === container.id && i.quantity > 0
    ? [{ id: i.id, name: i.name, type: i.type, quantity: i.quantity }] : []; });
  return { id: container.id, name: container.name, capacity: container.capacity,
    used: items.reduce((sum, item) => sum + item.quantity, 0), items };
}
/** A projection of existing action derivation, not a client-owned menu. Recomputed on intent. */
export function handInteractions(sim: Simulation, p: Person): HandInteraction[] {
  if (!canAct(sim, p)) return [];
  const w = sim.world, b = w.primaryBody(p.id)!;
  const out: HandInteraction[] = [];
  for (const container of reachableContainers(sim, p).filter(c => containerAccessAllowed(p, c)))
    out.push({ id: `${container.open ? 'close' : 'open'}:${container.id}`, kind: container.open ? 'close' : 'open', label: `${container.open ? 'Close' : 'Open'} ${container.name}`, slot: 'nearby' });
  // Existing canonical door operation, bounded to the hand's neighbourhood. The ray ends
  // just before the door surface so the closed target doesn't occlude itself.
  for(let x=Math.floor(b.pos.x)-2;x<=Math.floor(b.pos.x)+2;x++) for(let z=Math.floor(b.pos.z)-2;z<=Math.floor(b.pos.z)+2;z++) {
    const y=w.nav.floorY(x,z); if(y<0||w.grid.get(x,y,z)!==B.Door)continue;
    const pos={x:x+.5,y:y+.8,z:z+.5}, eye={...b.pos,y:b.pos.y+1.2};
    const length=Math.hypot(pos.x-eye.x,pos.y-eye.y,pos.z-eye.z); if(length>ITEM_REACH)continue;
    const t=Math.max(0,1-.8/Math.max(.01,length));
    if(!w.grid.lineOfPassage(eye,{x:eye.x+(pos.x-eye.x)*t,y:eye.y+(pos.y-eye.y)*t,z:eye.z+(pos.z-eye.z)*t},ITEM_REACH))continue;
    const kind=w.grid.isDoorOpen(x,y,z)?'close':'open',id=`door:${x}:${y}:${z}`;
    out.push({id:`${kind}:${id}`,kind,label:`${kind==='open'?'Open':'Close'} door`,slot:'nearby',target:{id,kind:'door',pos}});
  }
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
  if (!water && naturalWaterAtHand(w, b.pos)) out.push({ id: 'drink:natural-water', kind: 'drink', label: 'Drink — water', slot: 'nearby' });
  for (const carcass of carcassesAtHand(w, b)) out.push({ id: `butcher:${carcass.id}`, kind: 'butcher', label: `Butcher the ${w.nameOf(carcass.ownerId)} carcass${bladeOf(w, p) ? '' : ' (needs a blade)'}`, slot: 'nearby', target: { id: carcass.id, kind: 'carcass', pos: { ...carcass.pos } } });
  const resource = resourceAtHand(sim, p);
  if (resource) out.push({ id: `gather:${resource.id}`, kind: 'gather', label: resource.kind==='game'?'Gather meat (abstract game resource)':`Gather ${resource.yield}`, slot: 'nearby' });
  for (const id of p.inventory) {
    const it = w.item(id);
    if (!it || it.holderId !== p.id || it.quantity <= 0) continue;
    const drop=actionsForCarriedItem(w,p,it).find(a=>a.kind==='drop');
    if(drop&&dropPositionAtHand(sim,p))out.push({id:`drop:${it.id}`,kind:'drop',label:drop.label,slot:'drop'});
    const action = actionsForCarriedItem(w, p, it).find(a => a.kind === 'eat' || a.kind === 'drink');
    if (action) out.push({ id: `consume:${it.id}`, kind: action.kind, label: action.label, slot: 'consume' });
  }
  for(const action of out) {
    if(action.slot!=='nearby'||action.target)continue;
    const id=action.id.slice(action.id.indexOf(':')+1),item=w.item(id),container=w.containers().find(c=>c.id===id),node=w.resourceNodes.find(n=>n.id===id);
    const pos=item?.pos??container?.pos??node?.pos;
    if(pos)action.target={id,kind:item?'item':container?'container':'resource',pos:{...pos}};
    else if(id==='natural-water')action.target={id,kind:'water',pos:frontInteractionPos(b)};
  }
  return out;
}
/** Dead wild-animal bodies within arm's reach (the carcass stays until someone dresses it). */
function carcassesAtHand(w: World, b: Body): Body[] {
  return w.nearbyPhysicalBodies(b.pos, 2.4, true).filter(c => c.dead && c.present && c.ownerId !== b.ownerId && !!w.get<Creature>(c.ownerId)?.wildlife && Math.hypot(c.pos.x - b.pos.x, c.pos.z - b.pos.z) <= 2.4);
}
const BLADES = new Set(['dagger', 'sword', 'axe', 'stoneaxe']);
function bladeOf(w: World, p: Person) { return p.inventory.map(id => w.item(id)).find(i => i && i.holderId === p.id && i.quantity > 0 && BLADES.has(i.type) && i.condition !== 0); }
/** Dress a carcass: needs a blade, takes about twenty minutes of work, yields cuts of meat in
 * proportion to the animal's body mass (tagged with species and origin), and removes the carcass. */
function butcher(sim: Simulation, p: Person, bodyId: string): string {
  const w = sim.world, b = w.primaryBody(p.id)!, carcass = carcassesAtHand(w, b).find(c => c.id === bodyId);
  if (!carcass) return 'out_of_reach';
  if (!bladeOf(w, p)) return 'missing_tool';
  if (p.physiology.fatigue > 0.9) return 'too_tired';
  const animal = w.get<Creature>(carcass.ownerId)!, spec = w.ecology?.species[animal.species];
  const massKg = spec?.bodyPlan.massKg ?? 10;
  const units = Math.max(1, Math.round(massKg / 10));
  const meat = makeItem(w, 'meat', `${animal.name} meat`, { owner: p.id, holder: p.id, quantity: units, tags: ['butchered', `species:${animal.species}`, `from:${animal.id}`] });
  p.inventory.push(meat.id);
  carcass.present = false;
  p.physiology.fatigue = Math.min(1, p.physiology.fatigue + 0.06);
  const killedBySelf = w.events.some(e => e.type === 'kill' && e.actor === p.id && e.target === animal.id);
  const ev = w.emit('butchered', { actor: p.id, target: animal.id, pos: { ...carcass.pos }, category: 'world', significance: 0.15, visibility: 16, loudness: 4,
    data: { species: animal.species, units, itemId: meat.id, laborSeconds: 1200, killedBySelf }, summary: `${p.name} butchered a ${animal.name}` });
  recordCapabilityPractice(w, p, { skill: 'hunting', sourceEventId: ev.id });
  return 'accepted';
}
export function performHandInteraction(sim: Simulation, p: Person, id: unknown): string {
  if (typeof id !== 'string' || !/^(buy|take|steal|recover|consume|drink|gather|drop|open|close|butcher):.+$/.test(id)) return 'invalid_interaction';
  if (!canAct(sim, p)) return 'incapacitated';
  const split = id.indexOf(':'), kind = id.slice(0, split), target = id.slice(split + 1);
  if (kind === 'butcher') return butcher(sim, p, target);
  if (kind === 'open' || kind === 'close') {
    if(target.startsWith('door:')) {
      const action=handInteractions(sim,p).find(a=>a.id===id&&a.target?.kind==='door');
      if(!action)return 'interaction_unavailable';
      const [,x,y,z]=target.split(':').map(Number);
      return sim.world.setDoorOpen({x,y,z},kind==='open',p.id)?'accepted':'interaction_unavailable';
    }
    const container = reachableContainers(sim, p).find(c => c.id === target);
    if (!container || !handInteractions(sim, p).some(a => a.id === id)) return 'interaction_unavailable';
    return setContainerOpen(sim.world, p, container, kind === 'open').ok ? 'accepted' : 'interaction_unavailable';
  }
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

/** Revalidated whole-stack transfer. Unreal supplies identities and direction only. */
export function performContainerTransfer(sim: Simulation, p: Person, containerId: unknown, itemId: unknown, direction: unknown): string {
  if (typeof containerId !== 'string' || typeof itemId !== 'string' || (direction !== 'into' && direction !== 'out')) return 'invalid_interaction';
  if (!canAct(sim, p)) return 'incapacitated';
  const container = reachableContainers(sim, p).find(c => c.id === containerId && c.open);
  if (!container) return 'interaction_unavailable';
  const item = sim.world.item(itemId) ?? null;
  const result = direction === 'into' ? transferItemToContainer(sim.world, p, item, container) : takeItemFromContainer(sim.world, p, container, item);
  return result.ok ? 'accepted' : result.reason;
}
