export interface RateWindowResult {
  allowed: boolean;
  count: number;
  windowMs: number;
  reset: boolean;
}

/** Receive-time fixed window; no timer or event-loop callback is required. */
export class FixedRateWindow {
  private windowAt: number;
  private count = 0;

  constructor(private readonly limit: number, now: number, private readonly durationMs = 1000) {
    this.windowAt = now;
  }

  consume(now: number): RateWindowResult {
    const elapsed = now - this.windowAt;
    const reset = elapsed >= this.durationMs;
    if (reset) {
      this.windowAt = now;
      this.count = 0;
    }
    const count = ++this.count;
    return { allowed: count <= this.limit, count, windowMs: Math.max(0, now - this.windowAt), reset };
  }
}
