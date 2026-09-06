// v0.10 Part XI: multi-seed, multi-day stability probe for the motivation layers.
//
// Watches specifically for the failure modes the milestone names: purposes that never terminate,
// obligations multiplying without bound, goal churn, concern/purpose feedback, and anyone
// starving because a social purpose became absolute. Reports absolute numbers rather than
// pass/fail, so a regression is visible as a change rather than only as a broken threshold.
import { World } from '../../src/sim/core/world';
import { Simulation } from '../../src/sim/mind/agent';
import { generateVillage } from '../../src/sim/world/village';
import { pursuitsOf } from '../../src/sim/mind/pursuit';
import { obligationsOf } from '../../src/sim/social/obligation';
import { hungerBand, thirstBand } from '../../src/sim/core/physiology';

const seeds = (process.argv[2] ?? '1337,918271,42424242,12345,606060').split(',').map(Number);
const days = Number(process.argv[3] ?? 10);

console.log(`seed        wall(s)  goalChg  attacks  purpForm  purpRes  live  neverEnd  maxSteps  obForm  obRes  obFail  liveOb  maxOb  starving  deaths`);
for (const seed of seeds) {
  const world = new World(seed);
  generateVillage(world);
  const sim = new Simulation(world);
  const t0 = Date.now();
  const target = world.now + days * 24 * 3600;
  while (world.now < target) { const dt = world.clock.advance(0.2); world.physicalTime += 0.2; sim.step(0.2, dt); sim.flushSpeech(); }
  const wall = (Date.now() - t0) / 1000;

  const t = world.runTally;
  let live = 0, neverEnd = 0, maxSteps = 0, liveOb = 0, maxOb = 0, starving = 0, deaths = 0;
  const oldest = world.now - days * 24 * 3600;
  for (const p of world.persons()) {
    if (!p.alive) { deaths++; continue; }
    if (p.controlled) continue;
    for (const pu of pursuitsOf(p)) {
      if (pu.status !== 'active' && pu.status !== 'deferred') continue;
      live++;
      // "Never terminates" means: still live and formed before the run's own window even opened.
      if (pu.createdAt < oldest) neverEnd++;
      maxSteps = Math.max(maxSteps, pu.steps.length);
    }
    const obs = obligationsOf(p).filter(o => o.status === 'live');
    liveOb += obs.length;
    maxOb = Math.max(maxOb, obligationsOf(p).length);
    if (hungerBand(p) === 'critical' || thirstBand(p) === 'critical') starving++;
  }
  const n = (k: string) => String(t[k] ?? 0).padStart(7);
  console.log(
    `${String(seed).padEnd(11)} ${wall.toFixed(1).padStart(6)} ${n('goal_changed')}  ${String(world.events.filter(e => e.type === 'attack').length).padStart(7)}  ${n('pursuit_formed')}  ${n('pursuit_resolved')} ${String(live).padStart(5)} ${String(neverEnd).padStart(9)} ${String(maxSteps).padStart(9)} ${n('obligation_formed')} ${n('obligation_resolved')} ${n('obligation_failed')} ${String(liveOb).padStart(6)} ${String(maxOb).padStart(6)} ${String(starving).padStart(9)} ${String(deaths).padStart(7)}`,
  );
}
