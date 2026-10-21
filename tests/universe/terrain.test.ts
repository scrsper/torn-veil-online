import { describe, expect, it } from 'vitest';
import { NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { add, dot, length, normalize, scale, type V3 } from '../../src/sim/world/planet/planet';
import { dirToCube } from '../../src/sim/world/planet/scatter';
import { generateSystem, terrainHeight, universeSpec } from '../../src/sim/world/universe/generation';
import { TERRAIN_GRAIN_SIZE, UniverseTerrain, buildGroundTextureData, buildTerrainTile, selectTerrainTiles, surfaceDecorations, terrainTileDirection, type TerrainTile } from '../../src/web/universe/terrain';

const system = generateSystem(universeSpec(20261019), 3);
const planet = system.planets[0];
const point = (data: number[], i: number): V3 => ({ x: data[i * 3], y: data[i * 3 + 1], z: data[i * 3 + 2] });
const keyOf = (tile: TerrainTile) => `${tile.face}/${tile.level}/${tile.x}/${tile.y}`;
const surfaceTileLevel = (scene: Scene, direction: V3): number => {
  const cube = dirToCube(direction);
  const u = Math.atan(cube.u) / (Math.PI / 4) * .5 + .5;
  const v = Math.atan(cube.v) / (Math.PI / 4) * .5 + .5;
  const mesh = scene.meshes.find(mesh => {
    if (!mesh.name.startsWith('terrain:') || !mesh.isEnabled()) return false;
    const [face, level, x, y] = mesh.name.slice(mesh.name.lastIndexOf(':') + 1).split('/').map(Number);
    return face === cube.f && Math.floor(u * 2 ** level) === x && Math.floor(v * 2 ** level) === y;
  });
  return mesh ? Number(mesh.name.slice(mesh.name.lastIndexOf(':') + 1).split('/')[1]) : -1;
};

describe('universe terrain geometry', () => {
  it('samples matching ground texture colors on every cube-face join, including reversed and rotated edges', () => {
    const texture = buildGroundTextureData(), size = TERRAIN_GRAIN_SIZE;
    const sample = (u: number, v: number) => {
      const tx = (u - Math.floor(u)) * size - .5, ty = (v - Math.floor(v)) * size - .5;
      const x = Math.floor(tx), y = Math.floor(ty), fx = tx - x, fy = ty - y;
      const pixel = (x: number, y: number) => texture[(((y + size) % size) * size + (x + size) % size) * 3];
      return (pixel(x, y) * (1 - fx) + pixel(x + 1, y) * fx) * (1 - fy)
        + (pixel(x, y + 1) * (1 - fx) + pixel(x + 1, y + 1) * fx) * fy;
    };
    const cells = 8, edgeColors = new Map<string, number>(); let matches = 0;
    for (let face = 0; face < 6; face++) {
      const tile = { face, level: 0, x: 0, y: 0 }, geometry = buildTerrainTile(planet, tile, cells);
      for (let y = 0; y <= cells; y++) for (let x = 0; x <= cells; x++) {
        if (x !== 0 && x !== cells && y !== 0 && y !== cells) continue;
        const dir = terrainTileDirection(tile, x / cells, y / cells);
        const key = [dir.x, dir.y, dir.z].map(n => n.toFixed(9)).join('/');
        const index = y * (cells + 1) + x;
        const color = sample(geometry.uvs[index * 2], geometry.uvs[index * 2 + 1]);
        const previous = edgeColors.get(key);
        if (previous !== undefined) { expect(color).toBeCloseTo(previous, 7); matches++; }
        edgeColors.set(key, color);
      }
    }
    expect(matches).toBeGreaterThan(80);
  });

  it('samples the authoritative height at every surface vertex and points normals outward', () => {
    for (let face = 0; face < 6; face++) {
      const tile = { face, level: 2, x: 1, y: 2 }, cells = 4;
      const data = buildTerrainTile(planet, tile, cells);
      expect(data.surfaceVertices).toBe((cells + 1) ** 2);
      for (let y = 0; y <= cells; y++) for (let x = 0; x <= cells; x++) {
        const index = y * (cells + 1) + x, d = terrainTileDirection(tile, x / cells, y / cells);
        expect(length(point(data.positions, index))).toBeCloseTo(planet.radius + terrainHeight(planet, d), 8);
        expect(dot(point(data.normals, index), d)).toBeGreaterThan(.5);
        expect(length(point(data.normals, index))).toBeCloseTo(1, 8);
      }
      for (let i = data.surfaceVertices; i < data.positions.length / 3; i++) {
        const position = point(data.positions, i);
        expect(length(position)).toBeLessThan(planet.radius + terrainHeight(planet, normalize(position)) - 11);
      }
      expect(data.indices.every(i => Number.isInteger(i) && i >= 0 && i < data.positions.length / 3)).toBe(true);
    }
  });

  it('has identical adjacent tile edges and nested LOD samples', () => {
    const cells = 8, left = { face: 4, level: 2, x: 1, y: 1 }, right = { ...left, x: 2 };
    const a = buildTerrainTile(planet, left, cells), b = buildTerrainTile(planet, right, cells);
    for (let i = 0; i <= cells; i++) {
      expect(point(a.positions, i * (cells + 1) + cells)).toEqual(point(b.positions, i * (cells + 1)));
      expect(point(a.normals, i * (cells + 1) + cells)).toEqual(point(b.normals, i * (cells + 1)));
    }
    const child = { face: left.face, level: left.level + 1, x: left.x * 2, y: left.y * 2 };
    for (let y = 0; y <= cells; y += 2) for (let x = 0; x <= cells; x += 2) {
      expect(terrainTileDirection(child, x / cells, y / cells)).toEqual(terrainTileDirection(left, x / cells / 2, y / cells / 2));
    }
  });

  it('joins the +Z and +X cube faces without a polar/longitude seam', () => {
    const z = { face: 4, level: 0, x: 0, y: 0 }, x = { ...z, face: 0 };
    for (let i = 0; i <= 16; i++) {
      const a = terrainTileDirection(z, 1, i / 16), b = terrainTileDirection(x, 0, i / 16);
      expect(a.x).toBeCloseTo(b.x, 12); expect(a.y).toBeCloseTo(b.y, 12); expect(a.z).toBeCloseTo(b.z, 12);
      expect(terrainHeight(planet, a)).toBeCloseTo(terrainHeight(planet, b), 9);
    }
  });

  it('caps detail and retains complete face coverage at ground, limb, poles and space', () => {
    for (const lite of [false, true]) for (const dir of [
      { x: 0, y: 1, z: 0 }, normalize({ x: 1, y: 1, z: 1 }), { x: 0, y: 0, z: -1 },
    ]) for (const altitude of [3, 150, 1500, planet.radius * 6]) {
      const observer = add(planet.center, scale(dir, planet.radius + altitude));
      const plan = selectTerrainTiles(planet, observer, lite), keys = new Set(plan.map(keyOf));
      expect(plan.length).toBeLessThanOrEqual(lite ? 102 : 198);
      const leaves = plan.filter(tile => !keys.has(`${tile.face}/${tile.level + 1}/${tile.x * 2}/${tile.y * 2}`));
      for (let face = 0; face < 6; face++) {
        // The quadtree must partition each cube face exactly, without missing area.
        const area = leaves.filter(tile => tile.face === face).reduce((sum, tile) => sum + 4 ** -tile.level, 0);
        expect(area).toBe(1);
      }
      if (altitude > planet.radius * 5) expect(plan.length).toBe(6);
    }
  });
});

describe('universe terrain streaming', () => {
  it('keeps every planet covered and bounds residency when crossing worlds before prior detail finishes loading', () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const terrain = new UniverseTerrain(scene, system, true);
    const direction = normalize({ x: .217, y: .531, z: .819 });
    for (const destination of [...system.planets, ...system.planets.slice().reverse(), system.planets[0]]) {
      const observer = add(destination.center, scale(direction, destination.radius + terrainHeight(destination, direction) + 4));
      for (let frame = 0; frame < 5; frame++) terrain.update(observer, observer);
      const resident = scene.meshes.filter(mesh => mesh.name.startsWith('terrain:'));
      expect(resident.length).toBeLessThanOrEqual(102 + (system.planets.length - 1) * 6);
      expect(terrain.stats().pendingTiles).toBeLessThanOrEqual(96);
      for (const world of system.planets) {
        const enabled = resident.filter(mesh => mesh.name.startsWith(`terrain:${world.id}:`) && mesh.isEnabled());
        for (let face = 0; face < 6; face++) {
          const area = enabled.reduce((sum, mesh) => {
            const [f, level] = mesh.name.slice(mesh.name.lastIndexOf(':') + 1).split('/').map(Number);
            return sum + (f === face ? 4 ** -level : 0);
          }, 0);
          expect(area).toBe(1);
        }
        if (world !== destination) expect(enabled.length).toBe(6);
      }
      expect(scene.meshes.filter(mesh => mesh.name.startsWith('surface-detail:')).length).toBeLessThanOrEqual(1);
    }
    terrain.dispose();
    expect(scene.meshes.length).toBe(0); expect(scene.materials.length).toBe(0); expect(scene.textures.length).toBe(0);
    scene.dispose(); engine.dispose();
  });

  it('prioritizes the ground beneath a newly arrived observer before refining the remote hemisphere', () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const terrain = new UniverseTerrain(scene, { ...system, planets: [planet] });
    const direction = normalize({ x: .217, y: .531, z: .819 });
    const observer = add(planet.center, scale(direction, planet.radius + terrainHeight(planet, direction) + 3));
    const initial = terrain.stats().rebuilds;
    // Budget in completed uploads, not wall-clock timings or render frame count.
    while (terrain.stats().rebuilds - initial < 32) terrain.update(observer, observer);
    expect(surfaceTileLevel(scene, direction)).toBeGreaterThanOrEqual(6);
    expect(terrain.stats().pendingTiles).toBeGreaterThan(0);
    terrain.dispose(); scene.dispose(); engine.dispose();
  });

  it('replans Babylon Vector3 observers from surface to orbit and back on the same planet', () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const terrain = new UniverseTerrain(scene, { ...system, planets: [planet] }, true);
    const surface = new Vector3(planet.center.x, planet.center.y + planet.radius + 8, planet.center.z);
    const orbit = new Vector3(planet.center.x, planet.center.y + planet.radius * 7, planet.center.z);
    for (let i = 0; i < 110; i++) terrain.update(surface, surface);
    expect(terrain.stats().tiles).toBeGreaterThan(6);
    terrain.update(orbit, orbit);
    expect(terrain.stats().tiles).toBe(6);
    expect(terrain.stats().pendingTiles).toBe(0);
    terrain.update(surface, surface);
    expect(terrain.stats().pendingTiles).toBeGreaterThan(0);
    for (let i = 0; i < 110; i++) terrain.update(surface, surface);
    expect(terrain.stats().tiles).toBeGreaterThan(6);
    terrain.dispose(); scene.dispose(); engine.dispose();
  });

  it('keeps complete coverage, bounds per-update work, shifts the origin without rebuilds, and cleans up', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const single = { ...system, planets: [planet] };
    const before = JSON.stringify(single);
    const terrain = new UniverseTerrain(scene, single, true);
    const direction = normalize({ x: .2, y: .6, z: .8 });
    const observer = add(planet.center, scale(direction, planet.radius + 8));
    let previous = terrain.stats().rebuilds;
    for (let frame = 0; frame < 130; frame++) {
      terrain.update(observer, observer);
      const stats = terrain.stats();
      expect(stats.rebuilds - previous).toBeLessThanOrEqual(1);
      previous = stats.rebuilds;
      const enabled = scene.meshes.filter(mesh => mesh.name.startsWith('terrain:') && mesh.isEnabled());
      for (let face = 0; face < 6; face++) {
        const area = enabled.reduce((sum, mesh) => {
          const [f, level] = mesh.name.slice(mesh.name.lastIndexOf(':') + 1).split('/').map(Number);
          return sum + (f === face ? 4 ** -level : 0);
        }, 0);
        expect(area).toBe(1);
      }
    }
    expect(terrain.stats().pendingTiles).toBe(0);
    expect(terrain.stats().decorations).toBeLessThanOrEqual(500);
    const stable = terrain.stats().rebuilds;
    const newOrigin = add(observer, { x: 80000, y: -45000, z: 23000 });
    terrain.update(observer, newOrigin);
    expect(terrain.stats().rebuilds).toBe(stable);
    const root = scene.getTransformNodeByName(`universe:${planet.id}`)!;
    expect(root.position.x).toBe(planet.center.x - newOrigin.x);
    expect(root.position.y).toBe(planet.center.y - newOrigin.y);
    expect(root.position.z).toBe(planet.center.z - newOrigin.z);
    expect(JSON.stringify(single)).toBe(before);
    terrain.dispose(); terrain.dispose();
    expect(scene.meshes.length).toBe(0);
    expect(scene.materials.length).toBe(0);
    expect(scene.textures.length).toBe(0);
    expect(terrain.stats().tiles).toBe(0);
    scene.dispose(); engine.dispose();
  });

  it('keeps cosmetic scatter deterministic, small and within a bounded surface neighborhood', () => {
    const home = generateSystem(universeSpec(20261019), 0).planets[0];
    const dir = normalize({ x: 0, y: .309016994, z: .951056516 });
    const observer = add(home.center, scale(dir, home.radius + 9));
    const details = surfaceDecorations(home, observer);
    expect(details.length).toBeGreaterThan(50);
    expect(details.length).toBeLessThanOrEqual(1600);
    expect(surfaceDecorations(home, observer)).toEqual(details);
    expect(new Set(details.map(d => d.id)).size).toBe(details.length);
    for (const detail of details) {
      expect(detail.scale).toBeLessThan(.5);
      expect(detail.height).toBeGreaterThan(.8);
      expect(Math.acos(Math.min(1, dot(dir, detail.dir))) * home.radius).toBeLessThan(72);
    }
  });
});
