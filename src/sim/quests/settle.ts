import type { EntityId } from '../core/types';
import type { World } from '../core/world';
import { deriveObjectives, type DeriveOptions } from './derive';
import type { Objective, ObjectiveReceipt } from './types';

/**
 * Issue one `objective_completed` receipt per completed objective, and pay what the giver
 * offered out of the giver's own wealth.
 *
 * Idempotent: an objective's id already names the receipt count for its key, so once its
 * receipt exists the same id is never derived again. Finite: silver moves between persons
 * (conserved), capped by what the payer actually holds; nothing is minted. The receipt is
 * ordinary significant history (kept through compaction) and names the completion evidence
 * as its causes, the same path Tower floor-clear receipts use.
 */
export function settleObjectives(w: World, playerId: EntityId, options: DeriveOptions = {}): ObjectiveReceipt[] {
  const player = w.person(playerId); if (!player?.alive) return [];
  const issued = new Set(w.events.filter(e => e.type === 'objective_completed' && e.actor === playerId).map(e => String(e.data.objectiveId)));
  const out: ObjectiveReceipt[] = [];
  for (const o of deriveObjectives(w, playerId, options)) {
    if (!o.complete || issued.has(o.id)) continue;
    const payer = o.reward.from ? w.person(o.reward.from) : undefined;
    const silver = payer?.alive && payer.id !== playerId ? Math.max(0, Math.min(o.reward.silver, Math.floor(payer.wealth))) : 0;
    if (payer && silver > 0) { payer.wealth -= silver; player.wealth += silver; }
    const e = w.emit('objective_completed', { actor: playerId, target: o.giverId ?? undefined, pos: w.primaryBody(playerId)?.pos,
      causes: [...new Set([...o.causes, ...o.evidence])], significance: .6, visibility: 6, loudness: 2,
      data: { objectiveId: o.id, key: o.key, kind: o.kind, cause: o.cause, stage: o.stage, silver, payerId: silver ? payer!.id : null, facts: o.facts },
      summary: `${player.name} completed "${o.title}"${silver ? ` and was paid ${silver} silver by ${payer!.name}` : ''}` });
    issued.add(o.id);
    out.push({ objectiveId: o.id, key: o.key, eventId: e.id, tick: e.tick, silver, payerId: silver ? payer!.id : null });
  }
  return out;
}

/** Receipts already issued to this player, oldest first. */
export function objectiveReceipts(w: World, playerId: EntityId): ObjectiveReceipt[] {
  return w.events.filter(e => e.type === 'objective_completed' && e.actor === playerId).map(e => ({
    objectiveId: String(e.data.objectiveId), key: String(e.data.key), eventId: e.id, tick: e.tick, silver: Number(e.data.silver) || 0, payerId: e.data.payerId ?? null }));
}

/** Active objectives only: completed-and-receipted ones are history, not tasks. */
export function activeObjectives(w: World, playerId: EntityId, options: DeriveOptions = {}): Objective[] {
  return deriveObjectives(w, playerId, options).filter(o => !o.complete);
}
