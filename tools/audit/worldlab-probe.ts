#!/usr/bin/env node
/**
 * WorldLab adversarial probe (independent audit tool, v0.8 review).
 *
 * NOT part of `src/` and not imported by the simulation. It exists to answer questions the
 * current headless summary/anomaly detector structurally cannot, because both only ever look at
 * (a) end-of-run snapshots, (b) lifetime totals, and (c) a 3-hour trailing window at the very
 * end of the run:
 *
 *   - did the loop keep running, or did it fire once and die?
 *   - did any INDIVIDUAL starve/thirst for days while the village AVERAGE looked fine?
 *   - did any workflow (haul task, construction project, production request) stall?
 *   - is a "sustainable" chain actually drawing down a one-time stock?
 *   - does the same conclusion hold on neighbouring seeds?
 *
 * Usage:
 *   npx tsx tools/audit/worldlab-probe.ts --days 30 --seeds 918271,918272,918273
 */
import { World } from '../../src/sim/core/world';
import { Simulation } from '../../src/sim/mind/agent';
import { generateVillage } from '../../src/sim/world/village';
import { SECONDS_PER_DAY } from '../../src/sim/core/time';
import { hungerBand, thirstBand } from '../../src/sim/core/physiology';
import { stockAt, worldStock } from '../../src/sim/world/stock';
import { detectAnomalies } from '../../src/sim/telemetry/anomaly';
import type { Person } from '../../src/sim/core/types';

const SEVERITY_ORDER = ['comfortable', 'noticeable', 'uncomfortable', 'urgent', 'critical'] as const;
const atLeast = (b: string, min: string) => SEVERITY_ORDER.indexOf(b as any) >= SEVERITY_ORDER.indexOf(min as any);

interface DaySample {
  day: number;
  grain: number; flour: number; bread: number; log: number; plank: number; stone: number;
  treesAvailable: number; stoneRemaining: number;
  constructionPct: number; constructionStatus: string;
  openHauls: number; oldestOpenHaulAgeDays: number;
  openProductionRequests: number;
  totalWealth: number; gini: number; below3: number;
  harvestsToDate: number; transformsToDate: number; mealsToDate: number; shortagesToDate: number;
  peopleUrgentHungry: number; peopleUrgentThirsty: number;
}

