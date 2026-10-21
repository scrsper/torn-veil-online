/** Local host for the isolated universe travel slice. Existing World/Person saves
 * are intentionally never opened or rewritten by this service. */
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { generateSystem, universeSpec, type StarSystem, type UniverseSpec } from '../sim/world/universe/generation';
import {
  applyTravelCommand, createTravelState, neutralInput, parseUniverseCommand, stepTravel, travelStatus,
  type CommandResult, type TravelInput, type TravelState, type TravelStatus,
} from '../sim/world/universe/travel';
import { validateUniversePayload, type SavePayload } from '../sim/world/universe/persistence';
export { validateUniversePayload, type SavePayload } from '../sim/world/universe/persistence';

export interface UniverseSnapshot {
  spec: UniverseSpec; system: StarSystem; state: TravelState; revision: number; status: TravelStatus;
  sessionId: string; lastSeq: number; durableSeq?: number;
}
export interface UniverseReceipt extends CommandResult { snapshot: UniverseSnapshot }

const FORMAT = 'torn-veil-universe';
const SAVE_VERSION = 1;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class UniverseRuntime {
  readonly directory: string;
  readonly sessionId = randomUUID();
  readonly spec: UniverseSpec;
  readonly state: TravelState;
  revision = 0;
  lastSeq = 0;
  private input: TravelInput = neutralInput();
  private inputTick = -100;
  private readonly lockPath: string;
  private readonly savePath: string;
  private readonly lockToken = randomUUID();
  private closed = false;
  private fault: Error | null = null;

  /** A failed durable write fences this runtime until the process is restarted
   * from its last committed save. No undurable snapshot is served as success. */
  get failureReason(): string | null { return this.fault?.message ?? null; }

  constructor(options: { directory: string; seed?: number }) {
    if (!options.directory.trim()) throw Error('An explicit isolated universe save directory is required');
    this.directory = resolve(options.directory);
    mkdirSync(this.directory, { recursive: true });
    this.lockPath = join(this.directory, 'writer.lock');
    this.savePath = join(this.directory, 'universe-v1.json');
    let fd: number;
    try { fd = openSync(this.lockPath, 'wx'); }
    catch { throw Error(`Universe save is locked: ${this.lockPath}. Stop its host first. After an unclean exit, verify the recorded PID has stopped before removing only this lock.`); }
    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid, token: this.lockToken, kind: FORMAT }));
      fsyncSync(fd);
    } finally { closeSync(fd); }
    try {
      if (existsSync(this.savePath)) {
        if (statSync(this.savePath).size > 128 * 1024 * 1024) throw Error('Universe save exceeds supported size');
        const raw: unknown = JSON.parse(readFileSync(this.savePath, 'utf8'));
        if (!isRecord(raw) || raw.format !== FORMAT || raw.version !== SAVE_VERSION || raw.checksum !== digest(raw.payload))
          throw Error('Universe save checksum or version is invalid; refusing to reset');
        const saved = validateUniversePayload(raw.payload);
        if (options.seed !== undefined && saved.spec.seed !== universeSpec(options.seed).seed) throw Error('Configured seed differs from the existing universe save');
        this.spec = saved.spec; this.state = saved.state; this.revision = saved.revision;
        // Never replay held thrust or an unattended autopilot after process restart.
        this.state.cruise = false; this.state.landing = false; this.state.velocity = { x: 0, y: 0, z: 0 }; this.revision++;
      } else {
        this.spec = universeSpec(options.seed ?? 20261017); this.state = createTravelState(this.spec);
        this.save();
      }
    } catch (error) {
      this.releaseLock();
      throw error;
    }
  }
  snapshot(): UniverseSnapshot {
    this.assertHealthy();
    return {
      spec: { ...this.spec }, system: generateSystem(this.spec, this.state.systemIndex), state: structuredClone(this.state),
      revision: this.revision, status: travelStatus(this.spec, this.state), sessionId: this.sessionId, lastSeq: this.lastSeq,
    };
  }
  command(value: unknown): UniverseReceipt {
    this.assertHealthy();
    const reject = (error: string): UniverseReceipt => ({ ok: false, error, snapshot: this.snapshot() });
    if (!isRecord(value) || value.sessionId !== this.sessionId) return reject('Stale or missing host session');
    if (!integer(value.seq, 1) || value.seq <= this.lastSeq) return reject('Stale command sequence');
    // Keep room for ordinary browser reloads without allowing a client to burn the sequence space.
    if (value.seq > this.lastSeq + 1000) return reject('Command sequence is too far ahead');
    let command;
    try { command = parseUniverseCommand(value.command); } catch (error) { return reject(String(error)); }
    this.lastSeq = value.seq; this.revision++;
    const result = applyTravelCommand(this.spec, this.state, command);
    if (result.ok && command.type === 'input') { this.input = command.input; this.inputTick = this.state.tick; }
    if (result.ok && command.type !== 'input') {
      this.input = neutralInput();
      this.save();
    }
    return { ...result, snapshot: this.snapshot() };
  }
  step(count = 1): void {
    this.assertHealthy();
    if (!integer(count, 1, 10000)) throw Error('Invalid fixed step count');
    for (let i = 0; i < count; i++) {
      if (this.state.tick - this.inputTick >= 10) this.input = neutralInput();
      const previousMode = this.state.mode;
      stepTravel(this.spec, this.state, this.input);
      this.revision++;
      // Discovery and embodiment changes are durable before a client can observe
      // touchdown. Routine continuous motion keeps the bounded autosave cadence.
      if ((previousMode === 'flight' && this.state.mode === 'surface') || this.state.tick % 100 === 0) this.save();
    }
  }
  save(): void {
    this.assertHealthy();
    try {
      const payload: SavePayload = { spec: this.spec, state: this.state, revision: this.revision };
      const encoded = JSON.stringify({ format: FORMAT, version: SAVE_VERSION, checksum: digest(payload), payload });
      const temporary = `${this.savePath}.${this.lockToken}.tmp`, fd = openSync(temporary, 'w');
      try { writeFileSync(fd, encoded); fsyncSync(fd); } finally { closeSync(fd); }
      this.assertHealthy();
      renameSync(temporary, this.savePath);
    } catch (error) {
      this.fault = new Error(`Universe persistence failed; host is paused until recovery: ${error instanceof Error ? error.message : String(error)}`);
      throw this.fault;
    }
  }
  close(): void {
    if (this.closed) return;
    // A failed command may have mutated memory. Never overwrite the last durable
    // save with that rejected state while shutting down a faulted runtime.
    try { if (!this.fault) this.save(); } finally { this.closed = true; this.releaseLock(); }
  }
  private assertHealthy(): void {
    if (this.closed) throw Error('Universe host is closed');
    if (this.fault) throw this.fault;
    try {
      const lock: unknown = JSON.parse(readFileSync(this.lockPath, 'utf8'));
      if (!isRecord(lock) || lock.token !== this.lockToken || lock.pid !== process.pid || lock.kind !== FORMAT)
        throw Error('The writer lock belongs to another host');
    } catch (error) {
      this.fault = new Error(`Universe writer ownership lost; host is paused until recovery: ${error instanceof Error ? error.message : String(error)}`);
      throw this.fault;
    }
  }
  private releaseLock(): void {
    if (!existsSync(this.lockPath)) return;
    // A corrupt or replaced lock is evidence owned by recovery/the new writer.
    // Shutdown must not remove it or hide the original failure with a parse error.
    try {
      const lock: unknown = JSON.parse(readFileSync(this.lockPath, 'utf8'));
      if (isRecord(lock) && lock.token === this.lockToken) unlinkSync(this.lockPath);
    } catch { /* Preserve an unreadable/replaced lock for explicit recovery. */ }
  }
}
