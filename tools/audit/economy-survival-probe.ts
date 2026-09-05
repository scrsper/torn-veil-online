#!/usr/bin/env node
/**
 * Economy + survival-tail probe (independent audit, second pass against PR #12 head).
 *
 * Answers the questions WorldLab's own invariants/liveness structurally cannot, because they are
 * (a) village-wide cumulative counters, (b) whole-currency aggregates that do not distinguish
 * spendable wealth from inert coin items, and (c) end-of-run live-state scans.
 *
 * Usage: npx tsx tools/audit/economy-survival-probe.ts --days 30 --seeds 918271,918272,1337
 */
import { World } from '../../src/sim/core/world';
import { Simulation } from '../../src/sim/mind/agent';
import { generateVillage } from '../../src/sim/world/village';
import { SECONDS_PER_DAY } from '../../src/sim/core/time';
import { hungerBand, thirstBand, sleepBand } from '../../src/sim/core/physiology';
import { stockAt, worldStock } from '../../src/sim/world/stock';
import { effectivePrice } from '../../src/sim/world/pricing';
import { isFood } from '../../src/sim/world/factory';
import { detectAnomalies } from '../../src/sim/telemetry/anomaly';
import type { Person } from '../../src/sim/core/types';

const ORDER = ['comfortable', 'noticeable', 'uncomfortable', 'urgent', 'critical'] as const;
const atLeast = (b: string, min: string) => ORDER.indexOf(b as never) >= ORDER.indexOf(min as never);

function gini(v0: number[]): number {
  const v = v0.filter(Number.isFinite).sort((a, b) => a - b);
  const n = v.length; if (!n) return 0;
  const sum = v.reduce((a, b) => a + b, 0); if (sum <= 0) return 0;
  let cum = 0; for (let i = 0; i < n; i++) cum += (2 * (i + 1) - n - 1) * v[i];
  return Math.round((cum / (n * sum)) * 1000) / 1000;
}
const median = (v0: number[]) => { const v = [...v0].sort((a, b) => a - b); return v.length ? Math.round(v[Math.floor(v.length / 2)] * 100) / 100 : 0; };

/** Cheapest unit price of any food currently for sale anywhere (what `buyFoodPortion` charges). */
function cheapestMealPrice(world: World): number {
  let best = Infinity;
  for (const it of world.items()) {
    if (it.holderId || !it.placeId || it.quantity <= 0 || !isFood(it.type)) continue;
    if (!it.ownerId || !world.person(it.ownerId)?.alive) continue;
    best = Math.min(best, effectivePrice(it.type, it.value ?? 2, stockAt(world, it.type, it.placeId)));
  }
  return Number.isFinite(best) ? best : Infinity;
}

interface Row {
  day: number;
  personWealth: number; coinItems: number; totalCurrency: number;
  spendable: number;               // what NPC purchase paths can actually use
  sinkSupply: number; wages: number; purchases: number; wholesale: number; rewards: number;
  gini: number; median: number; poorestQuartileShare: number; richestShare: number;
  belowBread: number; cannotBuyAnyMeal: number; breadPrice: number;
  grain: number; flour: number; bread: number;
  meals: number; shortages: number; harvests: number; transforms: number;
  trees: number; standingLogCapacity: number; stoneLeft: number;
  urgentHungry: number; urgentThirsty: number;
}

function sample(world: World, day: number): Row {
  const alive = world.persons().filter(p => p.alive && !p.controlled);
  const wealths = alive.map(p => p.wealth);
  const personWealth = wealths.reduce((a, b) => a + b, 0);
  let coinItems = 0;
  for (const it of world.items()) if (it.type === 'coins') coinItems += it.quantity ?? 0;
  const bakery = world.places().find(p => p.type === 'bakery');
  const breadPrice = bakery ? effectivePrice('bread', 2, stockAt(world, 'bread', bakery.id)) : 2;
  const cheapest = cheapestMealPrice(world);
  const sorted = [...wealths].sort((a, b) => a - b);
  const q = Math.max(1, Math.floor(sorted.length / 4));
  const poorestQ = sorted.slice(0, q).reduce((a, b) => a + b, 0);
  const trees = world.resourceNodes.filter(n => n.kind === 'tree');
  return {
    day,
    personWealth: Math.round(personWealth * 100) / 100,
    coinItems,
    totalCurrency: Math.round((personWealth + coinItems) * 100) / 100,
    spendable: Math.round(personWealth * 100) / 100,
    sinkSupply: Math.round(world.runTally.supply_cost_amount ?? 0),
    wages: Math.round(world.runTally.wage_paid_amount ?? 0),
    purchases: Math.round(world.runTally.purchase_amount ?? 0),
    wholesale: Math.round(world.runTally.wholesale_amount ?? 0),
    rewards: Math.round(world.runTally.reward_paid_amount ?? 0),
    gini: gini(wealths), median: median(wealths),
    poorestQuartileShare: personWealth > 0 ? Math.round((poorestQ / personWealth) * 1000) / 10 : 0,
    richestShare: personWealth > 0 ? Math.round((Math.max(...wealths) / personWealth) * 1000) / 10 : 0,
    belowBread: wealths.filter(w => w < breadPrice).length,
    cannotBuyAnyMeal: wealths.filter(w => w < cheapest).length,
    breadPrice,
    grain: worldStock(world, 'grain'), flour: worldStock(world, 'flour'), bread: worldStock(world, 'bread'),
    meals: world.runTally.food_consumed ?? 0,
    shortages: world.runTally.resource_shortage ?? 0,
    harvests: world.runTally.crop_harvested ?? 0,
    transforms: world.runTally.resource_transformed ?? 0,
    trees: trees.filter(n => n.state === 'available').length,
    standingLogCapacity: trees.filter(n => n.state === 'available').reduce((a, n) => a + n.remaining, 0),
    stoneLeft: world.resourceNodes.filter(n => n.kind === 'stone').reduce((a, n) => a + n.remaining, 0),
    urgentHungry: alive.filter(p => atLeast(hungerBand(p), 'urgent')).length,
    urgentThirsty: alive.filter(p => atLeast(thirstBand(p), 'urgent')).length,
  };
}

