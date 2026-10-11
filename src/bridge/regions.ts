import type { World } from '../sim/core/world';
import { B } from '../sim/physical/blocks';
import { settlementSeed } from '../sim/world/settlementSpec';
import { RegionalGrid } from '../sim/physical/regionalGrid';
import { wildlifeProjection } from './wildlife';
import { ecologicalResourceAvailable } from '../sim/world/ecologyResources';

// Ground substance only: roofs and resource canopies are projected separately.
const ground = new Set<number>([B.Grass,B.Dirt,B.Stone,B.Cobble,B.Sand,B.Farmland,B.Path,B.Gravel,B.Mud,B.Snow]);
/** Blocks that are built structure (walls, roofs, glazing, chimneys, cloth, hay). Furnishings, fences, doors,
 * paths and crops are projected by their own fields, so they are not repeated here. */
const STRUCTURAL = new Set<number>([B.Planks,B.DarkPlanks,B.Log,B.Log2,B.Thatch,B.Brick,B.Glass,B.RoofTile,B.Chimney,B.StoneBrick,B.Plaster,B.Mossy,B.Stone,B.Cobble,B.Cloth,B.ClothRed,B.ClothBlue,B.Wool,B.Hay,B.Well,B.Furnace,B.Torch,B.Gravestone]);
const LEAVES = new Set<number>([B.Leaves, B.Leaves2]);
/** Optional projection detail. Off for every native client; a web client asks for it by client kind. */
export interface RegionProjectionOptions { /** Exact built structure per column as run-length runs: x, z, n, then n triples of (y, length, block). */ structures?: boolean }
function surface(w: World, x: number, z: number) {
  x = Math.min(w.grid.W-1,x); z = Math.min(w.grid.D-1,z);
  const c = w.geography ? { ...w.geography.surface(x,z) } : { height: 0, block: B.Grass as number, water: null as number | null, forest: 0 };
  for(let y=w.grid.H-1;y>=0;y--) if(ground.has(w.grid.get(x,y,z))) { c.height=y; c.block=w.grid.get(x,y,z); break; }
  c.water=null; for(let y=c.height+1;y<w.grid.H;y++) if(w.grid.get(x,y,z)===B.Water) c.water=y;
  return c;
}

const inBounds = (b: { x0: number; z0: number; x1: number; z1: number }, p: { x: number; z: number }) => p.x >= b.x0 && p.z >= b.z0 && p.x < b.x1 && p.z < b.z1;
export function regionBounds(w: World, rx: number, rz: number) {
  const size = w.geography?.spec.regionSize ?? 256;
  return { x0: rx * size, z0: rz * size, x1: w.geography ? (rx + 1) * size : Math.min((rx + 1) * size, w.grid.W), z1: w.geography ? (rz + 1) * size : Math.min((rz + 1) * size, w.grid.D) };
}
/** Geometry facts only. This is not an identity, ownership, inventory, goal or mind API. */
export function projectRegion(w: World, rx: number, rz: number, options: RegionProjectionOptions = {}) {
  const steps=projectRegionSteps(w,rx,rz,options);
  for(;;){const result=steps.next();if(result.done)return result.value;}
}

type ProjectedTree = { x: number; y: number; z: number; height: number; species: 'oak' | 'pine'; variant: number; yaw: number };
const treeKey = (x: number, y: number, z: number) => `${x},${y},${z}`;
/** Classify columns already visited by the yielded dense geometry scan. Keep exact log runs
 * for collision; the optional tree descriptor only replaces their visual representation. */
