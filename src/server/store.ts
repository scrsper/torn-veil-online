import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeSync, copyFileSync, unlinkSync } from 'node:fs';
import { open, mkdir, rename, rm, readdir } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';

/**
 * Durable world state for one environment (dev/staging/live).
 *
 *   <state>/world/WORLD.json          identity; written once. Its presence means a world exists here
 *                                      and a fresh one must never be generated silently.
 *   <state>/world/gen-00000042/        one complete, self-verifying checkpoint:
 *        world.json                   the canonical save (schema from sim/persist/save.ts)
 *        meta.json                    generation, clocks, versions, generator fingerprint,
 *                                      account→character ownership, sha256 of world.json
 *   <state>/world/CURRENT             name of the newest committed generation
 *   <state>/writer.lock               exclusive writer fence (pid, release, env)
 *
 * A checkpoint is written into a temporary directory with fsync, renamed into place, and only then
 * named by CURRENT (itself written via fsync + rename). An interrupted write therefore leaves at
 * worst a `.tmp-*` directory (removed at next start) and CURRENT still naming the previous complete
 * generation. Loading verifies size + sha256 and falls back to older generations, reporting each
 * failure; it never returns "empty" for a directory that has an identity.
 */

export interface GeneratorIdentity { kind: 'playable' | 'ashford'; seed: number; version: string; fingerprint: string }
export interface WorldIdentity { format: 1; worldId: string; env: string; createdAtIso: string; generator: GeneratorIdentity; createdByRelease: string }
export interface CheckpointMeta {
  format: 1; worldId: string; generation: number; savedAtIso: string; reason: string;
  physicalTime: number; worldNow: number; saveSchema: number;
  generator: GeneratorIdentity; release: { version: string; revision: string };
  ownership: Record<string, string[]>;
  worldSha256: string; worldBytes: number;
}
export interface LoadedCheckpoint { meta: CheckpointMeta; world: string; dir: string }

const GEN = /^gen-(\d{8})$/;
const genName = (n: number) => `gen-${String(n).padStart(8, '0')}`;
export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

function writeDurableSync(path: string, data: string): void {
  const fd = openSync(path, 'w');
  try { writeSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
}
async function writeDurable(path: string, data: string): Promise<void> {
  const fh = await open(path, 'w');
  try { await fh.writeFile(data); await fh.sync(); } finally { await fh.close(); }
}

export class WriterFenceError extends Error {}
export class RefuseToStartError extends Error {}

/** Exclusive-writer fence. Only one process may hold write authority for a state directory. */
export class WriterLock {
  private readonly path: string;
  private held = false;
  /** Distinguishes two writers in one process (and a recycled pid) from ourselves. */
  private readonly nonce = randomUUID();
  constructor(stateDir: string, private readonly owner: { release: string; env: string }) { this.path = join(stateDir, 'writer.lock'); }
  static alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } }
  read(): { pid: number; nonce: string; release: string; env: string; startedAtIso: string; host: string } | null {
    try { return JSON.parse(readFileSync(this.path, 'utf8')); } catch { return null; }
  }
  acquire(): { tookOverStale: boolean } {
    const record = JSON.stringify({ pid: process.pid, nonce: this.nonce, ...this.owner, startedAtIso: new Date().toISOString(), host: hostname() });
    try {
      const fd = openSync(this.path, 'wx'); try { writeSync(fd, record); fsyncSync(fd); } finally { closeSync(fd); }
      this.held = true; return { tookOverStale: false };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const current = this.read();
      if (current && current.nonce !== this.nonce && WriterLock.alive(current.pid))
        throw new WriterFenceError(`State is owned by live writer pid ${current.pid} (release ${current.release}, since ${current.startedAtIso}); refusing to start a second writer.`);
      writeDurableSync(this.path + '.tmp', record); renameSync(this.path + '.tmp', this.path);
      this.held = true; return { tookOverStale: true };
    }
  }
  /** Fencing check before every durable write: abort if another process has taken authority. */
  verify(): void {
    const current = this.read();
    if (!this.held || !current || current.nonce !== this.nonce) throw new WriterFenceError('Writer lock lost; another process holds write authority. Refusing to write.');
  }
  release(): void {
    if (!this.held) return;
    const current = this.read();
    if (current?.nonce === this.nonce) { try { unlinkSync(this.path); } catch { /* already gone */ } }
    this.held = false;
  }
}

