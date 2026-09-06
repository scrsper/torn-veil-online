// Before/after probe for milestone work: reports run cost and village health using ONLY the
// APIs that exist on both sides of a change, so the same file can be dropped into a worktree of
// the base branch and run there unmodified. That is the whole point of it — a v0.10 number is
// meaningless without the same number from the branch it is being compared against.
//
// Deprivation is INTEGRATED (person-hours spent in a critical band, sampled every 30 world
// minutes) rather than read off the final instant. A final-instant count of who happens to be
// starving when the run stops is dominated by what time of day the run ended on.
//
//   npx tsx tools/audit/baseline-compare.ts 1337,918271,42424242 10
//
// Run each side ALONE and back to back. Timings taken while anything else is running on the
// machine are contention, not cost — see docs/V0_9_SOCIAL_CAUSALITY.md.
import { World } from '../../src/sim/core/world';
import { Simulation } from '../../src/sim/mind/agent';
import { generateVillage } from '../../src/sim/world/village';
import { hungerBand, thirstBand, sleepBand } from '../../src/sim/core/physiology';

const seeds = (process.argv[2] ?? '1337').split(',').map(Number);
const days = Number(process.argv[3] ?? 10);
console.log('seed        wall(s)  goalChg  attacks  critHungH  critThirstH  critSleepH  deaths  meals  drinks');
for (const seed of seeds) {
  const world = new World(seed);
  generateVillage(world);
  const sim = new Simulation(world);
  let goalChanges = 0;
  world.onEvent(e => { if (e.type === 'goal_changed') goalChanges++; });
  const t0 = Date.now();
  const target = world.now + days * 24 * 3600;
  const sampleEvery = 1800; // world seconds
  let nextSample = world.now + sampleEvery;
  let hungH = 0, thirstH = 0, sleepH = 0;
  while (world.now < target) {
    const dt = world.clock.advance(0.2); world.physicalTime += 0.2; sim.step(0.2, dt); sim.flushSpeech();
    if (world.now >= nextSample) {
      nextSample += sampleEvery;
      for (const p of world.persons()) {
        if (!p.alive || p.controlled) continue;
        if (hungerBand(p) === 'critical') hungH += 0.5;
        if (thirstBand(p) === 'critical') thirstH += 0.5;
        if (sleepBand(p) === 'critical') sleepH += 0.5;
      }
    }
  }
  const wall = (Date.now() - t0) / 1000;
  let deaths = 0;
  for (const p of world.persons()) if (!p.alive) deaths++;
  const attacks = world.events.filter(e => e.type === 'attack').length;
  const t = world.runTally;
  console.log(`${String(seed).padEnd(11)} ${wall.toFixed(1).padStart(6)} ${String(goalChanges).padStart(8)} ${String(attacks).padStart(8)} ${hungH.toFixed(0).padStart(10)} ${thirstH.toFixed(0).padStart(12)} ${sleepH.toFixed(0).padStart(11)} ${String(deaths).padStart(7)} ${String(t.meal ?? 0).padStart(6)} ${String(t.drink ?? 0).padStart(7)}`);
}
