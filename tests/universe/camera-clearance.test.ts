import { describe, expect, it } from 'vitest';
import { MeshBuilder, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { settlementCameraClearance } from '../../src/web/universe/settlements';

describe('settlement orbit lens clearance', () => {
  it('clips a wall beside the centre ray and restores full orbit range when the door opens', () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const wall = MeshBuilder.CreateBox('door edge', { width: .3, height: 3, depth: .3 }, scene);
    wall.position.set(.4, 0, -3); wall.metadata = { canonicalSettlement: 'test' }; wall.computeWorldMatrix(true);
    const pivot = Vector3.Zero(), desired = new Vector3(0, 0, -6);
    const actual = settlementCameraClearance(scene, pivot, desired);
    expect(actual.length()).toBeLessThan(2.6);
    expect(actual.x).toBe(0); expect(actual.y).toBe(0);
    wall.setEnabled(false);
    expect(settlementCameraClearance(scene, pivot, desired).asArray()).toEqual(desired.asArray());
    scene.dispose(); engine.dispose();
  });
  it('does not force a minimum distance through a nearby obstruction', () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const wall = MeshBuilder.CreateBox('close wall', { width: 3, height: 3, depth: .1 }, scene);
    wall.position.z = -.15; wall.metadata = { canonicalSettlement: 'test' }; wall.computeWorldMatrix(true);
    expect(settlementCameraClearance(scene, Vector3.Zero(), new Vector3(0, 0, -6)).length()).toBe(0);
    scene.dispose(); engine.dispose();
  });
});
