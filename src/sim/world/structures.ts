import { B } from '../physical/blocks';
import { VoxelGrid } from '../physical/grid';
import type { Anchor, Vec3 } from '../core/types';
import { RNG } from '../core/rng';

export type Facing = 'N' | 'S' | 'E' | 'W'; // side on which the door is (N = -z)
export interface BuildResult { anchors: Anchor[]; door: Vec3 | null; inside: Vec3; fires: Vec3[]; chimneys: Vec3[]; y1: number; }
export interface BuildCtx { grid: VoxelGrid; reserved: Uint8Array; rng: RNG; }

export function v(x: number, y: number, z: number): Vec3 { return { x, y, z }; }
export function fill(g: VoxelGrid, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, b: number): void {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) if (g.inBounds(x, y, z)) g.data[g.idx(x, y, z)] = b;
}
export function reserve(ctx: BuildCtx, x0: number, z0: number, x1: number, z1: number, margin = 1): void {
  for (let x = x0 - margin; x <= x1 + margin; x++) for (let z = z0 - margin; z <= z1 + margin; z++) if (x >= 0 && z >= 0 && x < ctx.grid.W && z < ctx.grid.D) ctx.reserved[x * ctx.grid.D + z] = 1;
}
/** Flatten a footprint to a given top-solid level and clear above. */
export function flatten(g: VoxelGrid, x0: number, z0: number, x1: number, z1: number, top: number, margin = 1, surface = B.Grass): void {
  for (let x = x0 - margin; x <= x1 + margin; x++) for (let z = z0 - margin; z <= z1 + margin; z++) {
    if (!g.inBounds(x, 0, z)) continue;
    for (let y = 1; y < g.H; y++) { const want = y < top - 2 ? B.Stone : y < top ? B.Dirt : y === top ? surface : B.Air; g.data[g.idx(x, y, z)] = want; }
  }
}

function doorCell(x0: number, z0: number, x1: number, z1: number, facing: Facing): { dx: number; dz: number; ox: number; oz: number; ix: number; iz: number } {
  const mx = Math.floor((x0 + x1) / 2), mz = Math.floor((z0 + z1) / 2);
  switch (facing) {
    case 'N': return { dx: mx, dz: z0, ox: mx, oz: z0 - 1, ix: mx, iz: z0 + 1 };
    case 'S': return { dx: mx, dz: z1, ox: mx, oz: z1 + 1, ix: mx, iz: z1 - 1 };
    case 'W': return { dx: x0, dz: mz, ox: x0 - 1, oz: mz, ix: x0 + 1, iz: mz };
    case 'E': return { dx: x1, dz: mz, ox: x1 + 1, oz: mz, ix: x1 - 1, iz: mz };
  }
}

export interface HouseOpts { style?: 'plank' | 'stone' | 'plaster' | 'log'; roof?: 'thatch' | 'tile' | 'dark'; beds?: number; wallH?: number; fireplace?: boolean; windows?: boolean; ownerIds?: string[]; tables?: number; shelves?: boolean; }

