import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { Duplex } from 'node:stream';
import { BridgeSession } from '../bridge/session';
import { RegionalTransport, REGION_PROTOCOL, MAX_PRESENTATION_MESSAGE_BYTES } from '../bridge/streaming';
import { FixedScheduler } from '../bridge/scheduler';
import { FixedRateWindow } from '../bridge/rateWindow';
import { CoalescedInteractionWake } from '../bridge/interactionWake';
import { loadCatalogue } from '../foundry/load';
import { SAVE_VERSION, readableSaveVersion, serializeParts } from '../sim/persist/save';
import { isExternallyControlled, setExternalControl } from '../sim/runtime/controllers';
import { AccountRegistry, type AccountRecord } from './accounts';
import { CheckpointEncoder } from './checkpointEncoder';
import type { AlphaConfig, ReleaseIdentity } from './config';
import { GENERATOR_VERSION, playableBaselineFingerprint } from './fingerprint';
import { ALPHA_PROTOCOL, CLOSE, H, parseCharacterRequest } from './protocol';
import type { Lifecycle } from './readiness';
import { BackupSet, RefuseToStartError, WorldStore, WriterLock, type CheckpointMeta } from './store';

type Log = (level: 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>) => void;
interface Connection {
  socket: WebSocket; serial: number; account: AccountRecord; channelId: string; personId: string;
  stream: RegionalTransport; realtime: boolean; controlWindow: FixedRateWindow; presentationWindow: FixedRateWindow;
  remote: string; connectedAt: number; lastSaveRequest: number;
}
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const channelFor = (accountId: string) => `acct:${accountId}`;

/**
 * The Living Alpha authoritative service: one canonical World, many controllers.
 *
 * Authority stays in the TypeScript simulation. Clients submit intentions over one WebSocket each;
 * the server validates them against the account's own character and applies them through the same
 * `BridgeSession`/`GameSim`/`Simulation` paths NPCs use. Snapshots are filtered per character.
 *
 * Durability contract (see docs/LIVING_ALPHA_RELEASE.md): the whole World is checkpointed as one
 * consistent snapshot every `checkpointSeconds`, on character creation, on a player's explicit save,
 * on drain and on orderly shutdown. A crash loses at most the time since the last committed
 * checkpoint, consistently for everyone — nothing can be half-applied or duplicated because no
 * partial state is ever written. World time does not advance while the service is down.
 */
export class LiveServer {
  readonly store: WorldStore;
  readonly backups: BackupSet;
  readonly accounts: AccountRegistry;
  private readonly lock: WriterLock;
  session!: BridgeSession;
  private worldId = '';
  private ownership: Record<string, string[]> = {};
  private readonly http: Server[] = [];
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  private readonly connections = new Map<WebSocket, Connection>();
  private readonly byAccount = new Map<string, Connection>();
  private readonly graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly authFailures = new Map<string, { count: number; since: number }>();
  private serial = 0;
  private ticks = 0;
  private scheduler!: FixedScheduler;
  private timer?: ReturnType<typeof setTimeout>;
  private wake?: CoalescedInteractionWake;
  private checkpointTimer?: ReturnType<typeof setInterval>;
  private backupTimer?: ReturnType<typeof setInterval>;
  private readonly loopDelay = monitorEventLoopDelay({ resolution: 10 });
  private admissions = true;
  private stopping = false;
  private shuttingDown = false;
  private ready = false;
  private failed = false;
  private maintenance: { message: string; at: number } | null = null;
  private inFlight: Promise<CheckpointMeta> | null = null;
  private readonly checkpointEncoder = new CheckpointEncoder();
  private lastCheckpoint: CheckpointMeta | null = null;
  private readonly startedAt = Date.now();
  readonly metrics = { checkpoints: 0, lastSerializeMs: 0, maxSerializeMs: 0, lastEncodeMs: 0, maxEncodeMs: 0, lastCheckpointMs: 0, lastCommitMs: 0, lastBytes: 0, backups: 0, lastBackupIso: '', authFailures: 0, rejectedConnections: 0, connectionsServed: 0, recoveredFrom: [] as { generation: number; why: string }[] };
  private adminToken = '';