function treeProjector(w: World, bounds: ReturnType<typeof regionBounds>): (x: number, z: number, col: number[]) => ProjectedTree | null {
  const excluded = new Set<string>();
  const addBlocks = (blocks: { x: number; y: number; z: number; id: number }[]) => blocks.forEach(b => excluded.add(treeKey(b.x, b.y, b.z)));
  for (const n of w.resourceNodes) if (n.kind === 'tree') addBlocks(n.blocks);
  for (let rx = Math.floor(bounds.x0 / 256); rx <= Math.floor((bounds.x1 - 1) / 256); rx++)
    for (let rz = Math.floor(bounds.z0 / 256); rz <= Math.floor((bounds.z1 - 1) / 256); rz++)
      for (const n of w.geography?.resources(rx, rz) ?? []) if (n.kind === 'tree') addBlocks(n.blocks);
  // Open-air gates, bridges and worksites own their timbers too. Only wilderness
  // places permit this natural-tree interpretation of otherwise unowned grid logs.
  const places = w.places().filter(p => p.indoor || p.type !== 'wilderness').map(p => p.bounds);
  return (x, z, col) => {
    if (places.some(p => x >= p.x0 - 1 && x <= p.x1 + 1 && z >= p.z0 - 1 && z <= p.z1 + 1)) return null;
    let i = 0;
    while (i < col.length && col[i + 2] !== B.Log && col[i + 2] !== B.Log2) i += 3;
    if (i >= col.length) return null;
    const [base, height, b] = col.slice(i, i + 3);
    if (height < 2 || excluded.has(treeKey(x, base, z))) return null;
    const species = b === B.Log2 ? 'pine' : 'oak';
    let canopy = false;
    for (let yy = Math.max(base, base + height - 3); yy <= Math.min(w.grid.H - 1, base + height + 3) && !canopy; yy++)
      for (let xx = x - 3; xx <= x + 3 && !canopy; xx++) for (let zz = z - 3; zz <= z + 3; zz++)
        if (w.grid.inBounds(xx, yy, zz) && LEAVES.has(w.grid.get(xx, yy, zz))) canopy = true;
    if (!canopy) return null;
    const h = Math.abs((x * 1103515245 + z * 12345) | 0), variant = h % 4;
    return { x, y: base, z, height, species, variant, yaw: ((h >>> 8) % 628) / 100 };
  };
}
/** Same projection, yielded by small spatial batches so interaction ticks can run between them.
 * The transport discards an unfinished projection when its canonical region revision changes. */
