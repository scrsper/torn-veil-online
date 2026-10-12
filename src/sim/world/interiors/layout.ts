import { B } from '../../physical/blocks';
import { buildMaze } from './maze';
import {focusedFloorPlan,type FocusedFloorPlan} from '../assets/focusedLayouts';

/** Explicit bounded namespace, versioned separately from either realm. Addresses use
 * the existing grid dimensions, preserving every old door/diff index. Unallocated cells
 * remain solid. This is a staging namespace for folded interiors, not a third continent. */
export const INTERIOR_NAMESPACE = Object.freeze({ id: 'veil:folded-interiors:v1', x: 6144, z: 0, width: 2048, depth: 6144, cell: 128, capacity: 768 });
export interface InteriorDescriptor {
  version: 1; id: string; buildingId: string; seed: number; floor: number; slot: number;
  assetKit?:1;
}
export interface InteriorBox { id: string; x: number; y: number; z: number; w: number; h: number; d: number; kind: 'wall' | 'column' | 'bench' }
export interface InteriorPlan {
  id: string; descriptor: InteriorDescriptor; origin: { x: number; z: number }; half: number;
  start: { x: number; y: number; z: number }; exit: { x: number; y: number; z: number };
  solids: InteriorBox[]; rooms: { id: string; x: number; z: number; w: number; d: number; role: string }[];
  sources: { id: string; x: number; y: number; z: number; role: 'archive' | 'stores' }[];
  assetScene?:FocusedFloorPlan;
}
export function validInteriorDescriptor(d: InteriorDescriptor): boolean {
  return !!d && d.version === 1 && typeof d.id === 'string' && d.id.length > 0 && d.id.length <= 200
    && typeof d.buildingId === 'string' && d.buildingId.length > 0 && d.buildingId.length <= 200
    && Number.isSafeInteger(d.seed) && d.seed >= 0 && d.seed <= 0xffffffff
    && Number.isInteger(d.floor) && d.floor >= 1 && d.floor <= 100
    && Number.isInteger(d.slot) && d.slot >= 0 && d.slot < INTERIOR_NAMESPACE.capacity && (d.assetKit===undefined||d.assetKit===1);
}
export function interiorSlot(x: number, z: number): number | null {
  const n = INTERIOR_NAMESPACE;
  if (x < n.x || x >= n.x + n.width || z < n.z || z >= n.z + n.depth) return null;
  return Math.floor((z - n.z) / n.cell) * (n.width / n.cell) + Math.floor((x - n.x) / n.cell);
}
export function interiorOrigin(slot: number) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= INTERIOR_NAMESPACE.capacity) throw Error('Interior address capacity exceeded');
  const n = INTERIOR_NAMESPACE, columns = n.width / n.cell;
  return { x: n.x + slot % columns * n.cell + n.cell / 2, z: n.z + Math.floor(slot / columns) * n.cell + n.cell / 2 };
}
// Preserve the authored Tower's deterministic stream without importing presentation code.
function mulberry(seed: number) { return () => { let t = seed += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/** Connected rooms, a clear entrance/exit, storage and side archives. This yields physical
 * solids and stable access locations for both collision and rendering. Art may decorate
 * these structures but cannot add an invisible wall or erase a canonical opening. */
export function planInterior(d: InteriorDescriptor): InteriorPlan {
  if (!validInteriorDescriptor(d)) throw Error('Invalid interior descriptor');
  const origin = interiorOrigin(d.slot), half = 24 + 6 * Math.floor(d.floor / 25);
  if(d.assetKit){const assetScene=focusedFloorPlan(d.id,d.seed,d.floor,origin);return {id:d.id,descriptor:{...d},origin,half:61,start:assetScene.start,exit:assetScene.exit,rooms:assetScene.rooms,solids:[],sources:[],assetScene};}
  const maze = buildMaze(mulberry((d.seed * 31337 + d.floor * 7349) >>> 0), half, d.floor % 5 === 0 ? [-half * .52, -half * .2] : null);
  const boxes: InteriorBox[] = [], n = (suffix: string) => `${d.id}:${suffix}`;
  const box = (id: string, x: number, z: number, w: number, height: number, depth: number, kind: InteriorBox['kind'] = 'wall') =>
    boxes.push({ id: n(id), x: origin.x + x, y: 1, z: origin.z + z, w, h: height, d: depth, kind });
  box('west', -half - 1, -half - 1, 1, 6, half * 2 + 2); box('east', half, -half - 1, 1, 6, half * 2 + 2);
  box('north', -half, -half - 1, half * 2, 6, 1); box('south', -half, half, half * 2, 6, 1);
  maze.walls.forEach((s, i) => box(`partition:${i}`, s.x - (s.yaw ? s.len / 2 : .5), s.z - (s.yaw ? .5 : s.len / 2), s.yaw ? s.len : 1, 5, s.yaw ? 1 : s.len));
  const rooms = maze.rooms.map((r, i) => ({ id: n(`room:${i}`), x: origin.x + maze.x(r.i0) - maze.cell / 2,
    z: origin.z + maze.z(r.j0) - maze.cell / 2, w: r.w * maze.cell, d: r.d * maze.cell, role: r.role }));
  const sideRooms = rooms.filter(r => r.role === 'room');
  const sources = sideRooms.slice(0, 3).map((r, i) => ({ id: n(`source:${i}`), x: r.x + r.w / 2, y: 1, z: r.z + r.d / 2, role: i === 0 ? 'archive' as const : 'stores' as const }));
  // Furnish room corners; preserve a complete cell-centre route through every doorway.
  for (const [i, r] of sideRooms.entries()) {
    if (maze.cornerClosed(r.x - origin.x + 1.5, r.z - origin.z + 1.5)) box(`bench:${i}`, r.x - origin.x + 1, r.z - origin.z + 1, 2, 1, 1, 'bench');
  }
  return { id: d.id, descriptor: { ...d }, origin, half, solids: boxes, rooms, sources,
    start: { x: origin.x + .5, y: 1, z: origin.z + half - 4.5 }, exit: { x: origin.x + .5, y: 1, z: origin.z - half + 3.5 } };
}
/** Undefined means outside this instance; the namespace's default remains solid. */
export function interiorVoxel(plan: InteriorPlan, x: number, y: number, z: number): number | undefined {
  if (Math.abs(x + .5 - plan.origin.x) > plan.half + 1 || Math.abs(z + .5 - plan.origin.z) > plan.half + 1) return undefined;
  if (y <= 0) return B.Stone;
  return plan.solids.some(s => x + .5 >= s.x && x + .5 < s.x + s.w && y + .5 >= s.y && y + .5 < s.y + s.h && z + .5 >= s.z && z + .5 < s.z + s.d) ? B.Stone : B.Air;
}
