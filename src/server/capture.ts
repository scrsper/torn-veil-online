import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { AlphaConfig } from './config';
import { RefuseToStartError, WorldStore, WriterLock, WriterFenceError, type CheckpointMeta } from './store';

export class CaptureRefused extends Error {}

/** Case-insensitive on Windows, where C:\A and c:\a are the same directory. */
const norm = (p: string) => { const r = resolve(p).replace(/[\\/]+$/, ''); return process.platform === 'win32' ? r.toLowerCase() : r; };
/** True when one path is the other or lies inside it. */
export function pathsOverlap(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  return x === y || x.startsWith(y + sep) || y.startsWith(x + sep);
}

export interface CaptureResult { sourceGeneration: number; savedAtIso: string; physicalTime: number; installed: CheckpointMeta; replacedWorld: string | null }

/**
 * Copy the newest verified checkpoint of `from` into `to` (normally live → staging).
 *
 * Nothing in the destination is modified or removed until this process holds the destination's
 * exclusive writer fence and has confirmed no supervisor or server is serving it. Destinations
 * that are live, the source itself, overlap the source, or overlap any protected state root are
 * refused before any file is touched. The destination's previous world is moved aside rather
 * than deleted, and put back if installation fails.
 */
export async function captureState(from: AlphaConfig, to: AlphaConfig, opts: {
  /** Is a server answering for this environment? (HTTP health in production.) */
  isServing: (c: AlphaConfig) => Promise<boolean>;
  /** State roots that must never be written by a capture (e.g. the live environment). */
  protectedRoots?: string[];
  reason?: string;
}): Promise<CaptureResult> {
  if (to.env === 'live') throw new CaptureRefused('capture never writes to live (a stale copy must never replace newer live progress)');
  // A destination whose state is configured outside its own root could alias another environment.
  if (norm(to.stateDir) === norm(to.root) || !pathsOverlap(to.stateDir, to.root)) throw new CaptureRefused(`destination state ${to.stateDir} is not inside its environment root ${to.root}; refusing to capture`);
  for (const [a, b, what] of [[to.root, from.root, 'environment roots'], [to.stateDir, from.stateDir, 'state directories'], [to.stateDir, from.root, 'destination state and source root'], [to.root, from.stateDir, 'destination root and source state']] as const)
    if (pathsOverlap(a, b)) throw new CaptureRefused(`source and destination ${what} overlap (${a} / ${b}); refusing to capture`);
  for (const p of opts.protectedRoots ?? []) if (pathsOverlap(to.stateDir, p) || pathsOverlap(to.root, p)) throw new CaptureRefused(`destination ${to.stateDir} overlaps protected state ${p}; refusing to capture`);

  // Read-only: establish the source checkpoint before anything else.
  const source = new WorldStore(from.stateDir);
  const identity = source.identity();
  if (!identity) throw new CaptureRefused(`no world identity in ${from.env}`);
  const latest = source.candidates().next().value;
  if (!latest) throw new CaptureRefused(`no verified checkpoint in ${from.env}`);

  // Exclusive write authority over the destination comes first.
  mkdirSync(to.stateDir, { recursive: true });
  const lock = new WriterLock(to.stateDir, { release: 'ops-capture', env: to.env });
  try { lock.acquire(); }
  catch (e) { if (e instanceof WriterFenceError) throw new CaptureRefused(`destination ${to.env} is owned by another writer: ${e.message}`); throw e; }
  try {
    // A supervisor removes its lock on exit; a live one would restart a server onto the new state.
    // A crashed supervisor's lock with a recycled pid also refuses: fail closed, operator clears it.
    const supervisor = readJson<{ pid?: number }>(join(to.root, 'supervisor.lock'));
    if ((supervisor?.pid && WriterLock.alive(supervisor.pid)) || await opts.isServing(to))
      throw new CaptureRefused(`stop ${to.env} before capturing into it`);
    lock.verify();

    const worldDir = join(to.stateDir, 'world');
    const stamp = new Date().toISOString().replace(/[-:.]/g, '');
    const aside = join(to.stateDir, `world.replaced-${stamp}`);
    const hadWorld = existsSync(worldDir);
    if (hadWorld) renameSync(worldDir, aside);
    try {
      const target = new WorldStore(to.stateDir);
      writeFileSync(join(target.worldDir, 'WORLD.json'), JSON.stringify(identity, null, 2));
      const installed = target.installFrom(latest.dir, lock, opts.reason ?? `captured from ${from.env}`);
      // Keep only the world this capture replaced; older replaced copies are superseded.
      for (const n of readdirSync(to.stateDir)) if (n.startsWith('world.replaced-') && join(to.stateDir, n) !== aside) rmSync(join(to.stateDir, n), { recursive: true, force: true });
      return { sourceGeneration: latest.meta.generation, savedAtIso: latest.meta.savedAtIso, physicalTime: installed.physicalTime, installed, replacedWorld: hadWorld ? aside : null };
    } catch (e) {
      rmSync(worldDir, { recursive: true, force: true });
      if (hadWorld) renameSync(aside, worldDir);
      if (e instanceof RefuseToStartError) throw new CaptureRefused(e.message);
      throw e;
    }
  } finally { lock.release(); }
}

function readJson<T>(path: string): T | null { try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { return null; } }
