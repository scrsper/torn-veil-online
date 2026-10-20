import { describe, expect, it } from 'vitest';
import { Matrix, MeshBuilder, NullEngine, Scene } from '@babylonjs/core';
import { chooseShadowCasters, shadowTriangleCount, universeLightState, UNIVERSE_SUN_DIRECTION } from '../../src/web/universe/lighting';

describe('spherical presentation lighting', () => {
  it('keeps atmospheric daylight, night and vacuum finite without camera direction input', () => {
    const s = UNIVERSE_SUN_DIRECTION;
    const day = universeLightState(s, 0, 500);
    const night = universeLightState({ x: -s.x, y: -s.y, z: -s.z }, 0, 500);
    expect(day.day).toBe(1); expect(day.stars).toBe(0);
    expect(night.day).toBe(0); expect(night.stars).toBe(1);
    expect(universeLightState(s, 500, 500)).toMatchObject({ air: 0, stars: 1, shadows: false });
    const a = universeLightState(s, 249.99, 500), b = universeLightState(s, 250.01, 500);
    expect(Math.abs(a.air - b.air)).toBeLessThan(.0001);
  });
  it('preserves ground lighting exactly and lifts only bounded existing fill at altitude', () => {
    const sun = UNIVERSE_SUN_DIRECTION;
    for (const radial of [sun, { x: -sun.x, y: -sun.y, z: -sun.z }]) {
      for (const atmosphere of [120, 300]) {
        for (const altitude of [0, 3, 40]) {
          const state = universeLightState(radial, altitude, atmosphere);
          expect(state.altitudeFill).toBe(0);
          expect(state.fillIntensity).toBe(.3 + .25 * state.air * state.day);
          expect(state.environmentIntensity).toBe(.2 + .3 * state.air * state.day);
        }
        let previous = 0;
        for (const altitude of [40, 50, 100, 200, 400, 5000]) {
          const state = universeLightState(radial, altitude, atmosphere);
          expect(state.altitudeFill).toBeGreaterThanOrEqual(previous);
          expect(state.fillIntensity - (.3 + .25 * state.air * state.day)).toBeLessThanOrEqual(.16000001);
          expect(state.environmentIntensity - (.2 + .3 * state.air * state.day)).toBeLessThanOrEqual(.14000001);
          previous = state.altitudeFill;
        }
        const space = universeLightState(radial, 5000, atmosphere);
        expect(space.fillIntensity).toBeCloseTo(.46); expect(space.environmentIntensity).toBeCloseTo(.34);
        expect(space.shadows).toBe(false); expect(space.stars).toBe(1);
      }
    }
  });
  it('prioritizes the hero, bounds total shadow work and ignores remote/oversized meshes', () => {
    const candidates = [
      { id: 1, distance: 1, triangles: 300000, priority: 0 },
      { id: 2, distance: 1, triangles: 2000, priority: 0 },
      { id: 3, distance: 2, triangles: 15000, priority: 1 },
      { id: 4, distance: 70, triangles: 20, priority: 0 },
      { id: 5, distance: 3, triangles: 2000, priority: 0 },
    ];
    expect(chooseShadowCasters(candidates, 2, 20000)).toEqual({ ids: [3, 2], triangles: 17000 });
    expect(chooseShadowCasters(candidates.slice().reverse(), 3, 18000)).toEqual({ ids: [3, 2], triangles: 17000 });
  });
  it('counts actual thin-instance triangle work while admitting only whole batches', () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const mesh = MeshBuilder.CreateBox('batched architecture', {}, scene);
    const instance = mesh.createInstance('ordinary instance');
    expect(shadowTriangleCount(instance)).toBe(12);
    instance.dispose();
    const transforms = new Float32Array(1000 * 16);
    for (let i = 0; i < 1000; i++) Matrix.Translation(i, 0, 0).copyToArray(transforms, i * 16);
    mesh.thinInstanceSetBuffer('matrix', transforms, 16, true);
    expect(mesh.getTotalIndices()).toBe(36); // Babylon's prototype count.
    expect(shadowTriangleCount(mesh)).toBe(12000);
    const candidates = [{ id: 1, distance: 0, triangles: shadowTriangleCount(mesh), priority: 0 },
      { id: 2, distance: 1, triangles: 100, priority: 1 }];
    expect(chooseShadowCasters(candidates, 2, 1000)).toEqual({ ids: [2], triangles: 100 });
    expect(chooseShadowCasters(candidates, 2, 12100)).toEqual({ ids: [2, 1], triangles: 12100 });
    scene.dispose(); engine.dispose();
  });
});
