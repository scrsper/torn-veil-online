// Read-only inspection, with optional lossless expansion to a NEW non-authoritative file.
// node --import tsx scripts/alpha/inspect-checkpoint.ts --input <world.json> [--expand <new.json>]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeEventTable } from '../../src/sim/persist/eventTable';
const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const input = arg('input'); if (!input) throw new Error('--input is required');
const data = JSON.parse(readFileSync(input, 'utf8')), packed = data.eventEncoding !== undefined;
if (packed) {
  if (data.version !== 25) throw new Error('Unsupported encoded checkpoint');
  data.events = decodeEventTable({ ...data.eventEncoding, rows: data.events });
  delete data.eventEncoding;
}
const types: Record<string, number> = {};
for (const event of data.events) types[event.type] = (types[event.type] ?? 0) + 1;
const expanded = arg('expand');
if (expanded) {
  if (existsSync(expanded) || resolve(expanded) === resolve(input)) throw new Error('Expansion requires a new output file');
  writeFileSync(expanded, JSON.stringify(data), { flag: 'wx' });
}
console.log(JSON.stringify({ input, schema: data.version, packed, seed: data.seed, physicalTime: data.physicalTime,
  persons: data.persons.length, living: data.persons.filter((p: any) => p.alive).length,
  knowledge: data.persons.reduce((n: number, p: any) => n + Object.keys(p.knowledge).length, 0), events: data.events.length, types,
  expanded: expanded ?? null }, null, 2));
