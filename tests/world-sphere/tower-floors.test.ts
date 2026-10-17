import { describe, expect, it } from 'vitest';
import { TOWER_FLOORS, floorPlan, floorSignature, floorTheme, towerFloorSpec } from '../../src/sim/world/interiors/floorSpec';
import { interiorVoxel } from '../../src/sim/world/interiors/layout';
import { towerEncounter } from '../../src/sim/progression/towerEncounters';
import { towerTheme } from '../../src/web/realms/towerThemes';
import { realmSeed } from '../../src/sim/world/realms/layout';

const seed = realmSeed(20261017, 'canonical-tower');
const floors = Array.from({ length: TOWER_FLOORS }, (_, i) => i + 1);
/** Voxel flood fill at standing height: a 1.75 m body needs y=1 and y=2 open. */
function reachable(floor: number): boolean {
  const p = floorPlan(seed, floor), open = (x: number, z: number) => interiorVoxel(p, x, 1, z) === 0 && interiorVoxel(p, x, 2, z) === 0;
  const sx = Math.floor(p.start.x), sz = Math.floor(p.start.z), ex = Math.floor(p.exit.x), ez = Math.floor(p.exit.z);
  if (!open(sx, sz) || !open(ex, ez)) return false;
  const seen = new Set([`${sx},${sz}`]), queue = [[sx, sz]];
  while (queue.length) {
    const [x, z] = queue.pop()!;
    if (x === ex && z === ez) return true;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + dx},${z + dz}`; if (seen.has(k) || !open(x + dx, z + dz)) continue; seen.add(k); queue.push([x + dx, z + dz]);
    }
  }
  return false;
}

describe('the hundred Tower floors', () => {
  it('derives every floor deterministically from seed + floor', () => {
    for (const f of [1, 10, 37, 100]) expect(towerFloorSpec(seed, f)).toEqual(towerFloorSpec(seed, f));
    expect(() => towerFloorSpec(seed, 0)).toThrow(); expect(() => towerFloorSpec(seed, 101)).toThrow();
  });
  it('makes all 100 floors structurally distinct', () => {
    expect(new Set(floors.map(f => floorSignature(seed, f))).size).toBe(100);
  });
  it('keeps every floor traversable from entrance to stair', () => {
    for (const f of floors) expect(reachable(f), `floor ${f}`).toBe(true);
  });
  it('follows the existing gating, encounter and reward mechanics', () => {
    const specs = floors.map(f => towerFloorSpec(seed, f));
    expect(specs[0].gate).toEqual({ previousFloor: null, stage: null });
    expect(specs.slice(1).every((s, i) => s.gate.previousFloor === i + 1)).toBe(true);
    expect(specs[99].gate.stage).toBe('Silver');
    expect(specs.every(s => s.encounter.enemies === towerEncounter(s.floor).enemies && s.wardens.length === s.encounter.enemies)).toBe(true);
    expect(specs.filter(s => s.rewardKinds.includes('boon')).map(s => s.floor)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(specs.filter(s => s.rewardKinds.includes('trial')).map(s => s.floor)).toEqual([10]);
    expect(specs.filter(s => s.rest).map(s => s.floor)).toEqual([1, 11, 21, 31, 41, 51, 61, 71, 81, 91]);
    expect(specs.filter(s => s.layout.arena).length).toBe(20);
    expect(specs[0].startingSources).toBe(true); expect(specs.filter(s => s.startingSources)).toHaveLength(1);
    expect(specs[9].tierOnClear).toBe('Iron'); expect(specs[29].tierOnClear).toBe('Bronze'); expect(specs[64].tierOnClear).toBe('Silver');
    expect(specs[1].wardens).toContain('skirmisher'); expect(specs[4].wardens).toContain('caster'); expect(specs[9].wardens).toContain('heavy');
  });
  it('matches the presentation theme bands', () => {
    const names = { stone: 'Stone sanctum', aether: 'Aether archive', brass: 'Brass foundry' };
    for (const f of floors) expect(names[floorTheme(seed, f)]).toBe(towerTheme(f, seed).name);
  });
  it('dresses floors from the library module set without blocking routes', () => {
    for (const f of [1, 15, 50, 99, 100]) {
      const s = towerFloorSpec(seed, f);
      expect(s.dressing.length).toBeGreaterThan(3);
      expect(s.dressing.every(d => d.moduleId.startsWith('module:'))).toBe(true);
    }
  });
});