/** Generic house: floor, walls, windows, door, gabled roof, chimney, furniture. */
export function buildHouse(ctx: BuildCtx, x0: number, z0: number, x1: number, z1: number, floor: number, facing: Facing, o: HouseOpts = {}): BuildResult {
  const g = ctx.grid; const wallH = o.wallH ?? 4; const style = o.style ?? 'plank';
  const wall = style === 'stone' ? B.StoneBrick : style === 'plaster' ? B.Plaster : style === 'log' ? B.Log : B.Planks;
  const trim = style === 'log' ? B.DarkPlanks : B.DarkPlanks;
  const roofB = o.roof === 'thatch' ? B.Thatch : o.roof === 'tile' ? B.RoofTile : B.DarkPlanks;
  reserve(ctx, x0, z0, x1, z1, 2);
  fill(g, x0, floor + 1, z0, x1, floor + wallH + 8, z1, B.Air);
  fill(g, x0, floor, z0, x1, floor, z1, B.Planks);               // floor
  fill(g, x0 - 1, floor - 1, z0 - 1, x1 + 1, floor - 1, z1 + 1, B.Cobble); // foundation
  fill(g, x0 - 1, floor, z0 - 1, x1 + 1, floor, z1 + 1, B.Cobble); // rim
  fill(g, x0, floor, z0, x1, floor, z1, B.Planks);
  // walls
  for (let y = floor + 1; y <= floor + wallH; y++) {
    fill(g, x0, y, z0, x1, y, z0, wall); fill(g, x0, y, z1, x1, y, z1, wall); fill(g, x0, y, z0, x0, y, z1, wall); fill(g, x1, y, z0, x1, y, z1, wall);
  }
  // corner posts & base trim
  for (const [cx, cz] of [[x0, z0], [x0, z1], [x1, z0], [x1, z1]]) fill(g, cx, floor + 1, cz, cx, floor + wallH, cz, trim);
  fill(g, x0, floor + wallH, z0, x1, floor + wallH, z0, trim); fill(g, x0, floor + wallH, z1, x1, floor + wallH, z1, trim);
  fill(g, x0, floor + wallH, z0, x0, floor + wallH, z1, trim); fill(g, x1, floor + wallH, z0, x1, floor + wallH, z1, trim);
  // windows
  if (o.windows !== false) {
    for (let x = x0 + 2; x < x1 - 1; x += 3) { g.set(x, floor + 2, z0, B.Glass); g.set(x, floor + 2, z1, B.Glass); if (wallH >= 5) { g.set(x, floor + 3, z0, B.Glass); g.set(x, floor + 3, z1, B.Glass); } }
    for (let z = z0 + 2; z < z1 - 1; z += 3) { g.set(x0, floor + 2, z, B.Glass); g.set(x1, floor + 2, z, B.Glass); if (wallH >= 5) { g.set(x0, floor + 3, z, B.Glass); g.set(x1, floor + 3, z, B.Glass); } }
  }
  // door
  const d = doorCell(x0, z0, x1, z1, facing);
  g.set(d.dx, floor + 1, d.dz, B.Door); g.set(d.dx, floor + 2, d.dz, B.Air);
  if (facing === 'N' || facing === 'S') { g.set(d.dx - 1, floor + 2, d.dz, wall); g.set(d.dx + 1, floor + 2, d.dz, wall); }
  else { g.set(d.dx, floor + 2, d.dz - 1, wall); g.set(d.dx, floor + 2, d.dz + 1, wall); }
  // door step
  g.set(d.ox, floor, d.oz, B.Cobble); g.set(d.ox, floor + 1, d.oz, B.Air); g.set(d.ox, floor + 2, d.oz, B.Air);
  // roof: gable along the longer axis
  const roofY = floor + wallH + 1;
  const alongX = (x1 - x0) >= (z1 - z0);
  let top = roofY;
  if (alongX) {
    for (let i = 0; ; i++) { const za = z0 - 1 + i, zb = z1 + 1 - i; if (za > zb) break; const y = roofY + i; top = y;
      fill(g, x0 - 1, y, za, x1 + 1, y, za, roofB); fill(g, x0 - 1, y, zb, x1 + 1, y, zb, roofB);
      if (za + 1 <= zb - 1) { fill(g, x0, y, za + 1, x0, y, zb - 1, wall); fill(g, x1, y, za + 1, x1, y, zb - 1, wall); }
      if (za === zb) fill(g, x0 - 1, y, za, x1 + 1, y, za, roofB); }
  } else {
    for (let i = 0; ; i++) { const xa = x0 - 1 + i, xb = x1 + 1 - i; if (xa > xb) break; const y = roofY + i; top = y;
      fill(g, xa, y, z0 - 1, xa, y, z1 + 1, roofB); fill(g, xb, y, z0 - 1, xb, y, z1 + 1, roofB);
      if (xa + 1 <= xb - 1) { fill(g, xa + 1, y, z0, xb - 1, y, z0, wall); fill(g, xa + 1, y, z1, xb - 1, y, z1, wall); }
      if (xa === xb) fill(g, xa, y, z0 - 1, xa, y, z1 + 1, roofB); }
  }
  // interior
  const anchors: Anchor[] = []; const fires: Vec3[] = []; const chimneys: Vec3[] = [];
  const inside = v(d.ix, floor + 1, d.iz);
  // back wall is opposite the door
  const backX = facing === 'W' ? x1 - 1 : facing === 'E' ? x0 + 1 : null;
  const backZ = facing === 'N' ? z1 - 1 : facing === 'S' ? z0 + 1 : null;
  const beds = o.beds ?? 1;
  const bedCells: Vec3[] = [];
  if (backZ !== null) { for (let i = 0; i < beds; i++) { const x = x0 + 1 + i * 2; if (x < x1 - 1) bedCells.push(v(x, floor + 1, backZ)); } }
  else if (backX !== null) { for (let i = 0; i < beds; i++) { const z = z0 + 1 + i * 2; if (z < z1 - 1) bedCells.push(v(backX, floor + 1, z)); } }
  bedCells.forEach((c, i) => { g.set(c.x, c.y, c.z, B.Bed); anchors.push({ pos: c, kind: 'bed', ownerId: o.ownerIds?.[i] }); });
  // fireplace on a side wall
  if (o.fireplace !== false) {
    let fx: number, fz: number, cxp: number, czp: number;
    if (facing === 'N' || facing === 'S') { fx = x1 - 1; fz = Math.floor((z0 + z1) / 2); cxp = x1; czp = fz; }
    else { fx = Math.floor((x0 + x1) / 2); fz = z1 - 1; cxp = fx; czp = z1; }
    g.set(fx, floor + 1, fz, B.Fire); g.set(cxp, floor + 1, czp, B.Chimney); g.set(cxp, floor + 2, czp, B.Chimney);
    // chimney column through roof
    let cy = floor + 1; while (cy <= top + 1) { g.set(cxp, cy, czp, B.Chimney); cy++; }
    g.set(cxp, top + 2, czp, B.Chimney);
    fires.push(v(fx, floor + 1, fz)); chimneys.push(v(cxp, top + 3, czp));
    anchors.push({ pos: v(fx + (facing === 'N' || facing === 'S' ? -1 : 0), floor + 1, fz + (facing === 'N' || facing === 'S' ? 0 : -1)), kind: 'fire' });
  }
  // table + chairs in the middle
  const tables = o.tables ?? 1;
  const mx = Math.floor((x0 + x1) / 2), mz = Math.floor((z0 + z1) / 2);
  for (let t = 0; t < tables; t++) {
    const tx = mx + (t % 2) * 3 - (tables > 1 ? 1 : 0), tz = mz + Math.floor(t / 2) * 3 - (tables > 2 ? 1 : 0);
    if (tx <= x0 || tx >= x1 || tz <= z0 || tz >= z1) continue;
    if (g.get(tx, floor + 1, tz) !== B.Air) continue;
    g.set(tx, floor + 1, tz, B.Table);
    for (const [ox, oz] of [[1, 0], [-1, 0]]) { const cx = tx + ox, cz = tz + oz; if (cx > x0 && cx < x1 && cz > z0 && cz < z1 && g.get(cx, floor + 1, cz) === B.Air && !(cx === d.ix && cz === d.iz)) { g.set(cx, floor + 1, cz, B.Chair); anchors.push({ pos: v(cx, floor + 1, cz), kind: 'seat' }); } }
  }
  if (o.shelves) { const sx = facing === 'E' ? x0 + 1 : x1 - 1; for (let z = z0 + 1; z <= z1 - 1; z += 2) if (g.get(sx, floor + 1, z) === B.Air) { g.set(sx, floor + 1, z, B.Bookshelf); } }
  // lantern
  g.set(mx, floor + wallH - 1, mz, B.Lantern);
  // barrel in a corner
  const bx = facing === 'E' ? x1 - 1 : x0 + 1, bz = facing === 'S' ? z1 - 1 : z0 + 1;
  if (g.get(bx, floor + 1, bz) === B.Air) g.set(bx, floor + 1, bz, B.Barrel);
  return { anchors, door: v(d.ox, floor + 1, d.oz), inside, fires, chimneys, y1: top + 3 };
}

