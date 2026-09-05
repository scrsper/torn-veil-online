#!/usr/bin/env node
/**
 * RNG-coupling probe (independent audit tool, v0.8 review — Part 4).
 *
 * Hypothesis under test: the "12 → 25 → 35 world-day" drift of
 * `tests/living-world-logistics.test.ts`'s full-chain construction test across three logically
 * unrelated change sets is NOT emergent world dynamics. It is an artifact of ONE global
 * `world.rng` stream (`sim/core/world.ts`) being consumed, in interleaved order, by unrelated
 * subsystems — weather transitions, combat damage rolls, robbery rolls, chat partner choice,
 * small-talk lines, work-action durations, patrol start index, anchor choice, idle yaw jitter,
 * creature wandering. ANY change that adds or removes a single `rng.next()` call, or changes how
 * often one is reached, permanently re-phases every later draw in every other subsystem.
 *
 * Method: run the SAME seed, with the ONLY difference being `k` extra `world.rng.next()` draws
 * burned immediately after generation — a perturbation with no semantic meaning whatsoever. If
 * the world is robust, downstream macro outcomes should be near-identical. If the streams are
 * coupled, they will diverge wildly.
 *
 * Usage: npx tsx tools/audit/rng-coupling-probe.ts --days 25 --seed 918271 --burns 0,1,2,3,4,5
 */
import { World } from '../../src/sim/core/world';
import { Simulation } from '../../src/sim/mind/agent';
import { generateVillage } from '../../src/sim/world/village';
import { SECONDS_PER_DAY } from '../../src/sim/core/time';
import { worldStock } from '../../src/sim/world/stock';

function run(seed: number, days: number, burn: number) {
  const world = new World(seed);
  generateVillage(world);
  for (let i = 0; i < burn; i++) world.rng.next(); // the ONLY difference between runs
  const sim = new Simulation(world);
  const start = world.now;
  const total = days * SECONDS_PER_DAY;
  const substep = 0.15;
  let firstPlankDeliveryDay = -1, readyDay = -1, completeDay = -1, treesGoneDay = -1;
  while (world.now - start < total) {
    const remaining = total - (world.now - start);
    const dt = remaining < substep * world.clock.timeScale ? Math.max(remaining / world.clock.timeScale, 0.001) : substep;
    const wdt = world.clock.advance(dt);
    world.physicalTime += dt;
    sim.step(dt, wdt);
    sim.flushSpeech();
    const day = (world.now - start) / SECONDS_PER_DAY;
    const proj = world.constructionProjects[0];
    if (firstPlankDeliveryDay < 0 && (world.runTally['hauled:plank'] ?? 0) > 0) firstPlankDeliveryDay = day;
    if (readyDay < 0 && proj && (proj.status === 'ready' || proj.status === 'building')) readyDay = day;
    if (completeDay < 0 && proj && proj.status === 'complete') completeDay = day;
    if (treesGoneDay < 0 && world.resourceNodes.filter(n => n.kind === 'tree' && n.state === 'available').length === 0) treesGoneDay = day;
  }
  const alive = world.persons().filter(p => p.alive && !p.controlled);
  return {
    burn,
    completeDay: completeDay < 0 ? null : Math.round(completeDay * 100) / 100,
    readyDay: readyDay < 0 ? null : Math.round(readyDay * 100) / 100,
    firstPlankDay: firstPlankDeliveryDay < 0 ? null : Math.round(firstPlankDeliveryDay * 100) / 100,
    treesGoneDay: treesGoneDay < 0 ? null : Math.round(treesGoneDay * 100) / 100,
    extracted: world.runTally.resource_extracted ?? 0,
    transforms: world.runTally.resource_transformed ?? 0,
    harvests: world.runTally.crop_harvested ?? 0,
    meals: world.runTally.food_consumed ?? 0,
    shortages: world.runTally.resource_shortage ?? 0,
    bread: worldStock(world, 'bread'),
    grain: worldStock(world, 'grain'),
    plank: worldStock(world, 'plank'),
    totalWealth: Math.round(alive.reduce((a, p) => a + p.wealth, 0)),
    supplyCost: Math.round(world.runTally.supply_cost_amount ?? 0),
    wages: Math.round(world.runTally.wage_paid_amount ?? 0),
    purchases: Math.round(world.runTally.purchase_amount ?? 0),
    wholesale: Math.round(world.runTally.wholesale_amount ?? 0),
    events: world.events.length,
  };
}

const argv = process.argv.slice(2);
const get = (f: string, d: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const days = Number(get('--days', '25'));
const seed = Number(get('--seed', '918271'));
const burns = get('--burns', '0,1,2,3').split(',').map(Number);

console.log(`RNG-coupling probe · seed ${seed} · ${days} world-days · burn = extra rng.next() calls after generation (semantically meaningless)`);
console.log('burn | complete ready first-plank treesGone | extract transf harvest meals short | bread grain plank | wealth supplyCost wages purch wholesale | events');
for (const b of burns) {
  const r = run(seed, days, b);
  console.log(
    `${String(r.burn).padStart(4)} | ${String(r.completeDay).padStart(8)} ${String(r.readyDay).padStart(5)} ${String(r.firstPlankDay).padStart(11)} ${String(r.treesGoneDay).padStart(9)} | ` +
    `${String(r.extracted).padStart(7)} ${String(r.transforms).padStart(6)} ${String(r.harvests).padStart(7)} ${String(r.meals).padStart(5)} ${String(r.shortages).padStart(5)} | ` +
    `${String(r.bread).padStart(5)} ${String(r.grain).padStart(5)} ${String(r.plank).padStart(5)} | ` +
    `${String(r.totalWealth).padStart(6)} ${String(r.supplyCost).padStart(10)} ${String(r.wages).padStart(5)} ${String(r.purchases).padStart(5)} ${String(r.wholesale).padStart(9)} | ${String(r.events).padStart(6)}`,
  );
}
