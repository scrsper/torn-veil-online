/** Block palette. Blocks are the substance of the physical layer; visual hints live here too
 *  because the renderer is a faithful projection of the physical world. */
export const enum B {
  Air = 0, Grass, Dirt, Stone, Cobble, Planks, DarkPlanks, Log, Leaves, Water, Sand, Thatch, Brick, Glass,
  Door, Torch, Farmland, Wheat, Hay, Furnace, Anvil, Table, Bed, Barrel, Fence, Flowers, Path, RoofTile,
  Chair, Counter, Fire, Chimney, Bookshelf, Altar, Bench, Gravestone, Mossy, Tallgrass, Bush, Pumpkin,
  Cloth, ClothRed, ClothBlue, Wool, StoneBrick, Well, Lantern, Log2, Leaves2, Gravel, Crate, Sign, Snow, Mud, Plaster
}
export type Shape = 'cube' | 'cross' | 'slab' | 'inset' | 'post' | 'none';
export interface BlockDef {
  name: string; color: [number, number, number]; shape: Shape; solid: boolean; opaque: boolean; walkCost: number;
  emissive?: [number, number, number]; height?: number; inset?: number; transparent?: boolean; light?: number; color2?: [number, number, number];
  noise?: number;
}
const c = (r: number, g: number, b: number): [number, number, number] => [r / 255, g / 255, b / 255];
export const BLOCKS: Record<number, BlockDef> = {
  [B.Air]: { name: 'air', color: c(0, 0, 0), shape: 'none', solid: false, opaque: false, walkCost: 1 },
  [B.Grass]: { name: 'grass', color: c(98, 150, 62), color2: c(120, 90, 55), shape: 'cube', solid: true, opaque: true, walkCost: 1, noise: 0.08 },
  [B.Dirt]: { name: 'dirt', color: c(120, 88, 56), shape: 'cube', solid: true, opaque: true, walkCost: 1, noise: 0.06 },
  [B.Stone]: { name: 'stone', color: c(122, 124, 126), shape: 'cube', solid: true, opaque: true, walkCost: 1, noise: 0.07 },
  [B.Cobble]: { name: 'cobblestone', color: c(112, 108, 104), shape: 'cube', solid: true, opaque: true, walkCost: 1, noise: 0.12 },
  [B.Planks]: { name: 'planks', color: c(178, 136, 84), shape: 'cube', solid: true, opaque: true, walkCost: 1, noise: 0.05 },
  [B.DarkPlanks]: { name: 'dark planks', color: c(96, 64, 40), shape: 'cube', solid: true, opaque: true, walkCost: 1, noise: 0.05 },
  [B.Log]: { name: 'oak log', color: c(104, 78, 48), shape: 'cube', solid: true, opaque: true, walkCost: 1, noise: 0.05 },
  [B.Leaves]: { name: 'leaves', color: c(62, 118, 46), shape: 'cube', solid: true, opaque: false, walkCost: 3, noise: 0.14 },
  [B.Water]: { name: 'water', color: c(50, 110, 190), shape: 'cube', solid: false, opaque: false, walkCost: 20, transparent: true },
  [B.Sand]: { name: 'sand', color: c(214, 200, 150), shape: 'cube', solid: true, opaque: true, walkCost: 1, noise: 0.05 },
  [B.Thatch]: { name: 'thatch', color: c(190, 160, 80), shape: 'cube', solid: true, opaque: true, walkCost: 1, noise: 0.1 },
  [B.Brick]: { name: 'brick', color: c(160, 82, 64), shape: 'cube', solid: true, opaque: true, walkCost: 1, noise: 0.08 },
  [B.Glass]: { name: 'glass', color: c(190, 220, 240), shape: 'cube', solid: true, opaque: false, walkCost: 1, transparent: true },
  [B.Door]: { name: 'door', color: c(130, 90, 50), shape: 'inset', inset: 0.35, solid: false, opaque: false, walkCost: 1.2 },
  [B.Torch]: { name: 'torch', color: c(255, 200, 100), shape: 'post', solid: false, opaque: false, walkCost: 1, emissive: [1.0, 0.7, 0.3], light: 6, height: 0.6 },
  [B.Farmland]: { name: 'farmland', color: c(86, 60, 38), shape: 'slab', height: 0.9, solid: true, opaque: true, walkCost: 2, noise: 0.07 },
  [B.Wheat]: { name: 'wheat', color: c(210, 180, 80), shape: 'cross', solid: false, opaque: false, walkCost: 2 },
  [B.Hay]: { name: 'hay bale', color: c(200, 170, 70), shape: 'cube', solid: true, opaque: true, walkCost: 1, noise: 0.1 },
  [B.Furnace]: { name: 'oven', color: c(90, 88, 86), shape: 'cube', solid: true, opaque: true, walkCost: 1, emissive: [0.6, 0.25, 0.05], light: 5 },
  [B.Anvil]: { name: 'anvil', color: c(60, 60, 66), shape: 'inset', inset: 0.2, height: 0.7, solid: false, opaque: false, walkCost: 3 },
  [B.Table]: { name: 'table', color: c(150, 110, 70), shape: 'slab', height: 0.75, solid: false, opaque: false, walkCost: 4 },
  [B.Bed]: { name: 'bed', color: c(170, 60, 60), color2: c(230, 225, 210), shape: 'slab', height: 0.5, solid: false, opaque: false, walkCost: 3 },
  [B.Barrel]: { name: 'barrel', color: c(120, 85, 50), shape: 'inset', inset: 0.1, height: 0.9, solid: true, opaque: false, walkCost: 5 },
  [B.Fence]: { name: 'fence', color: c(140, 105, 65), shape: 'post', solid: true, opaque: false, walkCost: 50, height: 1.0 },
  [B.Flowers]: { name: 'flowers', color: c(230, 90, 120), shape: 'cross', solid: false, opaque: false, walkCost: 1 },
  [B.Path]: { name: 'dirt path', color: c(150, 122, 82), shape: 'cube', solid: true, opaque: true, walkCost: 0.6, noise: 0.06 },
  [B.RoofTile]: { name: 'roof tiles', color: c(120, 50, 40), shape: 'cube', solid: true, opaque: true, walkCost: 1, noise: 0.08 },
  [B.Chair]: { name: 'chair', color: c(140, 100, 60), shape: 'inset', inset: 0.25, height: 0.5, solid: false, opaque: false, walkCost: 2 },
  [B.Counter]: { name: 'counter', color: c(120, 80, 45), shape: 'slab', height: 0.9, solid: true, opaque: false, walkCost: 10 },
  [B.Fire]: { name: 'fire', color: c(255, 140, 40), shape: 'cross', solid: false, opaque: false, walkCost: 30, emissive: [1.0, 0.5, 0.15], light: 9 },
  [B.Chimney]: { name: 'chimney', color: c(100, 96, 92), shape: 'cube', solid: true, opaque: true, walkCost: 1, noise: 0.1 },
  [B.Bookshelf]: { name: 'bookshelf', color: c(110, 80, 50), color2: c(160, 60, 60), shape: 'cube', solid: true, opaque: true, walkCost: 1 },
  [B.Altar]: { name: 'altar', color: c(220, 215, 200), shape: 'slab', height: 0.85, solid: true, opaque: false, walkCost: 10 },
  [B.Bench]: { name: 'bench', color: c(130, 95, 60), shape: 'slab', height: 0.45, solid: false, opaque: false, walkCost: 2 },
  [B.Gravestone]: { name: 'gravestone', color: c(140, 140, 138), shape: 'inset', inset: 0.3, height: 0.8, solid: true, opaque: false, walkCost: 10 },
  [B.Mossy]: { name: 'mossy stone', color: c(96, 118, 90), shape: 'cube', solid: true, opaque: true, walkCost: 1, noise: 0.12 },
  [B.Tallgrass]: { name: 'grass tuft', color: c(110, 165, 70), shape: 'cross', solid: false, opaque: false, walkCost: 1 },
  [B.Bush]: { name: 'bush', color: c(52, 100, 40), shape: 'inset', inset: 0.05, height: 0.85, solid: true, opaque: false, walkCost: 8, noise: 0.15 },
  [B.Pumpkin]: { name: 'pumpkin', color: c(220, 130, 40), shape: 'inset', inset: 0.15, height: 0.7, solid: false, opaque: false, walkCost: 3 },
  [B.Cloth]: { name: 'canvas', color: c(225, 210, 180), shape: 'cube', solid: true, opaque: true, walkCost: 1 },
  [B.ClothRed]: { name: 'red cloth', color: c(180, 50, 50), shape: 'cube', solid: true, opaque: true, walkCost: 1 },
  [B.ClothBlue]: { name: 'blue cloth', color: c(50, 80, 170), shape: 'cube', solid: true, opaque: true, walkCost: 1 },
  [B.Wool]: { name: 'wool', color: c(230, 225, 215), shape: 'cube', solid: true, opaque: true, walkCost: 1 },
  [B.StoneBrick]: { name: 'stone brick', color: c(134, 132, 128), shape: 'cube', solid: true, opaque: true, walkCost: 1, noise: 0.06 },
  [B.Well]: { name: 'well', color: c(110, 110, 112), shape: 'cube', solid: true, opaque: true, walkCost: 50 },
  [B.Lantern]: { name: 'lantern', color: c(255, 220, 140), shape: 'inset', inset: 0.3, height: 0.5, solid: false, opaque: false, walkCost: 1, emissive: [1.0, 0.8, 0.4], light: 7 },
  [B.Log2]: { name: 'pine log', color: c(80, 58, 36), shape: 'cube', solid: true, opaque: true, walkCost: 1 },
  [B.Leaves2]: { name: 'pine needles', color: c(40, 90, 50), shape: 'cube', solid: true, opaque: false, walkCost: 3, noise: 0.14 },
  [B.Gravel]: { name: 'gravel', color: c(130, 126, 120), shape: 'cube', solid: true, opaque: true, walkCost: 0.8, noise: 0.12 },
  [B.Crate]: { name: 'crate', color: c(160, 125, 80), shape: 'cube', solid: true, opaque: true, walkCost: 20 },
  [B.Sign]: { name: 'sign', color: c(170, 130, 80), shape: 'inset', inset: 0.4, height: 0.9, solid: false, opaque: false, walkCost: 1 },
  [B.Snow]: { name: 'snow', color: c(240, 244, 250), shape: 'cube', solid: true, opaque: true, walkCost: 1.5 },
  [B.Mud]: { name: 'mud', color: c(80, 62, 44), shape: 'cube', solid: true, opaque: true, walkCost: 2, noise: 0.08 },
  [B.Plaster]: { name: 'plaster', color: c(226, 214, 190), shape: 'cube', solid: true, opaque: true, walkCost: 1, noise: 0.04 },
};
export function blockDef(id: number): BlockDef { return BLOCKS[id] ?? BLOCKS[B.Air]; }
export function isSolid(id: number): boolean { return blockDef(id).solid; }
export function isOpaque(id: number): boolean { return blockDef(id).opaque; }
