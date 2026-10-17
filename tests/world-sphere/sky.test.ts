import { describe, expect, it } from 'vitest';
import { DAY_SECONDS, HOME_ANCHOR, START_HOUR, LUNAR_DAYS, lightAt, localHour, skyAt, tangentFrame, dot } from '../../src/sim/world/planet';

const at = (hour: number, day = 0) => skyAt(((day * 24 + hour - START_HOUR + 24) % (24 * 1000)) / 24 * DAY_SECONDS);
describe('sun, moon and day/night clock', () => {
  it('is a pure function of simulation seconds', () => {
    expect(skyAt(12345.5)).toEqual(skyAt(12345.5));
    expect(skyAt(0).hour).toBeCloseTo(START_HOUR, 9);
  });
  it('puts the sun up at home noon and down at midnight', () => {
    const noon = lightAt(at(12), HOME_ANCHOR), night = lightAt(at(24), HOME_ANCHOR);
    expect(noon.sunElevation).toBeGreaterThan(.6); expect(noon.sunIntensity).toBeGreaterThan(1);
    expect(night.sunElevation).toBeLessThan(-.5); expect(night.sunIntensity).toBe(0); expect(night.stars).toBeGreaterThan(.9);
    expect(noon.daylight).toBeGreaterThan(.99);
  });
  it('rises in the east and sets in the west', () => {
    const f = tangentFrame(HOME_ANCHOR);
    expect(dot(at(7).sun, f.east)).toBeGreaterThan(.5);
    expect(dot(at(17).sun, f.east)).toBeLessThan(-.5);
  });
  it('lights the night with the moon, scaled by its phase', () => {
    let full = 0, newMoon = 1;
    for (let d = 0; d < LUNAR_DAYS; d++) for (let h = 0; h < 24; h += .5) {
      const s = at(h, d), l = lightAt(s, HOME_ANCHOR);
      if (l.sunElevation < -.3 && l.moonElevation > .3) full = Math.max(full, l.moonIntensity);
      newMoon = Math.min(newMoon, s.moonIllumination);
    }
    expect(full).toBeGreaterThan(.3); expect(newMoon).toBeLessThan(.05);
  });
  it('reports local solar time by longitude', () => {
    expect(localHour(at(12), 0)).toBeCloseTo(12, 6);
    expect(localHour(at(12), 90)).toBeCloseTo(18, 6);
  });
});