export function buildTavern(ctx: BuildCtx, x0: number, z0: number, x1: number, z1: number, floor: number, facing: Facing, ownerIds: string[]): BuildResult {
  const g = ctx.grid;
  const r = buildHouse(ctx, x0, z0, x1, z1, floor, facing, { style: 'plank', roof: 'tile', beds: 0, wallH: 6, fireplace: true, tables: 0 });
  const anchors = r.anchors;
  // bar counter along the back wall
  const bx = facing === 'W' ? x1 - 3 : x0 + 3;
  for (let z = z0 + 2; z <= z1 - 5; z++) g.set(bx, floor + 1, z, B.Counter);
  for (let z = z0 + 2; z <= z1 - 5; z += 2) anchors.push({ pos: v(bx + (facing === 'W' ? -1 : 1), floor + 1, z), kind: 'seat', label: 'bar' });
  anchors.push({ pos: v(bx + (facing === 'W' ? 1 : -1), floor + 1, z0 + 3), kind: 'work', label: 'bar' });
  anchors.push({ pos: v(bx + (facing === 'W' ? 1 : -1), floor + 1, z0 + 5), kind: 'work', label: 'bar' });
  anchors.push({ pos: v(bx, floor + 1, z0 + 4), kind: 'display', label: 'bar' });
  for (let z = z0 + 2; z <= z1 - 5; z++) { g.set(bx + (facing === 'W' ? 2 : -2), floor + 1, z, z % 2 ? B.Barrel : B.Crate); }
  // tables in the hall
  const hx0 = facing === 'W' ? x0 + 2 : x0 + 5, hx1 = facing === 'W' ? x1 - 5 : x1 - 2;
  for (let x = hx0 + 1; x <= hx1 - 1; x += 4) for (let z = z0 + 2; z <= z1 - 5; z += 4) {
    if (g.get(x, floor + 1, z) !== B.Air) continue;
    g.set(x, floor + 1, z, B.Table);
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const cx = x + ox, cz = z + oz; if (g.get(cx, floor + 1, cz) === B.Air && cx > x0 && cx < x1 && cz > z0 && cz < z1 && !(cx === r.inside.x && cz === r.inside.z)) { g.set(cx, floor + 1, cz, B.Chair); anchors.push({ pos: v(cx, floor + 1, cz), kind: 'seat' }); } }
  }
  // back rooms with beds along z1 wall
  const bz = z1 - 1;
  for (let x = x0 + 1; x <= x1 - 1; x += 2) { if (ownerIds.length === 0) break; if (g.get(x, floor + 1, bz) !== B.Air) continue; g.set(x, floor + 1, bz, B.Bed); anchors.push({ pos: v(x, floor + 1, bz), kind: 'bed', ownerId: ownerIds.shift() }); }
  // partition wall
  fill(g, x0 + 1, floor + 1, z1 - 3, x1 - 1, floor + 3, z1 - 3, B.Planks); g.set(Math.floor((x0 + x1) / 2), floor + 1, z1 - 3, B.Door); g.set(Math.floor((x0 + x1) / 2), floor + 2, z1 - 3, B.Air);
  // bench near the fire for the vagrant
  const fire = r.fires[0]; if (fire) { const bp = v(fire.x - 2, floor + 1, fire.z); if (g.get(bp.x, bp.y, bp.z) === B.Air) { g.set(bp.x, bp.y, bp.z, B.Bench); anchors.push({ pos: bp, kind: 'bed', label: 'bench' }); } }
  // hanging lanterns
  for (let x = x0 + 3; x < x1 - 2; x += 4) for (let z = z0 + 3; z < z1 - 4; z += 4) g.set(x, floor + 5, z, B.Lantern);
  // sign outside
  if (r.door) { g.set(r.door.x, floor + 3, r.door.z, B.Sign); }
  return r;
}

