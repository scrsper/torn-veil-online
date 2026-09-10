import type { Action, Person } from '../core/types';
import type { World } from '../core/world';
import type { Assembly, ComponentDefinition } from '../kernel/types';
import { manufactureStock } from '../kernel/manufacture';
import { distance, reachable } from '../kernel/mechanics';
import { stockAt, unreservedStockAt } from '../world/stock';
import { affordableHaulQuantity, claimHaulTask, createHaulTask, openHaulTasks } from '../logistics/haul';
import { learn } from './knowledge';

/** Refresh a failed offer only through a new local visit (or improved personal funds).
 * Remote inventory changes do not travel into a mind by themselves. */
export function observeMaterialSources(world: World, p: Person): void {
  for (const failure of Object.values(p.knowledge).filter(k => k.key.startsWith('supply-failed:'))) {
    const source = p.knowledge[failure.key.slice('supply-failed:'.length)]?.claim.materialSource;
    const place = world.place(source?.placeId); if (!place || !reachable(world, p, place.inside)) continue;
    const quantity = stockAt(world, failure.claim.resource, place.id);
    if (quantity <= 0 || (quantity === failure.claim.stock && p.wealth <= Number(failure.claim.wealth ?? p.wealth))) continue;
    const ev = world.emit('production_observed', { actor: p.id, placeId: place.id, pos: place.inside, causes: failure.source.viaEvent ? [failure.source.viaEvent] : [], significance: 0.1,
      data: { resource: failure.claim.resource, quantity }, summary: `${p.name} found a changed local material offer` });
    delete p.knowledge[failure.key];
    const belief = p.knowledge[failure.key.slice('supply-failed:'.length)];
    if (belief) { belief.source = { type: 'witnessed', viaEvent: ev.id }; belief.learnedAt = world.now; belief.confidence = 1; }
  }
}

export function knownComponents(p: Person): ComponentDefinition[] {
  const defs = new Map<string, ComponentDefinition>();
  for (const k of Object.values(p.knowledge).filter(k => k.confidence > 0.2)) {
    if (k.claim.component) defs.set(k.claim.component.id, k.claim.component);
    for (const d of k.claim.components ?? []) defs.set(d.id, d);
  }
  return [...defs.values()];
}

/** Supplier locations are memories, not a remote stock query. Empty/expensive visits can
 * invalidate them. A new physical observation can later contradict that failure. */
export function knownSuppliers(world: World, p: Person, d: ComponentDefinition, placeId: string) {
  const material = world.kernel.ruleset.materials.find(m => m.id === d.material);
  const destination = world.place(placeId); if (!destination) return [];
  return Object.values(p.knowledge).filter(k => k.confidence > 0.2 && k.claim.materialSource?.item === material?.legacyItem)
    .map(k => ({ belief: k, ...k.claim.materialSource as { placeId: string; item: string; nodeId?: string; pos: { x: number; y: number; z: number } } }))
    .filter(s => s.pos && world.place(s.placeId) && s.placeId !== placeId && distance(s.pos, destination.inside) < 400 && !p.knowledge[`supply-failed:${s.belief.key}`])
    .sort((a, b) => distance(a.pos, destination.inside) - distance(b.pos, destination.inside) || a.belief.key.localeCompare(b.belief.key));
}

export function canConsiderManufacture(world: World, p: Person, d: ComponentDefinition, placeId?: string): boolean {
  if (!placeId || !d.fabrication) return false;
  const material = world.kernel.ruleset.materials.find(m => m.id === d.material);
  return !!material && (manufactureStock(world, p, d, placeId) >= d.massKg / material.kgPerUnit || knownSuppliers(world, p, d, placeId).length > 0);
}

