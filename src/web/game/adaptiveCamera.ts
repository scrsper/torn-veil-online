/**
 * Adaptive third-person camera core, shared by the world client (CameraRig) and the arena / Tower of Chrysanthus.
 *
 * One continuous camera, not a set of modes: an elevated, freely orbitable view aimed at the chest. The player's
 * chosen distance is the anchor; the situation modulates it:
 *   exploration  ~4.6 m, ~12° down, player ~30% of screen height
 *   small fight  a little closer
 *   group fight  farther back and higher (attackers, allies, escape paths)
 *   large thing  far enough back that its scale reads
 *   interior     closer under a low ceiling
 *   aiming       a temporary over-the-shoulder precision framing
 * Obstruction pulls in at once along the view ray and recovers smoothly (with hysteresis) once clear.
 *
 * Presentation only: it reads positions and returns a camera pose; nothing in the simulation depends on it.
 * Yaw convention: forward = (-sin yaw, 0, -cos yaw) on the ground, the convention both clients' movement uses.
 */
export interface V3 { x: number; y: number; z: number }

export interface CameraSituation {
  /** Chest point of the player in render space. */
  pivot: V3;
  /** Player ground velocity (m/s), for a subtle lead in the direction of travel. */
  velocity?: { x: number; z: number };
  /** Hostiles engaged or close (roughly within 12 m) while fighting; 0 when exploring. */
  threats?: number;
  /** True while in combat (recent blows, guard, lock). */
  engaged?: boolean;
  /** Height in metres of the largest creature nearby (0 if none notable). */
  largest?: number;
  /** Free height above the pivot when under a roof or in a tight space; null in the open. */
  ceiling?: number | null;
  /** Precision ranged aiming. */
  aiming?: boolean;
  /** Optional look-at override weight toward a locked target (0..1) and its point. */
  focus?: { point: V3; weight: number } | null;
}

/** Clear distance from `from` along unit `dir`, up to `max` (already including any camera radius). */
export type ObstructionQuery = (from: V3, dir: V3, max: number, single?: boolean) => number;

export interface CameraPose { position: V3; target: V3; fov: number }

export const CAMERA_LIMITS = { minDistance: 2.6, maxDistance: 10, maxExceptional: 14, minPitch: 4 * Math.PI / 180, maxPitch: 50 * Math.PI / 180 };

/** Development presets: distance (m), pitch (deg), fov (deg), and a forced situation for tuning. */
export const CAMERA_PRESETS = {
  exploration: { distance: 4.6, pitch: 12, fov: 65 },
  close: { distance: 4.2, pitch: 16, fov: 64 },
  wide: { distance: 9.5, pitch: 27, fov: 65 },
  group: { distance: 6.8, pitch: 20, fov: 65, threats: 5, engaged: true },
  large: { distance: 6.8, pitch: 20, fov: 65, largest: 7, engaged: true },
  interior: { distance: 6.8, pitch: 20, fov: 65, ceiling: 2.6 },
} as const;
export type CameraPresetName = keyof typeof CAMERA_PRESETS;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const DEG = Math.PI / 180;

export class AdaptiveCamera {
  /** Input-owned orientation (what the mouse/stick set) and the player's preferred distance. */
  yaw = 0; pitch = 12 * DEG; preferred: number = CAMERA_PRESETS.exploration.distance; baseFov = 65 * DEG;
  /** Smoothed state actually rendered. */
  private yawS = 0; private pitchS = 12 * DEG; private dist: number = CAMERA_PRESETS.exploration.distance; private fovS = 65 * DEG; private shoulderS = 0;
  private lead = { x: 0, z: 0 }; private target: V3 = { x: 0, y: 0, z: 0 }; private started = false;
  /** Obstruction: the clear limit currently applied and how long the ray has been clear beyond it. */
  private limit = Infinity; private clearFor = 0; private rise = 0;
  /** Dev preset forcing a situation (null in play). */
  forced: Partial<CameraSituation> | null = null;
  /** Last frame's figures, for HUD/debug and review harnesses. */
  readonly debug = { want: 0, dist: 0, limit: 0, pitchDeg: 0, fovDeg: 0, reason: 'explore' };

  addLook(dx: number, dy: number): void {
    this.yaw = wrap(this.yaw - dx);
    this.pitch = clamp(this.pitch + dy, CAMERA_LIMITS.minPitch, CAMERA_LIMITS.maxPitch);
  }
  /** Wheel/trigger zoom: changes the preferred distance the situation modulates. */
  zoom(delta: number): void { this.preferred = clamp(this.preferred * (1 + delta * .08), CAMERA_LIMITS.minDistance, CAMERA_LIMITS.maxDistance); }
  preset(name: CameraPresetName): void {
    const p = CAMERA_PRESETS[name];
    this.preferred = p.distance; this.pitch = p.pitch * DEG; this.baseFov = p.fov * DEG;
    const { distance: _d, pitch: _p, fov: _f, ...forced } = p as Record<string, unknown>;
    this.forced = Object.keys(forced).length ? forced as Partial<CameraSituation> : null;
  }
  /** Jump straight to the current wish (spawn, teleport, mode switch). */
  snap(): void { this.started = false; }
  /** Ground-plane forward of the rendered camera (camera-relative movement uses the input yaw). */
  get renderedYaw(): number { return this.yawS; }

