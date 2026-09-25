// Read-only profiling of one committed generation; never opens a writer or changes the save.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deserialize, serialize } from '../../src/sim/persist/save';

const [input, output] = process.argv.slice(2).map(p => resolve(p));
assert(input && output && !existsSync(output), 'Existing save and NEW report path required');
const raw = readFileSync(input, 'utf8'), plain = JSON.parse(raw);
const parseStarted = performance.now(), restored = deserialize(raw);
assert(restored, 'Save must validate before profiling');
const loadMs = performance.now() - parseStarted;
const samples: { serializeMs: number; stringifyMs: number; bytes: number }[] = [];
for (let n = 0; n < 3; ++n) {
  const started = performance.now(), saved = serialize(restored.world), serializedAt = performance.now();
  JSON.stringify(plain);
  samples.push({ serializeMs: serializedAt - started, stringifyMs: performance.now() - serializedAt, bytes: saved.length });
  await new Promise<void>(r => setImmediate(r));
}
const counts: Record<string, number> = {};
for (const e of restored.world.events) counts[e.type] = (counts[e.type] ?? 0) + 1;
writeFileSync(output, JSON.stringify({ input, loadMs, samples, eventCount: restored.world.events.length, eventTypes: counts, memory: process.memoryUsage(), scope: 'offline read-only snapshot; no live tick or write' }, null, 2));
console.log(JSON.stringify({ output, loadMs, samples }));
