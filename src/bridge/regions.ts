import type { World } from '../sim/core/world';
import { B } from '../sim/physical/blocks';
import { settlementSeed } from '../sim/world/settlementSpec';
import { RegionalGrid } from '../sim/physical/regionalGrid';

// Ground substance only: roofs and resource canopies are projected separately.
const ground = new Set<number>([B.Grass,B.Dirt,B.Stone,B.Cobble,B.Sand,B.Farmland,B.Path,B.Gravel,B.Mud,B.Snow]);
function surface(w: World, x: number, z: number) {
  x = Math.min(w.grid.W-1,x); z = Math.min(w.grid.D-1,z);
  const c = { ...w.geography!.surface(x,z) };
  for(let y=w.grid.H-1;y>=0;y--) if(ground.has(w.grid.get(x,y,z))) { c.height=y; c.block=w.grid.get(x,y,z); break; }
  c.water=null; for(let y=c.height+1;y<w.grid.H;y++) if(w.grid.get(x,y,z)===B.Water) c.water=y;
  return c;
}

const inBounds = (b: { x0: number; z0: number; x1: number; z1: number }, p: { x: number; z: number }) => p.x >= b.x0 && p.z >= b.z0 && p.x < b.x1 && p.z < b.z1;
export function regionBounds(w: World, rx: number, rz: number) {
  const size = w.geography!.spec.regionSize;
  return { x0: rx * size, z0: rz * size, x1: (rx + 1) * size, z1: (rz + 1) * size };
}
/** Geometry facts only. This is not an identity, ownership, inventory, goal or mind API. */
export function projectRegion(w: World, rx: number, rz: number) {
  if (!w.geography || !Number.isInteger(rx) || !Number.isInteger(rz) || rx < 0 || rz < 0 || rx * 256 >= w.grid.W || rz * 256 >= w.grid.D) throw new Error('Region outside world');
  const bounds = regionBounds(w, rx, rz), columns: number[][] = [], stride = (w.grid as RegionalGrid).patches.some(p=>p.x<bounds.x1&&p.x+p.grid.W>bounds.x0&&p.z<bounds.z1&&p.z+p.grid.D>bounds.z0)?2:8, openings: number[][] = [], fences: number[][] = [], paths: number[][] = [];
  for (let x = bounds.x0; x <= bounds.x1; x += stride) for (let z = bounds.z0; z <= bounds.z1; z += stride) {
    const c = surface(w,x,z);
    // Stitch 2m settlement meshes to the shared 8m wilderness boundary exactly.
    if(stride===2 && (x===bounds.x0||x===bounds.x1||z===bounds.z0||z===bounds.z1)) {
      const alongZ=x===bounds.x0||x===bounds.x1, axis=alongZ?z:x, lo=Math.floor(axis/8)*8,hi=lo+8,t=(axis-lo)/8;
      c.height=surface(w,alongZ?x:lo,alongZ?lo:z).height*(1-t)+surface(w,alongZ?x:hi,alongZ?hi:z).height*t;
    }
    columns.push([x, z, c.height + 1, c.block, c.water === null ? -1 : c.water + .9, c.forest]);
  }
  const places = w.places().filter(p => inBounds(bounds, p.inside)).map(p => ({ id: p.id, type: p.type, bounds: p.bounds, inside: p.inside, door: p.door, indoor: p.indoor,
    visualSeed: settlementSeed(w.seed, { id: p.id, x: rx, z: rz }), culture: 'regional-prototype',
    wallHeight: Math.min(...[[p.bounds.x0,p.bounds.z0],[p.bounds.x1,p.bounds.z0],[p.bounds.x0,p.bounds.z1],[p.bounds.x1,p.bounds.z1]].map(([x,z])=> { let y=p.bounds.y0; while(y<p.bounds.y1 && w.grid.get(x,y,z)!==B.Air) y++; return Math.max(2,y-p.bounds.y0-1); })),
    family: p.type === 'house' ? 'dwelling' : p.type === 'chapel' ? 'community' : p.type === 'mill' ? 'production' : p.type === 'stall' || p.type === 'tavern' ? 'shop' : p.type === 'farm' || p.type === 'store' ? 'agricultural' : 'workshop' }));
  // Dense geometry exists only in inhabited patches. Never sweep a whole world volume.
  for (const patch of (w.grid as import('../sim/physical/regionalGrid').RegionalGrid).patches) {
    const x0 = Math.max(bounds.x0, patch.x), x1 = Math.min(bounds.x1, patch.x + patch.grid.W), z0 = Math.max(bounds.z0, patch.z), z1 = Math.min(bounds.z1, patch.z + patch.grid.D);
    for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) for (let y = 1; y < patch.grid.H; y++) {
      const b = w.grid.get(x, y, z);
      if (b === B.Door) openings.push([x, y, z, +w.grid.isDoorOpen(x, y, z)]);
      if (b === B.Fence) fences.push([x, y, z, w.grid.get(x-1,y,z)===B.Fence||w.grid.get(x+1,y,z)===B.Fence ? 0 : 90]);
      if (b === B.Path) paths.push([x,y+1,z]);
    }
  }
  return { id: `${rx},${rz}`, seed: w.geography.regionSeed(rx, rz), bounds, terrain: { stride, columns }, openings, fences, paths, places,
    roads: w.geography.roads.filter(r => r.points.some(p => inBounds(bounds, p))).map(r => ({ id: r.id, points: r.points.filter(p => p.x >= bounds.x0 - 128 && p.x < bounds.x1 + 128 && p.z >= bounds.z0 - 128 && p.z < bounds.z1 + 128).map(p=>({...p,y:surface(w,Math.floor(p.x),Math.floor(p.z)).height+1})) })),
    settlements: w.settlements().filter(s => s.bounds.x0 < bounds.x1 && s.bounds.x1 >= bounds.x0 && s.bounds.z0 < bounds.z1 && s.bounds.z1 >= bounds.z0).map(s => ({ id: s.id, bounds: s.bounds })),
    classification: 'canonical', decoration: { classification: 'decorative', seed: w.geography.regionSeed(rx, rz, 'dressing'), collision: false, gameplay: false } };
}