  update(dt: number, sit0: CameraSituation, obstruct: ObstructionQuery, ground?: (x: number, z: number) => number | null): CameraPose {
    const t = Math.min(dt, .1), sit = { ...sit0, ...this.forced, pivot: sit0.pivot };
    const threats = sit.threats ?? 0, largest = sit.largest ?? 0, engaged = !!sit.engaged;

    // ---- situation -> wished distance, pitch bias, fov, shoulder
    let want: number = this.preferred, pitchBias = 0, fov = this.baseFov, shoulder = 0, reason = 'explore';
    if (engaged && threats <= 2 && largest < 3) { want *= .92; pitchBias -= 1.5 * DEG; reason = 'duel'; }
    if (threats >= 3) { const g = Math.min(1, (threats - 2) / 5); want *= 1.1 + g * .2; pitchBias += (2 + g * 4) * DEG; fov += 2 * DEG * g; reason = 'group'; }
    if (largest >= 3) { const big = Math.min(CAMERA_LIMITS.maxExceptional, 3.2 + largest * 1.35); if (big > want) { want = big; reason = 'large'; } pitchBias += Math.min(6, largest) * DEG; }
    want = Math.min(want, largest >= 3 || threats >= 3 ? CAMERA_LIMITS.maxExceptional : CAMERA_LIMITS.maxDistance + 1);
    if (sit.ceiling != null && sit.ceiling < 4.5) {
      // Under a roof: closer and flatter so the camera stays inside the room instead of in the rafters.
      const k = clamp((4.5 - sit.ceiling) / 2.5, 0, 1);
      want = Math.min(want, 6.8 - k * 3.2); pitchBias -= k * 7 * DEG; reason = 'interior';
    }
    if (sit.aiming) { want = 3.4; shoulder = .7; pitchBias = -5 * DEG; fov -= 6 * DEG; reason = 'aim'; }

    // ---- smoothing: input-owned yaw/pitch track tightly (no felt latency); distance and fov ease
    const close = clamp((Math.min(want, 4) - Math.min(this.dist, 4)) / 2.6, 0, 1) * (sit.ceiling != null ? .3 : 1);
    pitchBias += this.rise + close * 9 * DEG;
    const wantPitch = clamp(this.pitch + pitchBias, CAMERA_LIMITS.minPitch, CAMERA_LIMITS.maxPitch);
    if (!this.started) { this.yawS = this.yaw; this.pitchS = wantPitch; this.dist = want; this.fovS = fov; this.target = { ...sit.pivot }; this.started = true; }
    this.yawS += wrap(this.yaw - this.yawS) * damp(26, t);
    this.pitchS += (wantPitch - this.pitchS) * damp(sit.aiming ? 14 : 7, t);
    this.fovS += (fov - this.fovS) * damp(5, t);
    this.shoulderS += (shoulder - this.shoulderS) * damp(10, t);

    // ---- composition: chest target, a little ground ahead of the view, and a subtle travel lead
    const fx = -Math.sin(this.yawS), fz = -Math.cos(this.yawS), rx = Math.cos(this.yawS), rz = -Math.sin(this.yawS);
    const v = sit.velocity ?? { x: 0, z: 0 }, sp = Math.hypot(v.x, v.z);
    const leadK = sit.aiming ? 0 : Math.min(1.4, sp * .22);
    const lx = sp > .1 ? v.x / sp * leadK : 0, lz = sp > .1 ? v.z / sp * leadK : 0;
    this.lead.x += (lx - this.lead.x) * damp(2.2, t); this.lead.z += (lz - this.lead.z) * damp(2.2, t);
    const ahead = sit.aiming ? 0 : .9;   // frame more of what is in front of the player
    let tx = sit.pivot.x + fx * ahead * (1 - close) + this.lead.x + rx * this.shoulderS, ty = sit.pivot.y + close * .28, tz = sit.pivot.z + fz * ahead + this.lead.z + rz * this.shoulderS;
    if (sit.focus && sit.focus.weight > 0) { const w = clamp(sit.focus.weight, 0, .45); tx += (sit.focus.point.x - tx) * w; ty += (sit.focus.point.y - ty) * w * .5; tz += (sit.focus.point.z - tz) * w; }
    // Target follows quickly (the body must never drift in frame), the lead slowly (stable).
    const tk = damp(18, t);
    this.target = { x: this.target.x + (tx - this.target.x) * tk, y: this.target.y + (ty - this.target.y) * tk, z: this.target.z + (tz - this.target.z) * tk };

    // ---- obstruction: shorten instantly, recover after the ray has stayed clear (no in/out popping)
    const cp = Math.cos(this.pitchS), back = { x: -fx * cp, y: Math.sin(this.pitchS), z: -fz * cp };
    const eye = { x: sit.pivot.x + rx * this.shoulderS, y: sit.pivot.y + .1, z: sit.pivot.z + rz * this.shoulderS };
    const clear = obstruct(eye, back, Math.max(want, this.dist) + .4);
    // Blocked well short of the wish: is the view clear from higher up (over a fence, cart, low roof)? Rise toward it.
    let riseWant = 0;
    if (clear < want * .7 && sit.ceiling == null) {
      const up = Math.min(CAMERA_LIMITS.maxPitch, this.pitchS + 16 * DEG), cu = Math.cos(up);
      const high = obstruct(eye, { x: -fx * cu, y: Math.sin(up), z: -fz * cu }, want + .4, true);
      if (high > clear + 1.2) riseWant = Math.min(16 * DEG, up - this.pitchS + this.rise);
    }
    // Low occluders (ruin walls, fences, carts) the camera clears but that still hide the body: keep the hips in view.
    if (!sit.aiming && sit.ceiling == null) {
      const hip = { x: sit.pivot.x, y: sit.pivot.y - .55, z: sit.pivot.z };
      const cx = eye.x + back.x * this.dist - hip.x, cy = eye.y + back.y * this.dist - hip.y, cz = eye.z + back.z * this.dist - hip.z, cl = Math.hypot(cx, cy, cz) || 1;
      if (obstruct(hip, { x: cx / cl, y: cy / cl, z: cz / cl }, cl, true) < cl - .5) riseWant = Math.max(riseWant, Math.min(18 * DEG, this.rise + 6 * DEG));
    }
    this.rise += (riseWant - this.rise) * damp(riseWant > this.rise ? 4 : 1.5, t);
    if (clear < this.limit - .02) { this.limit = clear; this.clearFor = 0; }
    else if (clear > this.limit + .3) { this.clearFor += t; if (this.clearFor > .18) this.limit += Math.min(clear - this.limit, (clear - this.limit) * damp(3, t) + t * .8); }
    else this.clearFor = 0;
    const goal = Math.max(1.1, Math.min(want, this.limit));
    this.dist = goal < this.dist ? goal : this.dist + (goal - this.dist) * damp(this.limit < want ? 3 : 4.5, t);

    let px = eye.x + back.x * this.dist, py = eye.y + back.y * this.dist, pz = eye.z + back.z * this.dist;
    const g = ground?.(px, pz); if (g != null && py < g + .45) py = g + .45;
    Object.assign(this.debug, { want: +want.toFixed(2), dist: +this.dist.toFixed(2), limit: +Math.min(99, this.limit).toFixed(2), pitchDeg: +(this.pitchS / DEG).toFixed(1), fovDeg: +(this.fovS / DEG).toFixed(1), reason });
    return { position: { x: px, y: py, z: pz }, target: this.target, fov: this.fovS };
  }
}

