import { beforeAll, describe, expect, it } from 'vitest';
import { BridgeSession } from '../src/bridge/session';
import { projectRegion } from '../src/bridge/regions';
import { RegionalTransport } from '../src/bridge/streaming';
import { B } from '../src/sim/physical/blocks';
import { World } from '../src/sim/core/world';
import type { Place } from '../src/sim/core/types';

/** Decode `structures.runs`: x, z, n, then n triples (y, length, block). */
function decode(runs: number[]): Map<string, [number, number, number][]> {
  const cols = new Map<string, [number, number, number][]>();
  for (let i = 0; i < runs.length;) {
    const x = runs[i++], z = runs[i++], n = runs[i++], list: [number, number, number][] = [];
    for (let k = 0; k < n; k++) { list.push([runs[i], runs[i + 1], runs[i + 2]]); i += 3; }
    cols.set(`${x},${z}`, list);
  }
  return cols;
}
const solidAt = (cols: Map<string, [number, number, number][]>, x: number, y: number, z: number) =>
  (cols.get(`${x},${z}`) ?? []).some(([y0, len]) => y >= y0 && y < y0 + len);
const blockAt = (cols: Map<string, [number, number, number][]>, x: number, y: number, z: number) =>
  (cols.get(`${x},${z}`) ?? []).find(([y0, len]) => y >= y0 && y < y0 + len)?.[2];

describe('web region detail: exact built structure, additive and opt-in', () => {
  let session: BridgeSession, region: ReturnType<typeof projectRegion>, web: ReturnType<typeof projectRegion>;
  beforeAll(() => {
    session = new BridgeSession(918271, { playable: true, defaultPlayer: false });
    const size = session.world.geography!.spec.regionSize;
    const start = session.spawnPoint();
    const rx = Math.floor(start.x / size), rz = Math.floor(start.z / size);
    region = projectRegion(session.world, rx, rz);
    web = projectRegion(session.world, rx, rz, { structures: true });
  }, 120_000);

  it('leaves the native projection untouched: no structures key, everything else identical', () => {
    expect('structures' in region).toBe(false);
    const { structures, ...rest } = web as any;
    expect(structures).toBeDefined();
    expect(JSON.stringify(rest)).toBe(JSON.stringify(region));
  });

  it('a transport asks for structures only when told to', () => {
    const w = session.world, size = w.geography!.spec.regionSize, s = session.spawnPoint();
    const collect = (options?: { structures?: boolean }) => {
      const t = new RegionalTransport(() => {}, () => null, options); let text = '';
      const anchor = w.playerId ?? w.persons()[0].id; (t as any).observer = () => anchor;
      const state = t.state(w); expect(state).toBeTruthy();
      for (let i = 0; i < 4000; i++) { t.prepare(w, Infinity); const c = t.next(w); if (!c) continue; text += Buffer.from(c.data, 'base64').toString(); t.acknowledge(c.transferId, c.index); if (c.index + 1 === c.count) break; }
      void size; void s; return text;
    };
    if (!session.world.playerId) session.world.playerId = session.world.persons().find(p => p.occupation !== 'child')!.id;
    expect(collect()).not.toContain('"structures"');
    expect(collect({ structures: true })).toContain('"structures"');
  }, 120_000);

  it('describes the walls, door gap and roof of every house from the real voxel grid', () => {
    const cols = decode(web.structures!.runs);
    const houses = web.places.filter((p: any) => p.type === 'house' && p.indoor);
    expect(houses.length).toBeGreaterThan(0);
    for (const p of houses as any[]) {
      const { x0, x1, z0, z1, y0, y1 } = p.bounds;
      const ring: [number, number][] = [];
      for (let x = x0; x <= x1; x++) { ring.push([x, z0], [x, z1]); }
      for (let z = z0 + 1; z < z1; z++) { ring.push([x0, z]); ring.push([x1, z]); }
      const doorCell = p.door ? ring.filter(([x, z]) => Math.abs(x - p.door.x) + Math.abs(z - p.door.z) === 1) : [];
      // Walls stand on the footprint ring at floor level, except where the door is.
      const missing = ring.filter(([x, z]) => !solidAt(cols, x, y0 + 1, z) && !doorCell.some(([dx, dz]) => dx === x && dz === z));
      expect(missing, `house ${p.id} wall ring gaps`).toEqual([]);
      // Windows are glazing blocks in that wall.
      expect(ring.some(([x, z]) => blockAt(cols, x, y0 + 1, z) === B.Glass), `house ${p.id} glazing`).toBe(true);
      // A roof rises above the walls, and the projected top agrees with the place's own extent.
      const top = Math.max(...ring.flatMap(([x, z]) => (cols.get(`${x},${z}`) ?? []).map(([y, len]) => y + len)));
      expect(top).toBeGreaterThan(y0 + 3);
      expect(top).toBeLessThanOrEqual(y1 + 4);
    }
  });

  it('keeps the projection bounded: structure data is a small fraction of a region transfer', () => {
    const structureBytes = JSON.stringify(web.structures!).length, whole = JSON.stringify(web).length;
    expect(structureBytes).toBeLessThan(400_000);
    expect(structureBytes).toBeLessThan(whole);
  });
});

