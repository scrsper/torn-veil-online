import { Color3, Matrix, Mesh, MeshBuilder, StandardMaterial, Texture, Vector3, VertexData, type Scene } from '@babylonjs/core';
import { loadScannedMaps } from '../render/materials';
import { PROP_ASSET, PROP_MODULE, arc, normalize, propsNear, surfaceRadius, tangentFrame, type PlanetSpec, type Prop, type PropKind, type V3 } from '../../sim/world/planet';
import type { LibraryLoader } from './library';

/** Thin-instanced vegetation and boulders from the seeded scatter. Library flora/geology GLBs
 * are used when hash-verified; otherwise procedural trees and rocks of the same footprint. */
type Part = { mesh: Mesh };
function colour(scene: Scene, name: string, hex: string) { const m = new StandardMaterial(name, scene); m.diffuseColor = Color3.FromHexString(hex); m.ambientColor = m.diffuseColor.scale(.9); m.specularColor = new Color3(.03, .03, .03); return m; }
/** Leaf cards: quads carrying the repo's alpha-tested branch textures, placed deterministically. */
function cards(name: string, scene: Scene, list: { c: [number, number, number]; yaw: number; tilt: number; size: number }[]): Mesh {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (const { c, yaw, tilt, size } of list) {
    const h = size / 2, cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
    // Card spans its local x (across) and a tilted local y (along the branch).
    const ax = [cy, 0, -sy], ay = [sy * st, ct, cy * st], n = [ax[1] * ay[2] - ax[2] * ay[1], ax[2] * ay[0] - ax[0] * ay[2], ax[0] * ay[1] - ax[1] * ay[0]];
    const base = positions.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const du = (u - .5) * 2 * h, dv = (v - .5) * 2 * h;
      positions.push(c[0] + ax[0] * du + ay[0] * dv, c[1] + ax[1] * du + ay[1] * dv, c[2] + ax[2] * du + ay[2] * dv); normals.push(...n); uvs.push(u, v);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const m = new Mesh(name, scene), vd = new VertexData(); Object.assign(vd, { positions, normals, uvs, indices }); vd.applyToMesh(m); return m;
}
const seq = (i: number) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
function fallback(scene: Scene, kind: PropKind): Mesh[] {
  const leaf = colour(scene, `prop-${kind}-leaf`, { oak: '#3f6a2a', willow: '#7d9a52', pine: '#2a4a2c', boulder: '#7c776e', shrub: '#4a6e30', ruin: '#8d877c', rubble: '#8d877c' }[kind]);
  const out: Mesh[] = [];
  const add = (m: Mesh, mat: StandardMaterial) => { m.material = mat; m.isPickable = false; m.setEnabled(false); out.push(m); return m; };
  if (kind === 'boulder') {
    const rock = colour(scene, 'prop-boulder-rock', '#9a958b'), maps = loadScannedMaps(scene, 'mossy_rock'); rock.diffuseTexture = maps.albedo; rock.bumpTexture = maps.normal; rock.invertNormalMapY = true; rock.diffuseColor = new Color3(1.25, 1.22, 1.15);
    const r = add(MeshBuilder.CreateIcoSphere(`prop-boulder`, { radius: 1.6, subdivisions: 2, flat: true }, scene), rock);
    const p = r.getVerticesData('position')!; for (let i = 0; i < p.length; i += 3) { const k = 1 + Math.sin(p[i] * 3.1 + p[i + 2] * 2.3) * .18; p[i] *= k * 1.2; p[i + 1] = p[i + 1] * k * .6 + .4; p[i + 2] *= k; }
    r.updateVerticesData('position', p); return out;
  }
  // Foliage cards share the focused pack's alpha-tested branch textures (repo CC0 set).
  const foliage = (path: string, tint: string) => {
    const m = colour(scene, `prop-${kind}-cards`, tint), t = new Texture(path, scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
    t.hasAlpha = true; m.diffuseTexture = t; m.diffuseColor = Color3.FromHexString(tint).scale(2.4); m.ambientColor = m.diffuseColor.scale(.8); m.backFaceCulling = false; m.twoSidedLighting = true; return m;
  };
  if (kind === 'shrub') {
    const s = add(MeshBuilder.CreateIcoSphere('prop-shrub', { radius: .6, subdivisions: 1, flat: true }, scene), leaf); s.bakeTransformIntoVertices(Matrix.Scaling(1, .7, 1).multiply(Matrix.Translation(0, .4, 0)));
    add(cards('prop-shrub-cards', scene, Array.from({ length: 7 }, (_, i) => ({ c: [(seq(i) - .5) * .8, .5 + seq(i + 9) * .4, (seq(i + 4) - .5) * .8] as [number, number, number], yaw: i * 2.4, tilt: .5 + seq(i + 2) * .6, size: 1.5 }))), foliage('/textures/world/foliage-branch.png', '#4a6e30'));
    return out;
  }
  const h = kind === 'pine' ? 9 : kind === 'willow' ? 6 : 7;
  const bark = colour(scene, `prop-${kind}-bark`, kind === 'willow' ? '#8a7a64' : '#7a6150'), bm = loadScannedMaps(scene, 'bark_brown_02');
  bark.diffuseTexture = bm.albedo; bark.bumpTexture = bm.normal; bark.invertNormalMapY = true; bark.diffuseColor = new Color3(1.3, 1.25, 1.2);
  const t = add(MeshBuilder.CreateCylinder(`prop-${kind}-trunk`, { height: h * .62, diameterTop: .28, diameterBottom: .6, tessellation: 8 }, scene), bark); t.bakeTransformIntoVertices(Matrix.Translation(0, h * .31, 0));
  if (kind === 'pine') {
    // Dark conical core with downward-sweeping branch cards in tiers.
    const parts = [0, 1, 2].map(i => { const c = MeshBuilder.CreateCylinder(`prop-pine-c${i}`, { height: 3.2, diameterTop: 0, diameterBottom: 3.2 - i * .9, tessellation: 8 }, scene); c.bakeTransformIntoVertices(Matrix.Translation(0, 3.4 + i * 2, 0)); return c; });
    add(Mesh.MergeMeshes(parts, true)!, leaf);
    const list = [];
    for (let tier = 0; tier < 5; tier++) for (let k = 0; k < 6; k++) { const yaw = k / 6 * Math.PI * 2 + tier * .5, rad = (2.3 - tier * .38) * .55; list.push({ c: [Math.sin(yaw) * rad, 2.6 + tier * 1.45, Math.cos(yaw) * rad] as [number, number, number], yaw: yaw + Math.PI / 2, tilt: 1.25, size: 3 - tier * .4 }); }
    add(cards('prop-pine-cards', scene, list), foliage('/textures/world/foliage-pine.png', '#3a5a38'));
  } else {
    const willow = kind === 'willow', core = willow ? [[0, 4.4, 0, 1.9]] : [[0, 5.1, 0, 1.9], [1, 4.5, .3, 1.3], [-.9, 4.7, -.5, 1.4]];
    add(Mesh.MergeMeshes(core.map(([x, y, z, r], i) => { const sp = MeshBuilder.CreateIcoSphere(`prop-${kind}-s${i}`, { radius: r, subdivisions: 1, flat: true }, scene); sp.bakeTransformIntoVertices(Matrix.Translation(x, y, z)); return sp; }), true)!, leaf);
    const list = Array.from({ length: willow ? 22 : 26 }, (_, i) => {
      const yaw = seq(i) * Math.PI * 2, el = willow ? -.2 + seq(i + 30) * .6 : -.3 + seq(i + 30) * 1.2, r = willow ? 2.2 : 2.4;
      return { c: [Math.sin(yaw) * Math.cos(el) * r, (willow ? 4 : 5) + Math.sin(el) * r * .8, Math.cos(yaw) * Math.cos(el) * r] as [number, number, number], yaw: yaw + Math.PI / 2, tilt: willow ? .15 : .4 + seq(i + 7) * .9, size: willow ? 3.4 : 2.8 };
    });
    add(cards(`prop-${kind}-cards`, scene, list), foliage('/textures/world/foliage-branch.png', willow ? '#8aa860' : '#4f7a35'));
  }
  return out;
}
export class PlanetProps {
  private parts = new Map<PropKind, Mesh[]>(); private centre: V3 | null = null; current: Prop[] = [];
  /** `modules` yields baked, disabled source meshes for a focused-pack module id (hash-verified). */
  constructor(readonly scene: Scene, readonly spec: PlanetSpec, readonly loader: LibraryLoader, readonly onCaster: (m: Mesh) => void, readonly radius = 420, readonly modules?: (id: string) => Promise<Mesh[]>) {}
  async init() {
    for (const kind of Object.keys(PROP_ASSET) as PropKind[]) {
      const id = PROP_ASSET[kind], moduleId = PROP_MODULE[kind]; let meshes: Mesh[] | null = null;
      if (moduleId) {
        // Focused-pack stonework; without the pack these kinds are simply not drawn.
        meshes = this.modules ? await this.modules(moduleId).catch(() => []) : [];
        this.parts.set(kind, meshes); continue;
      }
      if (id) {
        const c = await this.loader.container(id);
        if (c) {
          meshes = [];
          for (const src of c.meshes) {
            if (!(src instanceof Mesh) || !src.getTotalVertices()) continue;
            const copy = src.clone(`prop-${kind}-${src.name}`, null, true, false)!; copy.makeGeometryUnique();
            copy.bakeTransformIntoVertices(src.computeWorldMatrix(true)); copy.parent = null; copy.position.setAll(0); copy.rotationQuaternion = null; copy.rotation.setAll(0); copy.scaling.setAll(1);
            if (!this.scene.meshes.includes(copy)) this.scene.addMesh(copy);
            copy.setEnabled(false); meshes.push(copy);
          }
        }
      }
      this.parts.set(kind, meshes?.length ? meshes : fallback(this.scene, kind));
    }
    for (const list of this.parts.values()) for (const m of list) { m.receiveShadows = true; this.onCaster(m); }
  }
  follow(dir: V3, force = false) {
    const d = normalize(dir);
    if (!force && this.centre && arc(this.spec, d, this.centre) < this.radius / 4) return;
    this.centre = d; this.current = propsNear(this.spec, d, this.radius);
    const byKind = new Map<PropKind, Float32Array>(), counts = new Map<PropKind, number>();
    for (const p of this.current) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
    for (const [k, n] of counts) byKind.set(k, new Float32Array(n * 16));
    const fill = new Map<PropKind, number>(), m = new Matrix();
    for (const p of this.current) {
      const f = tangentFrame(p.dir), c = Math.cos(p.yaw), s = Math.sin(p.yaw);
      const z = new Vector3(f.north.x * c + f.east.x * s, f.north.y * c + f.east.y * s, f.north.z * c + f.east.z * s), y = new Vector3(f.up.x, f.up.y, f.up.z), x = Vector3.Cross(y, z).normalize();
      // Sink slightly so the base meets slopes.
      const r = surfaceRadius(this.spec, p.dir) - .15, sc = p.scale;
      Matrix.FromValuesToRef(x.x * sc, x.y * sc, x.z * sc, 0, y.x * sc, y.y * sc, y.z * sc, 0, z.x * sc, z.y * sc, z.z * sc, 0, p.dir.x * r, p.dir.y * r, p.dir.z * r, 1, m);
      const i = fill.get(p.kind) ?? 0; m.copyToArray(byKind.get(p.kind)!, i * 16); fill.set(p.kind, i + 1);
    }
    for (const [kind, meshes] of this.parts) {
      const data = byKind.get(kind);
      for (const mesh of meshes) {
        if (!data) { mesh.setEnabled(false); continue; }
        mesh.thinInstanceSetBuffer('matrix', data, 16, false); mesh.thinInstanceRefreshBoundingInfo(false); mesh.setEnabled(true);
      }
    }
  }
}