export function buildSmithy(ctx: BuildCtx, x0: number, z0: number, x1: number, z1: number, floor: number, facing: Facing): BuildResult {
  const g = ctx.grid; reserve(ctx, x0, z0, x1, z1, 2);
  fill(g, x0, floor + 1, z0, x1, floor + 10, z1, B.Air);
  fill(g, x0 - 1, floor, z0 - 1, x1 + 1, floor, z1 + 1, B.Cobble);
  const wallH = 4;
  for (let y = floor + 1; y <= floor + wallH; y++) { fill(g, x0, y, z0, x1, y, z0, B.StoneBrick); fill(g, x0, y, z1, x1, y, z1, B.StoneBrick); fill(g, x0, y, z0, x0, y, z1, B.StoneBrick); fill(g, x1, y, z0, x1, y, z1, B.StoneBrick); }
  // open front: remove most of the facing wall, keep posts
  const d = doorCell(x0, z0, x1, z1, facing);
  if (facing === 'W' || facing === 'E') { const wx = facing === 'W' ? x0 : x1; for (let z = z0 + 1; z <= z1 - 1; z++) for (let y = floor + 1; y <= floor + wallH - 1; y++) g.set(wx, y, z, B.Air); for (let z = z0 + 1; z <= z1 - 1; z += 3) fill(g, wx, floor + 1, z, wx, floor + wallH, z, B.Log); }
  else { const wz = facing === 'N' ? z0 : z1; for (let x = x0 + 1; x <= x1 - 1; x++) for (let y = floor + 1; y <= floor + wallH - 1; y++) g.set(x, y, wz, B.Air); for (let x = x0 + 1; x <= x1 - 1; x += 3) fill(g, x, floor + 1, wz, x, floor + wallH, wz, B.Log); }
  // roof (flat-ish sloped)
  const roofY = floor + wallH + 1; let top = roofY;
  const alongX = (x1 - x0) >= (z1 - z0);
  if (alongX) { for (let i = 0; ; i++) { const za = z0 - 1 + i, zb = z1 + 1 - i; if (za > zb) break; const y = roofY + i; top = y; fill(g, x0 - 1, y, za, x1 + 1, y, za, B.DarkPlanks); fill(g, x0 - 1, y, zb, x1 + 1, y, zb, B.DarkPlanks); if (za + 1 <= zb - 1) { fill(g, x0, y, za + 1, x0, y, zb - 1, B.StoneBrick); fill(g, x1, y, za + 1, x1, y, zb - 1, B.StoneBrick); } } }
  else { for (let i = 0; ; i++) { const xa = x0 - 1 + i, xb = x1 + 1 - i; if (xa > xb) break; const y = roofY + i; top = y; fill(g, xa, y, z0 - 1, xa, y, z1 + 1, B.DarkPlanks); fill(g, xb, y, z0 - 1, xb, y, z1 + 1, B.DarkPlanks); if (xa + 1 <= xb - 1) { fill(g, xa + 1, y, z0, xb - 1, y, z0, B.StoneBrick); fill(g, xa + 1, y, z1, xb - 1, y, z1, B.StoneBrick); } } }
  const anchors: Anchor[] = []; const fires: Vec3[] = []; const chimneys: Vec3[] = [];
  // forge against back wall
  const fx = facing === 'W' ? x1 - 1 : facing === 'E' ? x0 + 1 : Math.floor((x0 + x1) / 2);
  const fz = facing === 'N' ? z1 - 1 : facing === 'S' ? z0 + 1 : Math.floor((z0 + z1) / 2);
  g.set(fx, floor + 1, fz, B.Furnace); g.set(fx, floor + 2, fz, B.Fire);
  const cx = facing === 'W' ? x1 : facing === 'E' ? x0 : fx, cz = facing === 'N' ? z1 : facing === 'S' ? z0 : fz;
  for (let y = floor + 1; y <= top + 2; y++) g.set(cx, y, cz, B.Chimney);
  fires.push(v(fx, floor + 2, fz)); chimneys.push(v(cx, top + 3, cz));
  // anvil in the middle, trough, workbench
  const mx = Math.floor((x0 + x1) / 2), mz = Math.floor((z0 + z1) / 2);
  g.set(mx, floor + 1, mz, B.Anvil);
  anchors.push({ pos: v(mx + (facing === 'W' ? -1 : facing === 'E' ? 1 : 0), floor + 1, mz + (facing === 'N' ? 1 : facing === 'S' ? -1 : 0)), kind: 'work', label: 'anvil' });
  anchors.push({ pos: v(fx + (facing === 'W' ? -1 : facing === 'E' ? 1 : 0), floor + 1, fz + (facing === 'N' ? -1 : facing === 'S' ? 1 : 0)), kind: 'work', label: 'forge' });
  g.set(x0 + 1, floor + 1, z0 + 1, B.Barrel);
  g.set(x1 - 1, floor + 1, z1 - 1, B.Table); anchors.push({ pos: v(x1 - 1, floor + 1, z1 - 1), kind: 'display', label: 'workbench' });
  g.set(x0 + 1, floor + 1, z1 - 1, B.Table); anchors.push({ pos: v(x0 + 1, floor + 1, z1 - 1), kind: 'display', label: 'rack' });
  g.set(mx, floor + wallH - 1, mz, B.Lantern);
  return { anchors, door: v(d.ox, floor + 1, d.oz), inside: v(d.ix, floor + 1, d.iz), fires, chimneys, y1: top + 3 };
}

export function buildShop(ctx: BuildCtx, x0: number, z0: number, x1: number, z1: number, floor: number, facing: Facing, kind: 'bakery' | 'store', ownerIds: string[]): BuildResult {
  const g = ctx.grid;
  const r = buildHouse(ctx, x0, z0, x1, z1, floor, facing, { style: kind === 'bakery' ? 'plaster' : 'plank', roof: kind === 'bakery' ? 'tile' : 'dark', beds: 0, wallH: 4, fireplace: kind === 'store', tables: 0, shelves: kind === 'store' });
  const anchors = r.anchors;
  // counter across the shop a few cells in from the door
  const d = r.door!; const ins = r.inside;
  if (facing === 'E' || facing === 'W') {
    const cx = facing === 'E' ? x1 - 3 : x0 + 3;
    for (let z = z0 + 1; z <= z1 - 1; z++) if (z !== ins.z + 2 && z !== z1 - 1) g.set(cx, floor + 1, z, B.Counter);
    anchors.push({ pos: v(cx + (facing === 'E' ? -1 : 1), floor + 1, ins.z), kind: 'work', label: 'counter' });
    anchors.push({ pos: v(cx, floor + 1, ins.z - 1), kind: 'display', label: 'counter' }); anchors.push({ pos: v(cx, floor + 1, ins.z + 1), kind: 'display', label: 'counter' });
    anchors.push({ pos: v(cx + (facing === 'E' ? 1 : -1), floor + 1, ins.z), kind: 'counter' });
  } else {
    const cz = facing === 'S' ? z1 - 3 : z0 + 3;
    for (let x = x0 + 1; x <= x1 - 1; x++) if (x !== ins.x + 2 && x !== x1 - 1) g.set(x, floor + 1, cz, B.Counter);
    anchors.push({ pos: v(ins.x, floor + 1, cz + (facing === 'S' ? -1 : 1)), kind: 'work', label: 'counter' });
    anchors.push({ pos: v(ins.x - 1, floor + 1, cz), kind: 'display', label: 'counter' }); anchors.push({ pos: v(ins.x + 1, floor + 1, cz), kind: 'display', label: 'counter' });
    anchors.push({ pos: v(ins.x, floor + 1, cz + (facing === 'S' ? 1 : -1)), kind: 'counter' });
  }
  if (kind === 'bakery') {
    // oven in the back, chimney
    const ox = facing === 'E' ? x0 + 1 : facing === 'W' ? x1 - 1 : Math.floor((x0 + x1) / 2); const oz = facing === 'S' ? z0 + 1 : facing === 'N' ? z1 - 1 : Math.floor((z0 + z1) / 2) + 2;
    g.set(ox, floor + 1, oz, B.Furnace); g.set(ox, floor + 2, oz, B.Furnace);
    const cx = facing === 'E' ? x0 : facing === 'W' ? x1 : ox, cz = facing === 'S' ? z0 : facing === 'N' ? z1 : oz;
    for (let y = floor + 1; y <= r.y1 - 1; y++) g.set(cx, y, cz, B.Chimney);
    r.fires.push(v(ox, floor + 1, oz)); r.chimneys.push(v(cx, r.y1, cz));
    anchors.push({ pos: v(ox + (facing === 'E' ? 1 : facing === 'W' ? -1 : 0), floor + 1, oz + (facing === 'S' ? 1 : facing === 'N' ? -1 : 0)), kind: 'work', label: 'oven' });
  } else {
    for (let i = 0; i < 3; i++) { const cx = facing === 'E' ? x0 + 1 + i : x1 - 1 - i; const cz = facing === 'S' ? z0 + 1 : z1 - 1; if (g.get(cx, floor + 1, cz) === B.Air) g.set(cx, floor + 1, cz, i === 1 ? B.Crate : B.Barrel); }
  }
  // beds in back corners
  const bz = facing === 'S' ? z0 + 1 : z1 - 1;
  let placed = 0;
  for (let x = x0 + 1; x <= x1 - 1 && placed < ownerIds.length; x += 2) { if (g.get(x, floor + 1, bz) === B.Air) { g.set(x, floor + 1, bz, B.Bed); anchors.push({ pos: v(x, floor + 1, bz), kind: 'bed', ownerId: ownerIds[placed++] }); } }
  return r;
}

