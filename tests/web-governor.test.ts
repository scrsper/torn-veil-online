import { describe, expect, it } from 'vitest';
import { QualityGovernor, SCALE_STEPS } from '../src/web/render/governor';

describe('quality governor', () => {
  it('does nothing while frames are on budget, whatever the tier', () => {
    const g = new QualityGovernor();
    for (let t = 0; t < 60_000; t += 2000) expect(g.evaluate(6.9, 9, t, 'balanced')).toBeNull();
  });
  it('needs sustained slowness, not one bad window', () => {
    const g = new QualityGovernor();
    expect(g.evaluate(30, 60, 10_000, 'balanced')).toBeNull();
    expect(g.evaluate(8, 10, 12_000, 'balanced')).toBeNull();
    expect(g.evaluate(30, 60, 14_000, 'balanced')).toBeNull();
    expect(g.evaluate(30, 60, 16_000, 'balanced')).toBeNull();
  });
  it('steps down one tier after three slow windows, then waits for the change to settle', () => {
    const g = new QualityGovernor();
    const times = [10_000, 12_000, 14_000];
    expect(g.evaluate(30, 60, times[0], 'high')).toBeNull(); expect(g.evaluate(30, 60, times[1], 'high')).toBeNull();
    expect(g.evaluate(30, 60, times[2], 'high')).toEqual({ tier: 'balanced' });
    expect(g.evaluate(30, 60, 16_000, 'balanced')).toBeNull();     // settling: no immediate second step
    expect(g.evaluate(30, 60, 18_000, 'balanced')).toBeNull();
  });
  it('once on the cheapest tier it lowers the render scale, in order, and then stops', () => {
    const g = new QualityGovernor(0, 1);   // no settle time, one slow window
    const out: unknown[] = [];
    for (let i = 0; i < 8; i++) out.push(g.evaluate(40, 90, i * 2000, 'low'));
    expect(out.filter(Boolean)).toEqual(SCALE_STEPS.map(scale => ({ scale })));
    expect(out.slice(SCALE_STEPS.length).every(x => x === null)).toBe(true);
  });
  it('never steps up by itself', () => {
    const g = new QualityGovernor(0, 1);
    for (let t = 0; t < 600_000; t += 2000) { const a = g.evaluate(3, 4, t, 'low'); expect(a).toBeNull(); }
  });
  it('a player-chosen quality resets its history', () => {
    const g = new QualityGovernor();
    g.evaluate(30, 60, 10_000, 'high'); g.evaluate(30, 60, 12_000, 'high');
    g.reset(13_000);
    expect(g.evaluate(30, 60, 30_000, 'high')).toBeNull();          // only one slow window since the reset
  });
});
