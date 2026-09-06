import * as THREE from 'three';
import type { World } from '../../sim/core/world';
import { CHUNK } from '../../sim/physical/grid';
import { VoxelRenderer, type RevealBox } from '../voxel/mesher';
import { TerrainSkin } from './terrainSkin';
import { FoliageSkin } from './foliageSkin';
import { BuildingSkin } from './buildingSkin';
import { GeoAccum, UNIT, place as xf, shade, tapered, type RGB } from './geo';
import { surfaceMaterial, surfaceTex } from './textures';

/**
 * The presentation layer, assembled.
 *
 * One canonical world; several renderers, each responsible for a disjoint set of cells:
 *
 *   canonical VoxelGrid + Places + ResourceNodes
 *        │
 *        ├─ TerrainSkin      the ground, as one smoothed surface
 *        ├─ FoliageSkin      trees, crops, undergrowth, as plants
 *        ├─ BuildingSkin     roofs, gables, timber framing, windows, swinging doors
 *        ├─ VoxelRenderer    everything still genuinely block-shaped (walls, floors, fixtures)
 *        └─ stumps           felled tree nodes, from canonical ResourceNode state
 *
 * `style.ts` decides who owns what, and `BuildingSkin.claimedCells()` hands the mesher the cells
 * it has taken over, so no cell is ever drawn twice and none is silently dropped. This class owns
 * the ONE thing that has to be shared: the canonical dirty-chunk set. The simulation marks a
 * chunk dirty when it edits a block; every skin rebuilds that chunk; the change appears. That is
 * the whole update contract — there is no cache of world state anywhere in this folder.
 */
export class WorldSkin {
  group = new THREE.Group();
  voxels: VoxelRenderer;
  terrain: TerrainSkin;
  foliage: FoliageSkin;
  buildings: BuildingSkin;
  private stumpGroup = new THREE.Group();
  private stumpKey = '';
  private stumpMat = surfaceMaterial('bark');

  constructor(private world: World) {
    this.group.name = 'worldSkin';
    // Planning first: the building skin decides which cells it is taking over before the chunk
    // mesher is ever asked to draw one.
    this.buildings = new BuildingSkin(world);
    this.voxels = new VoxelRenderer(world.grid);
    this.voxels.setSkinned(this.buildings.claimedCells());
    this.terrain = new TerrainSkin(world.grid);
    this.foliage = new FoliageSkin(world.grid);
    this.group.add(this.terrain.group, this.foliage.group, this.buildings.group, this.voxels.group, this.stumpGroup);
  }

  buildAll(): void {
    this.voxels.buildAll();
    this.terrain.buildAll();
    this.foliage.buildAll();
    this.buildings.build();
    this.rebuildStumps();
  }

  /** Push every canonical change since the last frame into the presentation. */
  update(dt: number): void {
    const dirty = [...this.world.grid.dirtyChunks];
    if (dirty.length) {
      // Two passes: every affected column's cached height must be dropped before any chunk is
      // rebuilt, because a chunk's edge vertices average columns from its neighbours.
      for (const key of dirty) this.terrain.invalidateChunk(Math.floor(key / 1024), key % 1024);
      const touched = new Set<number>();
      for (const key of dirty) {
        const cx = Math.floor(key / 1024), cz = key % 1024;
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= this.world.grid.W / CHUNK || nz >= this.world.grid.D / CHUNK) continue;
          touched.add(nx * 1024 + nz);
        }
      }
      for (const key of touched) this.terrain.rebuild(Math.floor(key / 1024), key % 1024);
      for (const key of dirty) this.foliage.rebuild(Math.floor(key / 1024), key % 1024);
    }
    this.voxels.update();          // clears grid.dirtyChunks
    this.buildings.update(dt);
    this.rebuildStumps();
  }

  setTime(t: number, wind: number): void { this.voxels.setTime(t); this.foliage.setTime(t, wind); }

  /** One building drawn without its roof. Both the mesher and the roof skin honour the same box. */
  setReveal(box: RevealBox | null): void { this.voxels.setReveal(box); this.buildings.setReveal(box); }
  get revealed(): RevealBox | null { return this.voxels.revealed; }

  /**
   * A felled tree leaves a stump.
   *
   * This is the clearest example in the folder of presentation following canonical state: a
   * `ResourceNode` of kind 'tree' whose canonical `state` is no longer 'available' has had its
   * blocks cleared by the simulation, so the foliage skin has already stopped drawing a tree
   * there. The stump is drawn from the node itself — its position, its state, its regrowth —
   * and disappears again the moment `maintainResourceNodes` restores it. Nothing here is stored:
   * the key below is recomputed from canonical state every frame and only the geometry is cached.
   */
  private rebuildStumps(): void {
    const nodes = this.world.resourceNodes.filter(n => n.kind === 'tree' && n.state !== 'available');
    const key = nodes.map(n => `${n.id}:${n.state}:${n.growthStage ?? ''}`).join('|');
    if (key === this.stumpKey) return;
    this.stumpKey = key;
    for (const c of [...this.stumpGroup.children]) { this.stumpGroup.remove(c); (c as THREE.Mesh).geometry?.dispose(); }
    if (!nodes.length) return;
    const acc = new GeoAccum();
    const uv = surfaceTex('bark').uvScale;
    const bark: RGB = [0.30, 0.23, 0.15], heart: RGB = [0.62, 0.50, 0.33];
    for (const n of nodes) {
      const x = n.pos.x, z = n.pos.z;
      const y = this.world.grid.groundHeight(Math.floor(x), Math.floor(z)) + 1;
      // A regrowing node shows a sapling on the stump: the canonical growth stage, made visible.
      const sapling = n.state === 'regrowing';
      acc.add(tapered(0.86, 8), xf(x, y + 0.16, z, 0.5, 0.36, 0.5), bark, uv);
      acc.add(UNIT.cyl8, xf(x, y + 0.34, z, 0.42, 0.04, 0.42), heart, uv);
      if (sapling) {
        acc.add(tapered(0.5, 6), xf(x, y + 0.62, z, 0.07, 0.6, 0.07), shade(bark, 1.15), uv);
        for (let i = 0; i < 3; i++) {
          const a = i * 2.1;
          acc.add(UNIT.blobLo, xf(x + Math.cos(a) * 0.12, y + 0.85 + i * 0.08, z + Math.sin(a) * 0.12, 0.3, 0.24, 0.3), [0.24, 0.42, 0.19], uv);
        }
      }
    }
    const geo = acc.build();
    if (!geo) return;
    const m = new THREE.Mesh(geo, this.stumpMat);
    m.castShadow = true; m.receiveShadow = true;
    this.stumpGroup.add(m);
  }
}
