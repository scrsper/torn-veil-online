import { Color3, Matrix, Mesh, MeshBuilder, StandardMaterial, Vector3, type Scene } from '@babylonjs/core';
import { PROP_ASSET, arc, normalize, propsNear, surfaceRadius, tangentFrame, type PlanetSpec, type Prop, type PropKind, type V3 } from '../../sim/world/planet';
import type { LibraryLoader } from './library';

/** Thin-instanced vegetation and boulders from the seeded scatter. Library flora/geology GLBs
 * are used when hash-verified; otherwise procedural trees and rocks of the same footprint. */
type Part = { mesh: Mesh };
function colour(scene: Scene, name: string, hex: string) { const m = new StandardMaterial(name, scene); m.diffuseColor = Color3.FromHexString(hex); m.ambientColor = m.diffuseColor.scale(.9); m.specularColor = new Color3(.03, .03, .03); return m; }
function fallback(scene: Scene, kind: PropKind): Mesh[] {
  const trunk = colour(scene, `prop-${kind}-bark`, kind === 'willow' ? '#6b5a44' : '#5a4130'), leaf = colour(scene, `prop-${kind}-leaf`, { oak: '#3f6a2a', willow: '#7d9a52', pine: '#2a4a2c', boulder: '#7c776e', shrub: '#4a6e30' }[kind]);
  const out: Mesh[] = [];
  const add = (m: Mesh, mat: StandardMaterial) => { m.material = mat; m.isPickable = false; m.setEnabled(false); out.push(m); return m; };
  if (kind === 'boulder') {
    const r = add(MeshBuilder.CreateIcoSphere(`prop-boulder`, { radius: 1.6, subdivisions: 2, flat: true }, scene), leaf);
    const p = r.getVerticesData('position')!; for (let i = 0; i < p.length; i += 3) { const k = 1 + Math.sin(p[i] * 3.1 + p[i + 2] * 2.3) * .18; p[i] *= k * 1.2; p[i + 1] = p[i + 1] * k * .6 + .4; p[i + 2] *= k; }
    r.updateVerticesData('position', p); return out;
  }
  if (kind === 'shrub') { const s = add(MeshBuilder.CreateIcoSphere('prop-shrub', { radius: .8, subdivisions: 1, flat: true }, scene), leaf); s.bakeTransformIntoVertices(Matrix.Scaling(1, .7, 1).multiply(Matrix.Translation(0, .45, 0))); return out; }
  const h = kind === 'pine' ? 9 : kind === 'willow' ? 6 : 7;
  const t = add(MeshBuilder.CreateCylinder(`prop-${kind}-trunk`, { height: h * .55, diameterTop: .3, diameterBottom: .6, tessellation: 7 }, scene), trunk); t.bakeTransformIntoVertices(Matrix.Translation(0, h * .275, 0));
  if (kind === 'pine') {
    const parts = [0, 1, 2].map(i => { const c = MeshBuilder.CreateCylinder(`prop-pine-c${i}`, { height: 3.6, diameterTop: 0, diameterBottom: 4.4 - i * 1.2, tessellation: 8 }, scene); c.bakeTransformIntoVertices(Matrix.Translation(0, 3.2 + i * 2.1, 0)); return c; });
    add(Mesh.MergeMeshes(parts, true)!, leaf);
  } else if (kind === 'willow') {
    const c = MeshBuilder.CreateCylinder('prop-willow-c', { height: 4.6, diameterTop: 2.2, diameterBottom: 5.2, tessellation: 9 }, scene); c.bakeTransformIntoVertices(Matrix.Translation(0, 3.6, 0)); add(c, leaf);
  } else {
    const parts = [[0, 5.2, 0, 2.4], [1.3, 4.4, .4, 1.7], [-1.1, 4.6, -.6, 1.8], [.2, 6.4, -.3, 1.6]].map(([x, y, z, r], i) => { const s = MeshBuilder.CreateIcoSphere(`prop-oak-s${i}`, { radius: r, subdivisions: 1, flat: true }, scene); s.bakeTransformIntoVertices(Matrix.Translation(x, y, z)); return s; });
    add(Mesh.MergeMeshes(parts, true)!, leaf);
  }
  return out;
}
export class PlanetProps {
  private parts = new Map<PropKind, Mesh[]>(); private centre: V3 | null = null; current: Prop[] = [];
  constructor(readonly scene: Scene, readonly spec: PlanetSpec, readonly loader: LibraryLoader, readonly onCaster: (m: Mesh) => void, readonly radius = 420) {}
  async init() {
    for (const kind of Object.keys(PROP_ASSET) as PropKind[]) {
      const id = PROP_ASSET[kind]; let meshes: Mesh[] | null = null;
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