export function buildChapel(ctx: BuildCtx, x0: number, z0: number, x1: number, z1: number, floor: number, facing: Facing, ownerIds: string[]): BuildResult {
  const g = ctx.grid; reserve(ctx, x0, z0, x1, z1, 2);
  const wallH = 7;
  fill(g, x0, floor + 1, z0, x1, floor + 20, z1, B.Air);
  fill(g, x0 - 1, floor, z0 - 1, x1 + 1, floor, z1 + 1, B.StoneBrick);
  for (let y = floor + 1; y <= floor + wallH; y++) { fill(g, x0, y, z0, x1, y, z0, B.StoneBrick); fill(g, x0, y, z1, x1, y, z1, B.StoneBrick); fill(g, x0, y, z0, x0, y, z1, B.StoneBrick); fill(g, x1, y, z0, x1, y, z1, B.StoneBrick); }
  for (let z = z0 + 2; z < z1 - 1; z += 3) for (let y = floor + 2; y <= floor + 4; y++) { g.set(x0, y, z, B.Glass); g.set(x1, y, z, B.Glass); }
  const d = doorCell(x0, z0, x1, z1, facing);
  g.set(d.dx, floor + 1, d.dz, B.Door); g.set(d.dx, floor + 2, d.dz, B.Air); g.set(d.dx, floor + 3, d.dz, B.Air);
  g.set(d.dx - 1, floor + 1, d.dz, B.Door); g.set(d.dx - 1, floor + 2, d.dz, B.Air); g.set(d.dx - 1, floor + 3, d.dz, B.Air);
  g.set(d.ox, floor + 1, d.oz, B.Air); g.set(d.ox - 1, floor + 1, d.oz, B.Air);
  // roof along z (long axis)
  const roofY = floor + wallH + 1; let top = roofY;
  for (let i = 0; ; i++) { const xa = x0 - 1 + i, xb = x1 + 1 - i; if (xa > xb) break; const y = roofY + i; top = y; fill(g, xa, y, z0 - 1, xa, y, z1 + 1, B.RoofTile); fill(g, xb, y, z0 - 1, xb, y, z1 + 1, B.RoofTile); if (xa + 1 <= xb - 1) { fill(g, xa + 1, y, z0, xb - 1, y, z0, B.StoneBrick); fill(g, xa + 1, y, z1, xb - 1, y, z1, B.StoneBrick); } }
  // bell tower at the front-left corner
  const tx = x0 - 1, tz = facing === 'S' ? z1 + 1 : z0 - 1;
  fill(g, tx - 2, floor, tz - 2, tx + 1, floor, tz + 1, B.StoneBrick);
  for (let y = floor + 1; y <= top + 6; y++) { fill(g, tx - 2, y, tz - 2, tx + 1, y, tz + 1, B.StoneBrick); if (y > floor + 1 && y < top + 4) fill(g, tx - 1, y, tz - 1, tx, y, tz, B.Air); }
  for (let y = top + 3; y <= top + 5; y++) { for (const [ox, oz] of [[-2, -1], [-2, 0], [1, -1], [1, 0], [-1, -2], [0, -2], [-1, 1], [0, 1]]) g.set(tx + ox, y, tz + oz, B.Air); }
  fill(g, tx - 2, top + 7, tz - 2, tx + 1, top + 7, tz + 1, B.RoofTile); fill(g, tx - 1, top + 8, tz - 1, tx, top + 8, tz, B.RoofTile);
  g.set(tx, top + 4, tz, B.Lantern);
  // interior: altar at the back, benches
  const anchors: Anchor[] = [];
  const ax = Math.floor((x0 + x1) / 2), az = facing === 'S' ? z0 + 2 : z1 - 2;
  fill(g, ax - 1, floor + 1, az, ax + 1, floor + 1, az, B.Altar); anchors.push({ pos: v(ax, floor + 1, az + (facing === 'S' ? 1 : -1)), kind: 'altar' });
  anchors.push({ pos: v(ax, floor + 1, az + (facing === 'S' ? 1 : -1)), kind: 'work', label: 'altar' });
  g.set(ax - 2, floor + 1, az, B.Lantern); g.set(ax + 2, floor + 1, az, B.Lantern);
  const rowStart = facing === 'S' ? az + 4 : az - 4, rowEnd = facing === 'S' ? z1 - 3 : z0 + 3, step = facing === 'S' ? 2 : -2;
  for (let z = rowStart; facing === 'S' ? z <= rowEnd : z >= rowEnd; z += step) {
    for (let x = x0 + 1; x <= ax - 2; x++) { g.set(x, floor + 1, z, B.Bench); anchors.push({ pos: v(x, floor + 1, z), kind: 'seat' }); }
    for (let x = ax + 2; x <= x1 - 1; x++) { g.set(x, floor + 1, z, B.Bench); anchors.push({ pos: v(x, floor + 1, z), kind: 'seat' }); }
  }
  for (let z = z0 + 3; z < z1 - 2; z += 4) g.set(ax, floor + 5, z, B.Lantern);
  // annex with beds for the clergy (small lean-to on the east side)
  const ex0 = x1 + 1, ex1 = x1 + 5, ez0 = facing === 'S' ? z0 : z1 - 5, ez1 = facing === 'S' ? z0 + 5 : z1;
  reserve(ctx, ex0, ez0, ex1, ez1, 1);
  fill(g, ex0, floor + 1, ez0, ex1, floor + 12, ez1, B.Air);
  fill(g, ex0, floor, ez0, ex1, floor, ez1, B.Planks);
  for (let y = floor + 1; y <= floor + 3; y++) { fill(g, ex0, y, ez0, ex1, y, ez0, B.Planks); fill(g, ex0, y, ez1, ex1, y, ez1, B.Planks); fill(g, ex1, y, ez0, ex1, y, ez1, B.Planks); }
  fill(g, ex0, floor + 4, ez0 - 1, ex1 + 1, floor + 4, ez1 + 1, B.DarkPlanks); fill(g, ex0, floor + 5, ez0, ex1, floor + 5, ez1, B.DarkPlanks);
  // door from the nave into the annex
  g.set(x1, floor + 1, Math.floor((ez0 + ez1) / 2), B.Door); g.set(x1, floor + 2, Math.floor((ez0 + ez1) / 2), B.Air);
  ownerIds.forEach((oid, i) => { const bz = ez0 + 1 + i * 2; if (bz < ez1) { g.set(ex1 - 1, floor + 1, bz, B.Bed); anchors.push({ pos: v(ex1 - 1, floor + 1, bz), kind: 'bed', ownerId: oid }); } });
  g.set(ex0 + 1, floor + 1, ez1 - 1, B.Bookshelf); g.set(ex0 + 2, floor + 2, ez0 + 2, B.Lantern);
  return { anchors, door: v(d.ox, floor + 1, d.oz), inside: v(d.ix, floor + 1, d.iz), fires: [], chimneys: [], y1: top + 9 };
}