export function* projectRegionSteps(w: World, rx: number, rz: number, options: RegionProjectionOptions = {}) {
  if (!Number.isInteger(rx) || !Number.isInteger(rz) || rx < 0 || rz < 0 || rx * 256 >= w.grid.W || rz * 256 >= w.grid.D) throw new Error('Region outside world');
  const patches = w.grid instanceof RegionalGrid ? w.grid.patches : [{ x: 0, z: 0, grid: w.grid }];
  const bounds = regionBounds(w, rx, rz), columns: number[][] = [], stride = patches.some(p=>p.x<bounds.x1&&p.x+p.grid.W>bounds.x0&&p.z<bounds.z1&&p.z+p.grid.D>bounds.z0)?2:8, openings: number[][] = [], fences: number[][] = [], paths: number[][] = [], furnishings: { role: string; pos: { x: number; y: number; z: number }; yaw: number; support: number }[] = [];
  const projectTree = options.structures ? treeProjector(w, bounds) : null, trees: ProjectedTree[] = [];
  const furnishingRoles = new Map<number, string>([[B.Bed, 'bed'], [B.Chair, 'chair'], [B.Table, 'table'], [B.Counter, 'counter'], [B.Bench, 'bench'], [B.Anvil, 'anvil'], [B.Furnace, 'forge'], [B.Altar, 'altar'], [B.Bookshelf, 'shelf'], [B.Barrel, 'barrel'], [B.Crate, 'crate'], [B.Lantern, 'lantern'], [B.Sign, 'sign']]);
  const furnishingSeen = new Set<string>();
  const structureRuns: number[] = [], structureSeen = new Set<number>();
  for (let x = bounds.x0; x <= bounds.x1; x += stride) for (let z = bounds.z0; z <= bounds.z1; z += stride) {
    const c = surface(w,x,z);
    // Stitch 2m settlement meshes to the shared 8m wilderness boundary exactly.
    if(stride===2 && (x===bounds.x0||x===bounds.x1||z===bounds.z0||z===bounds.z1)) {
      const alongZ=x===bounds.x0||x===bounds.x1, axis=alongZ?z:x, lo=Math.floor(axis/8)*8,hi=lo+8,t=(axis-lo)/8;
      c.height=surface(w,alongZ?x:lo,alongZ?lo:z).height*(1-t)+surface(w,alongZ?x:hi,alongZ?hi:z).height*t;
    }
    columns.push([x, z, c.height + 1, c.block, c.water === null ? -1 : c.water + .9, c.forest]);
    if(columns.length%64===0)yield;
  }
  const places = w.places().filter(p => inBounds(bounds, p.inside)).map(p => ({ id: p.id, type: p.type, bounds: p.bounds, inside: p.inside, door: p.door, indoor: p.indoor,
    visualSeed: settlementSeed(w.seed, { id: p.id, x: rx, z: rz }), culture: 'regional-prototype',
    wallHeight: Math.min(...[[p.bounds.x0,p.bounds.z0],[p.bounds.x1,p.bounds.z0],[p.bounds.x0,p.bounds.z1],[p.bounds.x1,p.bounds.z1]].map(([x,z])=> { let y=p.bounds.y0; while(y<p.bounds.y1 && w.grid.get(x,y,z)!==B.Air) y++; return Math.max(2,y-p.bounds.y0-1); })),
    family: p.type === 'house' ? 'dwelling' : p.type === 'chapel' ? 'community' : p.type === 'mill' ? 'production' : p.type === 'stall' || p.type === 'tavern' ? 'shop' : p.type === 'farm' || p.type === 'store' ? 'agricultural' : 'workshop' }));
  // Dense geometry exists only in inhabited patches. Never sweep a whole world volume.
  for (const patch of patches) {
    // A small read-only path halo lets both neighbouring terrain materials agree at the seam.
    // Doors/fences remain owned by their original region and are never duplicated.
    const x0 = Math.max(bounds.x0 - 3, patch.x), x1 = Math.min(bounds.x1 + 3, patch.x + patch.grid.W), z0 = Math.max(bounds.z0 - 3, patch.z), z1 = Math.min(bounds.z1 + 3, patch.z + patch.grid.D);
    for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
      // Built structure sits above the ground the terrain mesh already draws.
      let structTop = -1, col: number[] | null = null;
      if (options.structures && inBounds(bounds, { x, z }) && !structureSeen.has(x * 65536 + z)) {
        structureSeen.add(x * 65536 + z); col = [];
        for (let y = patch.grid.H - 1; y >= 1; y--) if (ground.has(w.grid.get(x, y, z))) { structTop = y; break; }
      }
      for (let y = 1; y < patch.grid.H; y++) {
      const b = w.grid.get(x, y, z);
      if (col && y > structTop && STRUCTURAL.has(b)) { const n = col.length; if (n && col[n - 3] + col[n - 2] === y && col[n - 1] === b) col[n - 2]++; else col.push(y, 1, b); }
      if (b === B.Door && inBounds(bounds, {x,z})) openings.push([x, y, z, +w.grid.isDoorOpen(x, y, z)]);
      if (b === B.Fence && inBounds(bounds, {x,z})) fences.push([x, y, z, w.grid.get(x-1,y,z)===B.Fence||w.grid.get(x+1,y,z)===B.Fence ? 0 : 90]);
      if (b === B.Path) paths.push([x,y+1,z]);
      const role = furnishingRoles.get(b);
      if (role && inBounds(bounds, { x, z })) {
        const key = `${x}:${y}:${z}`;
        if (!furnishingSeen.has(key)) {
          furnishingSeen.add(key);
          const alongX = w.grid.get(x - 1, y, z) === b || w.grid.get(x + 1, y, z) === b;
          const alongZ = w.grid.get(x, y, z - 1) === b || w.grid.get(x, y, z + 1) === b;
          let yaw = alongZ && !alongX ? 90 : 0;
          if (role === 'chair') {
            // Face the actual adjacent table, not another chair or the world origin.
            const table = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dz]) => w.grid.get(x + dx, y, z + dz) === B.Table);
            if (table) yaw = Math.atan2(table[1], table[0]) * 180 / Math.PI;
          }
          furnishings.push({ role, pos: { x, y, z }, yaw, support: w.grid.get(x, y - 1, z) });
        }
      }
    }
      if (col && col.length) {
        structureRuns.push(x, z, col.length / 3, ...col);
        const tree = projectTree?.(x, z, col); if (tree) trees.push(tree);
      }
      if((z-z0)%16===15)yield; }
  }
  const regionSeed = w.geography?.regionSeed(rx, rz) ?? settlementSeed(w.seed, { id: 'observatory-region', x: rx, z: rz });
  return { id: `${rx},${rz}`, seed: regionSeed, bounds, terrain: { stride, columns }, openings, fences, paths, furnishings, places,
    dressingExclusions: w.places().filter(p => p.bounds.x0 < bounds.x1 + 4 && p.bounds.x1 >= bounds.x0 - 4 && p.bounds.z0 < bounds.z1 + 4 && p.bounds.z1 >= bounds.z0 - 4).map(p => ({bounds:p.bounds})),
    roads: (w.geography?.roads ?? []).filter(r => r.points.some(p => inBounds(bounds, p))).map(r => ({ id: r.id, points: r.points.filter(p => p.x >= bounds.x0 - 128 && p.x < bounds.x1 + 128 && p.z >= bounds.z0 - 128 && p.z < bounds.z1 + 128).map(p=>({...p,y:surface(w,Math.floor(p.x),Math.floor(p.z)).height+1})) })),
    settlements: w.settlements().filter(s => s.bounds.x0 < bounds.x1 && s.bounds.x1 >= bounds.x0 && s.bounds.z0 < bounds.z1 && s.bounds.z1 >= bounds.z0).map(s => ({ id: s.id, bounds: s.bounds })),
    classification: 'canonical', decoration: { classification: 'decorative', seed: w.geography?.regionSeed(rx, rz, 'dressing') ?? regionSeed, collision: false, gameplay: false },
    ...(options.structures ? { structures: { runs: structureRuns, ...(trees.length ? { trees } : {}) } } : {}) };
}

