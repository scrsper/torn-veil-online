import { InstancedMesh, Matrix, Mesh, Vector3, VertexBuffer, type TransformNode } from '@babylonjs/core';
import { chartToDir, tangentFrame, type PlanetSpec } from '../../sim/world/planet';
import { HOME_PLATEAU } from '../../sim/world/planet/planet';
import type { RealmChart } from '../../sim/world/planet/chart';

/** Bend flat realm content onto the sphere with the same chart the walker uses
 * (planet/chart.ts): every vertex, instance and thin instance is re-expressed in planet space. */
function frameAt(spec: PlanetSpec, c: RealmChart, x: number, z: number) {
  const d = chartToDir(c.anchor, -(x - c.origin.x), z - c.origin.z, spec.radius), f = tangentFrame(d);
  return { d, west: new Vector3(-f.east.x, -f.east.y, -f.east.z), up: new Vector3(f.up.x, f.up.y, f.up.z), north: new Vector3(f.north.x, f.north.y, f.north.z) };
}
export function bendPoint(spec: PlanetSpec, c: RealmChart, p: Vector3): Vector3 {
  const { d } = frameAt(spec, c, p.x, p.z), r = spec.radius + HOME_PLATEAU.height + (p.y - c.floorY);
  return new Vector3(d.x * r, d.y * r, d.z * r);
}
/** Rigid transform taking realm-local axes at (x, z) to planet space, for instances. */
export function bendMatrix(spec: PlanetSpec, c: RealmChart, m: Matrix): Matrix {
  const t = m.getTranslation(), f = frameAt(spec, c, t.x, t.z), p = bendPoint(spec, c, t);
  const local = m.getRotationMatrix(), s = new Vector3(); m.decompose(s);
  const frame = Matrix.FromValues(f.west.x, f.west.y, f.west.z, 0, f.up.x, f.up.y, f.up.z, 0, f.north.x, f.north.y, f.north.z, 0, 0, 0, 0, 1);
  return Matrix.Scaling(s.x, s.y, s.z).multiply(local).multiply(frame).multiply(Matrix.Translation(p.x, p.y, p.z));
}
/** Longest straight edge (m, world space) kept before bending; a 96 m flat quad would otherwise
 * stay a chord and sag ~1.4 m under the curved ground at its middle. */
const MAX_EDGE = 12;
/** Midpoint-split triangles whose world-space edges exceed `max`, interpolating every vertex
 * attribute. Leaves meshes without long edges untouched (one submesh only). */
