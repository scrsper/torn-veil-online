// Scratch probe: boot the real village, run a couple of days, and report what the v0.10
// motivation layers actually produced. Not a test — a development instrument.
import { World } from '../../src/sim/core/world';
import { Simulation } from '../../src/sim/mind/agent';
import { generateVillage } from '../../src/sim/world/village';
import { SECONDS_PER_HOUR } from '../../src/sim/core/time';
import { pursuitsOf, describePursuit } from '../../src/sim/mind/pursuit';
import { obligationsOf, describeObligation } from '../../src/sim/social/obligation';

const seed = Number(process.argv[2] ?? 1337);
const days = Number(process.argv[3] ?? 2);
const world = new World(seed);
generateVillage(world);
const sim = new Simulation(world);
const t0 = Date.now();
const target = world.now + days * 24 * SECONDS_PER_HOUR;
while (world.now < target) { const dt = world.clock.advance(0.2); world.physicalTime += 0.2; sim.step(0.2, dt); sim.flushSpeech(); }
const ms = Date.now() - t0;

const counts: Record<string, number> = {};
for (const e of world.events) counts[e.type] = (counts[e.type] ?? 0) + 1;
const tally = world.runTally;
console.log(`seed ${seed}, ${days}d in ${(ms / 1000).toFixed(1)}s`);
console.log('tally:', ['pursuit_formed', 'pursuit_resolved', 'obligation_formed', 'obligation_resolved', 'obligation_failed'].map(t => `${t}=${tally[t] ?? 0}`).join(' '));
console.log('attacks:', counts.attack ?? 0, 'goal_changed:', counts.goal_changed ?? 0, 'concern_formed:', tally.concern_formed ?? counts.concern_formed ?? 0);
let live = 0, settled = 0, obLive = 0, obSettled = 0;
for (const p of world.persons()) {
  for (const pu of pursuitsOf(p)) (pu.status === 'active' || pu.status === 'deferred') ? live++ : settled++;
  for (const o of obligationsOf(p)) o.status === 'live' ? obLive++ : obSettled++;
}
console.log(`pursuits: ${live} live / ${settled} settled ; obligations: ${obLive} live / ${obSettled} settled`);
for (const p of world.persons()) {
  const pus = pursuitsOf(p);
  if (!pus.length && !obligationsOf(p).length) continue;
  console.log(`  ${p.name} (${p.occupation}) goal=${p.mind.goal?.type ?? '-'}`);
  for (const pu of pus) console.log(`     [${pu.status}] ${describePursuit(world, pu)} pri=${pu.priority.toFixed(2)} attempts=${pu.attempts} steps=${pu.steps.join('>')} ${pu.resolution ?? ''}`);
  for (const o of obligationsOf(p)) console.log(`     (${o.status}) ${describeObligation(world, o)} mag=${o.magnitude.toFixed(2)} ${o.resolution ?? ''}`);
}
