import { Color3, Mesh, PBRMaterial, VertexData, type Scene } from '@babylonjs/core';
import { ROAD_HALF_WIDTH, cross, normalize, planetRoads, scale, sub, surfaceRadius, add, type PlanetSpec, type V3 } from '../../sim/world/planet';
import { loadScannedMaps, useScannedMaps } from '../render/materials';

/** Dry road stretches as ground ribbons following the terrain, from the sim's road network. */
export function buildRoads(scene: Scene, spec: PlanetSpec): Mesh | null {
  const positions: number[] = [], indices: number[] = [], uvs: number[] = [], normals: number[] = [];
  for (const road of planetRoads(spec)) {
    let run: V3[] = [];
    const flush = () => {
      if (run.length < 2) { run = []; return; }
      const base = positions.length / 3; let along = 0;
      run.forEach((p, i) => {
        const next = run[Math.min(i + 1, run.length - 1)], prev = run[Math.max(i - 1, 0)], t = normalize(sub(next, prev)), side = scale(normalize(cross(t, p)), ROAD_HALF_WIDTH);
        for (const s of [-1, 1]) { const q = normalize(add(scale(p, spec.radius), scale(side, s))), r = surfaceRadius(spec, q) + .22; positions.push(q.x * r, q.y * r, q.z * r); normals.push(p.x, p.y, p.z); uvs.push(s < 0 ? 0 : 1, along / 4); }
        if (i) along += 16;
        if (i < run.length - 1) { const a = base + i * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      });
      run = [];
    };
    road.points.forEach((p, i) => { if (road.wet[i]) flush(); else run.push(p); });
    flush();
  }
  if (!positions.length) return null;
  const mesh = new Mesh('planet-roads', scene), data = new VertexData();
  Object.assign(data, { positions, indices, normals, uvs }); data.applyToMesh(mesh);
  const m = new PBRMaterial('planet-road', scene); useScannedMaps(m, loadScannedMaps(scene, 'brown_mud')); m.albedoColor = new Color3(1.45, 1.3, 1.1); m.metallic = 0; m.roughness = .95; m.backFaceCulling = false;
  mesh.material = m; mesh.receiveShadows = true; mesh.isPickable = false;
  return mesh;
}
