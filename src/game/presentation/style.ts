import { B, BLOCKS } from '../../sim/physical/blocks';
import type { SurfaceFamily } from './textures';
import type { RGB } from './geo';

/**
 * The presentation descriptor layer.
 *
 * `sim/physical/blocks.ts` is canonical: it says what substance occupies a cell. This file says
 * how that substance is PRESENTED, and by which renderer — and it is the only place that
 * knowledge lives. Adding a smoother look for a substance means changing a row here, not
 * touching the simulation, the mesher, or any individual skin.
 *
 *   canonical block id  ->  PresentationChannel (who draws it)  ->  SurfaceFamily (how it looks)
 *
 * The channels are mutually exclusive by construction: exactly one renderer draws any given
 * cell, so nothing is ever drawn twice and nothing silently disappears.
 */
export type PresentationChannel =
  /** Part of the continuous smoothed ground surface (`terrainSkin`). Never drawn as a cube. */
  | 'terrain'
  /** Replaced by procedural plant geometry (`foliageSkin`). */
  | 'foliage'
  /** Still drawn by the chunk mesher, as geometry, with the upgraded materials. */
  | 'voxel'
  /** Drawn by a per-building architectural skin (`buildingSkin`) — windows, doors. */
  | 'architecture';

/** Which renderer owns a block id. Anything not listed is `voxel`. */
const CHANNEL: Partial<Record<number, PresentationChannel>> = {
  // --- the ground itself. These are the substances a person walks on; the terrain skin drapes
  // one continuous, smoothly-shaded surface over the whole height field they form.
  [B.Grass]: 'terrain', [B.Dirt]: 'terrain', [B.Stone]: 'terrain', [B.Sand]: 'terrain',
  [B.Snow]: 'terrain', [B.Mud]: 'terrain', [B.Gravel]: 'terrain', [B.Path]: 'terrain',
  [B.Cobble]: 'terrain', [B.Farmland]: 'terrain', [B.Mossy]: 'terrain',

  // --- living things and crops. Each of these is a canonical cell that becomes a real plant.
  [B.Log]: 'foliage', [B.Log2]: 'foliage', [B.Leaves]: 'foliage', [B.Leaves2]: 'foliage',
  [B.Bush]: 'foliage', [B.Tallgrass]: 'foliage', [B.Flowers]: 'foliage',
  [B.Wheat]: 'foliage', [B.Sprout]: 'foliage', [B.Seedling]: 'foliage', [B.Stubble]: 'foliage',
  [B.Hay]: 'foliage', [B.Pumpkin]: 'foliage',

  // --- building fabric with its own architectural treatment.
  [B.Glass]: 'architecture', [B.Door]: 'architecture', [B.Fence]: 'architecture',
  [B.Lantern]: 'architecture',
};

export function channelOf(id: number): PresentationChannel { return CHANNEL[id] ?? 'voxel'; }

/** True when the chunk mesher must not emit this block: something else is drawing it. */
export function meshedAsBlock(id: number): boolean {
  const c = channelOf(id);
  return c === 'voxel';
}

/** Material family for a block drawn by the chunk mesher (decides its texture/roughness group). */
const FAMILY: Partial<Record<number, SurfaceFamily>> = {
  [B.Planks]: 'plank', [B.DarkPlanks]: 'plank', [B.Table]: 'plank', [B.Chair]: 'plank',
  [B.Bench]: 'plank', [B.Counter]: 'plank', [B.Bookshelf]: 'plank', [B.Barrel]: 'plank',
  [B.Crate]: 'plank', [B.Sign]: 'plank', [B.Bed]: 'cloth',
  [B.StoneBrick]: 'stone', [B.Brick]: 'stone', [B.Well]: 'stone', [B.Chimney]: 'stone',
  [B.Altar]: 'stone', [B.Gravestone]: 'stone', [B.Furnace]: 'stone',
  [B.Plaster]: 'plaster',
  [B.Thatch]: 'thatch', [B.RoofTile]: 'tile',
  [B.Cloth]: 'cloth', [B.ClothRed]: 'cloth', [B.ClothBlue]: 'cloth', [B.Wool]: 'cloth',
  [B.Anvil]: 'metal', [B.Lantern]: 'metal', [B.Torch]: 'bark',
  [B.Water]: 'grain', [B.Fire]: 'grain',
};

export function familyOf(id: number): SurfaceFamily { return FAMILY[id] ?? 'grain'; }

/** The presentation colour of a block: the canonical palette entry, unchanged. */
export function colorOf(id: number): RGB {
  const def = BLOCKS[id] ?? BLOCKS[B.Air];
  return [def.color[0], def.color[1], def.color[2]];
}

/**
 * Ground surfaces get a slightly richer treatment than their flat palette colour: a second
 * colour to blend toward on slopes (exposed earth/rock under turf) and their own detail family.
 * This is what makes a hillside read as a hillside rather than as a green ramp.
 */
export interface GroundStyle { top: RGB; slope: RGB; family: SurfaceFamily; }
const GROUND: Partial<Record<number, GroundStyle>> = {
  [B.Grass]: { top: [0.30, 0.44, 0.20], slope: [0.32, 0.26, 0.17], family: 'ground' },
  [B.Dirt]: { top: [0.40, 0.30, 0.20], slope: [0.33, 0.25, 0.17], family: 'ground' },
  [B.Path]: { top: [0.53, 0.44, 0.31], slope: [0.38, 0.31, 0.22], family: 'ground' },
  [B.Cobble]: { top: [0.42, 0.41, 0.40], slope: [0.34, 0.33, 0.32], family: 'rock' },
  [B.Gravel]: { top: [0.49, 0.47, 0.44], slope: [0.38, 0.36, 0.34], family: 'rock' },
  [B.Stone]: { top: [0.45, 0.45, 0.46], slope: [0.36, 0.36, 0.38], family: 'rock' },
  [B.Mossy]: { top: [0.34, 0.43, 0.33], slope: [0.30, 0.32, 0.27], family: 'rock' },
  [B.Sand]: { top: [0.80, 0.74, 0.56], slope: [0.66, 0.60, 0.44], family: 'ground' },
  [B.Snow]: { top: [0.92, 0.94, 0.97], slope: [0.70, 0.74, 0.80], family: 'ground' },
  [B.Mud]: { top: [0.29, 0.23, 0.17], slope: [0.25, 0.19, 0.14], family: 'ground' },
  [B.Farmland]: { top: [0.31, 0.22, 0.14], slope: [0.28, 0.20, 0.13], family: 'ground' },
};
export function groundStyle(id: number): GroundStyle {
  return GROUND[id] ?? { top: colorOf(id), slope: colorOf(id), family: 'ground' };
}

/** Every material family the chunk mesher may need a draw group for. */
export const MESH_FAMILIES: SurfaceFamily[] = ['plank', 'stone', 'plaster', 'thatch', 'tile', 'cloth', 'metal', 'bark', 'grain'];
