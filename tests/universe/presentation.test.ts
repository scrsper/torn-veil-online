import { describe, expect, it } from 'vitest';
import { Matrix, Vector3 } from '@babylonjs/core';
import { avatarRotation } from '../../src/web/universe/avatar';
import { vesselLocation } from '../../src/web/universe/vessel';
import { buildTerrainTile } from '../../src/web/universe/terrain';
import { createTravelState } from '../../src/sim/world/universe/travel';
import { generateSystem, terrainHeight, universeSpec } from '../../src/sim/world/universe/generation';

describe('universe presentation coordinates', () => {
  it('keeps the shared -Z-facing hero upright with proper rotations, including vertical flight', () => {
    for (const up of [Vector3.Up(), Vector3.Down(), Vector3.Right(), new Vector3(.2, .3, .9).normalize()]) {
      for (const forward of [Vector3.Forward(true), up, up.scale(-1)]) {
        const q = avatarRotation(forward, up), matrix = Matrix.Identity(); q.toRotationMatrix(matrix);
        expect(matrix.determinant()).toBeCloseTo(1, 6); // Babylon stores matrix entries as float32.
        expect(Vector3.Distance(Vector3.Up().applyRotationQuaternion(q), up)).toBeLessThan(1e-6);
        const facing = Vector3.Forward(true).applyRotationQuaternion(q);
        expect(Math.abs(Vector3.Dot(facing, up))).toBeLessThan(1e-6);
        const tangent = forward.subtract(up.scale(Vector3.Dot(up, forward)));
        if (tangent.lengthSquared() > 1e-8) expect(Vector3.Dot(facing, tangent.normalize())).toBeCloseTo(1, 6);
      }
    }
  });

  it('keeps the vessel parked while the body flies and handles a landing without a local vessel', () => {
    const spec = universeSpec(442), state = createTravelState(spec), before = structuredClone(state.landedVesselPosition!);
    state.parkedVessel = { systemIndex: 0, planetId: state.landedPlanetId!, position: before };
    state.mode = 'flight'; state.position = { x: 9000, y: 7000, z: -500 };
    state.personalFlight = { version: 1, bodyId: 'same-body', phase: 'powered', manaSpent: 0, effortSpent: 0 };
    state.landedPlanetId = null; state.landedVesselPosition = null;
    expect(vesselLocation(state)?.position).toEqual(before);
    expect(vesselLocation(state)?.piloting).toBe(false);
    state.mode = 'surface'; delete state.personalFlight;
    state.landedPlanetId = generateSystem(spec, 0).planets[1].id;
    expect(vesselLocation(state)?.position).toEqual(before);
    state.systemIndex = 1;
    expect(vesselLocation(state)).toBeNull();
  });

  it('lowers only the presentation underlay while leaving canonical relief unchanged', () => {
    const planet = generateSystem(universeSpec(442), 0).planets[0], tile = { face: 4, level: 0, x: 0, y: 0 };
    const canonical = buildTerrainTile(planet, tile, 4);
    const lowered = buildTerrainTile(planet, tile, 4, (p, d) => terrainHeight(p, d) - .4);
    for (let i = 0; i < canonical.surfaceVertices * 3; i += 3) {
      const radius = (a: number[]) => Math.hypot(a[i], a[i + 1], a[i + 2]);
      expect(radius(canonical.positions) - radius(lowered.positions)).toBeCloseTo(.4, 8);
    }
    expect(buildTerrainTile(planet, tile, 4).positions).toEqual(canonical.positions);
    expect(lowered.colors).toEqual(canonical.colors);
  });
});
