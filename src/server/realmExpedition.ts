import { createHash } from 'node:crypto';
import { RealmSession } from '../sim/world/realms/session';
import { realmAt, realmSeed } from '../sim/world/realms/layout';
import { validRealmExpedition, type RealmExpedition } from '../sim/world/realms/expedition';
import { validCheckpoint, type TowerCheckpoint } from '../web/arena/tower/checkpoint';

export interface ExpeditionCommand {
  id: string;
  type: 'enter' | 'checkpoint' | 'finish' | 'return';
  revision: number;
  runId?: string;
  checkpoint?: unknown;
  outcome?: 'fallen' | 'completed';
}
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** A failed disk write rolls back the travel mutation before the host accepts more
 * movement. Retrying an acknowledged command does not create another expedition. */
export function commitExpedition(s: RealmSession, c: ExpeditionCommand, write: (raw: string) => void):
  { session: RealmSession; expedition: RealmExpedition; error?: never } | { session: RealmSession; error: string; expedition?: never } {
  const before = s.save();
  try {
    const expedition = applyExpeditionCommand(s, c); write(s.save());
    return { session: s, expedition };
  } catch (e) { return { session: new RealmSession(0, before), error: String(e) }; }
}

export function validateExpeditionSave(s: RealmSession): void {
  const r = s.world.realmExpedition;
  if (!r) return;
  if (!validRealmExpedition(r) || r.personId !== s.person.id || r.bodyId !== s.body.id
    || r.towerId !== s.grid.chunk(r.realm, 32, 32).buildings[0].id
    || !s.world.nav.isWalkable(Math.floor(r.returnPos.x), Math.floor(r.returnPos.z))) throw Error('Invalid Tower travel binding; save retained.');
  if (r.checkpoint !== null && !boundCheckpoint(r.checkpoint, r)) throw Error('Invalid bound Tower checkpoint; save retained.');
}

function boundCheckpoint(x: unknown, r: RealmExpedition): x is TowerCheckpoint {
  if (!validCheckpoint(x) || JSON.stringify(x).length > 500000 || x.runId !== r.runId || x.climberId !== r.personId || x.seed !== r.seed) return false;
  const j = x.sheet.journey, c = j?.current;
  return !!j && !j.preview && j.seed === r.seed && j.legacyFloors === 0 && j.legacyExperience === 0
    && j.cleared.length === x.floor - 1 && !!c && c.floor === x.floor
    && c.seconds === 0 && c.damage === 0 && c.casts === 0 && c.targets.every(t => t.credited === 0 && !t.defeated);
}

/** All validation precedes mutation. Caller must atomically persist before acknowledging.
 * Schema/sequence checks are NOT proof of combat: no checkpoint changes Person or Items. */
export function applyExpeditionCommand(s: RealmSession, c: ExpeditionCommand): RealmExpedition {
  if (!c || typeof c.id !== 'string' || c.id.length < 8 || c.id.length > 100 || !Number.isSafeInteger(c.revision)) throw Error('Invalid expedition command.');
  const digest = createHash('sha256').update(JSON.stringify(c)).digest('hex');
  const previous = s.world.realmExpedition;
  if (previous?.lastCommand.id === c.id) {
    if (previous.lastCommand.digest !== digest) throw Error('Command identity reused with different data.');
    return clone(previous);
  }
  if (c.revision !== (previous?.revision ?? 0)) throw Error('Expedition changed. Reload its saved state before continuing.');
  if (s.body.dead || !s.body.present || !s.person.alive) throw Error('This body cannot enter or leave an expedition.');
  let next: RealmExpedition;
  if (c.type === 'enter') {
    if (s.world.canonicalTower?.active || previous?.active || !s.inTower() || s.snapshot().pending) throw Error('Enter through the Tower atrium first.');
    const realm = realmAt(s.body.pos.x, s.body.pos.z)!;
    const tower = s.grid.chunk(realm, 32, 32).buildings[0];
    const returnPos = { ...s.body.pos };
    if (!s.world.nav.isWalkable(Math.floor(returnPos.x), Math.floor(returnPos.z))) throw Error('The return landing is obstructed.');
    const resumed = previous?.status === 'open';
    next = {
      version: 1, authority: 'checkpoint-only', personId: s.person.id, bodyId: s.body.id,
      realm, towerId: tower.id, returnPos, active: true, status: 'open',
      runId: resumed ? previous.runId : s.world.nextId('tower-expedition'),
      seed: resumed ? previous.seed : realmSeed(s.world.seed, 'tower-expedition', previous?.revision ?? 0),
      checkpoint: resumed ? clone(previous.checkpoint) : null,
      revision: c.revision + 1, lastCommand: { id: c.id, digest },
    };
  } else {
    if (!previous?.active || c.runId !== previous.runId) throw Error('No matching active expedition.');
    next = clone(previous);
    if (c.type === 'checkpoint') {
      if (next.status !== 'open' || !boundCheckpoint(c.checkpoint, next)) throw Error('Checkpoint does not match this expedition.');
      const old = next.checkpoint as TowerCheckpoint | null;
      const expected = old ? old.floor + 1 : 1;
      if (c.checkpoint.floor !== expected) throw Error('Checkpoint must be the next floor boundary.');
      next.checkpoint = clone(c.checkpoint);
    } else if (c.type === 'finish') {
      if (next.status !== 'open' || !['fallen', 'completed'].includes(c.outcome ?? '')) throw Error('Invalid expedition outcome.');
      if (c.outcome === 'completed' && (next.checkpoint as TowerCheckpoint | null)?.floor !== 100) throw Error('Summit checkpoint required.');
      next.status = c.outcome!;
    } else if (c.type === 'return') {
      const p = next.returnPos;
      if (!s.world.nav.isWalkable(Math.floor(p.x), Math.floor(p.z))) throw Error('Return landing is obstructed; expedition retained.');
      next.active = false;
    } else throw Error('Unknown expedition command.');
    next.revision++;
    next.lastCommand = { id: c.id, digest };
  }
  s.stop();
  if (c.type === 'return') { s.body.pos = { ...next.returnPos }; s.body.vel = { x: 0, y: 0, z: 0 }; s.world.nav.rebuildAll(); }
  s.world.realmExpedition = next;
  return clone(next);
}
