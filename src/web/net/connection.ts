import { timed } from '../game/probe';
import {
  ALPHA_PROTOCOL, CLOSE, INTERACTION_SPEC_REVISION, REGION_PROTOCOL,
  type CombatFrameMessage, type CommandReceiptMessage, type HelloMessage, type InteractionCommand, type LocalStateMessage,
  type MaintenanceMessage, type PresentationPayload, type RegionsStateMessage, type ResultMessage, type SceneMessage, type SnapshotMessage,
} from './messages';

export type LinkStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'closed';
export type CharacterChoice = { kind: 'auto' } | { kind: 'new'; name: string; sex: 'f' | 'm' } | { kind: 'existing'; personId: string };
export type ClosedKind = 'superseded' | 'auth' | 'forbidden' | 'character' | 'incompatible' | 'full' | 'maintenance' | 'no-character' | 'network' | 'no-session' | 'rate' | 'other';
export interface ClosedInfo { code: number; reason: string; kind: ClosedKind; /** Reconnecting automatically cannot help; the player must act. */ final: boolean }

/** Everything a game screen needs from a connection; the recorded-stream replay implements the same surface. */
export interface LinkEvents {
  status: LinkStatus;
  hello: HelloMessage;
  scene: SceneMessage;
  snapshot: SnapshotMessage;
  local_state: LocalStateMessage;
  combat_frame: CombatFrameMessage;
  receipt: CommandReceiptMessage;
  regions_state: RegionsStateMessage;
  /** `applied` must be called once the payload is in the scene; the server holds the next transfer until then. */
  presentation: { regionId: string; payload: PresentationPayload; applied: () => void };
  maintenance: MaintenanceMessage;
  result: ResultMessage;
  closed: ClosedInfo;
  unknown: Record<string, unknown>;
}
type Handler<K extends keyof LinkEvents> = (value: LinkEvents[K]) => void;

export interface GameLink {
  status: LinkStatus;
  hello: HelloMessage | null;
  rttMs: number;
  on<K extends keyof LinkEvents>(event: K, handler: Handler<K>): () => void;
  sendCommand(command: InteractionCommand): { commandId: string; sequence: number; clientTimeMs: number } | null;
  intent(body: Record<string, unknown>, timeoutMs?: number): Promise<ResultMessage>;
  requestSave(): Promise<ResultMessage>;
  connect(choice: CharacterChoice): void;
  disconnect(): void;
}

const MAX_TRANSFER_CHUNKS = 64;          // server bound: 4 MiB in 64 KiB chunks
const MAX_TRANSFER_BYTES = 5 * 1024 * 1024;
const ACK_FALLBACK_MS = 4000;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

function classify(code: number, reason: string): ClosedInfo {
  const make = (kind: ClosedKind, final: boolean): ClosedInfo => ({ code, reason, kind, final });
  switch (code) {
    case CLOSE.superseded: return make('superseded', true);
    case CLOSE.authFailed: return make('auth', true);
    case CLOSE.forbidden: return make('forbidden', true);
    case CLOSE.characterUnavailable: return make('character', true);
    case CLOSE.noCharacter: return make('no-character', true);
    case CLOSE.incompatible: return make('incompatible', true);
    case CLOSE.full: return make('full', false);
    case CLOSE.maintenance: return make('maintenance', false);
    case 1008: return make('rate', true);
    default: return make('network', false);
  }
}

export class GameConnection implements GameLink {
  status: LinkStatus = 'idle';
  hello: HelloMessage | null = null;
  scene: SceneMessage | null = null;
  rttMs = 0;
  clockOffsetMs = 0;
  reconnectAttempt = 0;
  private socket: WebSocket | null = null;
  private choice: CharacterChoice = { kind: 'auto' };
  private readonly handlers = new Map<string, Set<(v: never) => void>>();
  private readonly transfers = new Map<number, { count: number; parts: (Uint8Array | undefined)[]; got: number; bytes: number }>();
  private commandSequence = 0;
  private legacySequence = 0;
  private readonly waiting = new Map<number, { resolve: (m: ResultMessage) => void; timer: ReturnType<typeof setTimeout> }>();
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTick = -Infinity;
  private wantOpen = false;
  private everLive = false;
  private generation = 0;

  constructor(private readonly base: string = location.host, private readonly secure: boolean = location.protocol === 'https:') {}

