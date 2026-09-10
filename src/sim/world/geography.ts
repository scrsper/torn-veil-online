import { hash2, valueNoise, RNG } from '../core/rng';
import { B } from '../physical/blocks';
import type { ResourceNode } from '../core/types';
import { settlementSeed, SETTLEMENT_SIZE, type SettlementSite } from './settlementSpec';

/** Versioned generator inputs. A save must never reinterpret an older baseline. Metres. */
export interface PlayableWorldSpec { version: 1; size: number; regionSize: number; settlements: number; timeScale: number; }
export const PLAYABLE_WORLD: PlayableWorldSpec = { version: 1, size: 24576, regionSize: 256, settlements: 7, timeScale: 6 };
export interface Surface { height: number; water: number | null; moisture: number; fertility: number; stone: number; forest: number; block: number; }
export interface WorldRoad { id: string; from: string; to: string; points: { x: number; z: number }[]; length: number; }
export interface GeographySite extends SettlementSite { suitability: number; conditions: Surface; }
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const segmentDistance = (x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number }) => {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
};

/** Pure geographic baseline plus bounded, disposable query caches. No runtime RNG, entities,
 * visitation order, renderer state, or history is consulted by this generator. */
export class WorldGeography {
  readonly sites: GeographySite[];
  readonly roads: WorldRoad[] = [];
  private roadCells = new Map<string, { a: { x: number; z: number }; b: { x: number; z: number } }[]>();
  private nodes = new Map<string, ResourceNode[]>();
  constructor(readonly seed: number, readonly spec: PlayableWorldSpec = { ...PLAYABLE_WORLD }) {
    if (spec.version !== 1 || !Number.isInteger(spec.size) || spec.size < 4096 || spec.size > 49152 || spec.regionSize !== 256 || !Number.isInteger(spec.settlements) || spec.settlements < 2 || spec.settlements > 15 || !Number.isFinite(spec.timeScale) || spec.timeScale <= 0) throw new Error('Unsupported playable geography specification');
    this.spec = { ...spec };
    const candidates: GeographySite[] = [];
    for (let x = 512; x < spec.size - 768; x += 768) for (let z = 512; z < spec.size - 768; z += 768) {
      const rng = new RNG(settlementSeed(seed, { id: 'site-candidate', x, z }));
      const px = x + rng.int(-180, 180), pz = z + rng.int(-180, 180), c = this.natural(px + 120, pz + 120);
      const corners = [[0, 0], [240, 0], [0, 240], [240, 240]].map(([dx, dz]) => this.natural(px + dx, pz + dz));
      const relief = Math.max(...corners.map(c => c.height)) - Math.min(...corners.map(c => c.height));
      const waterDistance = this.waterDistance(px + 120, pz + 120);
      if (waterDistance < 170 || corners.some(c => c.water !== null) || relief > 3) continue;
      const suitability = 2 / (1 + waterDistance / 350) + c.fertility + c.forest * .3 + c.stone * .3 - relief * .12;
      candidates.push({ id: `site_${px}_${pz}`, x: px, z: pz, conditions: c, suitability });
    }
    candidates.sort((a, b) => b.suitability - a.suitability || a.x - b.x || a.z - b.z);
    this.sites = [];
    for (const c of candidates) {
      if (this.sites.every(s => distance(c, s) >= 1500)) this.sites.push(c);
      if (this.sites.length === spec.settlements) break;
    }
    if (this.sites.length < spec.settlements) throw new Error('Insufficient suitable settlement sites');
    // Nearby routes pay actual terrain/water cost. A long or impassable link is not guaranteed.
    const pairs = this.sites.flatMap((a, i) => this.sites.slice(i + 1).map(b => ({ a, b, d: distance(a, b) }))).sort((a, b) => a.d - b.d);
    const connected = new Map(this.sites.map(s => [s.id, s.id]));
    for (const { a, b, d } of pairs) {
      if (d > 9000 || connected.get(a.id) === connected.get(b.id)) continue;
      const points = this.route({ x: a.x - 4, z: a.z + 120 }, { x: b.x - 4, z: b.z + 120 });
      if (!points) continue;
      const road = { id: `road:${a.id}:${b.id}`, from: a.id, to: b.id, points, length: points.reduce((sum, p, i) => sum + (i ? distance(p, points[i - 1]) : 0), 0) };
      this.roads.push(road);
      const old = connected.get(b.id); for (const [id, group] of connected) if (group === old) connected.set(id, connected.get(a.id)!);
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        for (let x = Math.floor((Math.min(a.x, b.x) - 3) / 64); x <= Math.floor((Math.max(a.x, b.x) + 3) / 64); x++) for (let z = Math.floor((Math.min(a.z, b.z) - 3) / 64); z <= Math.floor((Math.max(a.z, b.z) + 3) / 64); z++) {
          const key = `${x},${z}`, list = this.roadCells.get(key) ?? []; list.push({ a, b }); this.roadCells.set(key, list);
        }
      }
    }
  }
  regionId(x: number, z: number): string { return `${Math.floor(x / this.spec.regionSize)},${Math.floor(z / this.spec.regionSize)}`; }
  regionSeed(x: number, z: number, family = 'baseline'): number { return settlementSeed(this.seed, { id: family, x, z }); }
  riverX(z: number, index: number): number { return this.spec.size * (index + 1) / 4 + 650 * (valueNoise(z / 1800, index, this.seed + 77) - .5); }
  waterDistance(x: number, z: number): number { return Math.min(...[0, 1, 2].map(i => Math.abs(x - this.riverX(z, i)))); }
  natural(x: number, z: number): Surface {
    const relief = valueNoise(x / 2400, z / 2400, this.seed), moisture = valueNoise(x / 1500, z / 1500, this.seed + 19);
    const dist = this.waterDistance(x, z), riverHeight = 10 + Math.floor(z / this.spec.size * 4);
    const high = 12 + 18 * relief + 2 * valueNoise(x / 320, z / 320, this.seed + 3);
    const blend = Math.min(1, dist / 160), bank = riverHeight + Math.min(4, Math.floor(dist / 12));
    const height = dist < 7 ? riverHeight - (dist < 3 ? 2 : 1) : Math.floor(bank * (1 - blend) + high * blend);
    const stone = relief, forest = moisture > .53 ? Math.min(1, (moisture - .4) * 2) : .08;
    return { height, water: dist < 7 ? riverHeight : null, moisture, fertility: moisture * (1 - relief * .4), stone, forest,
      block: dist < 14 ? B.Sand : relief > .77 ? B.Stone : moisture < .27 ? B.Sand : B.Grass };
  }
  onRoad(x: number, z: number): boolean { return (this.roadCells.get(`${Math.floor(x / 64)},${Math.floor(z / 64)}`) ?? []).some(s => segmentDistance(x, z, s.a, s.b) <= 2); }
  surface(x: number, z: number): Surface { const c = this.natural(x, z); if (c.water === null && this.onRoad(x, z)) c.block = B.Path; return c; }
  private route(start: { x: number; z: number }, end: { x: number; z: number }): WorldRoad['points'] | null {
    // Bounded 64m geographic search. Detailed movement still adjudicates each metre.
    const step = 64, n = Math.ceil(this.spec.size / step), key = (x: number, z: number) => x * n + z;
    const sx = Math.floor(start.x / step), sz = Math.round(start.z / step), tx = Math.floor(end.x / step), tz = Math.round(end.z / step), target = key(tx, tz);
    const open = [{ x: sx, z: sz, cost: 0, score: distance(start, end) / step }], costs = new Map([[key(sx, sz), 0]]), previous = new Map<number, number>();
    let found = false;
    for (let iterations = 0; open.length && iterations < 12000; iterations++) {
      open.sort((a, b) => b.score - a.score); const c = open.pop()!, id = key(c.x, c.z);
      if (c.cost > costs.get(id)!) continue;
      if (id === target) { found = true; break; }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const x = c.x + dx, z = c.z + dz; if (x < 1 || z < 1 || x >= n - 1 || z >= n - 1) continue;
        const a = this.natural(c.x * step, c.z * step), b = this.natural(x * step, z * step);
        // Rivers have shallow banks but no invented bridge. Crossings are excluded here.
        let blocked = false; for (let t = 0; t <= 8; t++) { const px = (c.x + dx * t / 8) * step, pz = (c.z + dz * t / 8) * step; if (this.natural(px, pz).water !== null || this.sites.some(s => px >= s.x && px < s.x + SETTLEMENT_SIZE && pz >= s.z && pz < s.z + SETTLEMENT_SIZE)) { blocked = true; break; } }
        if (blocked) continue;
        const cost = c.cost + Math.hypot(dx, dz) * (1 + b.forest * .3) + Math.abs(a.height - b.height) * .25, next = key(x, z);
        if (cost >= (costs.get(next) ?? Infinity)) continue;
        costs.set(next, cost); previous.set(next, id); open.push({ x, z, cost, score: cost + Math.hypot(x - tx, z - tz) });
      }
    }
    if (!found) return null;
    const path: WorldRoad['points'] = []; let cur = target;
    while (cur !== key(sx, sz)) { path.push({ x: Math.floor(cur / n) * step, z: cur % n * step }); cur = previous.get(cur)!; }
    path.push({ x: sx * step, z: sz * step }); return [start, ...path.reverse(), end];
  }
  /** Sparse harvestable substrate. Activation creates no new resource; it indexes these facts
   * for ordinary resource mechanics. Decorative vegetation is explicitly separate. */
  resources(rx: number, rz: number): ResourceNode[] {
    const key = `${rx},${rz}`; if (this.nodes.has(key)) return this.nodes.get(key)!;
    const result: ResourceNode[] = [], size = this.spec.regionSize;
    for (let i = 0; i < 8; i++) {
      const rng = new RNG(this.regionSeed(rx, rz, `resource:${i}`)), x = rx * size + rng.int(8, size - 9), z = rz * size + rng.int(8, size - 9), c = this.surface(x, z);
      if (x < 0 || z < 0 || x >= this.spec.size || z >= this.spec.size || c.water !== null || c.block === B.Path || this.sites.some(s => x >= s.x - 8 && x < s.x + 248 && z >= s.z - 8 && z < s.z + 248)) continue;
      const tree = rng.next() < c.forest; if (!tree && rng.next() > c.stone * .25) continue;
      const blocks = Array.from({ length: tree ? 5 : 1 }, (_, j) => ({ x, y: c.height + j + 1, z, id: tree ? B.Log : B.Stone }));
      if (result.some(n => n.blocks[0].x === x && n.blocks[0].z === z)) continue;
      result.push({ id: `wild:${this.seed}:${key}:${i}`, kind: tree ? 'tree' : 'stone', yield: tree ? 'log' : 'stone', pos: { x: x - .5, y: c.height + 1, z: z + .5 }, blocks,
        remaining: tree ? 6 : 24, capacity: tree ? 6 : 24, state: 'available', renewable: tree, regrowHours: tree ? 2.5 * 365 * 24 : 0, ...(tree ? { growthStage: 'mature' as const } : {}) });
    }
    if (this.nodes.size >= 128) this.nodes.delete(this.nodes.keys().next().value!); this.nodes.set(key, result); return result;
  }
  resourceBlock(x: number, y: number, z: number): number | undefined {
    return this.resources(Math.floor(x / this.spec.regionSize), Math.floor(z / this.spec.regionSize)).find(n => n.blocks[0].x === x && n.blocks[0].z === z)?.blocks.find(b => b.y === y)?.id;
  }
}