function gini(values: number[]): number {
  const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  const n = v.length; if (!n) return 0;
  const sum = v.reduce((a, b) => a + b, 0); if (sum <= 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (2 * (i + 1) - n - 1) * v[i];
  return Math.round((cum / (n * sum)) * 1000) / 1000;
}

function run(seed: number, days: number, substep = 0.15) {
  const world = new World(seed);
  generateVillage(world);
  const sim = new Simulation(world);
  const start = world.now;
  const total = days * SECONDS_PER_DAY;

  const samples: DaySample[] = [];
  // per-person consecutive-day deprivation streaks
  const hungerStreak = new Map<string, number>();
  const hungerStreakMax = new Map<string, number>();
  const thirstStreak = new Map<string, number>();
  const thirstStreakMax = new Map<string, number>();
  const goalDayCount = new Map<string, Record<string, number>>();

  let lastDay = -1;
  while (world.now - start < total) {
    const remaining = total - (world.now - start);
    const dt = remaining < substep * world.clock.timeScale ? Math.max(remaining / world.clock.timeScale, 0.001) : substep;
    const wdt = world.clock.advance(dt);
    world.physicalTime += dt;
    sim.step(dt, wdt);
    sim.flushSpeech();
    const day = Math.floor((world.now - start) / SECONDS_PER_DAY);
    if (day !== lastDay) {
      lastDay = day;
      samples.push(sample(world, day, hungerStreak, hungerStreakMax, thirstStreak, thirstStreakMax, goalDayCount));
    }
  }
  samples.push(sample(world, days, hungerStreak, hungerStreakMax, thirstStreak, thirstStreakMax, goalDayCount));
  return { world, sim, samples, hungerStreakMax, thirstStreakMax, goalDayCount, anomalies: detectAnomalies(world) };
}

function sample(
  world: World, day: number,
  hungerStreak: Map<string, number>, hungerStreakMax: Map<string, number>,
  thirstStreak: Map<string, number>, thirstStreakMax: Map<string, number>,
  goalDayCount: Map<string, Record<string, number>>,
): DaySample {
  const alive = world.persons().filter(p => p.alive && !p.controlled);
  let urgentH = 0, urgentT = 0;
  for (const p of alive) {
    const hb = hungerBand(p), tb = thirstBand(p);
    const hurt = atLeast(hb, 'urgent'); const thirsty = atLeast(tb, 'urgent');
    if (hurt) urgentH++; if (thirsty) urgentT++;
    const hs = hurt ? (hungerStreak.get(p.id) ?? 0) + 1 : 0;
    hungerStreak.set(p.id, hs); hungerStreakMax.set(p.id, Math.max(hungerStreakMax.get(p.id) ?? 0, hs));
    const ts = thirsty ? (thirstStreak.get(p.id) ?? 0) + 1 : 0;
    thirstStreak.set(p.id, ts); thirstStreakMax.set(p.id, Math.max(thirstStreakMax.get(p.id) ?? 0, ts));
    const g = p.mind.goal?.type ?? 'none';
    const row = goalDayCount.get(p.id) ?? {}; row[g] = (row[g] ?? 0) + 1; goalDayCount.set(p.id, row);
  }
  const proj = world.constructionProjects[0];
  const openHauls = world.haulTasks.filter(t => t.status === 'needed' || t.status === 'claimed' || t.status === 'in_transit');
  const oldest = openHauls.reduce((m, t) => Math.max(m, world.now - t.createdAt), 0);
  const wealths = alive.map(p => p.wealth);
  const trees = world.resourceNodes.filter(n => n.kind === 'tree');
  const stoneNodes = world.resourceNodes.filter(n => n.kind === 'stone');
  return {
    day,
    grain: worldStock(world, 'grain'), flour: worldStock(world, 'flour'), bread: worldStock(world, 'bread'),
    log: worldStock(world, 'log'), plank: worldStock(world, 'plank'), stone: worldStock(world, 'stone'),
    treesAvailable: trees.filter(n => n.state === 'available').length,
    stoneRemaining: stoneNodes.reduce((a, n) => a + n.remaining, 0),
    constructionPct: proj ? Math.round(100 * proj.laborDone / proj.laborRequired) : 0,
    constructionStatus: proj ? proj.status : 'none',
    openHauls: openHauls.length,
    oldestOpenHaulAgeDays: Math.round((oldest / SECONDS_PER_DAY) * 100) / 100,
    openProductionRequests: world.requests.filter(r => r.type === 'production' && (r.status === 'open' || r.status === 'accepted')).length,
    totalWealth: Math.round(wealths.reduce((a, b) => a + b, 0) * 100) / 100,
    gini: gini(wealths),
    below3: wealths.filter(w => w < 3).length,
    harvestsToDate: world.runTally.crop_harvested ?? 0,
    transformsToDate: world.runTally.resource_transformed ?? 0,
    mealsToDate: world.runTally.food_consumed ?? 0,
    shortagesToDate: world.runTally.resource_shortage ?? 0,
    peopleUrgentHungry: urgentH,
    peopleUrgentThirsty: urgentT,
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const get = (flag: string, dflt: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : dflt; };
  const days = Number(get('--days', '30'));
  const seeds = get('--seeds', '918271').split(',').map(Number);

  for (const seed of seeds) {
    const t0 = Date.now();
    const r = run(seed, days);
    const last = r.samples[r.samples.length - 1];
    const first = r.samples[0];
    console.log(`\n================ seed ${seed} · ${days} world-days · ${((Date.now() - t0) / 1000).toFixed(0)}s wall`);
    console.log('day  grain flour bread | log plank stone | trees stoneLeft | bldPct status     | hauls oldest | wealth  gini  <3 | harv trans meals short | urgH urgT');
    for (const s of r.samples) {
      console.log(
        `${String(s.day).padStart(3)}  ${String(s.grain).padStart(5)} ${String(s.flour).padStart(5)} ${String(s.bread).padStart(5)} | ${String(s.log).padStart(3)} ${String(s.plank).padStart(5)} ${String(s.stone).padStart(5)} | ` +
        `${String(s.treesAvailable).padStart(5)} ${String(s.stoneRemaining).padStart(9)} | ${String(s.constructionPct).padStart(6)} ${s.constructionStatus.padEnd(10)} | ` +
        `${String(s.openHauls).padStart(5)} ${String(s.oldestOpenHaulAgeDays).padStart(6)} | ${String(s.totalWealth).padStart(6)} ${String(s.gini).padStart(5)} ${String(s.below3).padStart(3)} | ` +
        `${String(s.harvestsToDate).padStart(4)} ${String(s.transformsToDate).padStart(5)} ${String(s.mealsToDate).padStart(5)} ${String(s.shortagesToDate).padStart(5)} | ${String(s.peopleUrgentHungry).padStart(4)} ${String(s.peopleUrgentThirsty).padStart(4)}`,
      );
    }
    // individual tails
    const worstHunger = [...r.hungerStreakMax.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const worstThirst = [...r.thirstStreakMax.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    console.log('worst individual hunger streaks (consecutive daily samples at >= urgent):');
    for (const [id, n] of worstHunger) console.log(`   ${String(n).padStart(3)} days  ${r.world.nameOf(id)} (${(r.world.person(id) as Person).occupation})`);
    console.log('worst individual thirst streaks:');
    for (const [id, n] of worstThirst) console.log(`   ${String(n).padStart(3)} days  ${r.world.nameOf(id)} (${(r.world.person(id) as Person).occupation})`);
    // production liveness: last day anything was produced
    const lastHarvestDay = [...r.samples].reverse().find((s, i, arr) => i + 1 < arr.length && s.harvestsToDate > arr[i + 1].harvestsToDate)?.day ?? -1;
    const lastTransformDay = [...r.samples].reverse().find((s, i, arr) => i + 1 < arr.length && s.transformsToDate > arr[i + 1].transformsToDate)?.day ?? -1;
    console.log(`liveness: last harvest on day ${lastHarvestDay}/${days}; last transform on day ${lastTransformDay}/${days}`);
    console.log(`stock drift: grain ${first.grain}→${last.grain}, flour ${first.flour}→${last.flour}, bread ${first.bread}→${last.bread}, logs ${first.log}→${last.log}, stone-in-ground ${first.stoneRemaining}→${last.stoneRemaining}, trees ${first.treesAvailable}→${last.treesAvailable}`);
    console.log(`wealth: total ${first.totalWealth}→${last.totalWealth}, gini ${first.gini}→${last.gini}, below-3-silver ${first.below3}→${last.below3}`);
    console.log(`end-of-run anomalies (existing detector): ${r.anomalies.length ? r.anomalies.map(a => `${a.type}x${a.occurrences}(${JSON.stringify(a.data)})`).join(', ') : 'none'}`);
    // Which goals do people actually spend their days in? (daily-sample histogram, whole village)
    const goalTotals: Record<string, number> = {};
    for (const row of r.goalDayCount.values()) for (const [g, n] of Object.entries(row)) goalTotals[g] = (goalTotals[g] ?? 0) + n;
    console.log('goal occupancy (daily samples): ' + Object.entries(goalTotals).sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g}=${n}`).join(', '));
    const richest = r.world.persons().filter(p => p.alive && !p.controlled).sort((a, b) => b.wealth - a.wealth)[0];
    const tw = r.world.persons().filter(p => p.alive && !p.controlled).reduce((a, p) => a + p.wealth, 0);
    console.log(`richest: ${richest.name} (${richest.occupation}) ${Math.round(richest.wealth)} silver = ${(100 * richest.wealth / Math.max(1, tw)).toFixed(1)}% of village wealth`);
  }
}

main();
