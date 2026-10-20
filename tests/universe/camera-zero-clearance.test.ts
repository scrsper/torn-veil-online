import { describe, expect, it } from 'vitest';
import { FreeCamera, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { SphericalOrbitCamera } from '../../src/web/universe/camera';

describe('fully retracted Babylon orbit camera', () => {
  it('keeps the actual view matrix finite and invertible after restoring minimum zoom beside a wall', () => {
    const engine = new NullEngine(), scene = new Scene(engine); scene.useRightHandedSystem = true;
    const lens = new FreeCamera('lens', Vector3.Zero(), scene); lens.inputs.clear();
    try {
      for (const up of [Vector3.Up(), new Vector3(.1, .4, .9).normalize()]) {
        const forward = Vector3.Cross(up, Vector3.Right()).normalize();
        const orbit = new SphericalOrbitCamera(); orbit.restore({ distance: 3 });
        for (const clearance of [0, 0, 1e-10, 0, 6]) {
          const pose = orbit.update(1 / 60, { radial: up, forward, velocity: Vector3.Zero(), mode: 'ground' }, () => clearance);
          lens.upVector.copyFromFloats(pose.up.x, pose.up.y, pose.up.z);
          lens.position.copyFromFloats(pose.position.x, pose.position.y, pose.position.z);
          lens.setTarget(new Vector3(pose.target.x, pose.target.y, pose.target.z));
          const view = lens.getViewMatrix(true);
          expect(Array.from(view.asArray()).every(Number.isFinite)).toBe(true);
          expect(Math.abs(view.determinant())).toBeGreaterThan(.99);
          expect(Vector3.Distance(lens.position, lens.getTarget())).toBeGreaterThan(.99);
          expect(orbit.debug.renderedDistance).toBeLessThanOrEqual(clearance);
        }
      }
    } finally { scene.dispose(); engine.dispose(); }
  });
});
