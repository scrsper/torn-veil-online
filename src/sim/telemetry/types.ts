export interface TelemetryRecord {
  /** Wall-clock ms when this record was written (Date.now()) — useful for browser sessions
   * where world time and real time diverge; headless runs mostly care about `worldTick`. */
  t: number;
  worldTick: number;
  category: 'run' | 'cognition' | 'perception' | 'knowledge' | 'relationship' | 'conflict' | 'social' | 'institutional' | 'integrity' | 'metabolism' | 'logistics' | 'construction';
  type: string;
  data: Record<string, unknown>;
}

/** A telemetry destination. `write` must be cheap and must never throw in a way that could
 * disrupt simulation — recorder.ts wraps sink calls defensively. */
export interface TelemetrySink {
  write(record: TelemetryRecord): void;
  flush?(): void | Promise<void>;
  close?(): void | Promise<void>;
}