describe('authored grid woodland projection', () => {
  function fixture() {
    const w = new World(13); w.initPhysical(32, 16, 32);
    for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) w.grid.set(x, 0, z, B.Grass);
    for (let y = 1; y <= 5; y++) w.grid.set(5, y, 5, B.Log);
    w.grid.set(6, 5, 5, B.Leaves);
    return w;
  }
  const project = (w: World) => projectRegion(w, 0, 0, { structures: true });
  const place = (w: World, type: Place['type'], indoor: boolean) => w.add<Place>({
    id: 'place', kind: 'place', name: 'Place', createdAt: 0, tags: [], type,
    bounds: { x0: 4, x1: 6, z0: 4, z1: 6, y0: 0, y1: 7 }, inside: { x: 5, y: 1, z: 5 },
    door: null, anchors: [], ownerId: null, residents: [], workers: [], description: '', indoor,
    parentId: null, fires: [], chimneys: [], lit: false });

  it('keeps exact trunk collision while deriving stable canopy geometry without identities', () => {
    const w = fixture(), p = project(w), tree = p.structures!.trees![0];
    expect(p.structures!.trees).toHaveLength(1);
    expect(tree).toMatchObject({ x: 5, y: 1, z: 5, height: 5, species: 'oak' });
    expect(decode(p.structures!.runs).get('5,5')).toContainEqual([1, 5, B.Log]);
    expect(project(w)).toEqual(p);
    expect(w.resourceNodes).toHaveLength(0);
    expect(projectRegion(w, 0, 0).structures).toBeUndefined();
  });

  it.each(['house', 'gate', 'bridge', 'camp'] as const)('preserves %s timbers beside foliage and bare posts', type => {
    const w = fixture();
    place(w, type, type === 'house');
    for (let y = 1; y <= 5; y++) w.grid.set(20, y, 20, B.Log2);
    const p = project(w);
    expect(p.structures!.trees ?? []).toEqual([]);
    expect(decode(p.structures!.runs).get('5,5')).toContainEqual([1, 5, B.Log]);
    expect(decode(p.structures!.runs).get('20,20')).toContainEqual([1, 5, B.Log2]);
  });

  it('retains natural canopies within wilderness place bounds', () => {
    const w = fixture(); place(w, 'wilderness', false);
    expect(project(w).structures!.trees).toHaveLength(1);
  });

  it('leaves registered resource trees to the dynamic renderer', () => {
    const w = fixture();
    w.resourceNodes.push({ id: 'tree', kind: 'tree', yield: 'log', pos: { x: 4, y: 1, z: 5 },
      blocks: [{ x: 5, y: 1, z: 5, id: B.Log }], remaining: 1, capacity: 1, renewable: true,
      regrowHours: 24, state: 'available' });
    expect(project(w).structures!.trees ?? []).toEqual([]);
  });

  it('drops the canopy descriptor when its supporting canonical geometry is removed', () => {
    const w = fixture(); w.grid.set(6, 5, 5, B.Air);
    expect(project(w).structures!.trees ?? []).toEqual([]);
    w.grid.set(6, 5, 5, B.Leaves);
    for (let y = 1; y <= 5; y++) w.grid.set(5, y, 5, B.Air);
    expect(project(w).structures!.trees ?? []).toEqual([]);
  });
});
