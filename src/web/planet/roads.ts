import { Color3, Mesh, PBRMaterial, VertexData, type Scene } from '@babylonjs/core';
import { ROAD_HALF_WIDTH, ROAD_STEP, cross, normalize, planetRoads, scale, sub, surfaceRadius, add, type PlanetSpec, type V3 } from '../../sim/world/planet';
import { loadScannedMaps, useScannedMaps } from '../render/materials';

/** Dry road stretches as ground ribbons following the terrain, from the sim's road network.
 * Each 16 m road step is resampled every 4 m so the ribbon follows the relief, and a 1.4 m verge
 * either side fades out (vertex alpha) so the road wears into the ground instead of ending in a hard edge. */
const SUBSTEPS = 4, VERGE = 1.4;
// Across the road: outer verge (clear), road edge, crown, road edge, outer verge.
const ACROSS: [number, number, number][] = [[-(ROAD_HALF_WIDTH + VERGE), 0, .1], [-ROAD_HALF_WIDTH, 1, .2], [0, 1, .24], [ROAD_HALF_WIDTH, 1, .2], [ROAD_HALF_WIDTH + VERGE, 0, .1]];
function densify(run: V3[]): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < run.length - 1; i++) for (let k = 0; k < SUBSTEPS; k++) { const t = k / SUBSTEPS; out.push(normalize(add(scale(run[i], 1 - t), scale(run[i + 1], t)))); }
  out.push(run[run.length - 1]); return out;
}
export function buildRoads(scene: Scene, spec: PlanetSpec): Mesh | null {
  const positions: number[] = [], indices: number[] = [], uvs: number[] = [], normals: number[] = [], colors: number[] = [], w = ACROSS.length;
  for (const road of planetRoads(spec)) {
    let run: V3[] = [];
    const flush = () => {
      if (run.length < 2) { run = []; return; }
      const pts = densify(run), base = positions.length / 3, step = ROAD_STEP / SUBSTEPS;
      pts.forEach((p, i) => {
        const next = pts[Math.min(i + 1, pts.length - 1)], prev = pts[Math.max(i - 1, 0)], t = normalize(sub(next, prev)), side = normalize(cross(t, p));
        // The ends of a run fade too, so fords and bridge approaches don't stop in a square edge.
        const end = Math.min(1, i / 2, (pts.length - 1 - i) / 2);
        for (const [off, alpha, lift] of ACROSS) {
          const q = normalize(add(scale(p, spec.radius), scale(side, off))), r = surfaceRadius(spec, q) + lift;
          positions.push(q.x * r, q.y * r, q.z * r); normals.push(p.x, p.y, p.z); uvs.push(.5 + off / (ROAD_HALF_WIDTH * 2), i * step / 4); colors.push(1, 1, 1, alpha * end);
        }
        if (i < pts.length - 1) for (let k = 0; k < w - 1; k++) { const a = base + i * w + k; indices.push(a, a + w, a + 1, a + 1, a + w, a + w + 1); }
      });
      run = [];
    };
    road.points.forEach((p, i) => { if (road.wet[i]) flush(); else run.push(p); });
    flush();
  }
  if (!positions.length) return null;
  const mesh = new Mesh('planet-roads', scene), data = new VertexData();
  Object.assign(data, { positions, indices, normals, uvs, colors }); data.applyToMesh(mesh);
  mesh.hasVertexAlpha = true;
  const m = new PBRMaterial('planet-road', scene); useScannedMaps(m, loadScannedMaps(scene, 'brown_mud')); m.albedoColor = new Color3(1.45, 1.3, 1.1); m.metallic = 0; m.roughness = .95; m.backFaceCulling = false;
  m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND; m.useAlphaFromAlbedoTexture = false; m.forceDepthWrite = false;
  mesh.material = m; mesh.receiveShadows = true; mesh.isPickable = false;
  return mesh;
}
