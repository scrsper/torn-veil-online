import type { World } from '../core/world';
import type { JohnSmithCommand } from './types';
import { ensureJohnSmith, holderRecord, interfaceHolders, isInterfaceHolder, ledgerOf, bump } from './state';
import { readAttention, readNewEvents, readRenown, readTravels, evaluateFeats } from './watch';
import { evaluateQuests, dismissQuest, watchQuest } from './quests';
import { cacheSafety, openCache, withdrawEmptyCoffers } from './reserve';

export { johnSmithView, johnSmithDeveloperView, type JohnSmithView, type QuestView } from './overview';
export { ensureJohnSmith, restoreJohnSmith } from './state';
export type { JohnSmithCommand, JohnSmithState } from './types';

/** Physical seconds between periodic passes. Events are read every call regardless. */
const PASS_SECONDS = 1;
const ATTENTION_SECONDS = 2;
const RENOWN_SECONDS = 10;

/**
 * John Smith's watch, run by the host after each canonical step. Pure function of World state and
 * canonical physical time, so the realm journal's replay reproduces it exactly. It reads history,
 * keeps its own record, and touches the physical world only to withdraw emptied coffers.
 */
export function observeJohnSmith(world: World): void {
  const s = ensureJohnSmith(world);
  const touched = readNewEvents(world, s);
  for (const id of [...touched].sort()) evaluateFeats(world, s, id);
  const t = world.physicalTime;
  if (t - s.passAt < PASS_SECONDS) return;
  s.passAt = t;
  if (t - s.attentionAt >= ATTENTION_SECONDS) readAttention(world, s);
  for (const holder of interfaceHolders(world)) {
    readTravels(world, s, holder);
    evaluateQuests(world, s, holder);
    const record = holderRecord(s, holder.id);
    if (s.caches.some(c => c.recipientId === holder.id && c.openedAt === undefined)) {
      const safety = cacheSafety(world, holder);
      if (record.safety !== safety) { record.safety = safety; bump(s); }
    }
  }
  if (t - s.renownAt >= RENOWN_SECONDS) readRenown(world, s);
  withdrawEmptyCoffers(world, s);
}

const ID = /^[\w:.-]{1,100}$/;
/** Exact-shape validation. Commands are journaled and replayed; anything else is refused whole. */
export function parseJohnSmithCommand(raw: unknown): JohnSmithCommand | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>, keys = Object.keys(c).sort().join(',');
  if (c.type === 'open_cache' && keys === 'cacheId,type' && typeof c.cacheId === 'string' && ID.test(c.cacheId)) return { type: 'open_cache', cacheId: c.cacheId };
  if (c.type === 'watch_quest' && keys === 'questId,type,watch' && typeof c.questId === 'string' && ID.test(c.questId) && typeof c.watch === 'boolean') return { type: 'watch_quest', questId: c.questId, watch: c.watch };
  if (c.type === 'dismiss_quest' && keys === 'dismiss,questId,type' && typeof c.questId === 'string' && ID.test(c.questId) && typeof c.dismiss === 'boolean') return { type: 'dismiss_quest', questId: c.questId, dismiss: c.dismiss };
  return null;
}

/** A holder's request to John Smith. Refusals change nothing except, where a cache could not be
 * opened, a notice saying why. Never throws on bad input. */
export function applyJohnSmithCommand(world: World, holderId: string, raw: unknown): { result: string; cofferId?: string; itemIds?: string[] } {
  const command = parseJohnSmithCommand(raw);
  if (!command) return { result: 'invalid_command' };
  const holder = world.person(holderId);
  if (!holder || !isInterfaceHolder(world, holderId)) return { result: 'no_interface' };
  const s = ensureJohnSmith(world);
  switch (command.type) {
    case 'open_cache': {
      const opened = openCache(world, s, holder, command.cacheId);
      if (opened.result === 'opened') {
        const l = ledgerOf(s, holder.id, world.now); l.counts.cachesOpened = (l.counts.cachesOpened ?? 0) + 1;
        evaluateFeats(world, s, holder.id);
      }
      return opened;
    }
    case 'watch_quest': return { result: watchQuest(s, holder.id, command.questId, command.watch) };
    case 'dismiss_quest': return { result: dismissQuest(s, holder.id, command.questId, command.dismiss) };
  }
}
