import type { World } from '../core/world';
import { methodsHeld, methodSignature } from '../mind/invention';
import { intactRecord } from '../mind/records';
import type { Assembly } from '../kernel/types';

/** A past success is evidence only while its actual physical topology remains intact. */
function preservedExample(world: World, a: Assembly): boolean {
  return a.learned && a.parts.length === a.method.definitions.length && a.parts.length > 0
    && a.parts.every((id, index) => world.kernel.components.some(c => c.id === id && c.assemblyId === a.id && c.condition > 0 && c.definition === a.method.definitions[index]))
    && a.connections.length === a.method.connections.length
    && a.method.connections.every(edge => a.connections.some(c => c.from === edge.from && c.to === edge.to));
}

/** Observability only. A reservoir is a projection of existing people, physical records,
 * working examples and recorded shared practice, never an institutional unlock or mind.
 * Moving members/records naturally divides the reservoir; deaths and neglect weaken it. */
export function practiceReservoirs(world: World) {
  return world.places().flatMap(place => {
    const members = world.livingPersons().filter(p => p.workId === place.id || p.homeId === place.id || p.id === place.ownerId);
    const records = world.itemsAtPlaces([place.id]).filter(i => intactRecord(i) && !i.holderId);
    const history = world.events.filter(e => e.placeId === place.id && ['method_discovered', 'method_reproduced', 'record_written', 'record_copied', 'record_destroyed'].includes(e.type));
    const keys = new Set([...members.flatMap(p => methodsHeld(p).map(k => k.key)), ...records.map(i => i.record!.knowledge.key), ...history.map(e => e.data.key as string)]);
    return [...keys].filter(Boolean).map(key => {
      const holders = members.filter(p => !!p.knowledge[key]);
      const sources = records.filter(i => i.record!.knowledge.key === key);
      const examples = world.kernel.assemblies.filter(a => a.bindings.placeId === place.id && `method:${methodSignature(a.method)}` === key && preservedExample(world, a));
      const trials = world.events.filter(e => e.type === 'mechanism_trial' && e.data.output > 0 && examples.some(a => a.id === e.data.assemblyId));
      const practitioners = [...new Set(trials.map(e => e.actor).filter((id): id is string => !!id))];
      const alivePractitioners = practitioners.filter(id => holders.some(p => p.id === id));
      return { placeId: place.id, settlementId: place.settlementId, key, holders: holders.map(p => p.id), records: sources.map(i => i.id), examples: examples.map(a => a.id),
        practitioners, practiceEvents: trials.map(e => e.id), historyEvents: history.filter(e => e.data.key === key).map(e => e.id),
        state: alivePractitioners.length >= 2 && trials.length >= 3 ? 'shared practice' : holders.length ? 'fragile' : sources.length ? 'dormant record' : examples.length ? 'uninterpreted example' : 'lost' };
    });
  });
}

/** Historical inventories cannot be used as an epistemic source by inhabitants. */
export function settlementCapabilities(world: World) {
  const reservoirs = practiceReservoirs(world);
  return world.settlements().map(s => ({ id: s.id, name: s.name, reservoirs: reservoirs.filter(r => r.settlementId === s.id),
    livingMethods: [...new Set(world.livingPersons().filter(p => world.place(p.homeId)?.settlementId === s.id).flatMap(p => methodsHeld(p).filter(k => k.confidence > 0.2).map(k => k.key)))],
    workingAssemblies: world.kernel.assemblies.filter(a => world.place(a.bindings.placeId)?.settlementId === s.id && preservedExample(world, a)).map(a => a.id) }));
}
