import type { Goal, KnowledgeItem, Person, Place, Request } from '../core/types';
import type { World } from '../core/world';
import { getPhysicalCapability } from '../core/attributes';
import { skillOf, tradeBatchSeconds } from '../core/skills';
import { reachable } from '../kernel/mechanics';
import { processFor, type TradeProcess } from '../world/labor';
import { stockAt } from '../world/stock';
import { effectivePrice } from '../world/pricing';
import { ITEM_VALUE } from '../world/factory';
import { productionSpecs, reserveFor } from '../world/production';
import { learn } from './knowledge';
import { laborIncentive } from './economy';
import { currentScheduleEntry } from './schedule';

export interface ProductionOpportunity {
  place: Place; process: TradeProcess; request: Request; belief: KnowledgeItem;
  input: number; output: number; deficit: number; pressure: number;
}

/** Local stocktaking at work one owns/holds. No remote prices, inferred village-wide vacancies,
 * private wallets, occupation permission or crisis state. Observations persist as evidence. */
export function observeProduction(world: World, p: Person): ProductionOpportunity[] {
  const places = new Set([p.workId, ...world.nearbyPlaces(world.positionOf(p.id) ?? { x: -1e6, y: 0, z: 0 }, 3).filter(pl => pl.ownerId === p.id || pl.workers.includes(p.id)).map(pl => pl.id)]);
  const result: ProductionOpportunity[] = [];
  for (const id of places) {
    const place = world.place(id), process = processFor(place?.type);
    if (!place || !process || !reachable(world, p, place.inside)) continue;
    const spec = productionSpecs().find(s => s.placeType === place.type && s.resource === process.output); if (!spec) continue;
    const input = stockAt(world, process.input, place.id), output = stockAt(world, process.output, place.id);
    const reserve = reserveFor(world, spec, place);
    const request = world.requests.find(r => r.type === 'production' && (r.status === 'open' || (r.status === 'accepted' && r.acceptedBy === p.id)) && r.payload.placeId === place.id && r.payload.resource === process.output);
    const quote = effectivePrice(process.output, ITEM_VALUE[process.output], output);
    const key = `production-observed:${place.id}`;
    let belief = p.knowledge[key];
    const changed = !belief || belief.claim.input !== input || belief.claim.output !== output || belief.claim.requestId !== request?.id;
    if (changed) {
      const sourceEvent = request ? world.events.find(e => e.type === 'request_created' && e.data.requestId === request.id) : undefined;
      // The measurement depends on the last physical change, without teaching its observer
      // who caused it or how it was achieved. Those claims require their own knowledge path.
      const changeEvent = [...world.events].reverse().find(e => e.placeId === place.id &&
        ((e.type === 'resource_transformed' && (e.data.to === process.output || e.data.from === process.input)) ||
         (e.type === 'trade' && (e.data.item === process.output || e.data.item === process.input))));
      const causes = [sourceEvent?.id, changeEvent?.id].filter((id): id is string => !!id);
      const ev = world.emit('production_observed', { actor: p.id, placeId: place.id, pos: place.inside, causes, significance: 0.1,
        data: { input, output, quote, resource: process.output, requestId: request?.id }, summary: `${p.name} inspected local production stocks and demand` });
      const claim = { placeId: place.id, resource: process.output, input, output, quote, requestId: request?.id, eventId: ev.id, tick: world.now };
      if (belief) { belief.claim = claim; belief.source = { type: 'witnessed', viaEvent: ev.id }; belief.learnedAt = world.now; belief.confidence = 1; belief.sharedWith = []; }
      else belief = learn(world, p, { key, kind: 'fact', claim, confidence: 1, source: { type: 'witnessed', viaEvent: ev.id } }, true)!;
    }
    if (!request || output >= reserve.trigger) continue;
    const deficit = Math.max(0, reserve.trigger - output);
    // A desire to fill one's own bin or earn an offered wage; never a village outcome target.
    const pressure = Math.min(1, deficit / Math.max(1, reserve.trigger)) * Math.min(1.4, laborIncentive(p, world));
    result.push({ place, process, request, belief, input, output, deficit, pressure });
  }
  return result;
}

/** Familiar practice competes with other goals. Knowledge/skill is needed to consider it;
 * physical work still uses the same trade process and request lifecycle. Missing inputs are
 * not silently repaired; a known stoppage makes repeating it unattractive until inputs change. */
export function productionWorkGoals(world: World, p: Person, opportunities: ProductionOpportunity[]): Partial<Goal>[] {
  const capacity = getPhysicalCapability(p, world).currentExertionCapacity;
  if (capacity <= 0.15) return [];
  return opportunities.flatMap(o => {
    // An existing work shift already proposes this action. Add opportunities outside that
    // shift without replacing its established trade/stand-in request lifecycle.
    const scheduled = currentScheduleEntry(p, world.clock.hourF);
    if (scheduled?.activity === 'work' && scheduled.placeId === o.place.id) return [];
    const skill = skillOf(p, o.process.skill), instruction = p.knowledge[`technique:${o.process.skill}`];
    if (!skill && !instruction) return [];
    const knownBlocked = p.knowledge[`short:${o.place.id}:${o.process.input}`];
    if (o.input <= 0 && knownBlocked && !knownBlocked.handled) return [];
    const seconds = tradeBatchSeconds(o.process.baseBatchSeconds, skill) / world.clock.timeScale;
    const utility = capacity * (0.22 + o.pressure * (0.38 + skill * 0.25)) / (1 + seconds / 120);
    return [{ type: 'work' as const, utility, targetPlace: o.place.id, causeEvent: o.belief.source.viaEvent,
      reasons: [`observed ${o.deficit.toFixed(2)} ${o.process.output} deficit`, `familiar practice; ${seconds.toFixed(1)} physical seconds per batch`],
      data: { productionOpportunity: true, requestId: o.request.id, resource: o.process.output } }];
  });
}