export function regionDynamics(w: World, ids: Set<string>) {
  const geo = w.geography!, inside = (p: { x: number; z: number }) => ids.has(geo.regionId(p.x, p.z));
  const nodes = new Map<string, import('../sim/core/types').ResourceNode>();
  for (const id of ids) { const [rx, rz] = id.split(',').map(Number); for (const n of geo.resources(rx, rz)) nodes.set(n.id, n); }
  for (const n of w.resourceNodes) if (inside(n.pos)) nodes.set(n.id, n);
  return { resources: [...nodes.values()].map(n => ({ id: n.id, kind: n.kind, pos: n.blocks[0] ? { x: n.blocks[0].x, y: n.blocks[0].y, z: n.blocks[0].z } : n.pos, state: n.state, remaining: n.remaining, growthStage: n.growthStage })),
    items: w.items().filter(i => i.pos && !i.holderId && i.quantity > 0 && inside(i.pos)).map(i => ({ id: i.id, type: i.type, pos: i.pos, quantity: i.quantity })),
    crops: w.fields.flatMap(f => f.plots.filter(inside).map(p => ({ id: `${f.id}:${p.x}:${p.z}`, pos: { x: p.x, y: p.y, z: p.z }, state: p.state, growth: p.growth }))),
    mechanisms: w.kernel.assemblies.filter(a => inside(a.pos)).map(a => ({ id: a.id, pos: a.pos, parts: a.parts.length, condition: Math.min(1,...a.parts.map(id=>w.kernel.components.find(c=>c.id===id)?.condition??0)), state: w.persons().some(p=>p.mind.plan.some(t=>t.status==='active' && ['operate_mechanism','mechanism_task'].includes(t.type) && t.data?.assemblyId===a.id)) ? 'working' : 'idle', operatedSeconds:a.operatedSeconds })),
    construction: w.constructionProjects.filter(p => inside({ x: p.siteBounds.x0, z: p.siteBounds.z0 })).map(p => ({ id: p.id, bounds: p.siteBounds, pos:{x:p.siteBounds.x0,y:p.siteBounds.y0,z:p.siteBounds.z0}, state: p.status, progress: p.laborDone/Math.max(1,p.laborRequired) })),
    fires: w.fires.filter(f => inside(f.pos)).map(f => ({ id: f.id, pos: f.pos, lit: f.lit, intensity: f.intensity })),
    doors: [...w.grid.doorStates].flatMap(([i, open]) => { const y = i % w.grid.H, col = (i - y) / w.grid.H, x = Math.floor(col / w.grid.D), z = col % w.grid.D; return inside({ x, z }) ? [{ id: `door:${x}:${y}:${z}`, pos: { x, y, z }, open, yaw:w.grid.get(x-1,y+1,z)!==B.Air&&w.grid.get(x+1,y+1,z)!==B.Air?0:90 }] : []; }),
    environment: { ...w.weather }, worldTime: w.now };
}

/** Per-connection presentation residency. Deleting this object changes no World field. */
export class RegionStream {
  private resident = new Set<string>();
  private dynamics = '';
  private revisions = new Map<string,string>();
  reset(): void { this.resident.clear(); this.dynamics = ''; this.revisions.clear(); }
  frame(w: World) {
    const g = w.geography, p = w.playerId ? w.positionOf(w.playerId) : null; if (!g || !p) return null;
    const size=g.spec.regionSize, rx = Math.floor(p.x / size), rz = Math.floor(p.z / size), wanted = new Set<string>();
    for (let x = rx - 1; x <= rx + 1; x++) for (let z = rz - 1; z <= rz + 1; z++) if (x >= 0 && z >= 0 && x * size < w.grid.W && z * size < w.grid.D) wanted.add(`${x},${z}`);
    const unload = [...this.resident].filter(id => !wanted.has(id));
    const regions = [...wanted].flatMap(id => { const [x,z]=id.split(',').map(Number), revision=JSON.stringify([(w.grid as RegionalGrid).regionRevision(x,z),w.places().filter(p=>g.regionId(p.inside.x,p.inside.z)===id).map(p=>[p.id,p.bounds,p.type,p.indoor])]); const changed=this.revisions.get(id)!==revision; this.revisions.set(id,revision); return !this.resident.has(id)||changed ? [projectRegion(w,x,z)] : []; });
    for(const id of unload) this.revisions.delete(id);
    this.resident = wanted;
    const dynamic = regionDynamics(w, wanted), fingerprint = JSON.stringify({ ...dynamic, worldTime: 0 });
    const changed = this.dynamics !== fingerprint || regions.length>0; this.dynamics = fingerprint;
    return { version: 1, type: 'regions', origin: { x: rx * size, y: 0, z: rz * size }, regions, unload, ...(changed ? { dynamic } : {}) };
  }
}