function run(seed: number, days: number) {
  const world = new World(seed);
  generateVillage(world);
  const sim = new Simulation(world);
  const start = world.now;
  const total = days * SECONDS_PER_DAY;
  const substep = 0.15;
  const rows: Row[] = [];
  // per-person consecutive-hour deprivation streaks, sampled hourly (not daily) so the
  // distribution is real rather than a once-a-day coin flip.
  const cur = { h: new Map<string, number>(), t: new Map<string, number>(), s: new Map<string, number>() };
  const max = { h: new Map<string, number>(), t: new Map<string, number>(), s: new Map<string, number>() };
  const bump = (k: 'h' | 't' | 's', id: string, on: boolean) => {
    const n = on ? (cur[k].get(id) ?? 0) + 1 : 0;
    cur[k].set(id, n); max[k].set(id, Math.max(max[k].get(id) ?? 0, n));
  };
  let lastDay = -1, lastHour = -1;
  let mealsByPerson = new Map<string, number>();
  while (world.now - start < total) {
    const remaining = total - (world.now - start);
    const dt = remaining < substep * world.clock.timeScale ? Math.max(remaining / world.clock.timeScale, 0.001) : substep;
    const wdt = world.clock.advance(dt);
    world.physicalTime += dt;
    sim.step(dt, wdt);
    sim.flushSpeech();
    const elapsed = world.now - start;
    const hour = Math.floor(elapsed / 3600);
    if (hour !== lastHour) {
      lastHour = hour;
      for (const p of world.persons()) {
        if (!p.alive || p.controlled) continue;
        bump('h', p.id, atLeast(hungerBand(p), 'urgent'));
        bump('t', p.id, atLeast(thirstBand(p), 'urgent'));
        bump('s', p.id, atLeast(sleepBand(p), 'urgent'));
      }
    }
    const day = Math.floor(elapsed / SECONDS_PER_DAY);
    if (day !== lastDay) { lastDay = day; rows.push(sample(world, day)); }
  }
  rows.push(sample(world, days));
  for (const e of world.events) if (e.type === 'food_consumed' && e.actor) mealsByPerson.set(e.actor, (mealsByPerson.get(e.actor) ?? 0) + 1);
  return { world, rows, max, mealsByPerson, anomalies: detectAnomalies(world) };
}