  constructor(readonly config: AlphaConfig, readonly release: ReleaseIdentity, private readonly log: Log) {
    for (const d of [config.stateDir, config.logDir, config.credentialsDir]) mkdirSync(d, { recursive: true });
    this.store = new WorldStore(config.stateDir);
    this.backups = new BackupSet(config.backupDir);
    this.accounts = new AccountRegistry(join(config.credentialsDir, 'accounts.json'));
    this.lock = new WriterLock(config.stateDir, { release: release.version, env: config.env });
  }

  /** Acquire write authority, load (or, only for a never-used state directory, create) the world. */
  async open(): Promise<void> {
    const took = this.lock.acquire();
    if (took.tookOverStale) this.log('warn', 'writer_lock_stale_taken_over', {});
    const adminPath = join(this.config.credentialsDir, 'admin.token');
    if (!existsSync(adminPath)) throw new RefuseToStartError(`Missing ${adminPath}; initialise the environment with the ops tool first`);
    this.adminToken = readFileSync(adminPath, 'utf8').trim();
    const removed = this.store.cleanInterrupted();
    if (removed.length) this.log('warn', 'interrupted_write_debris_removed', { removed });
    const catalogue = loadCatalogue(this.config.characterCatalogue ?? undefined);
    if (!catalogue.present) this.log('warn', 'character_catalogue_unavailable', { problems: catalogue.problems.map(p => p.detail) });
    const identity = this.store.identity();
    const t0 = performance.now(), fingerprint = playableBaselineFingerprint(identity?.generator.seed ?? this.config.seed, identity?.generator.version);
    this.log('info', 'generator_fingerprint', { fingerprint, ms: Math.round(performance.now() - t0) });
    if (!identity) {
      if (this.store.generations().length) throw new RefuseToStartError('Checkpoints exist without a world identity; refusing to guess. Restore WORLD.json from a backup.');
      if (!this.config.createWorldIfMissing) throw new RefuseToStartError('No world in this state directory and createWorldIfMissing is false');
      this.worldId = `tvo-${this.config.env}-${randomUUID()}`;
      this.session = new BridgeSession(this.config.seed, { playable: true, defaultPlayer: false, characterCatalogue: catalogue.catalogue });
      this.store.createIdentity({ format: 1, worldId: this.worldId, env: this.config.env, createdAtIso: new Date().toISOString(), generator: { kind: 'playable', seed: this.config.seed, version: GENERATOR_VERSION, fingerprint }, createdByRelease: this.release.version });
      this.log('info', 'world_created', { worldId: this.worldId, seed: this.config.seed });
      await this.checkpoint('world created');
    } else {
      if (identity.generator.fingerprint !== fingerprint)
        throw new RefuseToStartError(`Generator fingerprint changed (${identity.generator.fingerprint.slice(0, 12)} → ${fingerprint.slice(0, 12)}); this release would rebuild a different seeded base under world ${identity.worldId}. A migration is required.`);
      this.worldId = identity.worldId;
      let loaded = false;
      for (const candidate of this.store.candidates((generation, why) => { this.metrics.recoveredFrom.push({ generation, why }); this.log('error', 'checkpoint_rejected', { generation, why }); })) {
        if (!readableSaveVersion(candidate.meta.saveSchema)) { this.metrics.recoveredFrom.push({ generation: candidate.meta.generation, why: `save schema ${candidate.meta.saveSchema} ≠ ${SAVE_VERSION}` }); this.log('error', 'checkpoint_rejected', { generation: candidate.meta.generation, why: 'schema' }); continue; }
        try {
          const t1 = performance.now();
          this.session = new BridgeSession(identity.generator.seed, { playable: true, defaultPlayer: false, save: candidate.world, characterCatalogue: catalogue.catalogue });
          this.ownership = structuredClone(candidate.meta.ownership ?? {});
          this.lastCheckpoint = candidate.meta;
          this.log('info', 'world_loaded', { worldId: this.worldId, generation: candidate.meta.generation, savedAtIso: candidate.meta.savedAtIso, physicalTime: candidate.meta.physicalTime, ms: Math.round(performance.now() - t1) });
          loaded = true; break;
        } catch (e) {
          this.metrics.recoveredFrom.push({ generation: candidate.meta.generation, why: String(e) });
          this.log('error', 'checkpoint_unloadable', { generation: candidate.meta.generation, error: String(e) });
        }
      }
      if (!loaded) throw new RefuseToStartError(`World ${identity.worldId} exists but no checkpoint could be loaded; refusing to start (never regenerating). See logs; restore from backup.`);
      // No controller survives a restart: every character returns to ordinary autonomous life
      // until its owner reconnects (the same policy as an expired disconnect grace).
      for (const ids of Object.values(this.ownership)) for (const id of ids) { const p = this.session.world.person(id); if (p && isExternallyControlled(p)) setExternalControl(p, false); }
    }
  }

