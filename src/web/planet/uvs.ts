import { VertexBuffer, type Mesh } from '@babylonjs/core';

/** Metre-scale planar UVs (each face projected along its dominant normal axis, in the parent's
 * frame) so scanned surfaces keep their real size on boxes and ribbons of any extent (pagoda, survey walls). */
export function metreUVs(m: Mesh, tile: number) {
  const pos = m.getVerticesData(VertexBuffer.PositionKind), nor = m.getVerticesData(VertexBuffer.NormalKind); if (!pos || !nor) return;
  const uv = new Float32Array(pos.length / 3 * 2), o = m.position;
  for (let i = 0; i < pos.length / 3; i++) {
    const x = pos[i * 3] + o.x, y = pos[i * 3 + 1] + o.y, z = pos[i * 3 + 2] + o.z, ax = Math.abs(nor[i * 3]), ay = Math.abs(nor[i * 3 + 1]), az = Math.abs(nor[i * 3 + 2]);
    // Upward faces run their courses along the nearer eave (roof slates on all four slopes).
    const [u, v] = ay >= ax && ay >= az ? (ax > az ? [z, x] : [x, z]) : ax >= az ? [z, y] : [x, y];
    uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
  }
  m.setVerticesData(VertexBuffer.UVKind, uv, false);
}
