import { createHash } from 'node:crypto';
import { RealmSession } from '../sim/world/realms/session';
import { enterCanonicalTower, ascendCanonicalTower, returnCanonicalTower } from '../sim/world/interiors/tower';
import type { CanonicalTowerRun } from '../sim/world/interiors/towerTypes';

export interface TowerCommand { id: string; type: 'enter' | 'ascend' | 'return'; revision: number; runId?: string }
export function applyTowerCommand(s: RealmSession, c: TowerCommand): CanonicalTowerRun {
  if (!c || typeof c.id !== 'string' || !/^[\w:-]{8,100}$/.test(c.id) || !Number.isSafeInteger(c.revision)
    || !['enter', 'ascend', 'return'].includes(c.type) || Object.keys(c).some(k => !['id', 'type', 'revision', 'runId'].includes(k))) throw Error('Invalid Tower command');
  const digest = createHash('sha256').update(JSON.stringify(c)).digest('hex'), run = s.world.canonicalTower;
  const prior = run?.commands.find(x => x.id === c.id);
  if (prior) { if (prior.digest !== digest) throw Error('Command identity reused with different data'); return structuredClone(run!); }
  if (c.revision !== (run?.revision ?? 0)) throw Error('Tower changed; reload its current state');
  if (run && c.runId !== run.id) throw Error('No matching canonical Tower run');
  if (c.type === 'enter' && s.snapshot().pending) throw Error('Cancel the pending portal crossing first');
  s.stop();
  const next = c.type === 'enter' ? enterCanonicalTower(s.world, s.person.id)
    : c.type === 'ascend' ? ascendCanonicalTower(s.world) : returnCanonicalTower(s.world);
  next.revision++;
  next.commands.push({ id: c.id, digest, revision: next.revision });
  // A run needs at most 300 ordinary transition receipts; an explicit bounded ledger
  // avoids unbounded saves. Evicted requests still fail the monotonic revision check.
  if (next.commands.length > 512) next.commands.shift();
  return structuredClone(next);
}
/** The host swaps the entire session after failure and rebinds its controller, so no
 * old simulation reference can keep mutating the rolled-back world. */
export function commitTower(s: RealmSession, c: TowerCommand, write: (raw: string) => void):
  { session: RealmSession; tower: CanonicalTowerRun; error?: never } | { session: RealmSession; tower?: never; error: string } {
  const before = s.save();
  try { const tower = applyTowerCommand(s, c); write(s.save()); return { session: s, tower }; }
  catch (e) { return { session: new RealmSession(0, before), error: String(e) }; }
}
