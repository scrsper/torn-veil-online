import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RealmSession } from '../sim/world/realms/session';
import type { RealmOperation } from './realmRuntime';
import { canonicalUniverseView } from './canonicalUniverse';
import { canonicalSettlementProjection } from './universeSettlements';
import { parseUniverseCommand, type TravelInput } from '../sim/world/universe/travel';

export interface UniverseInputReceipt {
  type: 'universe_input_receipt'; phase: 'received' | 'durable' | 'failed';
  sessionId: string; seq: number; ok: boolean; input?: TravelInput; error?: string;
}

interface Host {
  session(): RealmSession;
  token(): string;
  ready(): boolean;
  apply(operation: RealmOperation): any;
  persist(): Promise<void>;
}

/** The realm host's existing controller and journal own this route. No second save,
 * independently stepped World, client checkpoint, or path-selected import exists. */
export class RealmUniverseApi {
  busy = false;
  private epoch = { token: '', lastSeq: 0, durableSeq: 0, pending: 0 };
  constructor(private readonly host: Host, private readonly port: number) {}

  /** Contact is produced by a tick after the land intent. Publish the landed
   * discovery only after that tick's journal batch has reached durable storage. */
  async persistOutcome(): Promise<void> {
    if (this.busy || !this.host.ready()) return;
    this.busy = true;
    try { await this.host.persist(); }
    catch { /* the host's persistence fence closes control and preserves the tail */ }
    finally { this.busy = false; }
  }

  private current() {
    const token = this.host.token();
    if (token !== this.epoch.token) this.epoch = { token, lastSeq: 0, durableSeq: 0, pending: 0 };
    return this.epoch;
  }
  private view() {
    const epoch = this.current(), token = epoch.token;
    const view = canonicalUniverseView(this.host.session());
    return { ...view, snapshot: view.snapshot ? { ...view.snapshot, sessionId: token,
      lastSeq: epoch.lastSeq, durableSeq: epoch.durableSeq } : null };
  }

