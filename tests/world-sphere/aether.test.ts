import { describe, expect, it } from 'vitest';
import { AETHER_CHART, FAR_ANCHOR, aetherBlocks, aetherChunks, planetSpec, realmToPlanet } from '../../src/sim/world/planet';

const spec = planetSpec(20261017);
const at = (gx: number, gz: number) => realmToPlanet(spec, AETHER_CHART, gx - 3072, 1, gz - 3072);

describe('Aether Reach on the far plateau', () => {
  it('is the canonical seeded realm city, without its own Tower building', () => {
    const a = aetherChunks(spec.seed), b = aetherChunks(spec.seed);
    expect(a).toHaveLength(9);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.flatMap(c => c.buildings).some(x => x.use === 'tower')).toBe(false);
    expect(a.flatMap(c => c.buildings).length).toBeGreaterThan(10);
  });
  it('building solids block the walker; streets and the far side of the world do not', () => {
    const b = aetherChunks(spec.seed).flatMap(c => c.buildings).find(x => x.solids.some(s => s.y <= 1.5 && s.y + s.h >= 2.5 && s.w >= 1 && s.d >= 1))!;
    const s = b.solids.find(s => s.y <= 1.5 && s.y + s.h >= 2.5 && s.w >= 1 && s.d >= 1)!;
    expect(aetherBlocks(spec, at(s.x + s.w / 2, s.z + s.d / 2))).toBe(true);
    const plaza = realmToPlanet(spec, AETHER_CHART, 48, 1, 48);
    expect(aetherBlocks(spec, plaza)).toBe(false);
    expect(aetherBlocks(spec, { x: -FAR_ANCHOR.x * 1606, y: -FAR_ANCHOR.y * 1606, z: -FAR_ANCHOR.z * 1606 })).toBe(false);
  });
});
