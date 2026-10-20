import type { UniverseContactPatch } from '../../server/universeContacts';
import type { FootPoint, FootSupport } from '../arena/footPlant';
import { add, sub, scale, dot, cross, normalize, length, type V3 } from '../../sim/world/planet/planet';
import { terrainHeight, terrainNormal, type PlanetDescriptor } from '../../sim/world/universe/generation';
import { ATLAS_MAX_STEP } from '../../sim/world/atlas/collision';
import { getAtlasAsset } from '../../sim/world/atlas';
import { atlasPlacementBasis, atlasPlanetPlacements, type AtlasPlacement } from '../../sim/world/atlas/placement';

type Triangle = { a: V3; u: V3; v: V3; normal: V3; uu: number; uv: number; vv: number; denominator: number };
const finite = (p: FootPoint) => [p.x, p.y, p.z].every(Number.isFinite);

/** A sole sample needs an actual point on a cooked top face. The canonical
 * walker's expanded capsule footprint is intentionally not foot-plant evidence.
 * Coordinates are planet-local; the caller samples the sole's full footprint. */
export function atlasSoleSupport(placements: readonly AtlasPlacement[], ground: V3, up: V3): FootSupport | null {
  let result: FootSupport | null = null, highest = 0;
  for (const p of placements) {
    if (!p.solid) continue;
    const asset = getAtlasAsset(p.assetId);
    if (!asset || asset.proxy.kind === 'none') continue;
    const basis = atlasPlacementBasis(p), relative = sub(ground, p.position);
    const foot = { x: dot(relative, basis.x), y: dot(relative, basis.y), z: dot(relative, basis.z) };
    const axis = { x: dot(up, basis.x), y: dot(up, basis.y), z: dot(up, basis.z) };
    if (axis.y < .95) continue;
    for (const box of asset.proxy.boxes) {
      const rise = (box.max.y - foot.y) / axis.y;
      if (rise <= highest || rise > ATLAS_MAX_STEP + 1e-6) continue;
      const x = foot.x + axis.x * rise, z = foot.z + axis.z * rise;
      // Numeric tolerance only: never expand a mesh top by body/sole radius.
      if (x < box.min.x - 1e-7 || x > box.max.x + 1e-7 || z < box.min.z - 1e-7 || z > box.max.z + 1e-7) continue;
      highest = rise; result = { point: add(ground, scale(up, rise)), normal: basis.y, source: 'atlas' };
    }
  }
  return result;
}

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
    const normal = terrain < 0 ? direction : terrainNormal(planet, direction), slope = dot(normal, axis);
    if (slope < .65) return null;
    const floor = add(planet.center, scale(direction, planet.radius + Math.max(0, terrain)));
    const distance = dot(sub(floor, point), normal) / slope;
    const ground = add(point, scale(axis, distance)), localGround = sub(ground, planet.center);
    const support = revision === 0 ? null : atlasSoleSupport(atlasPlanetPlacements(planet, localGround, 3, revision), localGround, axis);
    if (support) {
      const supported = add(planet.center, support.point);
      return Math.abs(dot(sub(supported, point), axis)) <= maxDistance ? { ...support, point: supported } : null;
    }
    return Math.abs(distance) <= maxDistance ? { point: ground, normal, source: terrain < 0 ? 'water' : 'terrain' } : null;
  }
  stats() { return { id: this.patch?.id ?? null, available: this.patch?.available ?? false,
    reason: this.patch?.reason ?? 'absent', triangles: this.triangles.length }; }
}
