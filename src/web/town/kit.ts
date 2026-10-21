import { Color3, Mesh, MeshBuilder, PBRMaterial, StandardMaterial, Texture, Vector3, VertexBuffer, VertexData, type Material, type Scene } from '@babylonjs/core';
import { loadScannedMaps, useScannedMaps } from '../render/materials';

/** Materials and primitive builders for the town's procedural props. Surfaces are the repo's
 * vetted CC0 scans (Poly Haven) on metre-scale planar UVs; cloth, metal, glow and foliage are
 * plain shaded colours. */
export type MatKey =
  | 'plaster' | 'plasterWarm' | 'timber' | 'darkTimber' | 'roofTerracotta' | 'roofSlate' | 'thatch' | 'stone' | 'stoneDark'
  | 'clothRed' | 'clothOchre' | 'clothBlue' | 'clothGreen' | 'clothCream' | 'iron' | 'glow' | 'window' | 'water'
  | 'leaf' | 'leafDark' | 'leafAutumn' | 'pine' | 'bark' | 'hay' | 'flowerRed' | 'flowerYellow' | 'flowerWhite' | 'flowerPurple' | 'produce' | 'gold' | 'paper';
export class Kit {
  readonly mats = {} as Record<MatKey, Material>;
  private scans = new Map<string, ReturnType<typeof loadScannedMaps>>();
  constructor(readonly scene: Scene) {
    const scan = (key: MatKey, surface: string, tint: [number, number, number], rough = 1, bump = 1) => {
      let maps = this.scans.get(surface); if (!maps) { maps = loadScannedMaps(scene, surface); this.scans.set(surface, maps); }
      const m = new PBRMaterial(key, scene); useScannedMaps(m, maps); m.albedoColor = new Color3(...tint); m.metallic = 0; m.roughness = rough;
      m.environmentIntensity = .7; if (m.bumpTexture) m.bumpTexture.level = bump; this.mats[key] = m;
    };
    scan('plaster', 'plastered_wall', [1.04, .98, .88]); scan('plasterWarm', 'plastered_wall', [1.08, .9, .72]);
    scan('timber', 'weathered_planks', [1.25, 1.05, .82]); scan('darkTimber', 'weathered_planks', [.62, .48, .38]);
    scan('roofTerracotta', 'roof_slates_02', [1.35, .7, .48]); scan('roofSlate', 'roof_slates_02', [.75, .8, .9]);
    scan('thatch', 'reed_roof_04', [1.1, .95, .7]); scan('hay', 'reed_roof_04', [1.35, 1.15, .7]);
    scan('stone', 'rock_wall_08', [1.08, 1.02, .94], 1, 1.2); scan('stoneDark', 'rock_wall_08', [.78, .76, .72], 1, 1.2); scan('bark', 'bark_brown_02', [1, .95, .9]);
    const flat = (key: MatKey, hex: string, rough = .9, emissive?: Color3) => {
      const m = new PBRMaterial(key, scene); m.albedoColor = Color3.FromHexString(hex).toLinearSpace(); m.metallic = 0; m.roughness = rough; m.environmentIntensity = .6;
      if (emissive) { m.emissiveColor = emissive; m.emissiveIntensity = 1; } this.mats[key] = m; return m;
    };
    flat('clothRed', '#9c2f2a', .95); flat('clothOchre', '#c08a2e', .95); flat('clothBlue', '#34507e', .95); flat('clothGreen', '#4d6b35', .95); flat('clothCream', '#d9cdb0', .95);
    const iron = flat('iron', '#2b2a2a', .55) as PBRMaterial; iron.metallic = .8;
    const gold = flat('gold', '#c9a24a', .4) as PBRMaterial; gold.metallic = .9;
    flat('paper', '#e3d7b8', .95); flat('produce', '#b8562e', .7);
    flat('flowerRed', '#b8322f'); flat('flowerYellow', '#e0b83a'); flat('flowerWhite', '#e8e4d8'); flat('flowerPurple', '#7a4a9a');
    // Lantern glass and windows glow warm (picked up by the glow layer).
    const glow = new StandardMaterial('glow', scene); glow.diffuseColor = Color3.Black(); glow.specularColor = Color3.Black(); glow.emissiveColor = new Color3(1, .62, .26); glow.disableLighting = true; this.mats.glow = glow;
    const win = new PBRMaterial('window', scene); win.albedoColor = new Color3(.02, .02, .02); win.roughness = .3; win.metallic = 0; win.emissiveColor = new Color3(.55, .3, .1); win.environmentIntensity = .9; this.mats.window = win;
    const water = new PBRMaterial('water', scene); water.albedoColor = new Color3(.04, .09, .1); water.roughness = .06; water.metallic = 0; water.alpha = .88; water.environmentIntensity = 1.2;
    const wn = loadScannedMaps(scene, 'brown_mud').normal; wn.uScale = wn.vScale = 3; water.bumpTexture = wn; water.bumpTexture.level = .25; this.mats.water = water;
    // Foliage: the grass scan's fine speckle gives leaf masses texture; tinted per species.
    const leaves = (key: MatKey, tint: [number, number, number]) => {
      let maps = this.scans.get('grass_ground'); if (!maps) { maps = loadScannedMaps(scene, 'grass_ground'); this.scans.set('grass_ground', maps); }
      const m = new PBRMaterial(key, scene); m.albedoTexture = maps.albedo; m.bumpTexture = maps.normal; m.invertNormalMapY = true; m.bumpTexture.level = 1.4;
      m.albedoColor = new Color3(...tint); m.roughness = .85; m.metallic = 0; m.environmentIntensity = .6; this.mats[key] = m;
    };
    leaves('leaf', [.95, 1.25, .62]); leaves('leafDark', [.62, .9, .5]); leaves('leafAutumn', [1.6, 1.1, .45]); leaves('pine', [.42, .68, .45]);
  }
}
/** Planar metre UVs (projection along each vertex's dominant normal), after transforms are baked. */
export function planarUV(m: Mesh, tile = 2): Mesh {
  const p = m.getVerticesData(VertexBuffer.PositionKind), n = m.getVerticesData(VertexBuffer.NormalKind); if (!p || !n) return m;
  const uv = new Float32Array(p.length / 3 * 2);
  for (let i = 0; i < p.length / 3; i++) {
    const ax = Math.abs(n[i * 3]), ay = Math.abs(n[i * 3 + 1]), az = Math.abs(n[i * 3 + 2]), x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    const [u, v] = ay >= ax && ay >= az ? [x, z] : ax >= az ? [z, y] : [x, y];
    uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
  }
  m.setVerticesData(VertexBuffer.UVKind, uv); return m;
}
/** A list of (material, mesh) parts in one local frame, merged per material on `finish`. */
export class Parts {
  readonly list: { mat: MatKey; mesh: Mesh }[] = [];
  constructor(readonly scene: Scene, readonly name: string) {}
  add(mat: MatKey, mesh: Mesh, tile = 2): Mesh { mesh.bakeCurrentTransformIntoVertices(); planarUV(mesh, tile); this.list.push({ mat, mesh }); return mesh; }
  box(mat: MatKey, x: number, y: number, z: number, w: number, h: number, d: number, yaw = 0, tile = 2, pitch = 0, roll = 0): Mesh {
    const b = MeshBuilder.CreateBox(this.name, { width: w, height: h, depth: d }, this.scene); b.position.set(x, y + h / 2, z); b.rotation.set(pitch, yaw, roll); return this.add(mat, b, tile);
  }
  cyl(mat: MatKey, x: number, y: number, z: number, h: number, dTop: number, dBottom = dTop, tess = 10, tile = 2): Mesh {
    const c = MeshBuilder.CreateCylinder(this.name, { height: h, diameterTop: dTop, diameterBottom: dBottom, tessellation: tess }, this.scene); c.position.set(x, y + h / 2, z); return this.add(mat, c, tile);
  }
  /** Lumpy blob (foliage, rocks, sacks): an icosphere with seeded radial noise. */
  blob(mat: MatKey, x: number, y: number, z: number, rx: number, ry: number, rz: number, seed: number, rough = .22, sub = 2): Mesh {
    const s = MeshBuilder.CreateIcoSphere(this.name, { radius: 1, subdivisions: sub, flat: false }, this.scene);
    const p = s.getVerticesData(VertexBuffer.PositionKind)!;
    for (let i = 0; i < p.length; i += 3) {
      const h = Math.sin(p[i] * 12.9898 + p[i + 1] * 78.233 + p[i + 2] * 37.719 + seed * 3.7) * 43758.5453, k = 1 + (h - Math.floor(h) - .5) * rough * 2;
      p[i] *= rx * k; p[i + 1] *= ry * k; p[i + 2] *= rz * k;
    }
    s.setVerticesData(VertexBuffer.PositionKind, p); const nn: number[] = []; VertexData.ComputeNormals(p, s.getIndices()!, nn); s.setVerticesData(VertexBuffer.NormalKind, nn);
    s.position.set(x, y, z); return this.add(mat, s, 1.2);
  }
  /** Gable roof: ridge along local x, eaves overhanging by `over`, slabs `t` thick. */
  gable(mat: MatKey, x: number, y: number, z: number, w: number, d: number, rise: number, yaw = 0, over = .5, t = .18): void {
    const half = d / 2 + over, slope = Math.atan2(rise, d / 2), len = half / Math.cos(slope);
    for (const s of [-1, 1]) {
      const b = MeshBuilder.CreateBox(this.name, { width: w + over * 2, height: t, depth: len }, this.scene);
      const cz = s * half / 2, cy = rise - half / 2 * Math.tan(slope) + t / 2;
      b.rotation.set(s * slope, 0, 0); b.position.set(0, cy, cz);
      b.bakeCurrentTransformIntoVertices(); b.rotation.y = yaw; b.position.set(x, y, z); this.add(mat, b, 2.2);
    }
    // Gable-end triangles (plaster) closing the attic.
    const g = new Mesh(this.name, this.scene), hw = w / 2, p: number[] = [], idx: number[] = [];
    for (const sx of [-1, 1]) for (const flip of [0, 1]) { const o = p.length / 3; p.push(sx * hw, 0, -d / 2, sx * hw, 0, d / 2, sx * hw, rise, 0); idx.push(...(flip ? [o, o + 2, o + 1] : [o, o + 1, o + 2])); }
    const vd = new VertexData(), nn: number[] = []; VertexData.ComputeNormals(p, idx, nn, { useRightHandedSystem: true }); Object.assign(vd, { positions: p, indices: idx, normals: nn }); vd.applyToMesh(g);
    g.rotation.y = yaw; g.position.set(x, y, z); g.material = null; this.add('plaster', g, 2.5);
  }
  /** Merge parts per material into meshes (one draw call each). */
  finish(kit: Kit): Mesh[] {
    const by = new Map<MatKey, Mesh[]>(); for (const { mat, mesh } of this.list) { const l = by.get(mat) ?? []; l.push(mesh); by.set(mat, l); }
    const out: Mesh[] = [];
    for (const [mat, meshes] of by) {
      const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, false); if (!merged) continue;
      merged.name = `${this.name}:${mat}`; merged.material = kit.mats[mat]; merged.isPickable = false; out.push(merged);
    }
    this.list.length = 0; return out;
  }
}
export const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
export { Texture };