export class WorldStore {
  readonly worldDir: string;
  constructor(readonly stateDir: string, private readonly keepGenerations = 8) {
    this.worldDir = join(stateDir, 'world');
    mkdirSync(this.worldDir, { recursive: true });
  }
  identity(): WorldIdentity | null {
    const path = join(this.worldDir, 'WORLD.json');
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  }
  createIdentity(identity: WorldIdentity): void {
    const path = join(this.worldDir, 'WORLD.json');
    if (existsSync(path)) throw new RefuseToStartError('A world identity already exists here; refusing to create another.');
    writeDurableSync(path + '.tmp', JSON.stringify(identity, null, 2)); renameSync(path + '.tmp', path);
  }
  generations(): number[] {
    return readdirSync(this.worldDir).flatMap(n => { const m = GEN.exec(n); return m ? [Number(m[1])] : []; }).sort((a, b) => b - a);
  }
  current(): number | null {
    try { const m = GEN.exec(readFileSync(join(this.worldDir, 'CURRENT'), 'utf8').trim()); return m ? Number(m[1]) : null; } catch { return null; }
  }
  /** Remove debris of writes interrupted before their rename; returns what was removed. */
  cleanInterrupted(): string[] {
    const removed = readdirSync(this.worldDir).filter(n => n.startsWith('.tmp-') || n === 'CURRENT.tmp');
    for (const n of removed) rmSync(join(this.worldDir, n), { recursive: true, force: true });
    return removed;
  }
  private verifyDir(dir: string): LoadedCheckpoint {
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as CheckpointMeta;
    const world = readFileSync(join(dir, 'world.json'), 'utf8');
    if (Buffer.byteLength(world) !== meta.worldBytes) throw new Error(`size ${Buffer.byteLength(world)} ≠ recorded ${meta.worldBytes}`);
    if (sha256(world) !== meta.worldSha256) throw new Error('sha256 mismatch');
    return { meta, world, dir };
  }
  /**
   * Verified checkpoints, newest-trusted first: the CURRENT generation, then every other generation
   * in descending order. Failures are reported through `onReject` so a fallback is never silent.
   */
  *candidates(onReject: (generation: number, why: string) => void = () => {}): Generator<LoadedCheckpoint> {
    const identity = this.identity();
    const order = [...new Set([this.current(), ...this.generations()].filter((g): g is number => g !== null))];
    for (const g of order) {
      const dir = join(this.worldDir, genName(g));
      if (!existsSync(dir)) { onReject(g, 'missing directory'); continue; }
      try {
        const loaded = this.verifyDir(dir);
        if (identity && loaded.meta.worldId !== identity.worldId) { onReject(g, `belongs to world ${loaded.meta.worldId}`); continue; }
        yield loaded;
      } catch (e) { onReject(g, String((e as Error).message ?? e)); }
    }
  }
  /** Commit a checkpoint. `world` must already be a complete serialized snapshot. */
  async commit(world: string, meta: Omit<CheckpointMeta, 'generation' | 'worldSha256' | 'worldBytes' | 'format'>, fence?: WriterLock): Promise<CheckpointMeta> {
    fence?.verify();
    const generation = Math.max(0, ...this.generations()) + 1;
    const full: CheckpointMeta = { format: 1, ...meta, generation, worldSha256: sha256(world), worldBytes: Buffer.byteLength(world) };
    const tmp = join(this.worldDir, `.tmp-${genName(generation)}-${process.pid}`);
    await mkdir(tmp, { recursive: true });
    await writeDurable(join(tmp, 'world.json'), world);
    await writeDurable(join(tmp, 'meta.json'), JSON.stringify(full, null, 2));
    fence?.verify();
    await rename(tmp, join(this.worldDir, genName(generation)));
    await writeDurable(join(this.worldDir, 'CURRENT.tmp'), genName(generation));
    await rename(join(this.worldDir, 'CURRENT.tmp'), join(this.worldDir, 'CURRENT'));
    await this.prune();
    return full;
  }
  private async prune(): Promise<void> {
    const gens = this.generations(), current = this.current();
    for (const g of gens.slice(this.keepGenerations)) if (g !== current) await rm(join(this.worldDir, genName(g)), { recursive: true, force: true });
  }
  /** Total bytes held by retained generations (for metrics/soak growth tracking). */
  bytes(): number {
    let total = 0;
    for (const g of this.generations()) for (const f of ['world.json', 'meta.json']) { try { total += statSync(join(this.worldDir, genName(g), f)).size; } catch { /* pruned concurrently */ } }
    return total;
  }
  checkpointDir(generation: number): string { return join(this.worldDir, genName(generation)); }
  /** Install a verified checkpoint copied from elsewhere as the next generation (restore). Older
   * generations are kept, so a restore is itself reversible. Caller must hold the writer lock. */
  installFrom(sourceDir: string, fence: WriterLock, reason: string): CheckpointMeta {
    fence.verify();
    const loaded = this.verifyDir(sourceDir), identity = this.identity();
    if (identity && identity.worldId !== loaded.meta.worldId) throw new RefuseToStartError(`Backup is of world ${loaded.meta.worldId}, not ${identity.worldId}`);
    const generation = Math.max(0, ...this.generations()) + 1;
    const meta: CheckpointMeta = { ...loaded.meta, generation, reason: `${reason} (from generation ${loaded.meta.generation})` };
    const tmp = join(this.worldDir, `.tmp-${genName(generation)}-${process.pid}`);
    mkdirSync(tmp, { recursive: true });
    copyFileSync(join(sourceDir, 'world.json'), join(tmp, 'world.json'));
    writeDurableSync(join(tmp, 'meta.json'), JSON.stringify(meta, null, 2));
    renameSync(tmp, join(this.worldDir, genName(generation)));
    writeDurableSync(join(this.worldDir, 'CURRENT.tmp'), genName(generation)); renameSync(join(this.worldDir, 'CURRENT.tmp'), join(this.worldDir, 'CURRENT'));
    return meta;
  }
}

