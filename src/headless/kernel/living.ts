import { World } from '../../sim/core/world';
import { Simulation } from '../../sim/mind/agent';
import { generateProceduralWorld } from '../../sim/world/settlement';
import type { SettlementSite } from '../../sim/world/settlementSpec';
import { methodsHeld } from '../../sim/mind/invention';
import { stockAt } from '../../sim/world/stock';
import { effectivePrice } from '../../sim/world/pricing';
import { ITEM_VALUE } from '../../sim/world/factory';
import { generateProductionNeeds } from '../../sim/world/production';
import { retireStack } from '../../sim/world/stock';

export function createLivingWorld(seed: number, sites: SettlementSite[] = [{ id: 'site_0', x: 256, z: 128 }]) {
  const world = new World(seed), settlements = generateProceduralWorld(world, sites);
  return { world, settlements, sim: new Simulation(world) };
}
export function advanceLiving(world: World, sim: Simulation, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 4); i++) { const wd = world.clock.advance(0.25); world.physicalTime += 0.25; sim.step(0.25, wd); sim.flushSpeech(); }
}

export interface LivingConditions { manualSkill?: number; calm?: boolean; sawnOnly?: boolean; steadyWind?: number }
/** A starting shortage and inexperienced post-holders, in generated towns with every other
 * resident autonomous. No inventory additions, free components, methods, schedules or chosen
 * goals. Education, geography, families, suppliers, and resource amounts remain generated. */
export function createLivingPressure(seed = 17, sites?: SettlementSite[], conditions: LivingConditions = {}) {
  const lab = createLivingWorld(seed, sites);
  if (conditions.steadyWind !== undefined) { lab.world.weather.wind = conditions.steadyWind; lab.world.weather.nextChangeAt = Number.MAX_SAFE_INTEGER; }
  for (const pl of lab.world.places().filter(pl => pl.type === 'mill' || pl.type === 'bakery')) {
    for (const item of lab.world.itemsAtPlaces([pl.id])) if (item.type === 'flour' || item.type === 'bread') { item.quantity = 0; retireStack(lab.world, item); }
    if (pl.type !== 'mill') continue;
    const p = lab.world.person(pl.ownerId)!;
    p.skills.milling = conditions.manualSkill ?? 0; p.skills.crafting = 0.5; p.traits.curiosity = 0.95;
    const b = lab.world.primaryBody(p.id)!; b.pos = { ...pl.inside }; // start of the existing shift
    if (conditions.sawnOnly) for (const k of Object.values(p.knowledge)) {
      const d = k.claim.component;
      if (d && lab.world.kernel.ruleset.materials.find(m => m.id === d.material)?.legacyItem === 'log') delete p.knowledge[k.key];
    }
  }
  if (conditions.calm) { lab.world.weather.wind = 0; lab.world.weather.nextChangeAt = Number.MAX_SAFE_INTEGER; }
  generateProductionNeeds(lab.world);
  return lab;
}

/** Walk only edges recorded by producers, physical hauls and consumers. */
export function causalAncestors(world: World, id: string): Set<string> {
  const seen = new Set<string>(), pending = [id];
  while (pending.length) { const next = pending.pop()!; if (seen.has(next)) continue; seen.add(next); pending.push(...(world.event(next)?.causes ?? [])); }
  return seen;
}
export function livingSnapshot(world: World) {
  return world.settlements().map(settlement => {
    const places = world.places().filter(p => p.settlementId === settlement.id), ids = new Set(places.map(p => p.id));
    const people = world.persons().filter(p => ids.has(p.homeId ?? '')), personIds = new Set(people.map(p => p.id));
    const events = world.events.filter(e => personIds.has(e.actor ?? '') || ids.has(e.placeId ?? ''));
    return { name: settlement.name, id: settlement.id, population: people.filter(p => p.alive).length,
      flour: places.reduce((n, p) => n + stockAt(world, 'flour', p.id), 0), bread: places.reduce((n, p) => n + stockAt(world, 'bread', p.id), 0),
      householdFood: places.filter(p => p.type === 'house').reduce((n, p) => n + stockAt(world, 'bread', p.id) + stockAt(world, 'cheese', p.id), 0),
      grain: places.reduce((n, p) => n + stockAt(world, 'grain', p.id), 0),
      baked: events.filter(e => e.type === 'resource_transformed' && e.data.to === 'bread').reduce((n, e) => n + e.data.toQty, 0),
      mechanicalOutput: world.kernel.assemblies.filter(a => personIds.has(a.ownerId)).reduce((n, a) => n + a.outputQuantity, 0),
      laborSeconds: world.kernel.assemblies.filter(a => personIds.has(a.ownerId)).reduce((n, a) => n + a.laborSeconds, 0),
      breadWithMechanicalAncestry: events.filter(e => e.type === 'resource_transformed' && e.data.to === 'bread' && [...causalAncestors(world, e.id)].some(id => world.event(id)?.data.how === 'mechanical processing')).reduce((n, e) => n + e.data.toQty, 0),
      flourDelivered: events.filter(e => e.type === 'resource_delivered' && e.data.resource === 'flour').reduce((n, e) => n + e.data.quantity, 0),
      manufactured: events.filter(e => e.type === 'component_manufactured').map(e => e.data),
      trials: events.filter(e => e.type === 'mechanism_trial').map(e => e.data),
      sources: world.kernel.energy.filter(e => places.some(p => p.inside.x === e.pos.x && p.inside.z === e.pos.z)).map(e => ({ initialJ: e.initialJ, remainingJ: e.remainingJ, maxPowerW: e.maxPowerW, wind: e.wind })),
      methods: people.flatMap(p => methodsHeld(p).map(k => ({ holder: p.id, alive: p.alive, source: k.source, method: k.claim.method }))),
      wealth: people.reduce((n, p) => n + p.wealth, 0),
      workers: people.filter(p => places.some(pl => pl.type === 'mill' && pl.workers.includes(p.id))).map(p => ({ id: p.id, name: p.name, skills: p.skills, traits: p.traits,
        goal: p.mind.goal?.type, pos: world.positionOf(p.id), plan: p.mind.plan, energy: p.physiology.energy,
        primitiveKnowledge: Object.values(p.knowledge).filter(k => k.claim.component).length,
        flourQuote: effectivePrice('flour', ITEM_VALUE.flour, stockAt(world, 'flour', p.workId!)),
        choices: events.filter(e => e.type === 'goal_changed' && e.actor === p.id).map(e => ({ to: e.data.to, reasons: e.summary })),
        supplies: events.filter(e => e.actor === p.id && ['component_supply_failed', 'resource_delivered', 'purchase_made'].includes(e.type)).map(e => ({ type: e.type, data: e.data })),
      })),
    };
  });
}