export function componentSupplyPlan(world: World, p: Person, a: Assembly): Action[] | null {
  if (!a.bindings.placeId) return null;
  // Absence of a local measurement while away is not evidence of an empty work bin.
  // Return to inspect it before issuing another purchase for already-delivered material.
  if (!reachable(world, p, a.pos)) return null;
  const d = knownComponents(p).find(d => d.id === a.method.definitions[a.parts.length]);
  if (!d?.fabrication) return null;
  const material = world.kernel.ruleset.materials.find(m => m.id === d.material)!;
  if (manufactureStock(world, p, d, a.bindings.placeId) + 1e-9 >= d.massKg / material.kgPerUnit) return null;
  const s = knownSuppliers(world, p, d, a.bindings.placeId)[0]; if (!s) return null;
  // Order enough of THIS material for the remaining shapes. Fractional stock conversion is
  // mass-conserving; legacy haul trips use whole stock measures and leave the surplus real.
  const quantity = Math.ceil(a.method.definitions.slice(a.parts.length).reduce((n, id) => {
    const def = knownComponents(p).find(d => d.id === id);
    return n + (def?.material === material.id ? def.massKg / material.kgPerUnit : 0);
  }, 0));
  const actions: Action[] = [{ type: 'goto', pos: s.pos, placeId: s.placeId, status: 'pending' }];
  if (s.nodeId) actions.push({ type: 'gather', pos: s.pos, placeId: s.placeId, duration: 5 * 60, data: { nodeId: s.nodeId, paidFirstSwing: true, causeEvent: a.lastEvent }, status: 'pending' });
  actions.push({ type: 'goto', pos: world.place(s.placeId)!.inside, placeId: s.placeId, status: 'pending' },
    { type: 'procure_material', placeId: s.placeId, data: { assemblyId: a.id, sourceKey: s.belief.key, quantity, resource: material.legacyItem }, status: 'pending' });
  return actions;
}

/** The local visit uses existing orders, payment, carrying, and unloading actions. */
export function procureMaterial(world: World, p: Person, action: Action): Action[] {
  const a = world.kernel.assemblies.find(a => a.id === action.data?.assemblyId), source = world.place(action.placeId);
  if (!a || a.ownerId !== p.id || !a.bindings.placeId || !source || !reachable(world, p, source.inside)) { action.status = 'failed'; return []; }
  const resource = action.data!.resource;
  const spec = { resource, quantity: Math.min(action.data!.quantity, Math.floor(unreservedStockAt(world, resource, source.id))),
    sourcePlaceId: source.id, destPlaceId: a.bindings.placeId, requesterId: p.id, buyerId: p.id, priority: 0.5, reason: 'material for a personally planned component' };
  spec.quantity = affordableHaulQuantity(world, spec);
  if (spec.quantity <= 0) {
    const ev = world.emit('component_supply_failed', { actor: p.id, placeId: source.id, pos: source.inside, causes: a.lastEvent ? [a.lastEvent] : [], visibility: 6, significance: 0.25,
      data: { assemblyId: a.id, resource, stock: stockAt(world, resource, source.id), reason: 'no unreserved affordable supply' }, summary: `${p.name} could not obtain material for the component` });
    a.lastEvent = ev.id;
    learn(world, p, { key: `supply-failed:${action.data!.sourceKey}`, kind: 'fact', claim: { stock: stockAt(world, resource, source.id), wealth: p.wealth, resource, placeId: source.id }, confidence: 1, source: { type: 'witnessed', viaEvent: ev.id } }, true);
    action.status = 'failed'; return [];
  }
  const task = openHaulTasks(world).find(t => t.buyerId === p.id && t.requesterId === p.id && t.destPlaceId === a.bindings.placeId && t.sourcePlaceId === source.id && t.resource === resource && (!t.claimantId || t.claimantId === p.id)) ?? createHaulTask(world, spec);
  claimHaulTask(world, task, p);
  action.status = 'done';
  return [
    { type: 'haul_load', placeId: source.id, duration: 90, data: { taskId: task.id }, status: 'pending' },
    { type: 'goto', placeId: a.bindings.placeId, pos: a.pos, data: { taskId: task.id }, status: 'pending' },
    { type: 'haul_unload', placeId: a.bindings.placeId, duration: 60, data: { taskId: task.id }, status: 'pending' },
  ];
}