/** Coarse read-only landform around a streamed centre region, for the far horizon only.
 * Sampled from the versioned geographic baseline (never the voxel grid), so it cannot reveal
 * or mutate settlement contents. Strings keep the payload small: one character per sample. */
export const VISTA_STRIDE = 32, VISTA_RADIUS = 160;
export function projectVista(w: World, rx: number, rz: number) {
  const g = w.geography!, size = g.spec.regionSize, side = VISTA_RADIUS * 2 + 1;
  const x0 = Math.round(((rx + .5) * size) / VISTA_STRIDE) * VISTA_STRIDE - VISTA_RADIUS * VISTA_STRIDE;
  const z0 = Math.round(((rz + .5) * size) / VISTA_STRIDE) * VISTA_STRIDE - VISTA_RADIUS * VISTA_STRIDE;
  let heights = '', forest = '', surface = '';
  for (let i = 0; i < side; i++) for (let j = 0; j < side; j++) {
    const x = Math.min(Math.max(x0 + i * VISTA_STRIDE, 0), g.spec.size - 1), z = Math.min(Math.max(z0 + j * VISTA_STRIDE, 0), g.spec.size - 1), c = g.surface(x, z);
    heights += String.fromCharCode(48 + Math.max(0, Math.min(70, Math.round(c.water !== null ? c.water + 1 : c.height + 1))));
    forest += String.fromCharCode(48 + Math.round(Math.max(0, Math.min(1, c.forest)) * 9));
    surface += c.water !== null ? 'w' : c.block === B.Path ? 'p' : c.block === B.Sand ? 's' : c.block === B.Stone ? 'r' : 'g';
  }
  const inside = (b: { x0: number; z0: number; x1: number; z1: number }) => b.x1 >= x0 && b.x0 <= x0 + side * VISTA_STRIDE && b.z1 >= z0 && b.z0 <= z0 + side * VISTA_STRIDE;
  return { center: `${rx},${rz}`, origin: { x: x0, z: z0 }, stride: VISTA_STRIDE, side, heights, forest, surface,
    settlements: w.settlements().filter(s => inside(s.bounds)).map(s => ({ id: s.id, bounds: s.bounds })),
    classification: 'decorative', collision: false, gameplay: false };
}

