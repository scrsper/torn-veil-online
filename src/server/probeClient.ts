import { WebSocket } from 'ws';
import { ALPHA_PROTOCOL, H } from './protocol';
import { REGION_PROTOCOL } from '../bridge/streaming';

/**
 * A scripted protocol client: the same headers, envelopes and acknowledgements the Unreal client
 * uses, driven from Node. It supplements, never replaces, the real packaged-client checks.
 */
export type Msg = Record<string, any>;
export interface ProbeOptions {
  port: number; host?: string; account: string; token: string;
  character?: string; name?: string; sex?: 'f' | 'm'; realtime?: boolean; protocol?: number; client?: string;
}
export class ProbeClient {
  readonly messages: Msg[] = [];
  readonly socket: WebSocket;
  closed: { code: number; reason: string } | null = null;
  hello: Msg | null = null;
  lastSnapshot: Msg | null = null;
  private sequence = 0;
  private commandSequence = 0;
  private waiters: { test: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
  private constructor(readonly options: ProbeOptions) {
    const headers: Record<string, string> = {
      [H.client]: options.client ?? 'probe', [H.protocol]: String(options.protocol ?? ALPHA_PROTOCOL), [H.region]: String(REGION_PROTOCOL),
      [H.account]: options.account, [H.token]: options.token, [H.character]: options.character ?? 'auto',
      ...(options.name ? { [H.characterName]: options.name } : {}), ...(options.sex ? { [H.characterSex]: options.sex } : {}),
      ...(options.realtime ? { [H.interaction]: '2' } : {}),
    };
    this.socket = new WebSocket(`ws://${options.host ?? '127.0.0.1'}:${options.port}`, { headers, maxPayload: 4 * 1024 * 1024 });
    this.socket.on('message', raw => {
      let m: Msg; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.type === 'hello') this.hello = m;
      if (m.type === 'snapshot') this.lastSnapshot = m;
      if (m.type === 'presentation_chunk') this.socket.send(JSON.stringify({ version: 1, type: 'presentation_ack', transferId: m.transferId, index: m.index }));
      if (m.type !== 'snapshot' && m.type !== 'local_state' && m.type !== 'presentation_chunk' && m.type !== 'combat_frame') { this.messages.push(m); if (this.messages.length > 500) this.messages.shift(); }
      this.waiters = this.waiters.filter(w => { if (w.test(m)) { w.resolve(m); return false; } return true; });
    });
    this.socket.on('close', (code, reason) => { this.closed = { code, reason: reason.toString() }; });
    this.socket.on('error', () => { /* surfaced through close */ });
  }
  /** Resolves once the server has sent hello and a first snapshot, or the connection was refused. */
  static async connect(options: ProbeOptions, timeoutMs = 60_000): Promise<ProbeClient> {
    const c = new ProbeClient(options);
    const start = Date.now();
    while (!(c.hello && c.lastSnapshot) && !c.closed) { if (Date.now() - start > timeoutMs) throw new Error('probe connect timeout'); await new Promise(r => setTimeout(r, 25)); }
    return c;
  }
  get personId(): string { return this.hello?.playerId; }
  get bodyId(): string { return this.lastSnapshot?.controlledBodyId; }
  ownBody(): Msg | undefined { return this.lastSnapshot?.bodies?.find((b: Msg) => b.bodyId === this.bodyId); }
  next(test: (m: Msg) => boolean, timeoutMs = 20_000): Promise<Msg> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('probe wait timeout')), timeoutMs);
      this.waiters.push({ test, resolve: m => { clearTimeout(t); resolve(m); } });
    });
  }
  /** A legacy sequenced intent (talk, dialogue, person_action, interact, …). */
  async intent(body: Msg): Promise<Msg> {
    const sequence = ++this.sequence;
    const reply = this.next(m => m.type === 'result' && m.sequence === sequence);
    this.socket.send(JSON.stringify({ version: 1, sequence, ...body }));
    return reply;
  }
  /** An epoch-bound realtime command; resolves with the terminal receipt (applied/rejected/cancelled). */
  async command(command: Msg): Promise<Msg> {
    const binding = this.hello?.interaction; if (!binding) throw new Error('not a realtime connection');
    const sequence = ++this.commandSequence, commandId = `${binding.controllerId}-${sequence}`;
    const done = this.next(m => m.type === 'command_receipt' && m.commandId === commandId && m.status !== 'received');
    this.socket.send(JSON.stringify({ version: 2, type: 'command', epoch: binding.epoch, controllerId: binding.controllerId, bodyId: binding.bodyId, sequence, commandId, specRevision: binding.specRevision, clientTimeMs: performance.now(), command }));
    return done;
  }
  sendRaw(message: Msg): void { this.socket.send(JSON.stringify(message)); }
  async close(): Promise<void> {
    if (this.closed) return;
    const done = new Promise<void>(r => this.socket.once('close', () => r()));
    this.socket.close(); await done;
  }
  async waitClosed(timeoutMs = 10_000): Promise<{ code: number; reason: string }> {
    const start = Date.now(); while (!this.closed) { if (Date.now() - start > timeoutMs) throw new Error('not closed'); await new Promise(r => setTimeout(r, 20)); }
    return this.closed;
  }
}