const argv = process.argv.slice(2);
const get = (f: string, d: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const days = Number(get('--days', '30'));
const seeds = get('--seeds', '918271').split(',').map(Number);

for (const seed of seeds) {
  const t0 = Date.now();
  const r = run(seed, days);
  const first = r.rows[0], last = r.rows[r.rows.length - 1];
  const pop = r.world.persons().filter(p => p.alive && !p.controlled).length;
  console.log(`\n############ seed ${seed} · ${days} world-days · ${((Date.now() - t0) / 1000).toFixed(0)}s wall · pop ${pop}`);
  console.log('CURRENCY / DISTRIBUTION');
  console.log('day | wealth  coins  total | sinkSup wages purch wholes reward | gini median pQ%  rich% | bread$ <bread noMeal');
  for (const s of r.rows) {
    console.log(
      `${String(s.day).padStart(3)} | ${String(s.personWealth).padStart(6)} ${String(s.coinItems).padStart(6)} ${String(s.totalCurrency).padStart(6)} | ` +
      `${String(s.sinkSupply).padStart(7)} ${String(s.wages).padStart(5)} ${String(s.purchases).padStart(5)} ${String(s.wholesale).padStart(6)} ${String(s.rewards).padStart(6)} | ` +
      `${String(s.gini).padStart(5)} ${String(s.median).padStart(6)} ${String(s.poorestQuartileShare).padStart(4)} ${String(s.richestShare).padStart(5)} | ` +
      `${String(s.breadPrice).padStart(6)} ${String(s.belowBread).padStart(6)} ${String(s.cannotBuyAnyMeal).padStart(6)}`);
  }
  console.log('\nFOOD CHAIN / RESOURCES');
  console.log('day | grain flour bread | harv trans meals short | trees logCap stone');
  for (const s of r.rows) {
    console.log(`${String(s.day).padStart(3)} | ${String(s.grain).padStart(5)} ${String(s.flour).padStart(5)} ${String(s.bread).padStart(5)} | ` +
      `${String(s.harvests).padStart(4)} ${String(s.transforms).padStart(5)} ${String(s.meals).padStart(5)} ${String(s.shortages).padStart(5)} | ` +
      `${String(s.trees).padStart(5)} ${String(s.standingLogCapacity).padStart(6)} ${String(s.stoneLeft).padStart(5)}`);
  }
  const explained = last.sinkSupply;
  const actualDrop = first.personWealth - last.personWealth;
  const totalDrop = first.totalCurrency - last.totalCurrency;
  console.log('\nECONOMY SUMMARY');
  console.log(`  spendable wealth  ${first.personWealth} -> ${last.personWealth}   (drop ${actualDrop.toFixed(0)}, ${(100 * actualDrop / first.personWealth).toFixed(0)}%)`);
  console.log(`  coin items        ${first.coinItems} -> ${last.coinItems}   (inert: no NPC economic action spends coin items)`);
  console.log(`  wealth+coins      ${first.totalCurrency} -> ${last.totalCurrency}   (drop ${totalDrop.toFixed(0)})`);
  console.log(`  tracked sink      ${explained}  |  residual unexplained on wealth+coins: ${(totalDrop - explained).toFixed(2)}`);
  console.log(`  spendable lost to coin conversion (wealth drop - total drop): ${(actualDrop - totalDrop).toFixed(0)}`);
  console.log(`  flows: wages ${last.wages}, purchases ${last.purchases}, wholesale ${last.wholesale}, rewards ${last.rewards}; sources: NONE`);
  console.log(`  gini ${first.gini} -> ${last.gini}; median ${first.median} -> ${last.median}; poorest-quartile share ${first.poorestQuartileShare}% -> ${last.poorestQuartileShare}%; richest ${first.richestShare}% -> ${last.richestShare}%`);
  console.log(`  below bread price ${first.belowBread} -> ${last.belowBread} of ${pop}; cannot afford ANY meal ${first.cannotBuyAnyMeal} -> ${last.cannotBuyAnyMeal}`);

  console.log('\nSURVIVAL TAILS (max consecutive world-HOURS at >= urgent, sampled hourly)');
  const tbl = (m: Map<string, number>, label: string) => {
    const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(`  ${label}: ` + top.map(([id, n]) => `${r.world.nameOf(id).split(' ')[0]}(${(r.world.person(id) as Person).occupation})=${n}h`).join(', '));
  };
  tbl(r.max.h, 'hunger'); tbl(r.max.t, 'thirst'); tbl(r.max.s, 'sleep  ');
  const overAll = [...r.max.h.values()];
  console.log(`  hunger streaks: max ${Math.max(...overAll)}h; people over 48h: ${overAll.filter(n => n > 48).length}/${pop}; over 168h (1 week): ${overAll.filter(n => n > 168).length}/${pop}`);
  const mealsPer = [...r.mealsByPerson.entries()].sort((a, b) => a[1] - b[1]);
  const never = r.world.persons().filter(p => p.alive && !p.controlled && !r.mealsByPerson.has(p.id));
  console.log(`  meals/person/day overall: ${(last.meals / (pop * days)).toFixed(2)} (physiological requirement >= ~2.1)`);
  console.log(`  people who NEVER ate in ${days} days: ${never.length ? never.map(p => `${p.name}(${p.occupation})`).join(', ') : 'none'}`);
  if (mealsPer.length) console.log(`  fewest meals: ` + mealsPer.slice(0, 5).map(([id, n]) => `${r.world.nameOf(id).split(' ')[0]}=${n}`).join(', ') + ` (note: event-log based, undercounts after compaction)`);
  console.log(`  end-of-run detectAnomalies(): ${r.anomalies.length ? r.anomalies.map(a => `${a.type}x${a.occurrences}`).join(', ') : 'none'}`);
}