/** Point-in-time copies of committed checkpoints into a separate backup root, with bounded retention:
 * the newest `recent` backups plus the newest backup of each of the last `days` days. */
export class BackupSet {
  constructor(readonly root: string, private readonly recent = 24, private readonly days = 30) { mkdirSync(root, { recursive: true }); }
  list(): { name: string; dir: string; meta: CheckpointMeta }[] {
    return readdirSync(this.root).filter(n => /^\d{8}T\d{6}Z-gen-\d{8}$/.test(n)).sort().reverse().flatMap(name => {
      try { return [{ name, dir: join(this.root, name), meta: JSON.parse(readFileSync(join(this.root, name, 'meta.json'), 'utf8')) as CheckpointMeta }]; } catch { return []; }
    });
  }
  async take(store: WorldStore, generation: number): Promise<string> {
    const source = store.checkpointDir(generation);
    const meta = JSON.parse(readFileSync(join(source, 'meta.json'), 'utf8')) as CheckpointMeta;
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const name = `${stamp}-${genName(generation)}`, tmp = join(this.root, `.tmp-${name}`), dir = join(this.root, name);
    await mkdir(tmp, { recursive: true });
    const world = readFileSync(join(source, 'world.json'));
    if (sha256(world) !== meta.worldSha256) { await rm(tmp, { recursive: true, force: true }); throw new Error(`generation ${generation} failed verification; not backed up`); }
    await writeDurable(join(tmp, 'world.json'), world.toString('utf8'));
    await writeDurable(join(tmp, 'meta.json'), JSON.stringify(meta, null, 2));
    const identity = store.identity(); if (identity) await writeDurable(join(tmp, 'WORLD.json'), JSON.stringify(identity, null, 2));
    await rename(tmp, dir);
    await this.prune();
    return dir;
  }
  private async prune(): Promise<void> {
    for (const n of (await readdir(this.root)).filter(n => n.startsWith('.tmp-'))) await rm(join(this.root, n), { recursive: true, force: true });
    const all = this.list(), keep = new Set(all.slice(0, this.recent).map(b => b.name)), seenDays = new Set<string>();
    const cutoff = Date.now() - this.days * 86400_000;
    for (const b of all) {
      const day = b.name.slice(0, 8), when = Date.parse(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T00:00:00Z`);
      if (when >= cutoff && !seenDays.has(day)) { seenDays.add(day); keep.add(b.name); }
    }
    for (const b of all) if (!keep.has(b.name)) await rm(b.dir, { recursive: true, force: true });
  }
}
