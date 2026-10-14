import { describe, expect, it } from 'vitest';
import { NullEngine, Scene, StandardMaterial, VertexBuffer } from '@babylonjs/core';
import { B } from '../src/sim/physical/blocks';
import { buildFieldSurface, type FieldSurfaceCell } from '../src/web/world/fieldSurface';

function mats(scene: Scene): any {
  const cache = new Map<string, StandardMaterial>();
  return { get: (name: string) => { let m = cache.get(name); if (!m) { m = new StandardMaterial(`m-${name}`, scene); cache.set(name, m); } return m; }, tilesPerMetre: () => 1 };
}
const region = { id: 'field-test', bounds: { x0: 0, z0: 0, x1: 16, z1: 16 } };

describe('field surface projection', () => {
  it('renders only connected projected farmland runs and anchors them to terrain', () => {
    const scene = new Scene(new NullEngine()); scene.useRightHandedSystem = true;
    const cells: FieldSurfaceCell[] = [];
    for (let x = 4; x < 8; x++) for (let z = 5; z < 8; z++) cells.push({ x, z, block: B.Farmland });
    cells.push({ x: 10, z: 5, block: B.Farmland }, { x: 10, z: 7, block: B.Farmland });
    cells.push({ x: 12, z: 12, block: B.Grass });
    const mesh = buildFieldSurface(scene, mats(scene), region, cells, (x, z) => x * .01 + z * .02)!;
    expect(mesh).toBeTruthy();
    expect(mesh.getIndices()!.length).toBe(144); // 12 contiguous cells × two channels × two triangles
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      expect(positions[i]).toBeGreaterThanOrEqual(3.9); expect(positions[i]).toBeLessThanOrEqual(7.9);
      expect(positions[i + 2]).toBeGreaterThanOrEqual(4.8); expect(positions[i + 2]).toBeLessThanOrEqual(7.9);
      minY = Math.min(minY, positions[i + 1]); maxY = Math.max(maxY, positions[i + 1]);
    }
    expect(maxY - minY).toBeGreaterThan(.08);
  });

  it('returns no surface for grass, crop, or isolated cells', () => {
    const scene = new Scene(new NullEngine()); scene.useRightHandedSystem = true;
    const cells = [{ x: 4, z: 5, block: B.Grass }, { x: 5, z: 5, block: B.Wheat }, { x: 8, z: 9, block: B.Farmland }];
    expect(buildFieldSurface(scene, mats(scene), region, cells, () => 0)).toBeNull();
  });
});
