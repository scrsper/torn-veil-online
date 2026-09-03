// Node-only. Import this ONLY from headless code (src/headless/**) — never from src/sim/**
// shared code or anything src/main.ts / src/game/** touches, so the browser bundle never
// pulls in node:fs.
import { createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { TelemetryRecord, TelemetrySink } from './types';

/** Appends one JSON object per line to a file, creating parent directories as needed.
 * Used by the headless runner to satisfy Part 3's ".debug/headless/" JSONL requirement. */
export class FileSink implements TelemetrySink {
  private stream: WriteStream | null = null;
  private ready: Promise<void>;
  private pending: string[] = [];
  constructor(private path: string) {
    this.ready = mkdir(dirname(path), { recursive: true }).then(() => {
      this.stream = createWriteStream(path, { flags: 'a' });
      for (const line of this.pending) this.stream.write(line);
      this.pending = [];
    });
  }
  write(r: TelemetryRecord): void {
    const line = JSON.stringify(r) + '\n';
    if (this.stream) this.stream.write(line); else this.pending.push(line);
  }
  async close(): Promise<void> {
    await this.ready;
    await new Promise<void>((resolve, reject) => { if (!this.stream) return resolve(); this.stream.end((err: Error | null | undefined) => (err ? reject(err) : resolve())); });
  }
}
