/** Player locomotion for the town: WASD relative to the camera's yaw, or click-to-move toward a
 * ground target. Pure: the browser feeds input and a collision world, and draws the result.
 * Heading convention: yaw 0 faces +z; forward = (sin yaw, cos yaw); right = (-cos yaw, sin yaw)
 * (right-handed, y up). */
export interface PlayerState { x: number; z: number; y: number; yaw: number; speed: number; target: { x: number; z: number } | null }
export interface MoveInput { forward: number; right: number; run: boolean }
export interface MoveWorld { move(x: number, z: number, dx: number, dz: number, r: number): [number, number]; groundAt(x: number, z: number): number }
export const WALK = 3.2, RUN = 6.4, RADIUS = .35, ARRIVE = .25, TURN = 12, ACCEL = 14;
export const forwardOf = (yaw: number): [number, number] => [Math.sin(yaw), Math.cos(yaw)];
export const rightOf = (yaw: number): [number, number] => [-Math.cos(yaw), Math.sin(yaw)];
/** Shortest signed angle from a to b. */
export function angleDelta(a: number, b: number): number { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }
/** World-space wish direction (unit or zero) from keys and the camera yaw. */
export function wishDirection(input: MoveInput, cameraYaw: number): [number, number] {
  const f = forwardOf(cameraYaw), r = rightOf(cameraYaw), x = f[0] * input.forward + r[0] * input.right, z = f[1] * input.forward + r[1] * input.right, l = Math.hypot(x, z);
  return l > 1e-6 ? [x / l, z / l] : [0, 0];
}
export function createPlayer(x: number, z: number, yaw: number, world: MoveWorld): PlayerState { return { x, z, y: world.groundAt(x, z), yaw, speed: 0, target: null }; }
/** One fixed step. Keys cancel a click target; a target is dropped on arrival or when blocked. */
export function stepPlayer(s: PlayerState, input: MoveInput, cameraYaw: number, dt: number, world: MoveWorld): PlayerState {
  let [wx, wz] = wishDirection(input, cameraYaw), target = s.target, run = input.run;
  if (wx || wz) target = null;
  else if (target) {
    const dx = target.x - s.x, dz = target.z - s.z, d = Math.hypot(dx, dz);
    if (d < ARRIVE) target = null; else { wx = dx / d; wz = dz / d; run = run || d > 12; }
  }
  const want = wx || wz ? (run ? RUN : WALK) : 0;
  const speed = s.speed + Math.max(-ACCEL * dt, Math.min(ACCEL * dt, want - s.speed));
  let { x, z, yaw } = s;
  if (wx || wz) yaw += angleDelta(yaw, Math.atan2(wx, wz)) * Math.min(1, TURN * dt);
  if (speed > 1e-3) {
    // Move along the wish direction (or the facing, while decelerating) and slide on contact.
    const [mx, mz] = wx || wz ? [wx, wz] : forwardOf(yaw);
    let step = speed * dt;
    if (target) step = Math.min(step, Math.hypot(target.x - x, target.z - z));
    const [nx, nz] = world.move(x, z, mx * step, mz * step, RADIUS);
    if (target && Math.hypot(nx - x, nz - z) < step * .2) target = null; // walked into something
    x = nx; z = nz;
  }
  const ground = world.groundAt(x, z), y = s.y + (ground - s.y) * Math.min(1, dt * 18);
  return { x, z, y: Math.abs(ground - y) < .01 ? ground : y, yaw, speed: wx || wz ? speed : Math.max(0, speed - ACCEL * dt * 2), target };
}