export function buildGraveyard(ctx: BuildCtx, x0: number, z0: number, x1: number, z1: number, floor: number, names: string[]): Anchor[] {
  const g = ctx.grid; reserve(ctx, x0, z0, x1, z1, 1);
  fill(g, x0, floor + 1, z0, x1, floor + 6, z1, B.Air);
  for (let x = x0; x <= x1; x++) { g.set(x, floor + 1, z0, B.Fence); g.set(x, floor + 1, z1, B.Fence); }
  for (let z = z0; z <= z1; z++) { g.set(x0, floor + 1, z, B.Fence); g.set(x1, floor + 1, z, B.Fence); }
  g.set(x0, floor + 1, Math.floor((z0 + z1) / 2), B.Air); g.set(x0, floor + 1, Math.floor((z0 + z1) / 2) + 1, B.Air);
  const anchors: Anchor[] = []; let i = 0;
  for (let z = z0 + 2; z <= z1 - 2; z += 3) for (let x = x0 + 2; x <= x1 - 2; x += 3) { if (i >= names.length) break; g.set(x, floor + 1, z, B.Gravestone); g.set(x, floor + 1, z + 1, B.Flowers); anchors.push({ pos: v(x, floor + 1, z + 1), kind: 'grave', label: names[i++] }); }
  return anchors;
}

export function buildGuardhouse(ctx: BuildCtx, x0: number, z0: number, x1: number, z1: number, floor: number, facing: Facing, ownerIds: string[]): BuildResult {
  const g = ctx.grid;
  const r = buildHouse(ctx, x0, z0, x1, z1, floor, facing, { style: 'stone', roof: 'dark', beds: ownerIds.length, wallH: 4, fireplace: true, tables: 1, ownerIds });
  // watchtower on a corner
  const tx = x1 + 2, tz = z1 + 2; reserve(ctx, tx - 1, tz - 1, tx + 1, tz + 1, 1);
  fill(g, tx - 1, floor + 1, tz - 1, tx + 1, floor + 12, tz + 1, B.Air);
  for (let y = floor; y <= floor + 9; y++) { for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.set(tx + ox, y, tz + oz, B.Log); }
  fill(g, tx - 1, floor + 9, tz - 1, tx + 1, floor + 9, tz + 1, B.Planks);
  for (let y = floor + 10; y <= floor + 10; y++) { for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) g.set(tx + ox, y, tz + oz, B.Fence); }
  fill(g, tx - 2, floor + 12, tz - 2, tx + 2, floor + 12, tz + 2, B.DarkPlanks); fill(g, tx - 1, floor + 13, tz - 1, tx + 1, floor + 13, tz + 1, B.DarkPlanks);
  g.set(tx, floor + 11, tz, B.Torch);
  // weapon rack
  g.set(x0 + 1, floor + 1, z0 + 1, B.Crate); r.anchors.push({ pos: v(x0 + 1, floor + 1, z0 + 1), kind: 'display', label: 'rack' });
  if (r.door) { g.set(r.door.x - 1, floor + 1, r.door.z, B.Torch); g.set(r.door.x + 1, floor + 1, r.door.z, B.Torch); r.anchors.push({ pos: v(r.door.x, floor + 1, r.door.z - 1), kind: 'post', label: 'guardhouse door' }); }
  return r;
}

