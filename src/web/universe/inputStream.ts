import type { TravelInput } from '../../sim/world/universe/travel';
import type { UniverseInputReceipt } from '../../server/realmUniverseApi';

type Pending = { input: TravelInput; resolve: (ok: boolean) => void; reject: (error: Error) => void;
  receivedTimer: ReturnType<typeof setTimeout>; durableTimer: ReturnType<typeof setTimeout> };
const equal = (a: TravelInput, b: TravelInput) =>
  ['throttle','yaw','pitch','strafe','lift','brake'].every(k => a[k as keyof TravelInput] === b[k as keyof TravelInput]);

/** Provisional receipts release the input queue; structural intent must wait for
 * durable(). No client prediction or save mutation occurs in this transport. */
export class UniverseInputStream {
  private pending = new Map<number, Pending>();
  private waiters = new Set<{ seq: number; resolve: () => void; reject: (error: Error) => void }>();
  private lastSent = 0;
  private lastReceived = 0;
  private lastDurable = 0;
  private lastDurableInput: { seq: number; input: TravelInput } | null = null;
  private failure: string | null = null;
  private generation = 0;
  constructor(private readonly session: () => string,
    private readonly write: (value: unknown) => void,
    private readonly failed: (error: Error) => void,
    private readonly timeoutMs = 2500) {}

  get stats() { return structuredClone({ lastSent: this.lastSent, lastReceived: this.lastReceived,
    lastDurable: this.lastDurable, pending: this.pending.size, lastDurableInput: this.lastDurableInput,
    failure: this.failure, generation: this.generation }); }
  get saving() { return this.pending.size > 0; }

  reset(reason = 'Movement connection changed.') {
    this.generation++;
    const error = Error(reason);
    for (const p of this.pending.values()) { clearTimeout(p.receivedTimer); clearTimeout(p.durableTimer); p.reject(error); }
    for (const w of this.waiters) w.reject(error);
    this.pending.clear(); this.waiters.clear();
    this.lastSent = this.lastReceived = this.lastDurable = 0; this.lastDurableInput = null; this.failure = null;
  }
  private fail(error: Error) { this.reset(error.message); this.failure = error.message; this.failed(error); }

  send(seq: number, input: TravelInput): Promise<boolean> {
    if (this.failure) return Promise.reject(Error(this.failure));
    if (!this.session() || !Number.isSafeInteger(seq) || seq <= this.lastSent || this.pending.size >= 64)
      return Promise.reject(Error('Movement input cannot enter this owner stream.'));
    this.lastSent = seq;
    const promise = new Promise<boolean>((resolve, reject) => {
      const receivedTimer = setTimeout(() => this.fail(Error('Movement receipt timed out.')), this.timeoutMs);
      const durableTimer = setTimeout(() => this.fail(Error('Movement saving timed out.')), this.timeoutMs);
      this.pending.set(seq, { input: { ...input }, resolve, reject, receivedTimer, durableTimer });
    });
    try { this.write({ type: 'universe_input', sessionId: this.session(), seq, command: { type: 'input', input } }); }
    catch { this.fail(Error('Movement connection interrupted.')); }
    return promise;
  }

  receive(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const m = value as UniverseInputReceipt;
    if (m.type !== 'universe_input_receipt' || m.sessionId !== this.session()
      || !Number.isSafeInteger(m.seq) || !['received','durable','failed'].includes(m.phase)) return false;
    const p = this.pending.get(m.seq);
    if (!p) return false;
    if (!m.ok || m.phase === 'failed') { this.fail(Error(m.error ?? 'Movement was refused.')); return true; }
    if (!m.input || !equal(m.input, p.input)) { this.fail(Error('Movement receipt does not match the sent input.')); return true; }
    this.lastReceived = Math.max(this.lastReceived, m.seq);
    clearTimeout(p.receivedTimer); p.resolve(true);
    if (m.phase === 'durable') {
      this.lastDurable = Math.max(this.lastDurable, m.seq);
      this.lastDurableInput = { seq: m.seq, input: { ...m.input } };
      for (const [seq, sent] of this.pending) if (seq <= m.seq) {
        clearTimeout(sent.receivedTimer); clearTimeout(sent.durableTimer); sent.resolve(true); this.pending.delete(seq);
      }
      for (const w of this.waiters) if (w.seq <= this.lastDurable) { this.waiters.delete(w); w.resolve(); }
    }
    return true;
  }

  durable(): Promise<void> {
    if (this.failure) return Promise.reject(Error(this.failure));
    if (this.lastSent <= this.lastDurable) return Promise.resolve();
    return new Promise((resolve, reject) => this.waiters.add({ seq: this.lastSent, resolve, reject }));
  }
}
