import { describe, expect, it } from 'vitest';
import { MAX_HORIZON_SPEED, ORBIT_INPUT, SphericalOrbitCamera, type SphericalCameraInput } from '../../src/web/universe/camera';
import { dot, length, normalize, scale, sub, type V3 } from '../../src/sim/world/planet/planet';

const ground: SphericalCameraInput = { radial: { x: 0, y: 1, z: 0 }, forward: { x: 1, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 }, mode: 'ground' };
const separation = (a: V3, b: V3) => length(sub(a, b));
const settle = (camera: SphericalOrbitCamera, input = ground, seconds = 3) => {
  let pose = camera.update(1 / 60, input);
  for (let i = 1; i < seconds * 60; i++) pose = camera.update(1 / 60, input);
  return pose;
};
const finitePose = (value: unknown): void => {
  if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) finitePose(item);
};

describe('local spherical orbit camera', () => {
  it('consumes full pointer travel independent of event partition without changing host vectors', () => {
    const input = structuredClone(ground), saved = structuredClone(input);
    Object.freeze(input.radial); Object.freeze(input.forward); Object.freeze(input.velocity); Object.freeze(input);
    const once = new SphericalOrbitCamera(), split = new SphericalOrbitCamera();
    once.orbitPixels(640, 20);
    for (let i = 0; i < 64; i++) split.orbitPixels(10, .3125);
    const a = settle(once, input), b = settle(split, input);
    expect(separation(a.position, b.position)).toBeLessThan(1e-10);
    expect(once.yaw).toBeCloseTo(-2.56, 12);
    expect(input).toEqual(saved);
  });

  it('completes unrestricted horizontal revolutions and clamps only pitch and zoom', () => {
    const camera = new SphericalOrbitCamera(), initial = camera.update(1 / 60, ground);
    camera.orbitPixels(Math.PI * 2 / ORBIT_INPUT.yawPerPixel, 0);
    const returned = settle(camera);
    expect(separation(returned.position, initial.position)).toBeLessThan(1e-9);
    camera.orbitPixels(0, 1e6); camera.zoom(1e6);
    camera.zoom(1e6);
    expect(camera.pitch).toBe(ORBIT_INPUT.maxPitch);
    expect(camera.preferredDistance).toBe(ORBIT_INPUT.maxDistance);
    for (let i = 0; i < 4; i++) camera.zoom(-1e6);
    camera.orbitPixels(0, -1e6);
    expect(camera.preferredDistance).toBe(ORBIT_INPUT.minDistance);
    expect(camera.pitch).toBe(ORBIT_INPUT.minPitch);
    finitePose(settle(camera));
  });

  it('retains an eastward anatomical heading during vertical ascent and descent', () => {
    const camera = new SphericalOrbitCamera(); settle(camera);
    for (const sign of [1, -1]) {
      const pose = settle(camera, { ...ground, forward: scale(ground.radial, sign), mode: 'personal' });
      expect(dot(pose.tangentHeading, ground.forward)).toBeGreaterThan(.999999);
      expect(Math.abs(dot(pose.tangentHeading, ground.radial))).toBeLessThan(1e-10);
    }
  });

  it('transports the horizon smoothly through an antipodal nearest-world switch', () => {
    const camera = new SphericalOrbitCamera(); let previous = settle(camera);
    const other: SphericalCameraInput = { ...ground, radial: scale(ground.radial, -1), forward: scale(ground.radial, -1), mode: 'personal' };
    for (let i = 0; i < 180; i++) {
      const pose = camera.update(1 / 60, other);
      finitePose(pose);
      expect(dot(previous.up, pose.up)).toBeGreaterThan(.968); // <15°/frame for the worst 180° change.
      expect(Math.abs(dot(pose.up, normalize(sub(pose.target, pose.pivot))))).toBeLessThan(1e-8);
      expect(Math.abs(dot(pose.tangentHeading, other.radial))).toBeLessThan(1e-8);
      previous = pose;
    }
    expect(dot(previous.up, other.radial)).toBeGreaterThan(.999999);
    expect(dot(previous.tangentHeading, ground.forward)).toBeGreaterThan(.999999);
  });

  it('keeps a continuous transported frame across the north pole', () => {
    const camera = new SphericalOrbitCamera(); let previous = camera.update(1 / 60, ground);
    for (let i = -60; i <= 60; i++) {
      const a = i * .0005, radial = { x: 0, y: Math.cos(a), z: Math.sin(a) };
      const pose = camera.update(1 / 60, { ...ground, radial, forward: radial, mode: 'personal' });
      finitePose(pose);
      expect(dot(pose.tangentHeading, ground.forward)).toBeGreaterThan(.999999);
      expect(separation(pose.position, previous.position)).toBeLessThan(.25);
      previous = pose;
    }
  });

  it('bounds a fast smooth antipodal horizon turn at 90 degrees/s across irregular frames', () => {
    const camera = new SphericalOrbitCamera(); let previous = settle(camera);
    const other: SphericalCameraInput = { ...ground, radial: normalize({ x: .001, y: -1, z: 0 }), mode: 'personal' };
    let elapsed = 0, total = 0;
    for (const dt of [.005, .04, .05, .007, .1, .023, .08, .016]) {
      const pose = camera.update(dt, other);
      const changed = Math.acos(Math.max(-1, Math.min(1, dot(previous.up, pose.up))));
      expect(changed).toBeLessThanOrEqual(MAX_HORIZON_SPEED * dt + 1e-9);
      elapsed += dt; total += changed;
      if (elapsed <= .095 + 1e-10) expect(total).toBeLessThanOrEqual(MAX_HORIZON_SPEED * .095 + 1e-9);
      previous = pose;
    }
    expect(total).toBeCloseTo(MAX_HORIZON_SPEED * elapsed, 9);
    expect(camera.debug.maxHorizonSpeed).toBe(MAX_HORIZON_SPEED);
  });

  it('frames a full standing body above the bottom HUD at close ground zoom across an orbit', () => {
    const projectY = (point: V3, camera: ReturnType<SphericalOrbitCamera['update']>) => {
      const view = normalize(sub(camera.target, camera.position));
      const screenUp = normalize(sub(camera.up, scale(view, dot(camera.up, view))));
      const offset = sub(point, camera.position), depth = dot(offset, view);
      expect(depth).toBeGreaterThan(0);
      return .5 - dot(offset, screenUp) / (depth * Math.tan(camera.fov / 2)) * .5;
    };
    for (const distance of [3, 3.292869816564158]) for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const camera = new SphericalOrbitCamera(); camera.restore({ distance, yaw });
      const pose = settle(camera);
      // 1.9m tall envelope, with boot/stance spread around the host feet.
      // Reference coordinates are three metres above those feet.
      for (const x of [-.3, .3]) for (const z of [-.3, .3]) {
        expect(projectY({ x, y: -3, z }, pose)).toBeLessThan(.86);
        expect(projectY({ x, y: -1.1, z }, pose)).toBeGreaterThan(.1);
      }
      expect(camera.preferredDistance).toBe(distance);
      expect(camera.pitch).toBeCloseTo(28 * Math.PI / 180, 12);
    }
  });

  it('eases ground, personal-flight and vessel offsets instead of jumping on mode changes', () => {
    const camera = new SphericalOrbitCamera(), grounded = settle(camera);
    const personal: SphericalCameraInput = { ...ground, mode: 'personal', velocity: { x: 60, y: 0, z: 0 } };
    const first = camera.update(1 / 60, personal), airborne = settle(camera, personal);
    expect(separation(first.position, grounded.position)).toBeLessThan(.3);
    expect(separation(airborne.position, grounded.position)).toBeGreaterThan(1);
    const firstVessel = camera.update(1 / 60, { ...personal, mode: 'vessel' });
    expect(separation(firstVessel.position, airborne.position)).toBeLessThan(1.1);
    expect(firstVessel.fov).toBeGreaterThan(grounded.fov);
    const landed = camera.update(1 / 60, ground);
    expect(separation(landed.position, firstVessel.position)).toBeLessThan(.5);
  });

  it('keeps a raised-hand flight silhouette within the frame while limiting speed pullback', () => {
    for (const speed of [0, 60, 900]) for (const yaw of [0, Math.PI / 2, Math.PI]) {
      const camera = new SphericalOrbitCamera(); camera.restore({ distance: 6, yaw });
      const pose = settle(camera, { ...ground, mode: 'personal', velocity: { x: speed, y: 0, z: 0 } });
      expect(camera.debug.renderedDistance).toBeLessThanOrEqual(8.1 + 1e-8);
      const view = normalize(sub(pose.target, pose.position));
      const screenUp = normalize(sub(pose.up, scale(view, dot(pose.up, view))));
      for (const x of [-.4, .4]) for (const z of [-.4, .4]) for (const y of [-3, -.5]) {
        const offset = sub({ x, y, z }, pose.position), depth = dot(offset, view);
        const screenY = .5 - dot(offset, screenUp) / (depth * Math.tan(pose.fov / 2)) * .5;
        expect(screenY).toBeGreaterThan(.1); expect(screenY).toBeLessThan(.86);
      }
      expect(camera.preferredDistance).toBe(6);
    }
  });

  it('recenters behind the current tangent heading after an orbit and a character turn', () => {
    const camera = new SphericalOrbitCamera(); settle(camera);
    camera.orbitPixels(430, 0);
    const turned: SphericalCameraInput = { ...ground, forward: { x: 0, y: 0, z: -1 } };
    settle(camera, turned); camera.recenter();
    const pose = settle(camera, turned), offset = sub(pose.position, pose.pivot);
    const horizontal = normalize(sub(offset, scale(pose.up, dot(offset, pose.up))));
    expect(dot(horizontal, scale(turned.forward, -1))).toBeGreaterThan(.99999);
  });

  it('pulls inside an obstruction immediately and restores distance slowly after clearance', () => {
    const camera = new SphericalOrbitCamera(); settle(camera);
    let pose = camera.update(1 / 60, ground, () => 1.8);
    expect(separation(pose.position, pose.pivot)).toBeCloseTo(1.8, 10);
    for (let i = 0; i < 5; i++) pose = camera.update(1 / 60, ground, () => 6);
    expect(separation(pose.position, pose.pivot)).toBeCloseTo(1.8, 10);
    for (let i = 0; i < 180; i++) pose = camera.update(1 / 60, ground, () => 6);
    expect(separation(pose.position, pose.pivot)).toBeGreaterThan(5.99);
    camera.orbitPixels(300, 0);
    pose = camera.update(1 / 60, ground, () => .4);
    expect(separation(pose.position, pose.pivot)).toBeCloseTo(.4, 10);
  });

  it('retains a defined look direction at minimum zoom when wall clearance is zero', () => {
    const camera = new SphericalOrbitCamera(); camera.restore({ distance: 3 });
    for (const clearance of [0, 1e-10, 0]) {
      const pose = camera.update(1 / 60, ground, () => clearance);
      finitePose(pose);
      expect(separation(pose.position, pose.pivot)).toBeLessThanOrEqual(clearance + 1e-12);
      expect(separation(pose.target, pose.position)).toBeGreaterThan(.99);
      expect(dot(normalize(sub(pose.target, pose.position)), ground.forward)).toBeGreaterThan(.8);
      expect(camera.preferredDistance).toBe(3);
    }
  });

  it('uses elapsed time for horizon and distance easing at different render rates', () => {
    const run = (hz: number) => {
      const camera = new SphericalOrbitCamera(); camera.update(1 / hz, ground);
      const input: SphericalCameraInput = { ...ground, radial: { x: 0, y: 0, z: 1 }, mode: 'personal' };
      let result = camera.update(0, input);
      for (let i = 0; i < hz; i++) result = camera.update(1 / hz, input);
      return result;
    };
    const slow = run(30), fast = run(120);
    expect(separation(slow.up, fast.up)).toBeLessThan(1e-10);
    expect(separation(slow.position, fast.position)).toBeLessThan(.015);
  });

  it('restores only finite bounded local preferences and preserves them across camera resets', () => {
    const camera = new SphericalOrbitCamera();
    camera.restore({ yaw: Infinity, pitch: 500, distance: -3 });
    expect(camera.preferences()).toEqual({ yaw: 0, pitch: 28 * Math.PI / 180, distance: 6 });
    camera.restore({ yaw: 1.2, pitch: .5, distance: 9 });
    camera.orbitPixels(NaN, 0); camera.zoom(Infinity);
    camera.reset(); settle(camera);
    expect(camera.preferences()).toEqual({ yaw: 1.2, pitch: .5, distance: 9 });
    expect(camera.debug.renderedDistance).toBeCloseTo(9, 10);
  });
});
