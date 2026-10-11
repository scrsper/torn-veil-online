import type { Point, RealmId } from './layout';

/** Host-owned travel binding. The legacy arena checkpoint is quarantined activity
 * data, not evidence for World items, injuries or advancement. Keeping it in this
 * save gives one resume location without promoting browser claims into truth. */
export interface RealmExpedition {
  version: 1;
  authority: 'checkpoint-only';
  personId: string;
  bodyId: string;
  towerId: string;
  realm: RealmId;
  returnPos: Point;
  runId: string;
  seed: number;
  active: boolean;
  status: 'open' | 'fallen' | 'completed';
  revision: number;
  checkpoint: unknown | null;
  lastCommand: { id: string; digest: string };
}

export function validRealmExpedition(x: unknown): x is RealmExpedition {
  if (!x || typeof x !== 'object') return false;
  const r = x as RealmExpedition;
  return r.version === 1 && r.authority === 'checkpoint-only'
    && [r.personId, r.bodyId, r.towerId, r.runId].every(v => typeof v === 'string' && v.length > 0 && v.length < 200)
    && ['aether', 'brass'].includes(r.realm) && typeof r.active === 'boolean'
    && ['open', 'fallen', 'completed'].includes(r.status)
    && Number.isSafeInteger(r.seed) && r.seed >= 0
    && Number.isSafeInteger(r.revision) && r.revision >= 1
    && !!r.returnPos && [r.returnPos.x, r.returnPos.y, r.returnPos.z].every(Number.isFinite)
    && !!r.lastCommand && typeof r.lastCommand.id === 'string' && r.lastCommand.id.length <= 100
    && typeof r.lastCommand.digest === 'string' && r.lastCommand.digest.length === 64;
}
