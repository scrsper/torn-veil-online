import type { World } from '../../sim/core/world';
import { SECONDS_PER_DAY } from '../../sim/core/time';
import { isFood } from '../../sim/world/factory';
import { homeFood } from '../../sim/world/household';
import { generateProceduralWorld } from '../../sim/world/settlement';
import { ISOLATED_SITES } from '../../sim/world/settlementSpec';
import { runHeadless } from '../runner';
import { canonicalStateHash } from '../benchmarkReport';

/** Read-only diagnostics. These totals never feed back into prices or agents' beliefs. */
export function economyObservation(world: World, day: number) {
  const people = world.livingPersons().filter(p => !p.controlled);
  const energies = people.map(p => p.physiology.energy).sort((a,b) => a-b);
  const wallets = world.persons().reduce((n,p)=>n+p.wealth,0);
  const purses = world.households().reduce((n,h)=>n+h.wealth,0);
  const coins = world.items().filter(i=>i.type==='coins').reduce((n,i)=>n+i.quantity,0);
  const goods: Record<string, number> = {};
  let food = 0;
  for (const item of world.items()) if (item.quantity > 0) {
    goods[item.type] = (goods[item.type] ?? 0) + item.quantity;
    if (isFood(item.type)) food += item.quantity;
  }
  const hungry = people.filter(p=>p.physiology.energy <= 0.001);
  return { day, population: people.length, zeroEnergy: hungry.length,
    medianEnergy: energies[Math.floor(energies.length/2)] ?? 0,
    zeroEnergyWithUnderTwoSilver: hungry.filter(p=>p.wealth<2).length,
    wallets, householdPurses: purses, coinItems: coins, currency: wallets+purses+coins, food, goods,
    huntingCapacity: world.resourceNodes.filter(n=>n.kind==='game').reduce((n,g)=>n+g.capacity,0),
    gameRemaining: world.resourceNodes.filter(n=>n.kind==='game').reduce((n,g)=>n+g.remaining,0),
    circulation: { retail: world.runTally.purchase_amount ?? 0, wholesale: world.runTally.wholesale_amount ?? 0,
      wages: world.runTally.wage_paid_amount ?? 0, externalSink: world.runTally.supply_cost_amount ?? 0,
      householdMealsDeposited: world.runTally.household_food_deposited ?? 0 },
    mealFailures: { unavailable: world.runTally['meal_failure:unavailable'] ?? 0, unaffordable: world.runTally['meal_failure:unaffordable'] ?? 0 },
    people: people.map(p=>({ id:p.id, name:p.name, occupation:p.occupation, wealth:p.wealth, energy:p.physiology.energy,
      householdId:p.householdId, pantryUnits:homeFood(world,p).reduce((n,i)=>n+i.quantity,0), goal:p.mind.goal?.type })),
  };
}

export function runEconomyTrace(options: { seed?: number; days?: number; proceduralSite?: number; onProgress?: (day: number)=>void } = {}) {
  const seed=options.seed??918271, days=options.days??30;
  if (!Number.isFinite(days) || days<=0 || !Number.isSafeInteger(seed)) throw new Error('Expected a finite positive duration and an integer seed');
  const site=options.proceduralSite===undefined ? undefined : ISOLATED_SITES[options.proceduralSite];
  if (options.proceduralSite!==undefined && !site) throw new Error('Procedural site must be 0, 1, 2 or 3');
  const samples: ReturnType<typeof economyObservation>[]=[];
  const started=performance.now();
  const result=runHeadless({ seed, days, stepSeconds:0.15,
    generate:site ? w=>generateProceduralWorld(w,[site]) : undefined,
    probeIntervalSeconds:4*SECONDS_PER_DAY,
    onProbe:(w,_sim,elapsed)=>{ const day=elapsed/SECONDS_PER_DAY; samples.push(economyObservation(w,day)); options.onProgress?.(day); },
  });
  if (samples.at(-1)?.day!==days) samples.push(economyObservation(result.world,days));
  return { seed, days, scenario:site?.id??'Ashford', stepSeconds:0.15, wallMs:Math.round(performance.now()-started),
    hash:canonicalStateHash(result.world), samples };
}