/**
 * Sphere-ish cast from point samples: march a few parallel rays (centre and four offsets of `radius`) and return
 * the nearest clear distance minus a margin. `blocked` answers whether a point is inside solid structure.
 */
export function marchObstruction(blocked: (x: number, y: number, z: number) => boolean, radius = .28, step = .22): ObstructionQuery {
  return (from, dir, max, single) => {
    if (single) { for (let d = step * 1.5; d < max; d += step * 1.5) if (blocked(from.x + dir.x * d, from.y + dir.y * d, from.z + dir.z * d)) return Math.max(0, d - step * 1.5); return max; }
    // Perpendicular basis for the offsets.
    const ux = -dir.z, uz = dir.x, ul = Math.hypot(ux, uz) || 1;
    const offs = [[0, 0, 0], [ux / ul * radius, 0, uz / ul * radius], [-ux / ul * radius, 0, -uz / ul * radius], [0, radius, 0], [0, -radius * .7, 0]];
    const hits = offs.map(([ox, oy, oz]) => {
      for (let d = step; d < max; d += step) if (blocked(from.x + ox + dir.x * d, from.y + oy + dir.y * d, from.z + oz + dir.z * d)) return d - step;
      return max;
    });
    // A thin post grazing one edge ray should not collapse the camera: the centre ray, or two edge rays, must agree.
    const edges = hits.slice(1).sort((a, b) => a - b);
    return Math.max(0, Math.min(hits[0], edges[1]) - .2);
  };
}