function subdivideLong(mesh: Mesh, max: number) {
  const idx = mesh.getIndices(), pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!idx || !pos || mesh.subMeshes?.length > 1) return;
  const world = mesh.computeWorldMatrix(true), w = new Vector3();
  const wp: number[] = [];
  for (let i = 0; i < pos.length; i += 3) { Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], world, w); wp.push(w.x, w.y, w.z); }
  const d2 = (a: number, b: number) => (wp[a * 3] - wp[b * 3]) ** 2 + (wp[a * 3 + 1] - wp[b * 3 + 1]) ** 2 + (wp[a * 3 + 2] - wp[b * 3 + 2]) ** 2;
  let long = false;
  for (let k = 0; k < idx.length && !long; k += 3) long = Math.max(d2(idx[k], idx[k + 1]), d2(idx[k + 1], idx[k + 2]), d2(idx[k + 2], idx[k])) > max * max;
  if (!long) return;
  const kinds = mesh.getVerticesDataKinds().filter(k => !k.startsWith('matrices'));
  const data = new Map(kinds.map(k => [k, Array.from(mesh.getVerticesData(k)!)]));
  const stride = new Map(kinds.map(k => [k, data.get(k)!.length / (pos.length / 3)]));
  const mids = new Map<string, number>();
  const mid = (a: number, b: number) => {
    const key = a < b ? a + ':' + b : b + ':' + a, hit = mids.get(key); if (hit !== undefined) return hit;
    const n = wp.length / 3;
    for (const k of kinds) { const s = stride.get(k)!, arr = data.get(k)!; for (let c = 0; c < s; c++) arr.push((arr[a * s + c] + arr[b * s + c]) / 2); }
    for (let c = 0; c < 3; c++) wp.push((wp[a * 3 + c] + wp[b * 3 + c]) / 2);
    mids.set(key, n); return n;
  };
  let tris = Array.from(idx);
  for (let pass = 0; pass < 6; pass++) {
    const next: number[] = []; let split = false;
    for (let k = 0; k < tris.length; k += 3) {
      const [a, b, c] = [tris[k], tris[k + 1], tris[k + 2]];
      if (Math.max(d2(a, b), d2(b, c), d2(c, a)) <= max * max) { next.push(a, b, c); continue; }
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); split = true;
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    tris = next; if (!split) break;
  }
  for (const k of kinds) mesh.setVerticesData(k, data.get(k)!, true, stride.get(k));
  mesh.setIndices(tris);
}
export function bendTree(spec: PlanetSpec, c: RealmChart, root: TransformNode,
  onMaterialized?: (original: InstancedMesh, replacement: Mesh) => void): Mesh[] {
  root.computeWorldMatrix(true);
  const out: Mesh[] = [];
  for (const node of root.getChildMeshes(false)) {
    let mesh: Mesh;
    if (node instanceof InstancedMesh) {
      const copy = node.sourceMesh.clone(node.name + ':bent', null, true, false); if (!copy) continue;
      copy.makeGeometryUnique(); copy.parent = null; copy.position.setAll(0); copy.rotationQuaternion = null; copy.rotation.setAll(0); copy.scaling.setAll(1);
      copy.bakeTransformIntoVertices(node.computeWorldMatrix(true)); copy.setEnabled(node.isEnabled()); copy.isVisible = node.isVisible; copy.visibility = node.visibility;
      // The view owning registrations/instance metadata can transfer them
      // before the original instance is released. Other callers are unchanged.
      onMaterialized?.(node, copy);
      node.dispose(); mesh = copy;
    } else if (node instanceof Mesh) mesh = node; else continue;
    const thin = mesh.thinInstanceCount;
    if (thin > 0) {
      // Thin instances keep their geometry; each instance matrix is bent rigidly.
      const world = mesh.computeWorldMatrix(true).clone(), data = mesh.thinInstanceGetWorldMatrices();
      const buffer = new Float32Array(thin * 16);
      data.forEach((m, i) => bendMatrix(spec, c, m.multiply(world)).copyToArray(buffer, i * 16));
      mesh.setParent(null); mesh.position.setAll(0); mesh.rotationQuaternion = null; mesh.rotation.setAll(0); mesh.scaling.setAll(1);
      mesh.thinInstanceSetBuffer('matrix', buffer, 16, true); mesh.thinInstanceRefreshBoundingInfo(false); out.push(mesh); continue;
    }
    if (!mesh.getVerticesData(VertexBuffer.PositionKind)) continue;
    if (mesh.geometry && mesh.geometry.meshes.length > 1) mesh.makeGeometryUnique();
    subdivideLong(mesh, MAX_EDGE);
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    const normals = mesh.getVerticesData(VertexBuffer.NormalKind), world = mesh.computeWorldMatrix(true), nm = world.getRotationMatrix();
    const p = new Vector3(), n = new Vector3();
    for (let i = 0; i < positions.length; i += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(positions[i], positions[i + 1], positions[i + 2], world, p);
      const f = frameAt(spec, c, p.x, p.z), r = spec.radius + HOME_PLATEAU.height + (p.y - c.floorY);
      positions[i] = f.d.x * r; positions[i + 1] = f.d.y * r; positions[i + 2] = f.d.z * r;
      if (normals) {
        Vector3.TransformNormalFromFloatsToRef(normals[i], normals[i + 1], normals[i + 2], nm, n); n.normalize();
        normals[i] = f.west.x * n.x + f.up.x * n.y + f.north.x * n.z; normals[i + 1] = f.west.y * n.x + f.up.y * n.y + f.north.y * n.z; normals[i + 2] = f.west.z * n.x + f.up.z * n.y + f.north.z * n.z;
      }
    }
    mesh.setParent(null); mesh.position.setAll(0); mesh.rotationQuaternion = null; mesh.rotation.setAll(0); mesh.scaling.setAll(1);
    // Mirrored source transforms (glTF handedness roots) flip winding; keep faces outward.
    if (world.determinant() < 0) { const idx = mesh.getIndices(); if (idx) { const f = Array.from(idx); for (let k = 0; k < f.length; k += 3) { const s = f[k + 1]; f[k + 1] = f[k + 2]; f[k + 2] = s; } mesh.setIndices(f); } }
    mesh.setVerticesData(VertexBuffer.PositionKind, positions, true); if (normals) mesh.setVerticesData(VertexBuffer.NormalKind, normals, true);
    mesh.refreshBoundingInfo(); out.push(mesh);
  }
  return out;
}
