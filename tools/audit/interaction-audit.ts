// v0.10.1 Part XVIII — the measurements this milestone is required to report, in one place.
//
// Every column is a number the milestone names: duplicated items and invalid ownership (Part XVI),
// transaction counts and failures (Part X), long-running report goals (Part XII), goal churn and
// critical-need neglect (Part XI), request growth, and run cost.
//
//   npx tsx tools/audit/interaction-audit.ts 1337,918271,42424242 10
//
// Shape-compatible where it can be: the columns that exist on both sides of this milestone are
// printed first, so a `main` worktree running `tools/audit/baseline-compare.ts` lines up against
// the left half of this table.
import { World } from '../../src/sim/core/world';
import { Simulation } from '../../src/sim/mind/agent';
import { generateVillage } from '../../src/sim/world/village';
import { hungerBand, thirstBand } from '../../src/sim/core/physiology';
import type { Item, Person } from '../../src/sim/core/types';

const seeds = (process.argv[2] ?? '1337,918271,42424242').split(',').map(Number);
const days = Number(process.argv[3] ?? 10);

/** Every way one item can be in two places at once, or in none. Returns human-readable problems. */
export function itemIntegrityProblems(world: World): string[] {
  const problems: string[] = [];
  const inventoryOf = new Map<string, Person[]>();
  for (const p of world.persons()) {
    for (const id of p.inventory) {
      const list = inventoryOf.get(id) ?? [];
      list.push(p);
      inventoryOf.set(id, list);
    }
  }
  for (const it of world.items() as Item[]) {
    const holders = inventoryOf.get(it.id) ?? [];
    if (it.quantity <= 0) {
      if (holders.length) problems.push(`${it.id} (${it.type}) is empty but still in ${holders.length} inventory/ies`);
      continue;
    }
    if (holders.length > 1) problems.push(`${it.id} (${it.type}) is in ${holders.length} inventories at once`);
    if (it.holderId) {
      if (!holders.some(h => h.id === it.holderId)) problems.push(`${it.id} (${it.type}) claims holder ${it.holderId} whose inventory does not list it`);
      if (it.pos || it.placeId) problems.push(`${it.id} (${it.type}) is held AND lying in the world`);
    } else if (holders.length) {
      problems.push(`${it.id} (${it.type}) is unheld but listed in ${holders[0].name}'s inventory`);
    }
    if (it.ownerId && !world.person(it.ownerId) && !world.place(it.ownerId)) problems.push(`${it.id} (${it.type}) is owned by ${it.ownerId}, which is not a person or a place`);
  }
  return problems;
}

console.log('seed        wall(s)  goalChg  attacks  starving  deaths  purchases  purchAmt  reports  reportsUndelivered  longReports  requests  haulTasks  dupItems  badOwner');
for (const seed of seeds) {
  const world = new World(seed);
  generateVillage(world);
  const sim = new Simulation(world);
  let goalChanges = 0, purchases = 0, reportGoals = 0;
  world.onEvent(e => {
    if (e.type === 'goal_changed') { goalChanges++; if (e.data?.to === 'report') reportGoals++; }
    if (e.type === 'purchase_made') purchases++;
  });
  const t0 = Date.now();
  const target = world.now + days * 24 * 3600;
  while (world.now < target) { const dt = world.clock.advance(0.2); world.physicalTime += 0.2; sim.step(0.2, dt); sim.flushSpeech(); }
  const wall = (Date.now() - t0) / 1000;

  let starving = 0, deaths = 0, reports = 0, undelivered = 0, longReports = 0;
  for (const p of world.persons()) {
    if (!p.alive) { deaths++; continue; }
    if (p.controlled) continue;
    if (hungerBand(p) === 'critical' || thirstBand(p) === 'critical') starving++;
    for (const r of Object.values(p.mind.reports ?? {})) {
      reports++;
      if (r.status !== 'delivered' && r.status !== 'moot') undelivered++;
      // "Still trying about something learned more than a day ago" is the shape of the v0.10
      // report attractor: a goal that never concludes and keeps outbidding the body.
      if (r.status === 'seeking' && world.now - r.firstAt > 24 * 3600) longReports++;
    }
  }
  const problems = itemIntegrityProblems(world);
  const dup = problems.filter(s => /inventories|held AND/.test(s)).length;
  const badOwner = problems.filter(s => /owned by/.test(s)).length;
  const n = (x: number, w = 7) => String(x).padStart(w);
  console.log(
    `${String(seed).padEnd(11)} ${wall.toFixed(1).padStart(6)} ${n(goalChanges, 8)} ${n(world.events.filter(e => e.type === 'attack').length, 8)} ${n(starving, 9)} ${n(deaths, 7)} ${n(purchases, 10)} ${n(Math.round(world.runTally.purchase_amount ?? 0), 9)} ${n(reports, 8)} ${n(undelivered, 19)} ${n(longReports, 12)} ${n(world.requests.length, 9)} ${n(world.haulTasks.length, 10)} ${n(dup, 9)} ${n(badOwner, 9)}`,
  );
  if (problems.length) {
    console.log(`  ! ${problems.length} item-integrity problem(s):`);
    for (const p of problems.slice(0, 10)) console.log(`      ${p}`);
  }
  void reportGoals;
}