  on<K extends keyof LinkEvents>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event); if (!set) this.handlers.set(event, set = new Set());
    set.add(handler as (v: never) => void);
    return () => set!.delete(handler as (v: never) => void);
  }
  private emit<K extends keyof LinkEvents>(event: K, value: LinkEvents[K]): void {
    for (const h of [...(this.handlers.get(event) ?? [])]) { try { (h as Handler<K>)(value); } catch (e) { console.error(`[net] ${String(event)} handler failed`, e); } }
  }
  private setStatus(s: LinkStatus): void { if (this.status !== s) { this.status = s; this.emit('status', s); } }

  connect(choice: CharacterChoice): void {
    this.choice = choice; this.wantOpen = true; this.reconnectAttempt = 0;
    this.open();
  }
  disconnect(): void {
    this.wantOpen = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.teardown(); this.setStatus('idle');
  }
  private query(): string {
    const q = new URLSearchParams();
    const c = this.choice;
    if (c.kind === 'auto') q.set('character', 'auto');
    else if (c.kind === 'existing') q.set('character', c.personId);
    else { q.set('character', 'new'); q.set('name', c.name); q.set('sex', c.sex); }
    return q.toString();
  }
  private open(): void {
    this.teardown();
    this.setStatus(this.everLive ? 'reconnecting' : 'connecting');
    const gen = ++this.generation;
    let ws: WebSocket;
    try { ws = new WebSocket(`${this.secure ? 'wss' : 'ws'}://${this.base}/ws?${this.query()}`); }
    catch (e) { this.handleClose(gen, 1006, String(e)); return; }
    this.socket = ws;
    ws.onmessage = ev => { if (gen === this.generation) timed('message', () => this.onMessage(ev.data), 10); };
    ws.onclose = ev => this.handleClose(gen, ev.code, ev.reason);
    ws.onerror = () => { /* the close event carries the outcome */ };
  }
  private teardown(): void {
    this.generation++;
    if (this.probeTimer) { clearInterval(this.probeTimer); this.probeTimer = null; }
    const s = this.socket; this.socket = null;
    if (s) { s.onmessage = null; s.onclose = null; s.onerror = null; try { s.close(); } catch { /* closing */ } }
    this.transfers.clear();
    for (const [, w] of this.waiting) clearTimeout(w.timer);
    this.waiting.clear();
    this.hello = null; this.lastTick = -Infinity; this.commandSequence = 0;
  }
  private handleClose(gen: number, code: number, reason: string): void {
    if (gen !== this.generation) return;
    const info = classify(code, reason);
    this.teardown();
    if (!this.wantOpen) return;
    // A browser socket refused before the upgrade completes reports 1006 with no reason: that is
    // "no launch session" (or a stopped gateway), which retrying cannot fix on its own.
    if (code === 1006 && !this.everLive && this.reconnectAttempt >= 2) { this.finish({ code, reason: 'The game could not be reached. Start it from Play Torn Veil Web.', kind: 'no-session', final: true }); return; }
    if (info.final) { this.finish(info); return; }
    this.emit('closed', info);
    const delay = BACKOFF_MS[Math.min(this.reconnectAttempt, BACKOFF_MS.length - 1)];
    this.reconnectAttempt++;
    this.setStatus('reconnecting');
    if (this.everLive && this.hello === null && this.lastPersonId) this.choice = { kind: 'existing', personId: this.lastPersonId };
    this.retryTimer = setTimeout(() => { if (this.wantOpen) this.open(); }, delay);
  }
  private finish(info: ClosedInfo): void { this.wantOpen = false; this.emit('closed', info); this.setStatus('closed'); }
  private lastPersonId = '';

  private onMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    let m: any;
    try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
    switch (m.type) {
      case 'hello': return this.onHello(m as HelloMessage);
      case 'scene': this.scene = m; return this.emit('scene', m);
      case 'snapshot': {
        // Atomic, monotonic application: an older generation (out of order after takeover/reconnect) is refused.
        if (typeof m.tick === 'number') { if (m.tick < this.lastTick) return; this.lastTick = m.tick; }
        return this.emit('snapshot', m);
      }
      case 'local_state': return this.emit('local_state', m);
      case 'combat_frame': return this.emit('combat_frame', m);
      case 'command_receipt': return this.emit('receipt', m);
      case 'regions_state': return this.emit('regions_state', m);
      case 'presentation_chunk': return this.onChunk(m);
      case 'maintenance': return this.emit('maintenance', m);
      case 'clock_probe': return this.onProbe(m);
      case 'result': {
        const w = this.waiting.get(m.sequence);
        if (w) { clearTimeout(w.timer); this.waiting.delete(m.sequence); w.resolve(m); }
        return this.emit('result', m);
      }
      default: return this.emit('unknown', m);
    }
  }
  private onHello(m: HelloMessage): void {
    if (m.alphaProtocol !== ALPHA_PROTOCOL || m.regionProtocol !== REGION_PROTOCOL) {
      this.wantOpen = false;
      this.finish({ code: CLOSE.incompatible, kind: 'incompatible', final: true, reason: `This client speaks protocol ${ALPHA_PROTOCOL}/${REGION_PROTOCOL}; the server offered ${m.alphaProtocol}/${m.regionProtocol}. Update the game.` });
      this.teardown(); return;
    }
    if (m.interaction && m.interaction.specRevision !== INTERACTION_SPEC_REVISION) {
      this.wantOpen = false;
      this.finish({ code: CLOSE.incompatible, kind: 'incompatible', final: true, reason: `Movement rules ${m.interaction.specRevision} differ from this client (${INTERACTION_SPEC_REVISION}). Update the game.` });
      this.teardown(); return;
    }
    this.hello = m; this.everLive = true; this.reconnectAttempt = 0; this.lastPersonId = m.playerId; this.commandSequence = 0; this.lastTick = -Infinity;
    this.setStatus('live');
    this.emit('hello', m);
    if (!this.probeTimer) { this.sendProbe(); this.probeTimer = setInterval(() => this.sendProbe(), 2000); }
  }
  private sendProbe(): void { this.raw({ version: 1, type: 'clock_probe', clientTimeMs: performance.now() }); }
  private onProbe(m: { clientTimeMs: number; serverTimeMs: number }): void {
    const now = performance.now(), rtt = now - m.clientTimeMs;
    if (!(rtt >= 0 && rtt < 10_000)) return;
    this.rttMs = this.rttMs ? this.rttMs * 0.7 + rtt * 0.3 : rtt;
    this.clockOffsetMs = m.serverTimeMs - (m.clientTimeMs + rtt / 2);
  }
  private onChunk(m: { transferId: number; regionId: string; index: number; count: number; data: string }): void {
    if (!Number.isInteger(m.transferId) || !Number.isInteger(m.index) || !Number.isInteger(m.count) || m.count < 1 || m.count > MAX_TRANSFER_CHUNKS || m.index < 0 || m.index >= m.count || typeof m.data !== 'string') return;
    let t = this.transfers.get(m.transferId);
    if (!t) { t = { count: m.count, parts: new Array(m.count), got: 0, bytes: 0 }; this.transfers.set(m.transferId, t); if (this.transfers.size > 4) this.transfers.delete(this.transfers.keys().next().value!); }
    if (t.count !== m.count) return;
    const bin = atob(m.data), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (!t.parts[m.index]) { t.parts[m.index] = bytes; t.got++; t.bytes += bytes.length; }
    if (t.bytes > MAX_TRANSFER_BYTES) { this.transfers.delete(m.transferId); return; }
    const ack = () => this.raw({ version: 1, type: 'presentation_ack', transferId: m.transferId, index: m.index });
    if (t.got < t.count) { ack(); return; }
    // Final chunk: acknowledge only after the scene has actually applied the region, so a slow
    // renderer applies backpressure to the server's presentation stream instead of queueing it.
    this.transfers.delete(m.transferId);
    const all = new Uint8Array(t.bytes); let at = 0; for (const p of t.parts) { all.set(p!, at); at += p!.length; }
    let payload: PresentationPayload;
    try { payload = JSON.parse(new TextDecoder().decode(all)); } catch { ack(); return; }
    let acked = false;
    const applied = () => { if (!acked) { acked = true; clearTimeout(fallback); ack(); } };
    const fallback = setTimeout(applied, ACK_FALLBACK_MS);
    this.emit('presentation', { regionId: m.regionId, payload, applied });
  }

  private raw(message: Record<string, unknown>): boolean {
    const s = this.socket;
    if (!s || s.readyState !== WebSocket.OPEN) return false;
    if (s.bufferedAmount > 256 * 1024) return false; // backpressure: never queue stale input
    s.send(JSON.stringify(message)); return true;
  }
  sendCommand(command: InteractionCommand): { commandId: string; sequence: number; clientTimeMs: number } | null {
    const b = this.hello?.interaction; if (!b) return null;
    const sequence = this.commandSequence, commandId = `${b.controllerId}-${sequence}`, clientTimeMs = Math.round(performance.now());
    const ok = this.raw({ version: 2, type: 'command', epoch: b.epoch, controllerId: b.controllerId, bodyId: b.bodyId, sequence, commandId, specRevision: b.specRevision, clientTimeMs, command });
    if (!ok) return null;
    this.commandSequence++;
    return { commandId, sequence, clientTimeMs };
  }
  intent(body: Record<string, unknown>, timeoutMs = 8000): Promise<ResultMessage> {
    const sequence = ++this.legacySequence;
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.waiting.delete(sequence); resolve({ type: 'result', sequence, result: 'timeout' }); }, timeoutMs);
      this.waiting.set(sequence, { resolve, timer });
      if (!this.raw({ version: 1, sequence, ...body })) { clearTimeout(timer); this.waiting.delete(sequence); resolve({ type: 'result', sequence, result: 'not_connected' }); }
    });
  }
  requestSave(): Promise<ResultMessage> { return this.intent({ type: 'save' }, 15000); }
}
