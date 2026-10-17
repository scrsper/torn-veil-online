import { Color3, Mesh, PBRMaterial, StandardMaterial, VertexData, type Scene } from '@babylonjs/core';
import { loadScannedMaps } from '../render/materials';
import { arc, biomeAt, climateAt, cubeToDir, normalize, tangentFrame, add, scale, type Biome, type PlanetSpec, type V3 } from '../../sim/world/planet';

/** Presentation of the canonical height/biome fields. The globe is a cube-sphere; a dense
 * local patch follows the observer so ground-level views keep metre-scale relief. */
const PALETTE: Record<Biome, [number, number, number]> = {
  ocean: [.36, .34, .27], beach: [.78, .72, .54], grassland: [.36, .52, .22], forest: [.2, .36, .14], taiga: [.24, .33, .22],
  tundra: [.5, .5, .42], desert: [.84, .7, .45], savanna: [.66, .6, .3], swamp: [.27, .33, .18], mountain: [.45, .42, .38], snow: [.92, .94, .97],
};
export function groundColour(spec: PlanetSpec, d: V3, h: number, biome: Biome): [number, number, number] {
  if (h < -1) { const k = Math.min(1, -h / 40); return [.3 - .24 * k, .32 - .2 * k, .28 - .1 * k]; }
  const c = PALETTE[biome], n = (Math.sin(d.x * 911 + d.y * 577) * Math.cos(d.z * 733 - d.x * 311)) * .06;
  const rock = biome === 'mountain' || biome === 'snow' ? 0 : Math.max(0, Math.min(1, (h - 70) / 50));
  return [c[0] * (1 + n) * (1 - rock) + .47 * rock, c[1] * (1 + n) * (1 - rock) + .44 * rock, c[2] * (1 + n) * (1 - rock) + .4 * rock];
}
function build(name: string, scene: Scene, positions: number[], colours: number[], indices: number[], uvs?: number[]) {
  const mesh = new Mesh(name, scene), data = new VertexData(), normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  Object.assign(data, { positions, indices, normals, colors: colours, ...(uvs ? { uvs } : {}) }); data.applyToMesh(mesh, true);
  return mesh;
}
export class PlanetTerrain {
  readonly globe: Mesh; patch: Mesh | null = null; readonly water: Mesh; readonly material: StandardMaterial; readonly detail: PBRMaterial;
  private heights: Float32Array; private dirs: V3[] = []; private patchCentre: V3 | null = null;
  /** Presentation-only depression (metres) under authored ground, e.g. the focused town's canonical terrain. */
  sink: (d: V3) => number = () => 0;
  constructor(readonly scene: Scene, readonly spec: PlanetSpec, readonly n = 96, readonly patchSize = 360, readonly patchCells = 144) {
    const m = this.material = new StandardMaterial('planet-ground', scene);
    m.diffuseColor = Color3.White(); m.ambientColor = new Color3(.8, .8, .8); m.specularColor = new Color3(.04, .04, .04);
    // Near ground: the shared CC0 scanned grass normal/roughness as metre-scale detail under biome colour.
    const maps = loadScannedMaps(scene, 'grass_ground'), dm = this.detail = new PBRMaterial('planet-ground-detail', scene);
    dm.albedoColor = Color3.White(); dm.bumpTexture = maps.normal; dm.bumpTexture.level = .6; dm.invertNormalMapY = true; dm.metallicTexture = maps.arm;
    dm.useAmbientOcclusionFromMetallicTextureRed = true; dm.useRoughnessFromMetallicTextureGreen = true; dm.useMetallnessFromMetallicTextureBlue = true; dm.metallic = 0; dm.roughness = 1;
    maps.albedo.dispose();
    const positions: number[] = [], colours: number[] = [], indices: number[] = [];
    for (let f = 0; f < 6; f++) {
      const base = positions.length / 3;
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        // Equal-angle cube mapping keeps cells near the face edges from crowding.
        const u = Math.tan((i / n * 2 - 1) * Math.PI / 4), v = Math.tan((j / n * 2 - 1) * Math.PI / 4), d = cubeToDir(f, u, v), c = climateAt(spec, d);
        this.dirs.push(d); const r = spec.radius + c.height; positions.push(d.x * r, d.y * r, d.z * r);
        colours.push(...groundColour(spec, d, c.height, biomeAt(spec, d)), 1);
      }
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const a = base + j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    this.heights = Float32Array.from(this.dirs.map((d, i) => Math.hypot(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]) - spec.radius));
    this.globe = build('planet-globe', scene, positions, colours, indices);
    this.fixWinding(this.globe);
    this.globe.material = m; this.globe.receiveShadows = true; this.globe.isPickable = false;
    const wm = new StandardMaterial('planet-sea', scene);
    wm.diffuseColor = new Color3(.025, .075, .11); wm.ambientColor = new Color3(.03, .07, .1); wm.specularColor = new Color3(.4, .42, .45); wm.specularPower = 96; wm.alpha = .9;
    this.water = this.sphere('planet-sea-surface', spec.radius, 160); this.water.material = wm; this.water.isPickable = false; this.water.receiveShadows = true;
  }
  /** Ensure outward-facing triangles (cube faces have mixed parity). */
  private fixWinding(mesh: Mesh) {
    const p = mesh.getVerticesData('position')!, idx = mesh.getIndices()!.slice();
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map(k => ({ x: p[k * 3], y: p[k * 3 + 1], z: p[k * 3 + 2] }));
      const n = { x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y), y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z), z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) };
      // Babylon's right-handed mode treats clockwise-from-outside as front facing.
      if (n.x * a.x + n.y * a.y + n.z * a.z > 0) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
    }
    mesh.setIndices(idx); const normals: number[] = []; VertexData.ComputeNormals(p, idx, normals); mesh.setVerticesData('normal', normals, true);
  }
  private sphere(name: string, radius: number, n: number) {
    const positions: number[] = [], indices: number[] = [], colours: number[] = [];
    for (let f = 0; f < 6; f++) {
      const base = positions.length / 3;
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const d = cubeToDir(f, Math.tan((i / n * 2 - 1) * Math.PI / 4), Math.tan((j / n * 2 - 1) * Math.PI / 4)); positions.push(d.x * radius, d.y * radius, d.z * radius); colours.push(1, 1, 1, 1); }
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = base + j * (n + 1) + i; indices.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2); }
    }
    const m = build(name, this.scene, positions, colours, indices); this.fixWinding(m); return m;
  }
  /** Rebuild the dense patch when the observer has moved a third of its span; sink the coarse globe beneath it. */
  follow(dir: V3, force = false) {
    const d = normalize(dir);
    if (!force && this.patchCentre && arc(this.spec, d, this.patchCentre) < this.patchSize / 3) return;
    this.patchCentre = d;
    const { east, north, up } = tangentFrame(d), n = this.patchCells, half = this.patchSize / 2, positions: number[] = [], colours: number[] = [], indices: number[] = [], uvs: number[] = [];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const x = -half + i / n * this.patchSize, z = -half + j / n * this.patchSize;
      const p = normalize(add(up, add(scale(east, x / this.spec.radius), scale(north, z / this.spec.radius)))), c = climateAt(this.spec, p), r = this.spec.radius + c.height - this.sink(p);
      positions.push(p.x * r, p.y * r, p.z * r); colours.push(...groundColour(this.spec, p, c.height, biomeAt(this.spec, p)).map(v => v * 1.25), 1); uvs.push(x / 3, z / 3);
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; indices.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2); }
    this.patch?.dispose();
    this.patch = build('planet-ground-patch', this.scene, positions, colours, indices, uvs); this.fixWinding(this.patch);
    this.patch.material = this.detail; this.patch.receiveShadows = true; this.patch.isPickable = false;
    // Lower the coarse globe under the patch so its chords never poke through.
    const pos = this.globe.getVerticesData('position')!;
    for (let k = 0; k < this.dirs.length; k++) {
      const a = arc(this.spec, this.dirs[k], d), drop = a < half * .9 ? 2.5 : a < half * 1.6 ? 2.5 * (1 - (a - half * .9) / (half * .7)) : 0, r = this.spec.radius + this.heights[k] - drop;
      pos[k * 3] = this.dirs[k].x * r; pos[k * 3 + 1] = this.dirs[k].y * r; pos[k * 3 + 2] = this.dirs[k].z * r;
    }
    this.globe.updateVerticesData('position', pos);
  }
  dispose() { this.globe.dispose(); this.patch?.dispose(); this.water.dispose(); this.material.dispose(); }
}
