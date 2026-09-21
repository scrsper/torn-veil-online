import { beforeEach, afterEach, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { Session } from 'node:inspector';
import { Simulation } from '../../src/sim/mind/agent';
import { serialize, deserialize } from '../../src/sim/persist/save';
import { stockAt } from '../../src/sim/world/stock';
import { effectivePrice } from '../../src/sim/world/pricing';
import { createProfile } from './profiler';
import { World } from '../../src/sim/core/world';

let sim: Simulation | undefined, steps = 0, start = 0, cpuStart = process.cpuUsage();
let hostStart = hostCPU();
let inspector: Session | undefined;
let measurement: Record<string, any>;
let counters: ReturnType<typeof createProfile> | undefined;
const debugGlobal = globalThis as any;
const originalEmit = World.prototype.emit;
if (process.env.FOOD_PERF_INSTRUMENT === '1') World.prototype.emit = function (...args: Parameters<World['emit']>) {
  const event = originalEmit.apply(this, args);
  if (counters) counters.work(`emitted:${event.type}`);
  if (counters && event.data?.encounter) counters.work('encounters.retained');
  return event;
};
const originalStep = Simulation.prototype.step;
Simulation.prototype.step = function (...args: Parameters<Simulation['step']>) {
  if (sim !== this) { sim = this; if (process.env.FOOD_PERF_PROFILE === '1') this.profile = {}; }
  steps++;
  return originalStep.apply(this, args);
};
function hostCPU() {
  return os.cpus().reduce((sum, c) => ({ idle: sum.idle + c.times.idle, total: sum.total + Object.values(c.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 });
}
function sorted(v: any): any {
  return Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v;
}
function digest(raw: string) {
  const value = JSON.parse(raw); delete value.savedAt;
  return { digest: createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex'), orderedDigest: createHash('sha256').update(JSON.stringify(value)).digest('hex'), rng: { world: value.rng, weather: value.weatherRng, demographic: value.demographicRng, ecology: value.ecology?.rngState } };
}
function post(method: string, params?: any): Promise<any> {
  return new Promise((resolve, reject) => inspector!.post(method as any, params, (error, result) => error ? reject(error) : resolve(result)));
}
beforeEach(async () => {
  sim = undefined; steps = 0;
  if (process.env.FOOD_PERF_INSTRUMENT === '1') {
    const { profileLabels } = await import('./instrumentation');
    debugGlobal.__foodProfile = counters = createProfile(profileLabels);
  }
  if (process.env.FOOD_PERF_PROFILE === '1') { inspector = new Session(); inspector.connect(); await post('Profiler.enable'); await post('Profiler.start'); }
  hostStart = hostCPU(); cpuStart = process.cpuUsage(); start = performance.now();
});
afterEach(context => {
  const wallSeconds = (performance.now() - start) / 1000;
  const cpu = process.cpuUsage(cpuStart), resources = process.resourceUsage(), host = hostCPU();
  measurement = { test: context.task.name, wallSeconds, cpuSeconds: (cpu.user + cpu.system) / 1e6,
    userCPUSeconds: cpu.user / 1e6, systemCPUSeconds: cpu.system / 1e6, processPeakRSSMB: resources.maxRSS / 1024,
    hostBusyPercent: 100 * (1 - (host.idle - hostStart.idle) / (host.total - hostStart.total)),
    failure: context.task.result?.errors?.map((e: any) => ({ message: e.message, actual: e.actual, expected: e.expected, code: e.code })) };
  if (counters) { measurement.profile = counters.snapshot(); delete debugGlobal.__foodProfile; counters = undefined; }
});
afterAll(async () => {
  const output = process.env.FOOD_PERF_OUTPUT!;
  if (inspector) { const { profile } = await post('Profiler.stop'); writeFileSync(output + '.cpuprofile', JSON.stringify(profile)); inspector.disconnect(); inspector = undefined; }
  if (!sim) throw Error('Food workload did not create a Simulation');
  const source = sim, world = source.world;
  const bakery = world.places().find(p => p.type === 'bakery')!;
  const bread = stockAt(world, 'bread', bakery.id);
  const saved = serialize(world), state = digest(saved);
  const report: Record<string, any> = {
    ...measurement, revision: process.env.FOOD_PERF_REVISION, seed: world.seed,
    mode: process.env.FOOD_PERF_PROFILE === '1' ? 'profile' : 'timing', head: process.env.FOOD_PERF_HEAD,
    node: process.version,
    freeMemoryGB: os.freemem() / 2 ** 30, ...state,
    food: { bread, breadPrice: effectivePrice('bread', 2, bread), alive: world.persons().filter(p => p.alive).length, requests: world.requests.length },
    counts: { steps, people: world.persons().length, eventsRetained: world.events.length,
      knowledgeRetained: world.persons().reduce((n, p) => n + Object.keys(p.knowledge).length, 0),
      memoriesRetained: world.persons().reduce((n, p) => n + p.memories.length, 0),
      pathSearches: world.nav.searches, pathCacheHits: world.nav.cacheHits, spatial: world.spatialStats(), eventsByType: { ...world.runTally } },
    subsystemMilliseconds: source.profile ? { ...source.profile } : null,
  };
  if (process.env.FOOD_PERF_REPLAY !== '0') {
    const loaded = deserialize(saved)?.world;
    if (!loaded) throw Error('Food workload save did not reload');
    const resumed = new Simulation(loaded);
    const advance = (s: Simulation) => { for (let i = 0; i < 20; i++) { const dt = 0.15; const wdt = s.world.clock.advance(dt); s.world.physicalTime += dt; s.step(dt, wdt); s.flushSpeech(); } };
    advance(source); advance(resumed);
    report.continuation = { original: digest(serialize(world)), reloaded: digest(serialize(loaded)) };
    report.continuation.matches = report.continuation.original.digest === report.continuation.reloaded.digest;
    if (!report.continuation.matches) {
      const diffs: any[] = [];
      const walk = (a: any, b: any, path = '') => {
        if (diffs.length >= 20 || Object.is(a, b)) return;
        if (a && b && typeof a === 'object' && typeof b === 'object') {
          for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) if (key !== 'savedAt') walk(a[key], b[key], `${path}/${key}`);
        } else diffs.push({ path, original: a, reloaded: b });
      };
      walk(JSON.parse(serialize(world)), JSON.parse(serialize(loaded)));
      report.continuation.differences = diffs;
    }
  }
  writeFileSync(output, JSON.stringify(report, null, 2));
});
