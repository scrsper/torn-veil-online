import { describe, expect, it } from 'vitest';
import { FixedRateWindow } from '../src/bridge/rateWindow';

describe('bridge receive-time rate windows', () => {
  it('starts a fresh window on the next received message after elapsed time, without a timer', () => {
    const limiter = new FixedRateWindow(2, 100);
    expect(limiter.consume(100).allowed).toBe(true);
    expect(limiter.consume(500).allowed).toBe(true);
    const next = limiter.consume(1_101);
    expect(next.reset).toBe(true);
    expect(next.count).toBe(1);
    expect(next.allowed).toBe(true);
  });

  it('rejects a true burst within one fixed window', () => {
    const limiter = new FixedRateWindow(2, 0);
    expect(limiter.consume(1).allowed).toBe(true);
    expect(limiter.consume(2).allowed).toBe(true);
    const rejected = limiter.consume(3);
    expect(rejected.reset).toBe(false);
    expect(rejected.count).toBe(3);
    expect(rejected.allowed).toBe(false);
  });
});