export function buildFarm(ctx: BuildCtx, x0: number, z0: number, x1: number, z1: number, floor: number): Anchor[] {
  const g = ctx.grid; reserve(ctx, x0, z0, x1, z1, 1);
  fill(g, x0, floor + 1, z0, x1, floor + 5, z1, B.Air);
  for (let x = x0; x <= x1; x++) { g.set(x, floor + 1, z0, B.Fence); g.set(x, floor + 1, z1, B.Fence); }
  for (let z = z0; z <= z1; z++) { g.set(x0, floor + 1, z, B.Fence); g.set(x1, floor + 1, z, B.Fence); }
  // gate openings on each side middle
  const gx = Math.floor((x0 + x1) / 2), gz = Math.floor((z0 + z1) / 2);
  g.set(gx, floor + 1, z0, B.Air); g.set(gx, floor + 1, z1, B.Air); g.set(x0, floor + 1, gz, B.Air); g.set(x1, floor + 1, gz, B.Air);
  const anchors: Anchor[] = [];
  for (let x = x0 + 2; x <= x1 - 2; x++) for (let z = z0 + 2; z <= z1 - 2; z++) {
    if ((x - x0) % 3 === 0) { g.set(x, floor, z, B.Path); continue; }
    g.set(x, floor, z, B.Farmland); const ripe = ctx.rng.chance(0.85); g.set(x, floor + 1, z, ripe ? B.Wheat : (ctx.rng.chance(0.3) ? B.Pumpkin : B.Air));
  }
  for (let x = x0 + 3; x <= x1 - 3; x += 3) for (let z = z0 + 3; z <= z1 - 3; z += 5) anchors.push({ pos: v(x, floor + 1, z), kind: 'work', label: 'field' });
  // hay bales and a scarecrow
  g.set(x0 + 1, floor + 1, z0 + 1, B.Hay); g.set(x0 + 2, floor + 1, z0 + 1, B.Hay); g.set(x0 + 1, floor + 2, z0 + 1, B.Hay);
  g.set(gx, floor + 1, gz, B.Fence); g.set(gx, floor + 2, gz, B.Pumpkin);
  return anchors;
}

export function buildStall(ctx: BuildCtx, x: number, z: number, floor: number, cloth: number, facing: Facing): Anchor[] {
  const g = ctx.grid; reserve(ctx, x - 1, z - 1, x + 1, z + 1, 0);
  const alongX = facing === 'N' || facing === 'S';
  const anchors: Anchor[] = [];
  if (alongX) {
    for (let dx = -1; dx <= 1; dx++) g.set(x + dx, floor + 1, z, B.Counter);
    for (const dx of [-1, 1]) { g.set(x + dx, floor + 1, z + 1, B.Fence); g.set(x + dx, floor + 2, z + 1, B.Fence); g.set(x + dx, floor + 1, z - 1, B.Fence); g.set(x + dx, floor + 2, z - 1, B.Fence); }
    fill(g, x - 2, floor + 3, z - 1, x + 2, floor + 3, z + 1, cloth);
    const behind = facing === 'N' ? z + 1 : z - 1, front = facing === 'N' ? z - 1 : z + 1;
    anchors.push({ pos: v(x, floor + 1, behind), kind: 'work', label: 'stall' }); anchors.push({ pos: v(x, floor + 1, front), kind: 'counter' });
    anchors.push({ pos: v(x - 1, floor + 1, z), kind: 'display' }); anchors.push({ pos: v(x + 1, floor + 1, z), kind: 'display' });
  } else {
    for (let dz = -1; dz <= 1; dz++) g.set(x, floor + 1, z + dz, B.Counter);
    for (const dz of [-1, 1]) { g.set(x + 1, floor + 1, z + dz, B.Fence); g.set(x + 1, floor + 2, z + dz, B.Fence); g.set(x - 1, floor + 1, z + dz, B.Fence); g.set(x - 1, floor + 2, z + dz, B.Fence); }
    fill(g, x - 1, floor + 3, z - 2, x + 1, floor + 3, z + 2, cloth);
    const behind = facing === 'W' ? x + 1 : x - 1, front = facing === 'W' ? x - 1 : x + 1;
    anchors.push({ pos: v(behind, floor + 1, z), kind: 'work', label: 'stall' }); anchors.push({ pos: v(front, floor + 1, z), kind: 'counter' });
    anchors.push({ pos: v(x, floor + 1, z - 1), kind: 'display' }); anchors.push({ pos: v(x, floor + 1, z + 1), kind: 'display' });
  }
  return anchors;
}

export function buildWell(ctx: BuildCtx, x: number, z: number, floor: number): Anchor[] {
  const g = ctx.grid; reserve(ctx, x - 2, z - 2, x + 2, z + 2, 0);
  fill(g, x - 1, floor + 1, z - 1, x + 1, floor + 1, z + 1, B.Well); g.set(x, floor + 1, z, B.Water); g.set(x, floor, z, B.Water);
  for (const [ox, oz] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) { g.set(x + ox, floor + 2, z + oz, B.Fence); g.set(x + ox, floor + 3, z + oz, B.Fence); }
  fill(g, x - 2, floor + 4, z - 2, x + 2, floor + 4, z + 2, B.RoofTile); fill(g, x - 1, floor + 5, z - 1, x + 1, floor + 5, z + 1, B.RoofTile);
  return [{ pos: v(x - 2, floor + 1, z), kind: 'work', label: 'well' }, { pos: v(x + 2, floor + 1, z), kind: 'seat', label: 'well edge' }, { pos: v(x, floor + 1, z + 2), kind: 'seat', label: 'well edge' }];
}

