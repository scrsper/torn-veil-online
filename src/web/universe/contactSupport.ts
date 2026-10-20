import type { UniverseContactPatch } from '../../server/universeContacts';
import type { FootPoint, FootSupport } from '../arena/footPlant';
import { add, sub, scale, dot, cross, normalize, length, type V3 } from '../../sim/world/planet/planet';
import { terrainHeight, terrainNormal, type PlanetDescriptor } from '../../sim/world/universe/generation';
import { atlasPlanetSupport } from '../../sim/world/atlas/collision';

type Triangle = { a: V3; u: V3; v: V3; normal: V3; uu: number; uv: number; vv: number; denominator: number };
const finite = (p: FootPoint) => [p.x, p.y, p.z].every(Number.isFinite);

/** Read-only floor queries in absolute universe coordinates. The host's small
 * patch is the only support inside mapped towns; unloaded/out-of-range evidence
 * releases contact instead of substituting the depressed visual underlay. */
export class UniverseFootSupport {
  private patch: UniverseContactPatch | null = null;
  private triangles: Triangle[] = [];
  setPatch(patch: UniverseContactPatch | null) {
    if (patch?.id === this.patch?.id) return;
    this.patch = patch; this.triangles = [];
    if (!patch?.available) return;
    for (const p of patch.triangles) {
      if (p.length !== 9 || !p.every(Number.isFinite)) continue;
      const a = { x: p[0], y: p[1], z: p[2] }, u = sub({ x: p[3], y: p[4], z: p[5] }, a), v = sub({ x: p[6], y: p[7], z: p[8] }, a);
      const normal = normalize(cross(u, v)), uu = dot(u, u), uv = dot(u, v), vv = dot(v, v), denominator = uu * vv - uv * uv;
      if (denominator > 1e-12) this.triangles.push({ a, u, v, normal, uu, uv, vv, denominator });
    }
  }

  sample(planet: PlanetDescriptor, mappedTown: boolean, revision: number,
    point: FootPoint, up: FootPoint, radius: number, maxDistance: number): FootSupport | null {
    if (!finite(point) || !finite(up) || length(up) < .99 || !Number.isFinite(radius) || radius < 0
      || !Number.isFinite(maxDistance) || maxDistance <= 0 || maxDistance > 1) return null;
    const axis = normalize(up);
    if (mappedTown) {
      const patch = this.patch;
      if (!patch?.available || patch.planetId !== planet.id) return null;
      const local = sub(point, patch.origin), horizontal = sub(local, scale(axis, dot(local, axis)));
      // Inscribed in the host's cell window. Large source triangles cannot
      // make old patches support a character after leaving their bounded area.
      if (!Number.isFinite(patch.radius) || patch.radius <= 0 || length(horizontal) + radius > Math.min(2.45, patch.radius)) return null;
      let nearest: FootSupport | null = null, height = -Infinity;
      for (const t of this.triangles) {
        const slope = dot(t.normal, axis);
        if (slope < .65) continue;
        const distance = dot(sub(t.a, local), t.normal) / slope;
        if (Math.abs(distance) > maxDistance || distance <= height) continue;
        const hit = add(local, scale(axis, distance)), offset = sub(hit, t.a), du = dot(offset, t.u), dv = dot(offset, t.v);
        const b = (t.vv * du - t.uv * dv) / t.denominator, c = (t.uu * dv - t.uv * du) / t.denominator;
        if (b < -1e-7 || c < -1e-7 || b + c > 1 + 1e-7) continue;
        height = distance; nearest = { point: add(patch.origin, hit), normal: t.normal, source: 'settlement:' + patch.id };
      }
      return nearest;
    }
    const direction = normalize(sub(point, planet.center)), terrain = terrainHeight(planet, direction);
    const raised = atlasPlanetSupport(planet, direction, revision), normal = raised > 0 || terrain < 0 ? direction : terrainNormal(planet, direction);
    const slope = dot(normal, axis);
    if (slope < .65) return null;
    const floor = add(planet.center, scale(direction, planet.radius + Math.max(0, terrain) + raised));
    const distance = dot(sub(floor, point), normal) / slope;
    return Math.abs(distance) <= maxDistance ? { point: add(point, scale(axis, distance)), normal,
      source: raised > 0 ? 'atlas' : terrain < 0 ? 'water' : 'terrain' } : null;
  }
  stats() { return { id: this.patch?.id ?? null, available: this.patch?.available ?? false,
    reason: this.patch?.reason ?? 'absent', triangles: this.triangles.length }; }
}