  /** The existing owner socket admits input in journal order without pausing
   * simulation for disk I/O. Received is provisional; only durable acknowledges
   * storage. Structural HTTP commands remain behind the durable input barrier. */
  receiveInput(token: string, value: unknown, send: (receipt: UniverseInputReceipt) => void): void {
    const v = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const seq = Number.isSafeInteger(v.seq) && Number(v.seq) > 0 ? Number(v.seq) : 0;
    const emit = (receipt: UniverseInputReceipt) => { try { send(receipt); } catch { /* socket disposal cannot cancel journal persistence */ } };
    const reject = (error: string) => emit({ type: 'universe_input_receipt', phase: 'received', sessionId: token, seq, ok: false, error });
    if (!token || token !== this.host.token() || !this.host.ready()) { reject('World controller changed or saving failed.'); return; }
    const epoch = this.current();
    if (v.sessionId !== token || !seq || seq <= epoch.lastSeq) { reject('Stale input sequence or session.'); return; }
    if (this.busy || epoch.pending >= 64) { reject('Input admission is blocked by a crossing or persistence backlog.'); return; }
    let command;
    try { command = parseUniverseCommand(v.command); }
    catch { reject('Invalid movement input.'); return; }
    if (command.type !== 'input') { reject('Only movement input uses this stream.'); return; }
    try {
      const result = this.host.apply({ type: 'universe_travel', command });
      epoch.lastSeq = seq; epoch.pending++;
      const error = result?.error ?? result?.value?.error;
      const receipt = { type: 'universe_input_receipt' as const, sessionId: token, seq,
        ok: !error, input: command.input, ...(error ? { error: String(error) } : {}) };
      emit({ ...receipt, phase: 'received' });
      void (async () => {
        try {
          await this.host.persist();
          if (this.epoch !== epoch || this.host.token() !== token) return;
          if (!this.host.ready()) { emit({ ...receipt, phase: 'failed', ok: false, error: 'Saving failed. Movement is not acknowledged as durable.' }); return; }
          epoch.durableSeq = Math.max(epoch.durableSeq, seq);
          emit({ ...receipt, phase: 'durable' });
        } catch {
          if (this.epoch === epoch && this.host.token() === token)
            emit({ ...receipt, phase: 'failed', ok: false, error: 'Saving failed. Movement is not acknowledged as durable.' });
        } finally { epoch.pending--; }
      })();
    } catch { reject('Movement could not enter the journal.'); }
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (!['/realms/universe', '/realms/universe/command', '/realms/universe/transition', '/realms/universe/settlements'].includes(path)) return false;
    const respond = (code: number, value: unknown, condition?: 'saving-crossing') => {
      res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store',
        ...(condition ? { 'x-tv-universe-condition': condition } : {}) });
      res.end(JSON.stringify(value));
    };
    if (!this.host.ready()) { respond(503, { error: 'Saving or simulation failed. Restart the world to recover its durable journal.' }); return true; }
    const token = this.host.token();
    if (!token || req.headers['x-realms-controller'] !== token) { respond(409, { error: 'This tab does not hold the world controller. Close the other play tab, then reconnect.' }); return true; }
    if (req.method === 'GET' && path === '/realms/universe/settlements') {
      if (this.busy) respond(503, { error: 'Saving the crossing. Try again shortly.' }, 'saving-crossing');
      else respond(200, canonicalSettlementProjection(this.host.session()));
      return true;
    }
    if (req.method === 'GET' && path === '/realms/universe') {
      if (this.busy) respond(503, { error: 'Saving the crossing. Try again shortly.' }, 'saving-crossing');
      else respond(200, this.view());
      return true;
    }
    if (req.method !== 'POST' || !['/realms/universe/command', '/realms/universe/transition'].includes(path)
      || ![`http://127.0.0.1:${this.port}`, `http://localhost:${this.port}`].includes(req.headers.origin ?? '')
      || req.headers['content-type'] !== 'application/json') {
      respond(403, { error: 'Same-origin JSON command required.' }); return true;
    }
    const parts: Buffer[] = []; let bytes = 0;
    try {
      for await (const part of req) {
        const buffer = Buffer.from(part); bytes += buffer.length;
        if (bytes > 8192) { respond(413, { error: 'Universe command exceeds supported size.' }); return true; }
        parts.push(buffer);
      }
      // Reading a request body yields. Recheck both ownership and the persistence
      // fence before mutating the World, even if authorization was valid at arrival.
      if (token !== this.host.token() || !this.host.ready()) { respond(409, { error: 'World controller changed. Reload before continuing.' }); return true; }
      const epoch = this.current();
      if (this.busy || epoch.pending) { respond(409, { error: 'A crossing or movement is being saved. Try again shortly.' }); return true; }
      const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) { respond(400, { error: 'Invalid universe command.' }); return true; }
      this.view();
      if (path.endsWith('/command')) {
        if (value.sessionId !== token || !Number.isSafeInteger(value.seq) || value.seq <= epoch.lastSeq) {
          respond(409, { ok: false, error: 'Stale command sequence or session.', ...this.view() }); return true;
        }
        epoch.lastSeq = value.seq;
      }
      this.busy = true;
      try {
        const result = this.host.apply(path.endsWith('/command')
          ? { type: 'universe_travel', command: value.command }
          : { type: 'universe', command: value });
        const error = result?.error ?? result?.value?.error;
        const reply = { ok: !error, ...(error ? { error } : {}), ...this.view() };
        const committedSeq = epoch.lastSeq;
        // The scheduler pauses while this exact result is becoming durable. Never
        // acknowledge a transition using a later, uncommitted simulation snapshot.
        await this.host.persist();
        if (!this.host.ready()) { respond(503, { error: 'Saving failed. World paused for durable recovery.' }); return true; }
        if (token !== this.host.token()) { respond(409, { error: 'World controller changed while saving. Reconnect to inspect the durable result.' }); return true; }
        epoch.durableSeq = Math.max(epoch.durableSeq, committedSeq);
        if (reply.snapshot) reply.snapshot.durableSeq = committedSeq;
        respond(error ? 409 : 200, reply);
      } finally { this.busy = false; }
    } catch {
      respond(this.host.ready() ? 400 : 503, { ok: false, error: this.host.ready()
        ? 'Invalid or interrupted universe command.'
        : 'Saving failed. World paused for durable recovery.' });
    }
    return true;
  }
}
