// v0.10.1 Part XI — look for the specific ways an NPC can be mechanically valid and obviously
// wrong, in a real village, and name the worst offenders.
//
//   npx tsx tools/audit/continuity-audit.ts 1337,918271 6
//
// Each detector below corresponds to one item in the milestone's own list. They read the canonical
// event stream and canonical state — no instrumentation is added to the simulation itself — so the
// same tool works unchanged against a `main` worktree for a before/after comparison.
import { World } from '../../src/sim/core/world';
import { Simulation } from '../../src/sim/mind/agent';
import { generateVillage } from '../../src/sim/world/village';
import { hungerBand, thirstBand, severityAtLeast } from '../../src/sim/core/physiology';
import type { EntityId } from '../../src/sim/core/types';

const seeds = (process.argv[2] ?? '1337,918271').split(',').map(Number);
const days = Number(process.argv[3] ?? 6);

/** A goal re-adopted this many times with no completion in between is not "trying", it is a loop. */
const RESELECT_THRESHOLD = 8;
/** Two goals alternating this many times inside an hour is walking back and forth. */
const OSCILLATION_THRESHOLD = 6;
/** A displacement this small is noise, not a decision. */
const TINY_MARGIN = 0.03;
const HOUR = 3600;

interface Tally { label: string; count: number; worst: string }

for (const seed of seeds) {
  const world = new World(seed);
  generateVillage(world);
  const sim = new Simulation(world);

  // --- per-person running state
  const runLength = new Map<string, number>();          // person|goalKey -> consecutive adoptions
  const lastGoals = new Map<EntityId, { key: string; at: number }[]>();
  const reselect = new Map<string, number>();
  const oscillation = new Map<string, number>();
  let tinyAbandon = 0; let tinyWorst = '';
  let staleReport = 0; let staleWorst = '';
  const pathFail = new Map<string, number>();

  world.onEvent(e => {
    if (e.type === 'goal_changed' && e.actor) {
      const key = String(e.data?.key ?? e.data?.to ?? '');
      const id = `${e.actor}|${key}`;
      const n = (runLength.get(id) ?? 0) + 1;
      runLength.set(id, n);
      if (n >= RESELECT_THRESHOLD) reselect.set(id, n);

      // A→B→A→B alternation inside an hour.
      const hist = lastGoals.get(e.actor) ?? [];
      hist.push({ key, at: world.now });
      while (hist.length && world.now - hist[0].at > HOUR) hist.shift();
      lastGoals.set(e.actor, hist);
      if (hist.length >= 4) {
        const keys = hist.map(h => h.key);
        const distinct = new Set(keys);
        if (distinct.size === 2 && keys.length >= OSCILLATION_THRESHOLD) {
          const pair = `${world.nameOf(e.actor)}: ${[...distinct].join(' ⇄ ')}`;
          oscillation.set(pair, Math.max(oscillation.get(pair) ?? 0, keys.length));
        }
      }

      // Dropping a task for something barely better.
      const from = e.data?.from as string | undefined;
      const u = Number(e.data?.utility ?? 0);
      const prevU = Number(e.data?.fromUtility ?? NaN);
      if (from && Number.isFinite(prevU) && Math.abs(u - prevU) < TINY_MARGIN && from !== e.data?.to) {
        tinyAbandon++;
        if (!tinyWorst) tinyWorst = `${world.nameOf(e.actor)}: ${from}(${prevU.toFixed(2)}) → ${e.data?.to}(${u.toFixed(2)})`;
      }

      // Still setting out to report something the watch has already been told.
      if (e.data?.to === 'report') {
        const p = world.person(e.actor);
        const k = p?.knowledge[String(e.data?.key ?? '')];
        if (k) {
          const guardKnows = world.persons().some(g => (g.occupation === 'guard' || g.occupation === 'captain') && k.sharedWith.includes(g.id));
          if (guardKnows) { staleReport++; if (!staleWorst) staleWorst = `${world.nameOf(e.actor)} set out to report something the watch already knows`; }
        }
      }
    }
    if (e.type === 'goal_completed' && e.actor) runLength.set(`${e.actor}|${String(e.data?.goalKey ?? e.data?.goalType ?? '')}`, 0);
    if (e.type === 'path_failure' && e.actor) {
      const id = `${world.nameOf(e.actor)} → ${e.target ? world.nameOf(e.target) : e.placeId ? world.nameOf(e.placeId) : 'somewhere'}`;
      pathFail.set(id, (pathFail.get(id) ?? 0) + 1);
    }
  });

  // --- sampled state: someone in real physiological trouble doing something else entirely
  let neglectSamples = 0; let neglectWorst = ''; let worstNeglect = 0;
  const neglectStreak = new Map<EntityId, number>();
  const SAMPLE = 1800;
  let nextSample = world.now + SAMPLE;

  const t0 = Date.now();
  const target = world.now + days * 24 * HOUR;
  while (world.now < target) {
    const dt = world.clock.advance(0.2); world.physicalTime += 0.2; sim.step(0.2, dt); sim.flushSpeech();
    if (world.now >= nextSample) {
      nextSample += SAMPLE;
      for (const p of world.persons()) {
        if (!p.alive || p.controlled) continue;
        const desperate = severityAtLeast(hungerBand(p), 'critical') || severityAtLeast(thirstBand(p), 'critical');
        const attending = p.mind.goal && ['eat', 'drink_water', 'sleep', 'flee', 'go_home'].includes(p.mind.goal.type);
        if (desperate && !attending) {
          const streak = (neglectStreak.get(p.id) ?? 0) + 0.5;
          neglectStreak.set(p.id, streak);
          neglectSamples++;
          if (streak > worstNeglect) { worstNeglect = streak; neglectWorst = `${p.name} spent ${streak.toFixed(1)}h at a critical need while pursuing ${p.mind.goal?.type ?? 'nothing'}`; }
        } else neglectStreak.set(p.id, 0);
      }
    }
  }
  const wall = (Date.now() - t0) / 1000;

  const top = (m: Map<string, number>): string => {
    const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    return best ? `${best[0]} ×${best[1]}` : '—';
  };
  const tallies: Tally[] = [
    { label: 'goal re-adopted without completing', count: reselect.size, worst: top(reselect) },
    { label: 'two goals alternating within an hour', count: oscillation.size, worst: top(oscillation) },
    { label: 'task dropped for a margin under 0.03', count: tinyAbandon, worst: tinyWorst || '—' },
    { label: 'repeated failure to reach a target', count: [...pathFail.values()].filter(n => n >= RESELECT_THRESHOLD).length, worst: top(pathFail) },
    { label: 'critical need ignored (half-hour samples)', count: neglectSamples, worst: neglectWorst || '—' },
    { label: 'set out to report what the watch knows', count: staleReport, worst: staleWorst || '—' },
  ];

  console.log(`\n=== seed ${seed}, ${days} day(s), ${wall.toFixed(1)}s ===`);
  for (const t of tallies) console.log(`  ${String(t.count).padStart(6)}  ${t.label}\n          ${t.worst}`);
}
