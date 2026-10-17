import { GRAVITY, add, cross, dot, length, normalize, scale, sub, surfaceRadius, tangentFrame, type PlanetSpec, type V3 } from './planet';

/** Deterministic surface locomotion under spherical gravity. Input is intent only;
 * the step owns position, velocity, contact and the body's up/forward frame.
 * The sea surface is walkable as shallow wading/swimming, so no route falls off the world. */
export interface SurfaceBody { pos: V3; vel: V3; forward: V3; grounded: boolean; swimming: boolean }
export interface SurfaceInput { forward: number; right: number; turn: number; jump: boolean; run: boolean }
export const WALK = 4.2, RUN = 8.5, SWIM = 2.4, JUMP = 5.2, TURN = 2.6, WADE_DEPTH = .9;
export function spawnBody(spec: PlanetSpec, dir: V3, facing?: V3): SurfaceBody {
  const up = normalize(dir), f = tangentFrame(up), fwd = facing ? normalize(sub(facing, scale(up, dot(facing, up)))) : f.north;
  return { pos: scale(up, groundRadius(spec, up)), vel: { x: 0, y: 0, z: 0 }, forward: length(fwd) > .5 ? fwd : f.north, grounded: true, swimming: false };
}
/** Walkable radius: terrain, or the water surface less a wading depth. */
export function groundRadius(spec: PlanetSpec, up: V3) { return Math.max(surfaceRadius(spec, up), spec.radius - WADE_DEPTH); }
export const upOf = (b: SurfaceBody) => normalize(b.pos);
export const rightOf = (b: SurfaceBody) => normalize(cross(upOf(b), b.forward));
function rotateAbout(v: V3, axis: V3, a: number): V3 {
  // Rodrigues' rotation, axis unit length.
  const c = Math.cos(a), s = Math.sin(a);
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}
export function stepSurface(spec: PlanetSpec, b: SurfaceBody, input: SurfaceInput, dt: number): SurfaceBody {
  if (!(dt > 0 && dt <= .1)) throw Error('Surface step must be in (0, 0.1] seconds');
  let up = normalize(b.pos);
  let forward = rotateAbout(b.forward, up, clamp(input.turn) * TURN * dt);
  forward = normalize(sub(forward, scale(up, dot(forward, up))));
  const right = normalize(cross(up, forward));
  const swimming = surfaceRadius(spec, up) < spec.radius - WADE_DEPTH;
  const speed = swimming ? SWIM : input.run ? RUN : WALK;
  let wish = add(scale(forward, clamp(input.forward)), scale(right, clamp(input.right)));
  const wl = length(wish); if (wl > 1) wish = scale(wish, 1 / wl);
  const radial = dot(b.vel, up), tangent = sub(b.vel, scale(up, radial)), target = scale(wish, speed);
  // Full control on the ground, partial in the air.
  const k = b.grounded ? 1 : Math.min(1, dt * 2.5), nextTangent = add(tangent, scale(sub(target, tangent), k));
  let vr = radial - GRAVITY * dt;
  if (b.grounded && input.jump && !swimming) vr = JUMP;
  else if (b.grounded && vr < 0) vr = 0;
  let pos = add(b.pos, scale(add(nextTangent, scale(up, vr)), dt));
  // Re-seat on the new local vertical; parallel-transport the heading to the new tangent plane.
  const nup = normalize(pos), ground = groundRadius(spec, nup), r = length(pos);
  let grounded = false;
  if (r <= ground + .05 && vr <= 0) { pos = scale(nup, ground); vr = 0; grounded = true; }
  // Snap down gentle descents so walking downhill does not hop.
  else if (b.grounded && vr <= 0 && r - ground < .6) { pos = scale(nup, ground); vr = 0; grounded = true; }
  const axis = cross(up, nup), al = length(axis);
  if (al > 1e-12) forward = rotateAbout(forward, scale(axis, 1 / al), Math.asin(Math.min(1, al)));
  forward = normalize(sub(forward, scale(nup, dot(forward, nup))));
  up = nup;
  const vel = add(sub(nextTangent, scale(up, dot(nextTangent, up))), scale(up, vr));
  return { pos, vel, forward, grounded, swimming: surfaceRadius(spec, up) < spec.radius - WADE_DEPTH };
}
const clamp = (n: number) => Math.max(-1, Math.min(1, Number.isFinite(n) ? n : 0));
