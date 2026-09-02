/**
 * Time in Infinite RPG is layered:
 *  - Real time: the wall clock of the observer running the renderer.
 *  - Physical time: how fast bodies move through space. Runs at (real dt * speedMultiplier).
 *  - World (calendar) time: the world's own clock. Runs at physical time * TIME_SCALE.
 *    Schedules, needs, history and events are stamped in world seconds.
 *  - Subjective time: each mind carries a `timeRate`; its cognition budget accumulates at
 *    physical dt * timeRate, so a being with timeRate 100 thinks 100x more often than a human.
 */
export const SECONDS_PER_MINUTE = 60;
export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;
export const SECONDS_PER_DAY = SECONDS_PER_HOUR * HOURS_PER_DAY;
export const DEFAULT_TIME_SCALE = 60; // 1 real second = 1 world minute => a day is 24 real minutes

export interface ClockState { worldSeconds: number; timeScale: number; }

export class WorldClock {
  worldSeconds: number;
  timeScale: number;
  speedMultiplier = 1;   // fast-forward for both physical and world time
  paused = false;
  constructor(state?: Partial<ClockState>) {
    this.worldSeconds = state?.worldSeconds ?? SECONDS_PER_DAY * 100 + 7 * SECONDS_PER_HOUR + 20 * 60;
    this.timeScale = state?.timeScale ?? DEFAULT_TIME_SCALE;
  }
  /** Advance by a physical dt (seconds already multiplied by speed). Returns world dt. */
  advance(physicalDt: number): number { const w = physicalDt * this.timeScale; this.worldSeconds += w; return w; }
  get day(): number { return Math.floor(this.worldSeconds / SECONDS_PER_DAY); }
  get hour(): number { return Math.floor((this.worldSeconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR); }
  get minute(): number { return Math.floor((this.worldSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE); }
  /** Fractional hour of day 0..24 */
  get hourF(): number { return (this.worldSeconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR; }
  /** 0..1 fraction of day */
  get dayFraction(): number { return (this.worldSeconds % SECONDS_PER_DAY) / SECONDS_PER_DAY; }
  state(): ClockState { return { worldSeconds: this.worldSeconds, timeScale: this.timeScale }; }
}

export function formatWorldTime(seconds: number): string {
  const day = Math.floor(seconds / SECONDS_PER_DAY);
  const h = Math.floor((seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  const m = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  return `Day ${day} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
export function formatRelativeTime(seconds: number, now: number): string {
  const d = now - seconds;
  if (d < 0) return 'in the future';
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < SECONDS_PER_HOUR) return `${Math.floor(d / 60)}m ago`;
  if (d < SECONDS_PER_DAY) return `${(d / SECONDS_PER_HOUR).toFixed(1)}h ago`;
  if (d < SECONDS_PER_DAY * 60) return `${Math.floor(d / SECONDS_PER_DAY)}d ago`;
  return `${Math.floor(d / (SECONDS_PER_DAY * 365))}y ${Math.floor((d % (SECONDS_PER_DAY * 365)) / SECONDS_PER_DAY)}d ago`;
}
