import { Worker } from 'node:worker_threads';

/** One bounded worker per service. The caller captures JSON synchronously; only lossless storage
 * packing runs concurrently. A failed worker rejects the checkpoint, leaving CURRENT untouched. */
export class CheckpointEncoder {
  private worker?: Worker;
  private failure?: Error;
  private closed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: { resolve: (value: { bytes: Buffer; encodeMs: number }) => void; reject: (error: Error) => void };
  encode(snapshot: string): Promise<{ bytes: Buffer; encodeMs: number }> {
    if (this.closed || this.failure) throw this.failure ?? new Error('Checkpoint encoder closed');
    if (this.pending) throw new Error('Checkpoint encoding already in flight');
    if (!this.worker) {
      const source = import.meta.url.endsWith('.ts');
      this.worker = new Worker(new URL(source ? './checkpointWorker.ts' : './checkpointWorker.mjs', import.meta.url), {
        execArgv: source ? ['--import', 'tsx'] : [],
      });
      this.worker.on('message', value => {
        clearTimeout(this.timer);
        const pending = this.pending; this.pending = undefined;
        if (!pending) return;
        if (value.error) pending.reject(new Error(value.error));
        else pending.resolve({ bytes: Buffer.from(value.bytes.buffer, value.bytes.byteOffset, value.bytes.byteLength), encodeMs: value.encodeMs });
      });
      const fail = (error: Error) => { clearTimeout(this.timer); this.failure = error; const pending = this.pending; this.pending = undefined; pending?.reject(error); };
      this.worker.on('error', fail);
      this.worker.on('exit', code => { this.worker = undefined; fail(new Error(`Checkpoint encoder exited (${code})`)); });
    }
    // TextEncoder produces a dedicated transferable allocation, including for tiny snapshots.
    // Include this UTF-8 capture/copy in the caller's blocking serialization metric.
    const bytes = new TextEncoder().encode(snapshot);
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.timer = setTimeout(() => {
        this.failure = new Error('Checkpoint encoding exceeded 60 seconds');
        this.pending = undefined; reject(this.failure); void this.worker?.terminate();
      }, 60_000);
      try { this.worker!.postMessage(bytes, [bytes.buffer]); }
      catch (error) { clearTimeout(this.timer); this.pending = undefined; reject(error as Error); }
    });
  }
  async close(): Promise<void> { this.closed = true; await this.worker?.terminate(); }
}
