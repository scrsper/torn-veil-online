#!/usr/bin/env node
/**
 * Save/load PRNG-continuity probe (independent audit, second pass).
 *
 * Question: is the pseudo-random state (`world.rng`, and now also `world.weatherRng`) preserved
 * across serialize/deserialize? If not, a saved world does not CONTINUE on load — it re-plays
 * the post-generation stream position, so the future after a load differs from the future of an
 * uninterrupted run, even at the same seed.
 *
 * Method: run N world-seconds; snapshot the next K draws of each stream; then serialize,
 * deserialize, and snapshot the next K draws of the reloaded world's streams. Identical draws
 * would mean state was preserved. Also compares the reloaded world's weather schedule.
 *
 * Usage: npx tsx tools/audit/save-rng-continuity.ts
 */
import { World } from '../../src/sim/core/world';
import { Simulation } from '../../src/sim/mind/agent';
import { newWorld, serialize, deserialize } from '../../src/sim/persist/save';
import { SECONDS_PER_DAY } from '../../src/sim/core/time';

function advance(world: World, sim: Simulation, worldSeconds: number): void {
  const substep = 0.15;
  const target = world.now + worldSeconds;
  while (world.now < target) {
    const dt = substep;
    const wdt = world.clock.advance(dt);
    world.physicalTime += dt;
    sim.step(dt, wdt);
    sim.flushSpeech();
  }
}

const SEED = 918271;
const DAYS = 2;
const K = 6;

const { world } = newWorld(SEED);
const sim = new Simulation(world);
advance(world, sim, DAYS * SECONDS_PER_DAY);

// Snapshot the live world's next draws by cloning stream state via a throwaway probe: we cannot
// peek without consuming, so we consume on the LIVE world (this world is discarded afterwards).
/** `world.weatherRng` only exists from PR #12's v0.8 §9 weather-stream separation onward. This
 * probe is written to run against either commit, so the second stream is optional. */
const weatherStream = (w: World): { next(): number } | null => (w as unknown as { weatherRng?: { next(): number } }).weatherRng ?? null;
const drawK = (s: { next(): number } | null) => s ? Array.from({ length: K }, () => Number(s.next().toFixed(9))) : [];

const liveMain = Array.from({ length: K }, () => Number(world.rng.next().toFixed(9)));
const liveWeather = drawK(weatherStream(world));
const liveWeatherState = { ...world.weather };
const liveNow = world.now;

// Re-run an identical world to the same point so the serialized snapshot is taken from a world
// whose streams have NOT been disturbed by the peek above.
const { world: w2 } = newWorld(SEED);
const sim2 = new Simulation(w2);
advance(w2, sim2, DAYS * SECONDS_PER_DAY);
const json = serialize(w2);

const restored = deserialize(json);
if (!restored) { console.error('deserialize returned null'); process.exit(1); }
const rw = restored.world;
const loadedMain = Array.from({ length: K }, () => Number(rw.rng.next().toFixed(9)));
const loadedWeather = drawK(weatherStream(rw));

// A freshly generated world, never advanced — what the stream position would be right after
// generation. If the loaded world matches THIS instead of the live world, the stream was rewound.
const { world: w3 } = newWorld(SEED);
const freshMain = Array.from({ length: K }, () => Number(w3.rng.next().toFixed(9)));
const freshWeather = drawK(weatherStream(w3));

const eq = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

console.log(`save/load PRNG continuity · seed ${SEED} · ran ${DAYS} world-days before saving\n`);
console.log('main stream (world.rng)');
console.log(`  after ${DAYS}d, live next-${K}: ${liveMain.map(n => n.toFixed(4)).join(' ')}`);
console.log(`  after load,   next-${K}:        ${loadedMain.map(n => n.toFixed(4)).join(' ')}`);
console.log(`  fresh post-generation next-${K}: ${freshMain.map(n => n.toFixed(4)).join(' ')}`);
console.log(`  loaded == live (state preserved)?      ${eq(loadedMain, liveMain) ? 'YES' : 'NO'}`);
console.log(`  loaded == fresh (stream REWOUND)?      ${eq(loadedMain, freshMain) ? 'YES' : 'NO'}`);
console.log('');
if (!liveWeather.length) console.log('weather stream (world.weatherRng): not present on this commit — skipped');
else {
console.log('weather stream (world.weatherRng, new in v0.8 §9)');
console.log(`  after ${DAYS}d, live next-${K}: ${liveWeather.map(n => n.toFixed(4)).join(' ')}`);
console.log(`  after load,   next-${K}:        ${loadedWeather.map(n => n.toFixed(4)).join(' ')}`);
console.log(`  fresh post-generation next-${K}: ${freshWeather.map(n => n.toFixed(4)).join(' ')}`);
console.log(`  loaded == live (state preserved)?      ${eq(loadedWeather, liveWeather) ? 'YES' : 'NO'}`);
console.log(`  loaded == fresh (stream REWOUND)?      ${eq(loadedWeather, freshWeather) ? 'YES' : 'NO'}`);
}
console.log('');
console.log(`weather VALUE round-trips (it is in the save payload): live=${liveWeatherState.kind}@${liveWeatherState.intensity.toFixed(2)} loaded=${rw.weather.kind}@${rw.weather.intensity.toFixed(2)}`);
console.log(`world clock round-trips: live now=${Math.round(liveNow)} loaded now=${Math.round(rw.now)}`);

// Behavioural consequence: continue both worlds and compare a downstream outcome.
const contLive = (() => { const { world: a } = newWorld(SEED); const s = new Simulation(a); advance(a, s, DAYS * SECONDS_PER_DAY); advance(a, s, SECONDS_PER_DAY); return a; })();
const restored2 = deserialize(json)!;
const s2 = new Simulation(restored2.world);
advance(restored2.world, s2, SECONDS_PER_DAY);
const cmp = (w: World) => ({
  events: w.events.length,
  weather: `${w.weather.kind}@${w.weather.intensity.toFixed(2)}`,
  meals: w.runTally.food_consumed ?? 0,
  harvests: w.runTally.crop_harvested ?? 0,
  wealth: Math.round(w.persons().filter(p => p.alive && !p.controlled).reduce((n, p) => n + p.wealth, 0)),
});
console.log('\nBEHAVIOURAL CONSEQUENCE — same seed, +1 more world-day after the save point:');
console.log(`  uninterrupted run : ${JSON.stringify(cmp(contLive))}`);
console.log(`  save -> load -> run: ${JSON.stringify(cmp(restored2.world))}`);
console.log(`  (runTally is not persisted, so cumulative counters legitimately restart; compare weather + wealth)`);
