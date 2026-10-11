import { describe, expect, it } from 'vitest';
import { blocksView, type CutBox } from '../src/web/arena/cutaway';

describe('elevated Tower camera cutaway footprint', () => {
  const wall: CutBox = { x: 0, z: 0, yaw: 0, hx: .8, hz: 4 };
  it('cuts a crossing wall and keeps walls beside or behind the hero solid', () => {
    expect(blocksView({ x: -6, z: 0 }, { x: 3, z: 0 }, wall)).toBe(true);
    expect(blocksView({ x: -6, z: 6 }, { x: 3, z: 6 }, wall)).toBe(false);
    expect(blocksView({ x: -6, z: 0 }, { x: -2, z: 0 }, wall)).toBe(false);
    expect(blocksView({ x: -6, z: 0 }, { x: -.7, z: 0 }, wall)).toBe(false);
  });
  it('works throughout a full camera orbit around a rotated wall', () => {
    for (let i = 0; i < 32; i++) {
      const a = i * Math.PI / 16, c = Math.cos(a), s = Math.sin(a);
      const p = (x: number, z: number) => ({ x: x * c + z * s + 7, z: -x * s + z * c - 3 });
      const box = { ...wall, x: 7, z: -3, yaw: a };
      expect(blocksView(p(-6, 0), p(3, 0), box)).toBe(true);
      expect(blocksView(p(-6, 6), p(3, 6), box)).toBe(false);
    }
  });
  it('also fades a projecting sconce when its supporting wall cuts away', () => {
    const sconce = { ...wall, hx: 1.5 };
    for (const z of [-3.5, 0, 3.5]) {
      const cam = { x: -7, z }, hero = { x: 3, z };
      expect(blocksView(cam, hero, wall)).toBe(true);
      expect(blocksView(cam, hero, sconce)).toBe(true);
    }
  });
});
