import { describe, expect, it } from 'vitest';
import { SpatialIndex } from '../src/sim/core/spatial';

type Entry = { id: string; value: number };
type Box = { x0: number; z0: number; x1: number; z1: number } | null;
const box = (x: number, z: number): Box => ({ x0: x, x1: x, z0: z, z1: z });

function oracle(entries: readonly { entry: Entry; box: Box; order: number }[], size: number, pos: { x: number; z: number }, radius: number): Entry[] {
  const x0 = Math.floor((pos.x - radius) / size), x1 = Math.floor((pos.x + radius) / size);
  const z0 = Math.floor((pos.z - radius) / size), z1 = Math.floor((pos.z + radius) / size);
  const wide = (x1 - x0 + 1) * (z1 - z0 + 1) > 4096;
  const cells = new Set<string>(); for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) cells.add(`${x},${z}`);
  return entries.filter(({ box: b }) => {
    if (!b) return false;
    const bx0 = Math.floor(b.x0 / size), bx1 = Math.floor(b.x1 / size), bz0 = Math.floor(b.z0 / size), bz1 = Math.floor(b.z1 / size);
    if ((bx1 - bx0 + 1) * (bz1 - bz0 + 1) > 4096) return true;
    if (wide) return true;
    for (let x = bx0; x <= bx1; x++) for (let z = bz0; z <= bz1; z++) if (cells.has(`${x},${z}`)) return true;
    return false;
  }).sort((a, b) => a.order - b.order).map(x => x.entry);
}

describe('SpatialIndex query memo', () => {
  it('matches an independent broad-phase oracle through deterministic mutations', () => {
    const index = new SpatialIndex<Entry>(4);
    const entries = [...Array(8)].map((_, i) => ({ entry: { id: `e${i}`, value: i }, box: null as Box, order: i }));
    const set = (i: number, b: Box) => { entries[i].box = b; index.update(entries[i].entry, b); };
    set(0, box(1, 1)); set(1, box(2, 1)); set(2, box(9, 9)); set(3, box(12, 1));
    const queries = [{ x: 1, y: 0, z: 1, r: 5 }, { x: 10, y: 0, z: 1, r: 2 }, { x: -4, y: 0, z: -4, r: 3 }];
    const expectQuery = (q: { x: number; y: number; z: number; r: number }) => { const before = index.candidates; const actual = index.query(q, q.r); const expected = oracle(entries, 4, q, q.r); expect(actual.map(e => e.id)).toEqual(expected.map(e => e.id)); expect(index.candidates - before).toBe(expected.length); };
    for (const q of queries) expectQuery(q);
    set(2, box(2, 2)); set(1, null); set(5, box(1, 1)); set(2, box(1, 1)); set(5, null); set(2, box(30, 30));
    for (const q of [...queries, { x: 30, y: 0, z: 30, r: 1 }]) expectQuery(q);
    const result = index.query({ x: 1, y: 0, z: 1 }, 5); result.length = 0;
    expect(index.query({ x: 1, y: 0, z: 1 }, 5).map(e => e.id)).toEqual(oracle(entries, 4, { x: 1, z: 1 }, 5).map(e => e.id));
    expect(index.query({ x: 1, y: 0, z: 1 }, 5)[0].value).toBe(0);
    entries[0].entry.value = 99;
    expect(index.query({ x: 1, y: 0, z: 1 }, 5)[0].value).toBe(99);
  });

  it('matches wide queries, oversized membership, and enforces the bounded cache', () => {
    const index = new SpatialIndex<Entry>(1), entries = [{ entry: { id: 'a', value: 1 }, box: box(0, 0), order: 0 }, { entry: { id: 'b', value: 2 }, box: box(100, 100), order: 1 }];
    index.update(entries[0].entry, entries[0].box); index.update(entries[1].entry, entries[1].box);
    const wide = { x: 0, y: 0, z: 0, r: 100 };
    const expectWide = (q: { x: number; y: number; z: number; r: number }) => { const before = index.candidates; const actual = index.query(q, q.r); const expected = oracle(entries, 1, q, q.r); expect(actual.map(e => e.id)).toEqual(expected.map(e => e.id)); expect(index.candidates - before).toBe(expected.length); };
    expectWide(wide);
    entries[1].box = null; index.update(entries[1].entry, null); expectWide(wide);
    entries[1].box = { x0: -5000, z0: -5000, x1: 5000, z1: 5000 }; index.update(entries[1].entry, entries[1].box);
    expectWide({ x: 999, y: 0, z: 999, r: 1 });
    for (let i = 0; i < 300; i++) index.query({ x: i * 10, y: 0, z: i * 10 }, 0.1);
    expect((index as any).queryCache.size).toBeLessThanOrEqual(256);
  });
});
