import { describe, expect, it } from 'vitest';
import { NullEngine, Ray, Scene, StandardMaterial, Vector3, VertexBuffer } from '@babylonjs/core';
import { B } from '../src/sim/physical/blocks';
import { MeshBatch } from '../src/web/world/meshBatch';
import { buildStructures, decodeStructure } from '../src/web/world/structures';
import { buildBuildingDressing } from '../src/web/world/buildingDressing';
import type { PlaceProjection, RegionProjection } from '../src/web/net/messages';

function materialStub(scene: Scene): any {
  const cache = new Map<string, StandardMaterial>();
  return { get: (name: string) => { let m = cache.get(name); if (!m) { m = new StandardMaterial(`m-${name}`, scene); cache.set(name, m); } return m; }, clone: (name: string, label: string) => cache.get(name)!.clone(label), tilesPerMetre: () => 1 };
}

function place(): PlaceProjection {
  return { id: 'test-house', type: 'house', bounds: { x0: 2, z0: 2, x1: 7, z1: 5, y0: 0, y1: 10 }, inside: { x: 3, y: 1, z: 3 }, door: { x: 4, y: 1, z: 2 }, indoor: true, visualSeed: 17, wallHeight: 4, family: 'test' };
}

function regionWithStandardGable(): RegionProjection {
  const p = place(), runs: number[] = [];
  const add = (x: number, z: number, y: number, len: number, b: number) => runs.push(x, z, 1, y, len, b);
  for (let y = 1; y <= 4; y++) for (let x = p.bounds.x0; x <= p.bounds.x1; x++) {
    add(x, p.bounds.z0, y, 1, x === p.door!.x && y === 1 ? B.Door : x === p.door!.x && y === 2 ? B.Air : x === 3 && y === 2 ? B.Glass : B.Planks);
    add(x, p.bounds.z1, y, 1, B.Planks);
  }
  for (let y = 1; y <= 4; y++) for (let z = p.bounds.z0 + 1; z < p.bounds.z1; z++) { add(p.bounds.x0, z, y, 1, B.Planks); add(p.bounds.x1, z, y, 1, B.Planks); }
  for (let i = 0; ; i++) { const za = p.bounds.z0 - 1 + i, zb = p.bounds.z1 + 1 - i; if (za > zb) break; const y = 5 + i; for (let x = p.bounds.x0 - 1; x <= p.bounds.x1 + 1; x++) { add(x, za, y, 1, B.RoofTile); if (zb !== za) add(x, zb, y, 1, B.RoofTile); } }
  return { id: '0,0', seed: 1, bounds: { x0: 0, z0: 0, x1: 16, z1: 16 }, terrain: { stride: 1, columns: [] }, openings: [], fences: [], paths: [], furnishings: [], places: [p], roads: [], settlements: [], dressingExclusions: [], decoration: { classification: 'test', seed: 1, collision: false, gameplay: false }, structures: { runs } };
}

describe('Babylon presentation geometry', () => {
  it('keeps MeshBatch box triangle winding aligned with emitted normals', () => {
    const scene = new Scene(new NullEngine()); scene.useRightHandedSystem = true; const batch = new MeshBatch(); batch.box([0, 0, 0], [1, 1, 1], [1, 1, 1], 1);
    const mesh = batch.build('box', scene, new StandardMaterial('box-mat', scene))!;
    expect(mesh.sideOrientation).toBe(1); // CCW front-side orientation used by Babylon VertexData.
    const p = mesh.getVerticesData(VertexBuffer.PositionKind)!, n = mesh.getVerticesData(VertexBuffer.NormalKind)!, idx = mesh.getIndices()!;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      expect(cx * n[a] + cy * n[a + 1] + cz * n[a + 2]).toBeGreaterThan(0);
    }
  });

  it('decorates a canonical gable without covering its door or window and preserves projection data', () => {
    const scene = new Scene(new NullEngine()), r = regionWithStandardGable(), before = JSON.stringify(r.structures);
    const out = buildStructures(scene, materialStub(scene), r);
    expect(out.meshes.length).toBeGreaterThan(0);
    expect(out.stats.roofsAnalytic).toBe(1);
    expect(out.meshes.some(m => m.metadata?.cutawayBounds?.x0 === 2)).toBe(true);
    expect(JSON.stringify(r.structures)).toBe(before);
    const cells = decodeStructure(r.structures!.runs, 0, 0), p = place();
    expect(cells.get(p.door!.x, p.door!.y, p.door!.z)).toBe(B.Door);
    expect(cells.get(3, 2, 2)).toBe(B.Glass);
    const renderMeshes = out.meshes.filter(m => !m.name.startsWith('panes-'));
    const hit = (x: number, y: number): boolean => renderMeshes.some(m => m.intersects(new Ray(new Vector3(x, y, 1.5), Vector3.Forward(), 1.6)).hit);
    expect(hit(4.5, 1.5)).toBe(false);
    expect(hit(2.5, 1.5)).toBe(true);
    expect(hit(3.28, 2.25)).toBe(false);
    expect(hit(2.5, 2.5)).toBe(true);
  });

  it('does not place dressing on a path or inside the door approach strip', () => {
    const scene = new Scene(new NullEngine()), p = place(), pathCells = new Set<number>();
    for (const [x, z] of [[1, 3], [8, 4], [3, 1], [6, 6]]) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) pathCells.add((x + dx) * 100003 + z + dz);
    const meshes = buildBuildingDressing(scene, materialStub(scene), p, null, { regionX0: 0, regionZ0: 0, heightAt: () => 0, pathCells });
    expect(meshes).toEqual([]);
  });
});