export function regionDynamics(w: World, ids: Set<string>, observerId: string | null = w.playerId) {
  const geo = w.geography, inside = (p: { x: number; z: number }) => ids.has(geo?.regionId(p.x, p.z) ?? `${Math.floor(p.x / 256)},${Math.floor(p.z / 256)}`);
  const nodes = new Map<string, import('../sim/core/types').ResourceNode>();
  for (const id of ids) { const [rx, rz] = id.split(',').map(Number); for (const n of geo?.resources(rx, rz) ?? []) nodes.set(n.id, n); }
  for (const n of w.resourceNodes) if (inside(n.pos)) nodes.set(n.id, n);
  return { resources: [...nodes.values()].map(n => ({ id: n.id, kind: n.kind, pos: n.blocks[0] ? { x: n.blocks[0].x, y: n.blocks[0].y, z: n.blocks[0].z } : n.pos, state: n.state, remaining: n.remaining, growthStage: n.growthStage,
      ...(n.kind === 'forage' || n.kind === 'surface_water' ? { capacity: n.capacity, unit: n.kind === 'forage' ? 'kg' : 'litres', forage: n.forage, physicallyAvailable: ecologicalResourceAvailable(w, n) } : {}) })),
    wildlife: wildlifeProjection(w, observerId ? w.primaryBody(observerId) : undefined, ids),
    items: w.items().filter(i => i.pos && !i.holderId && i.quantity > 0 && inside(i.pos)).map(i => ({ id: i.id, type: i.type, pos: i.pos, quantity: i.quantity })),
    containers: w.containers().filter(c=>c.pos&&inside(c.pos)).map(c=>({id:c.id,name:c.name,pos:c.pos,open:c.open,capacity:c.capacity,used:c.itemIds.reduce((sum,id)=>sum+Math.max(0,w.item(id)?.quantity??0),0)})),
    crops: w.fields.flatMap(f => f.plots.filter(inside).map(p => ({ id: `${f.id}:${p.x}:${p.z}`, pos: { x: p.x, y: p.y, z: p.z }, state: p.state, growth: p.growth }))),
    mechanisms: w.kernel.assemblies.filter(a => inside(a.pos)).map(a => ({ id: a.id, pos: a.pos, parts: a.parts.length, condition: Math.min(1,...a.parts.map(id=>w.kernel.components.find(c=>c.id===id)?.condition??0)), state: w.persons().some(p=>p.mind.plan.some(t=>t.status==='active' && ['operate_mechanism','mechanism_task'].includes(t.type) && t.data?.assemblyId===a.id)) ? 'working' : 'idle', operatedSeconds:a.operatedSeconds })),
    construction: w.constructionProjects.filter(p => inside({ x: p.siteBounds.x0, z: p.siteBounds.z0 })).map(p => ({ id: p.id, bounds: p.siteBounds, pos:{x:p.siteBounds.x0,y:p.siteBounds.y0,z:p.siteBounds.z0}, state: p.status, progress: p.laborDone/Math.max(1,p.laborRequired) })),
    fires: w.fires.filter(f => inside(f.pos)).map(f => ({ id: f.id, pos: f.pos, lit: f.lit, intensity: f.intensity })),
    doors: [...w.grid.doorStates].flatMap(([i, open]) => { const y = i % w.grid.H, col = (i - y) / w.grid.H, x = Math.floor(col / w.grid.D), z = col % w.grid.D; return inside({ x, z }) ? [{ id: `door:${x}:${y}:${z}`, pos: { x, y, z }, open, yaw:w.grid.get(x-1,y+1,z)!==B.Air&&w.grid.get(x+1,y+1,z)!==B.Air?0:90 }] : []; }),
    environment: { ...w.weather }, worldTime: w.now };
}

/** Per-connection presentation residency. Deleting this object changes no World field. */
export class RegionStream {
  /** `observer` names the Person whose body anchors residency; null falls back to the legacy single player. */
  constructor(private readonly observer: () => string | null = () => null) {}
  private resident = new Set<string>();
  private dynamics = '';
  private revisions = new Map<string,string>();
  reset(): void { this.resident.clear(); this.dynamics = ''; this.revisions.clear(); }
  /** Cheap residency/revision planning. Callers can materialize regions progressively. */
  plan(w: World) {
    const g = w.geography, who = this.observer() ?? w.playerId, p = who ? w.positionOf(who) : null; if (!g || !p) return null;
    const size=g.spec.regionSize, rx = Math.floor(p.x / size), rz = Math.floor(p.z / size), wanted = new Set<string>();
    for (let x = rx - 1; x <= rx + 1; x++) for (let z = rz - 1; z <= rz + 1; z++) if (x >= 0 && z >= 0 && x * size < w.grid.W && z * size < w.grid.D) wanted.add(`${x},${z}`);
    const ordered = [...wanted].sort((a,b) => { const distance=(id:string)=>{const [x,z]=id.split(',').map(Number);return (x-rx)**2+(z-rz)**2;}; return distance(a)-distance(b)||a.localeCompare(b); });
    const unload = [...this.resident].filter(id => !wanted.has(id));
    const changed = ordered.filter(id => { const [x,z]=id.split(',').map(Number), revision=JSON.stringify([(w.grid as RegionalGrid).regionRevision(x,z),w.places().filter(p=>g.regionId(p.inside.x,p.inside.z)===id).map(p=>[p.id,p.bounds,p.type,p.indoor])]); const changed=this.revisions.get(id)!==revision; this.revisions.set(id,revision); return !this.resident.has(id)||changed; });
    for(const id of unload) this.revisions.delete(id);
    this.resident = wanted;
    return { origin: { x: rx * size, y: 0, z: rz * size }, center: `${rx},${rz}`, wanted: ordered, unload, changed };
  }
  frame(w: World) {
    const plan=this.plan(w); if(!plan) return null;
    const regions=plan.changed.map(id=>{const [x,z]=id.split(',').map(Number);return projectRegion(w,x,z);});
    const dynamic = regionDynamics(w, new Set(plan.wanted), this.observer() ?? w.playerId), fingerprint = JSON.stringify({ ...dynamic, worldTime: 0 });
    const changed = this.dynamics !== fingerprint || regions.length>0; this.dynamics = fingerprint;
    return { version: 1, type: 'regions', origin: plan.origin, regions, unload:plan.unload, ...(changed ? { dynamic } : {}) };
  }
}