  /** Capture canonical JSON and transfer owned bytes synchronously. Storage packing and commit
   * operate on that fixed snapshot while the world continues. Clocks and ownership must be
   * captured before yielding, so metadata can never describe a later world than the payload. */
  checkpoint(reason: string): Promise<CheckpointMeta> {
    if (this.inFlight) return this.inFlight.then(() => this.checkpoint(reason));
    const w = this.session.world, t0 = performance.now();
    const world = serializeParts(w);
    const metadata = {
      worldId: this.worldId, savedAtIso: new Date().toISOString(), reason, physicalTime: w.physicalTime, worldNow: w.now, saveSchema: SAVE_VERSION,
      generator: this.store.identity()!.generator, release: { version: this.release.version, revision: this.release.revision }, ownership: structuredClone(this.ownership),
    };
    const encoding = this.checkpointEncoder.encode(world);
    const serializeMs = performance.now() - t0;
    this.metrics.lastSerializeMs = serializeMs; this.metrics.maxSerializeMs = Math.max(this.metrics.maxSerializeMs, serializeMs);
    this.inFlight = encoding.then(async ({ bytes, encodeMs }) => {
      this.metrics.lastEncodeMs = encodeMs; this.metrics.maxEncodeMs = Math.max(this.metrics.maxEncodeMs, encodeMs);
      const t1 = performance.now();
      const meta = await this.store.commit(bytes, metadata, this.lock);
      this.lastCheckpoint = meta; this.metrics.checkpoints++; this.metrics.lastCommitMs = performance.now() - t1; this.metrics.lastBytes = meta.worldBytes;
      this.metrics.lastCheckpointMs = performance.now() - t0;
      this.log('info', 'checkpoint', { generation: meta.generation, reason, serializeMs: Math.round(serializeMs), encodeMs: Math.round(encodeMs), checkpointMs: Math.round(this.metrics.lastCheckpointMs), commitMs: Math.round(this.metrics.lastCommitMs), bytes: meta.worldBytes, physicalTime: meta.physicalTime });
      return meta;
    }).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
  async backup(): Promise<string | null> {
    const g = this.lastCheckpoint?.generation; if (!g) return null;
    const dir = await this.backups.take(this.store, g);
    this.metrics.backups++; this.metrics.lastBackupIso = new Date().toISOString();
    this.log('info', 'backup', { generation: g, dir }); return dir;
  }

  async listen(): Promise<void> {
    this.loopDelay.enable();
    for (const host of this.config.bind) {
      const server = createServer((req, res) => this.handleHttp(req, res, host));
      server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(this.config.port, host, () => { server.off('error', reject); resolve(); }); });
      this.http.push(server);
      this.log('info', 'listening', { host, port: this.config.port });
    }
    this.scheduler = new FixedScheduler(1000 / 60, performance.now());
    this.wake = new CoalescedInteractionWake(() => this.scheduler.remaining(performance.now()) <= 0, () => { clearTimeout(this.timer); this.pump(); });
    this.timer = setTimeout(() => this.pump(), 1);
    this.checkpointTimer = setInterval(() => { if (!this.stopping) this.checkpoint('periodic').catch(e => this.fatal('checkpoint_failed', e)); }, this.config.checkpointSeconds * 1000);
    this.backupTimer = setInterval(() => { if (!this.stopping) this.backup().catch(e => this.log('error', 'backup_failed', { error: String(e) })); }, this.config.backupMinutes * 60_000);
    this.ready = true;
    this.log('info', 'ready', { worldId: this.worldId, release: this.release.version, residents: this.session.world.livingPersons().length, env: this.config.env });
  }

  private fatal(event: string, error: unknown): void {
    this.log('error', event, { error: String((error as Error)?.stack ?? error) });
    // A lost fence or failed durable write must stop the writer rather than keep diverging.
    this.failed = true; this.ready = false; this.admissions = false;
    setTimeout(() => process.exit(70), 50);
  }

  private pump(): void {
    if (this.stopping) return;
    try { this.scheduler.run(performance.now(), () => this.update()); }
    catch (e) { this.fatal('tick_exception', e); return; }
    this.timer = setTimeout(() => this.pump(), Math.max(1, Math.min(16, this.scheduler.remaining(performance.now()))));
  }

  private update(): void {
    const receipts = this.session.stepAll();
    for (const c of this.connections.values()) {
      if (c.socket.readyState !== WebSocket.OPEN) continue;
      if (c.socket.bufferedAmount > 256_000) { this.close(c, 1013, 'Action backpressure'); continue; }
      for (const r of receipts.get(c.channelId) ?? []) c.socket.send(JSON.stringify(r));
      const state = this.session.localState(c.channelId); if (state) c.socket.send(JSON.stringify(state));
      const combat = this.session.combatFrame(c.channelId); if (combat && c.socket.bufferedAmount < 256_000) c.socket.send(JSON.stringify(combat));
    }
    const deadline = performance.now() + 3;
    for (const c of this.connections.values()) {
      const budget = deadline - performance.now(); if (budget <= 0) break;
      if (c.socket.readyState === WebSocket.OPEN && c.socket.bufferedAmount < MAX_PRESENTATION_MESSAGE_BYTES) {
        try { c.stream.prepare(this.session.world, budget); } catch (e) { this.log('error', 'presentation_error', { error: String(e) }); this.close(c, 1011, 'Presentation generation failed; see server log'); }
      }
    }
    if (++this.ticks % 6) return;
    for (const c of this.connections.values()) {
      if (c.socket.readyState !== WebSocket.OPEN || c.socket.bufferedAmount >= 512_000) continue;
      c.socket.send(JSON.stringify(this.session.snapshot(true, c.channelId)));
      if (c.socket.bufferedAmount >= MAX_PRESENTATION_MESSAGE_BYTES) continue;
      try {
        const state = c.stream.state(this.session.world); if (state) c.socket.send(JSON.stringify(state));
        const chunk = c.stream.next(this.session.world, performance.now(), 0); if (chunk) c.socket.send(JSON.stringify(chunk));
      } catch (e) { this.log('error', 'presentation_error', { error: String(e) }); this.close(c, 1011, 'Presentation generation failed; see server log'); }
    }
    if (this.maintenance && this.ticks % 600 === 0) this.broadcast({ version: 1, type: 'maintenance', message: this.maintenance.message, atMs: this.maintenance.at, inMs: Math.max(0, this.maintenance.at - Date.now()) });
  }
  private broadcast(message: object): void { const payload = JSON.stringify(message); for (const c of this.connections.values()) if (c.socket.readyState === WebSocket.OPEN) c.socket.send(payload); }
  private close(c: Connection, code: number, reason: string): void { try { c.socket.close(code, reason); } catch { /* already closing */ } }

  // ── HTTP ────────────────────────────────────────────────────────────────────────────────────
  private isAdmin(req: IncomingMessage): boolean {
    if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return false;
    const given = Buffer.from(String(req.headers['x-torn-veil-admin'] ?? '')), expected = Buffer.from(this.adminToken);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
  /** Process alive → world loaded → accepting players; or deliberately not (maintenance/stopping/failed). */
  lifecycle(): Lifecycle {
    if (this.failed) return 'failed';
    if (this.stopping || this.shuttingDown) return 'stopping';
    if (!this.ready) return 'starting';
    return this.admissions ? 'ready' : 'maintenance';
  }
  status() {
    const w = this.session.world;
    return {
      env: this.config.env, worldId: this.worldId, release: this.release, protocol: ALPHA_PROTOCOL, state: this.lifecycle(), ready: this.ready, admissions: this.admissions,
      runtime: { node: process.version, v8: process.versions.v8, pid: process.pid }, cpuMicroseconds: process.cpuUsage(),
      maintenance: this.maintenance, uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      world: { physicalTime: w.physicalTime, worldNow: w.now, day: Math.floor(w.now / 86400), livingPersons: w.livingPersons().length, events: w.events.length, knowledge: w.persons().reduce((n, p) => n + Object.keys(p.knowledge).length, 0), creatures: w.creatures().length },
      connections: [...this.connections.values()].map(c => ({ account: c.account.id, personId: c.personId, remote: c.remote, since: new Date(c.connectedAt).toISOString() })),
      graceRunning: [...this.graceTimers.keys()],
      characters: this.ownership,
      scheduler: { steps: this.scheduler?.steps ?? 0, overruns: this.scheduler?.overruns ?? 0, maxDebtMs: this.scheduler?.maxDebtMs ?? 0, debtMs: this.scheduler?.debt(performance.now()) ?? 0 },
      eventLoopMs: { p50: this.loopDelay.percentile(50) / 1e6, p99: this.loopDelay.percentile(99) / 1e6, max: this.loopDelay.max / 1e6 },
      memory: process.memoryUsage(), lastCheckpoint: this.lastCheckpoint && { generation: this.lastCheckpoint.generation, savedAtIso: this.lastCheckpoint.savedAtIso, reason: this.lastCheckpoint.reason, bytes: this.lastCheckpoint.worldBytes },
      storeBytes: this.store.bytes(), metrics: this.metrics,
    };
  }
  private handleHttp(req: IncomingMessage, res: ServerResponse, host: string): void {
    res.setHeader('Content-Type', 'application/json');
    const url = new URL(req.url ?? '/', 'http://x'), send = (code: number, body: unknown) => { res.statusCode = code; res.end(JSON.stringify(body)); };
    // /health is liveness only (the process answers). /ready is 200 only while players can be admitted.
    if (url.pathname === '/health') return send(200, { ok: true, state: this.lifecycle(), env: this.config.env, release: this.release.version, protocol: ALPHA_PROTOCOL, regionProtocol: REGION_PROTOCOL });
    if (url.pathname === '/ready') { const state = this.lifecycle(); return send(state === 'ready' ? 200 : 503, { state, ready: this.ready, admissions: this.admissions, maintenance: this.maintenance }); }
    if (!url.pathname.startsWith('/admin/')) return send(404, {});
    if (!LOOPBACK.has(host) || !this.isAdmin(req)) return send(403, { error: 'forbidden' });
    const op = url.pathname.slice(7);
    if (op === 'status' && req.method === 'GET') return send(200, this.status());
    if (op === 'debug/snapshot' && req.method === 'GET') return send(200, this.session.developerSnapshot());
    if (req.method !== 'POST') return send(405, {});
    if (op === 'checkpoint') { this.checkpoint(url.searchParams.get('reason') ?? 'admin').then(m => send(200, { generation: m.generation, savedAtIso: m.savedAtIso }), e => send(500, { error: String(e) })); return; }
    if (op === 'backup') { this.checkpoint('pre-backup').then(() => this.backup()).then(dir => send(200, { dir }), e => send(500, { error: String(e) })); return; }
    if (op === 'drain') { const seconds = Math.max(0, Math.min(3600, Number(url.searchParams.get('seconds') ?? 60))); this.drain(seconds, url.searchParams.get('message') ?? 'Server maintenance').then(m => send(200, { generation: m.generation, savedAtIso: m.savedAtIso }), e => send(500, { error: String(e) })); return; }
    if (op === 'open') { this.admissions = true; this.maintenance = null; this.log('info', 'admissions_opened', {}); return send(200, { admissions: true }); }
    if (op === 'shutdown') { send(202, { stopping: true }); void this.shutdown('admin'); return; }
    return send(404, {});
  }

  /** Stop admissions, warn players, disconnect everyone at the deadline and commit a checkpoint. */
  async drain(seconds: number, message: string): Promise<CheckpointMeta> {
    this.admissions = false; this.maintenance = { message, at: Date.now() + seconds * 1000 };
    this.log('info', 'drain_started', { seconds, message });
    this.broadcast({ version: 1, type: 'maintenance', message, atMs: this.maintenance.at, inMs: seconds * 1000 });
    if (seconds > 0) await new Promise(r => setTimeout(r, seconds * 1000));
    for (const c of [...this.connections.values()]) this.close(c, CLOSE.maintenance, `Maintenance: ${message}`);
    const meta = await this.checkpoint('drain');
    this.log('info', 'drained', { generation: meta.generation });
    return meta;
  }
  async shutdown(reason: string, exitCode = 0): Promise<void> {
    if (this.stopping || this.shuttingDown) return;
    this.shuttingDown = true;
    this.log('info', 'shutdown_started', { reason });
    this.admissions = false; this.ready = false;
    for (const c of [...this.connections.values()]) this.close(c, CLOSE.maintenance, 'Server shutting down');
    // The final snapshot is the stopped world's state. Do not generate unsaved NPC history
    // while its immutable bytes are being packed and committed in the background.
    this.stopping = true;
    clearTimeout(this.timer); clearInterval(this.checkpointTimer); clearInterval(this.backupTimer); this.wake?.stop(); this.loopDelay.disable();
    let ok = true;
    try { if (this.session) await this.checkpoint(`shutdown: ${reason}`); } catch (e) { ok = false; this.log('error', 'final_checkpoint_failed', { error: String(e) }); }
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.wss.close(); for (const s of this.http) s.close();
    await this.checkpointEncoder.close();
    this.lock.release();
    writeFileSync(join(this.config.stateDir, 'last-shutdown.json'), JSON.stringify({ reason, atIso: new Date().toISOString(), ok, generation: this.lastCheckpoint?.generation ?? null, release: this.release.version }));
    this.log('info', 'shutdown_complete', { ok, generation: this.lastCheckpoint?.generation });
    if (exitCode >= 0) setTimeout(() => process.exit(ok ? exitCode : 71), 20);
  }
  /** In-process stop (tests, offline tools): same orderly shutdown, no process exit. */
  async stopInProcess(reason = "stopped"): Promise<void> { await this.shutdown(reason, -1); }

  // ── WebSocket admission ─────────────────────────────────────────────────────────────────────
  private reject(socket: WebSocket, code: number, reason: string, remote: string): void {
    this.metrics.rejectedConnections++;
    this.log('warn', 'connection_rejected', { code, reason, remote });
    socket.close(code, reason);
  }
  private handleUpgrade(req: IncomingMessage, raw: Duplex, head: Buffer): void {
    if (this.stopping) { raw.destroy(); return; }
    this.wss.handleUpgrade(req, raw, head, socket => this.admit(socket, req));
  }
  private admit(socket: WebSocket, req: IncomingMessage): void {
    const remote = req.socket.remoteAddress ?? 'unknown', header = (name: string) => { const v = req.headers[name]; return Array.isArray(v) ? v[0] : v; };
    const failures = this.authFailures.get(remote);
    if (failures && Date.now() - failures.since < 60_000 && failures.count >= 10) return this.reject(socket, CLOSE.full, 'Too many failed sign-ins; wait a minute', remote);
    if (!['unreal', 'probe'].includes(String(header(H.client)))) return this.reject(socket, CLOSE.incompatible, 'Torn Veil client required', remote);
    if (header(H.protocol) !== String(ALPHA_PROTOCOL)) return this.reject(socket, CLOSE.incompatible, `Incompatible client: server protocol ${ALPHA_PROTOCOL}, release ${this.release.version}. Update your client.`, remote);
    if (header(H.region) !== String(REGION_PROTOCOL)) return this.reject(socket, CLOSE.incompatible, `Incompatible client: regional protocol ${REGION_PROTOCOL} required`, remote);
    const account = this.accounts.authenticate(header(H.account), header(H.token));
    if (!account) {
      const f = failures && Date.now() - failures.since < 60_000 ? failures : { count: 0, since: Date.now() };
      f.count++; this.authFailures.set(remote, f); this.metrics.authFailures++;
      return this.reject(socket, CLOSE.authFailed, 'Sign-in failed: unknown or disabled account, or wrong token', remote);
    }
    if (!this.admissions) return this.reject(socket, CLOSE.maintenance, this.maintenance ? `Maintenance: ${this.maintenance.message}` : 'Server not accepting players right now', remote);
    const previous = this.byAccount.get(account.id);
    if (!previous && this.byAccount.size >= this.config.maxConnections) return this.reject(socket, CLOSE.full, 'Server full', remote);
    const request = parseCharacterRequest(header(H.character), header(H.characterName), header(H.characterSex));
    if (!request) return this.reject(socket, CLOSE.characterUnavailable, 'Invalid character request (names: 3–32 letters, spaces, apostrophes or hyphens)', remote);
    const owned = this.ownership[account.id] ?? [], w = this.session.world;
    const living = owned.filter(id => w.person(id)?.alive);
    let personId: string | null = null;
    if (request.kind === 'existing') {
      if (!owned.includes(request.personId)) return this.reject(socket, CLOSE.forbidden, 'That character does not belong to this account', remote);
      if (!w.person(request.personId)?.alive) return this.reject(socket, CLOSE.characterUnavailable, 'That character has died. Death is permanent; create a new character.', remote);
      personId = request.personId;
    } else if (request.kind === 'auto') {
      personId = living.at(-1) ?? null;
      if (!personId) return this.reject(socket, CLOSE.noCharacter, owned.length ? 'Your character has died. Create a new character to continue.' : 'No character yet. Create a new character.', remote);
    } else if (living.length >= account.maxCharacters) return this.reject(socket, CLOSE.characterUnavailable, `Character limit (${account.maxCharacters}) reached`, remote);

    // Supersede this account's older connection (reconnect from a new client). Its command epoch
    // dies with it, so nothing it queued can be replayed through the new connection.
    if (previous) { this.connections.delete(previous.socket); this.byAccount.delete(account.id); this.close(previous, CLOSE.superseded, 'Signed in from another client'); }
    const channelId = channelFor(account.id);
    const grace = this.graceTimers.get(channelId); if (grace) { clearTimeout(grace); this.graceTimers.delete(channelId); }
    let created = false;
    if (request.kind === 'new') {
      personId = this.session.createCharacter(channelId, request.name, { gender: request.sex });
      (this.ownership[account.id] ??= []).push(personId); created = true;
    } else {
      const current = this.session.channel(channelId);
      if (current && current.personId !== personId) this.session.releaseChannel(channelId);
      if (!this.session.openChannel(channelId, personId!)) return this.reject(socket, CLOSE.characterUnavailable, 'Character is controlled elsewhere', remote);
      const body = w.primaryBody(personId!); const p = w.person(personId!)!;
      // Returning control interrupts whatever ordinary life was being lived meanwhile; a sleeper wakes.
      p.mind.plan = []; p.mind.goal = null; if (body?.pose === 'sleep') body.pose = 'stand';
    }
    this.session.resetInput(channelId); this.session.resetAppearanceDelta(channelId);
    const person = w.person(personId!)!;
    const realtime = header(H.interaction) === '2';
    const c: Connection = { socket, serial: ++this.serial, account, channelId, personId: personId!, remote, connectedAt: Date.now(), lastSaveRequest: 0, realtime,
      stream: new RegionalTransport(e => this.log('info', 'region', { conn: this.serial, ...e }), () => personId), controlWindow: new FixedRateWindow(realtime ? 160 : 80, performance.now()), presentationWindow: new FixedRateWindow(80, performance.now()) };
    this.connections.set(socket, c); this.byAccount.set(account.id, c); this.metrics.connectionsServed++;
    const interaction = realtime ? this.session.bindInteraction(`${account.id}:${c.serial}`, channelId) : undefined;
    this.log('info', 'connected', { account: account.id, personId, created, remote, serial: c.serial });
    const send = (m: object) => socket.send(JSON.stringify(m));
    send({ version: 1, type: 'hello', regionProtocol: REGION_PROTOCOL, alphaProtocol: ALPHA_PROTOCOL, release: this.release.version, worldId: this.worldId, controls: true, playerId: personId, interaction,
      account: { id: account.id, displayName: account.displayName, developer: account.roles.includes('developer') },
      character: { personId, name: person.name, created, characters: (this.ownership[account.id] ?? []).map(id => ({ personId: id, name: w.person(id)?.name ?? '?', alive: !!w.person(id)?.alive })) },
      durability: { checkpointSeconds: this.config.checkpointSeconds, lastCheckpointIso: this.lastCheckpoint?.savedAtIso ?? null }, maintenance: this.maintenance });
    send(this.session.scene(channelId));
    send(this.session.snapshot(true, channelId));
    if (created) this.checkpoint(`character created: ${account.id}`).catch(e => this.fatal('checkpoint_failed', e));
    socket.on('message', bytes => this.onMessage(c, bytes.toString()));
    socket.on('error', e => { this.log('warn', 'socket_error', { account: account.id, error: e.message }); socket.close(); });
    socket.on('close', (code, reason) => this.onClose(c, code, reason.toString()));
  }
  private onClose(c: Connection, code: number, reason: string): void {
    if (this.connections.get(c.socket) !== c) return; // superseded: the new connection owns the channel
    this.connections.delete(c.socket); this.byAccount.delete(c.account.id);
    this.log('info', 'disconnected', { account: c.account.id, personId: c.personId, code, reason });
    if (this.stopping) return;
    this.session.suspendChannel(c.channelId);
    const release = () => { this.graceTimers.delete(c.channelId); if (this.byAccount.has(c.account.id)) return; this.session.releaseChannel(c.channelId); this.log('info', 'character_autonomous', { account: c.account.id, personId: c.personId }); };
    if (this.config.disconnectGraceSeconds <= 0) release();
    else this.graceTimers.set(c.channelId, setTimeout(release, this.config.disconnectGraceSeconds * 1000));
  }
  private onMessage(c: Connection, text: string): void {
    const socket = c.socket;
    if (this.connections.get(socket) !== c) return;
    let message: Record<string, any>;
    try { message = JSON.parse(text); } catch { socket.send('{"version":1,"type":"result","sequence":-1,"result":"invalid_json"}'); return; }
    if (!message || typeof message !== 'object') return;
    if (message.type === 'presentation_ack') {
      if (!c.presentationWindow.consume(performance.now()).allowed) { this.close(c, 1008, 'Presentation rate limit'); return; }
      c.stream.acknowledge(message.transferId, message.index); return;
    }
    if (!c.controlWindow.consume(performance.now()).allowed) { this.log('warn', 'control_rate_limit', { account: c.account.id }); this.close(c, 1008, 'Rate limit'); return; }
    if (message.type === 'clock_probe') { socket.send(JSON.stringify({ version: 1, type: 'clock_probe', clientTimeMs: message.clientTimeMs, serverTimeMs: performance.now() })); return; }
    if (message.type === 'command') { const receipt = this.session.receiveCommand(message, performance.now(), c.channelId); if (receipt) socket.send(JSON.stringify(receipt)); this.wake?.request(); return; }
    if (message.type === 'save') {
      // Players cannot write saves; they can ask for their progress to be made durable now.
      if (Date.now() - c.lastSaveRequest < 30_000) { socket.send(JSON.stringify({ version: 1, type: 'result', sequence: message.sequence ?? -1, result: 'saved', generation: this.lastCheckpoint?.generation, savedAtIso: this.lastCheckpoint?.savedAtIso })); return; }
      c.lastSaveRequest = Date.now();
      this.checkpoint(`player request: ${c.account.id}`).then(m => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ version: 1, type: 'result', sequence: message.sequence ?? -1, result: 'saved', generation: m.generation, savedAtIso: m.savedAtIso })); }, e => this.fatal('checkpoint_failed', e));
      return;
    }
    if (message.type === 'debug_inspect') {
      if (!c.account.roles.includes('developer') || typeof message.personId !== 'string') { socket.send(JSON.stringify({ version: 1, type: 'result', sequence: message.sequence ?? -1, result: 'forbidden' })); return; }
      socket.send(JSON.stringify({ version: 1, type: 'debug_inspection', truth: this.session.game.debugTruth(message.personId), beliefs: this.session.game.beliefs(c.channelId, message.personId) })); return;
    }
    // Realtime clients move and fight only through epoch-bound command envelopes; the legacy
    // unbound forms would let a reconnecting client re-send stale input.
    if (c.realtime && (message.type === 'move' || message.type === 'attack')) { socket.send(JSON.stringify({ version: 1, type: 'result', sequence: message.sequence ?? -1, result: 'use_command_protocol' })); return; }
    socket.send(JSON.stringify({ version: 1, type: 'result', ...this.session.intent(message, c.channelId) }));
  }
}
