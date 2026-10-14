import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const directory = resolve(process.argv[2] ?? '.debug/motion-correction/focused-journey-v11');
const result = JSON.parse(readFileSync(resolve(directory, 'result.json'), 'utf8'));
assert.equal(result.status, 'passed');
const combat = result.samples.find(sample => sample.name === '07-canonical-combat').frame;
const reloaded = result.samples.find(sample => sample.name === '08-reloaded-floor').frame;
const state = frame => ({ person: frame.own.id, body: frame.own.bodyId, rank: frame.own.rank,
  health: frame.own.health, inventory: frame.snapshot.bodies.find(body => body.bodyId === frame.own.bodyId).inventory,
  run: frame.tower.id, floor: frame.tower.floor });
assert.deepEqual(state(reloaded), state(combat), 'Recorded post-combat reload changed canonical state');
const initial = result.samples.find(sample => sample.name === '06-floor-traversal').frame;
assert.ok(reloaded.snapshot.bodies.some(body => body.bodyId !== reloaded.own.bodyId &&
  body.hitSeq > (initial.snapshot.bodies.find(before => before.bodyId === body.bodyId)?.hitSeq ?? body.hitSeq)),
  'Recorded uninterrupted journey contains no actual contact on an opposing body');
const distribution = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = percentile => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentile))] ?? null;
  return { count: sorted.length, median: at(.5), p95: at(.95), p99: at(.99), max: sorted.at(-1) ?? null };
};
const summary = {
  status: result.status,
  commit: result.health.clientBuild.commit,
  errors: result.errors,
  canonicalReload: state(reloaded),
  hitSequences: reloaded.snapshot.bodies.map(body => ({ body: body.bodyId, hitSeq: body.hitSeq })),
  method: result.measurement,
  caveats: 'Recorded headless Chrome intervals include video/readback/automation overhead. GPU residency/VRAM and human climb pacing were not measured. Each snapshot contains cumulative samples since its page load; distributions overlap and must not be summed.',
  phases: result.samples.map(sample => ({
    name: sample.name, kind: sample.kind,
    frameMs: distribution(sample.frames ?? []),
    streamingFrameMs: distribution(sample.streamingFrames ?? []),
    chunkUploadMs: distribution(sample.uploads ?? []),
    serverMs: distribution(sample.serverMs ?? sample.serverSamples ?? []),
    loaded: sample.loaded, pending: sample.pending, focused: sample.focused,
    meshes: sample.meshes, textures: sample.textures, heap: sample.heap,
    hardware: sample.hardware, journeys: sample.journeys,
  })),
};
writeFileSync(resolve(directory, 'measurements.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