export function buildCamp(ctx: BuildCtx, x: number, z: number, floor: number, ownerIds: string[]): { anchors: Anchor[]; fires: Vec3[] } {
  const g = ctx.grid; reserve(ctx, x - 6, z - 6, x + 6, z + 6, 1);
  flatten(g, x - 6, z - 6, x + 6, z + 6, floor, 1, B.Dirt);
  fill(g, x - 1, floor, z - 1, x + 1, floor, z + 1, B.Cobble); g.set(x, floor + 1, z, B.Fire);
  const anchors: Anchor[] = [];
  const tents = [[-4, -3], [4, -3], [0, 4]];
  tents.forEach(([ox, oz], i) => {
    const tx = x + ox, tz = z + oz;
    fill(g, tx - 1, floor + 1, tz - 1, tx + 1, floor + 1, tz + 1, B.Wool); fill(g, tx, floor + 2, tz - 1, tx, floor + 2, tz + 1, B.Wool);
    fill(g, tx - 1, floor + 1, tz, tx + 1, floor + 1, tz, B.Air); g.set(tx, floor + 2, tz, B.Air);
    g.set(tx, floor, tz, B.Bed);
    // open the side facing the fire
    const fx = ox > 0 ? -1 : ox < 0 ? 1 : 0, fz = oz > 0 ? -1 : 0;
    if (fx) { g.set(tx + fx, floor + 1, tz, B.Air); }
    if (fz) { g.set(tx, floor + 1, tz + fz, B.Air); }
    if (i < ownerIds.length) anchors.push({ pos: v(tx, floor + 1, tz), kind: 'bed', ownerId: ownerIds[i] });
  });
  for (const [ox, oz] of [[-2, 1], [2, 1], [0, -2]]) anchors.push({ pos: v(x + ox, floor + 1, z + oz), kind: 'seat', label: 'fire' });
  g.set(x + 3, floor + 1, z + 2, B.Crate); anchors.push({ pos: v(x + 3, floor + 1, z + 2), kind: 'display', label: 'loot' });
  anchors.push({ pos: v(x - 2, floor + 1, z - 1), kind: 'work', label: 'camp' });
  anchors.push({ pos: v(x + 2, floor + 1, z - 1), kind: 'post', label: 'camp watch' });
  return { anchors, fires: [v(x, floor + 1, z)] };
}

export function buildShrine(ctx: BuildCtx, x: number, z: number, floor: number): Anchor[] {
  const g = ctx.grid; reserve(ctx, x - 5, z - 5, x + 5, z + 5, 1);
  flatten(g, x - 5, z - 5, x + 5, z + 5, floor, 0, B.Grass);
  fill(g, x - 3, floor, z - 3, x + 3, floor, z + 3, B.Mossy);
  for (const [ox, oz] of [[-3, -3], [3, -3], [-3, 3], [3, 3], [0, -3], [0, 3]]) { const h = 2 + Math.floor(ctx.rng.next() * 4); fill(g, x + ox, floor + 1, z + oz, x + ox, floor + h, z + oz, B.Mossy); }
  g.set(x, floor + 1, z, B.Altar); g.set(x, floor + 2, z, B.Lantern);
  for (const [ox, oz] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) g.set(x + ox, floor + 1, z + oz, B.Flowers);
  return [{ pos: v(x, floor + 1, z + 1), kind: 'altar' }, { pos: v(x, floor + 1, z + 1), kind: 'work', label: 'shrine' }, { pos: v(x - 1, floor + 1, z - 1), kind: 'seat' }];
}

export function buildMill(ctx: BuildCtx, x0: number, z0: number, x1: number, z1: number, floor: number, facing: Facing, riverSide: 'W' | 'E', ownerIds: string[]): BuildResult {
  const g = ctx.grid;
  const r = buildHouse(ctx, x0, z0, x1, z1, floor, facing, { style: 'stone', roof: 'dark', beds: ownerIds.length, wallH: 5, ownerIds, tables: 1 });
  // water wheel: a ring of dark planks on the river side
  const wx = riverSide === 'W' ? x0 - 2 : x1 + 2; const wz = Math.floor((z0 + z1) / 2);
  for (let a = 0; a < 16; a++) { const ang = (a / 16) * Math.PI * 2; const dy = Math.round(Math.sin(ang) * 3.2), dz = Math.round(Math.cos(ang) * 3.2); g.set(wx, floor + 2 + dy, wz + dz, B.DarkPlanks); }
  fill(g, wx, floor + 2, wz, riverSide === 'W' ? x0 : x1, floor + 2, wz, B.Log);
  g.set(x0 + 1, floor + 1, z1 - 1, B.Crate); g.set(x0 + 2, floor + 1, z1 - 1, B.Crate); g.set(x0 + 1, floor + 2, z1 - 1, B.Hay);
  r.anchors.push({ pos: v(x0 + 2, floor + 1, z0 + 2), kind: 'work', label: 'millstone' });
  return r;
}

export function buildBridge(ctx: BuildCtx, x0: number, x1: number, z: number, y: number): void {
  const g = ctx.grid;
  for (let x = x0; x <= x1; x++) { for (let dz = -1; dz <= 1; dz++) { g.set(x, y, z + dz, B.Planks); for (let yy = y + 1; yy < y + 4; yy++) g.set(x, yy, z + dz, B.Air); } g.set(x, y + 1, z - 2, B.Fence); g.set(x, y + 1, z + 2, B.Fence); g.set(x, y, z - 2, B.Planks); g.set(x, y, z + 2, B.Planks); for (let yy = y - 1; yy > y - 4; yy--) if (g.get(x, yy, z) === B.Water || g.get(x, yy, z) === B.Air) { if ((x - x0) % 4 === 0) { g.set(x, yy, z - 2, B.Log); g.set(x, yy, z + 2, B.Log); } } }
  reserve(ctx, x0, z - 2, x1, z + 2, 1);
}
