import type { Person } from '../core/types';
import type { World } from '../core/world';
import type { JohnSmithState, Quest, QuestStatus } from './types';
import { RECOGNIZERS, RECOGNIZER_BY_KIND, type Candidate, type QuestContext, type Verdict } from './recognizers';
import { archive, bump, holderRecord, ledgerOf, MAX_OPEN_QUESTS, MAX_QUESTS, MAX_WATCHED_QUESTS, notice } from './state';
import { grantCache } from './reserve';
import { evaluateFeats } from './watch';
import { pick, VOICE } from './voice';

/** New quests take a tracker slot on their own only while this many are watched; the last
 * slot is the holder's to fill. */
const AUTO_WATCH_LIMIT = MAX_WATCHED_QUESTS - 1;
type Closing = Omit<Verdict, 'status'> & { status: Exclude<QuestStatus, 'open'> };

/**
 * The quest lifecycle for one interface holder. Every evaluation: merge the matters the
 * recognizers currently see (one quest per key, ever); judge every open quest from the holder's
 * evidence; let quests nobody has seen evidence of for long enough fade. A closed quest never
 * reopens. A matter that opened and ended between two passes is recorded once, as closed.
 */
export function evaluateQuests(world: World, s: JohnSmithState, holder: Person): void {
  const record = holderRecord(s, holder.id), now = world.now;
  const ctx: QuestContext = { world, s, holder, body: world.primaryBody(holder.id), record, now };
  const candidates = RECOGNIZERS.flatMap(r => r.scan(ctx)).sort((a, b) => b.priority - a.priority || (a.key < b.key ? -1 : 1));
  const created: Quest[] = [];
  for (const c of candidates) { const q = merge(world, s, holder, c); if (q) created.push(q); }
  for (const q of record.quests) {
    if (q.status !== 'open') continue;
    const verdict = RECOGNIZER_BY_KIND.get(q.kind)?.judge(ctx, q) ?? null;
    if (verdict) close(world, s, holder, q, verdict);
  }
  for (const q of created) if (q.status === 'open') notice(world, s, holder.id, { kind: 'quest', title: q.title, text: pick(world.seed, `recognized:${q.key}`, VOICE.questRecognized(q.title)), ref: q.id });
  for (const q of record.quests) {
    if (q.status !== 'open') continue;
    const fadeAfter = RECOGNIZER_BY_KIND.get(q.kind)?.fadeAfter ?? null;
    if (fadeAfter !== null && now - q.seenAt > fadeAfter) close(world, s, holder, q, { status: 'faded', code: 'faded', text: 'No word of it in a long while.' });
  }
  if (record.quests.length > MAX_QUESTS) {
    // Oldest closed matters leave the journal first; open ones never do.
    const closed = record.quests.filter(q => q.status !== 'open').sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
    const drop = new Set(closed.slice(0, record.quests.length - MAX_QUESTS).map(q => q.id));
    record.quests = record.quests.filter(q => !drop.has(q.id));
  }
}

/** Fold a candidate into the journal. Returns a newly created quest, so the caller can announce
 * it only if it is still open after judgement. */
function merge(world: World, s: JohnSmithState, holder: Person, c: Candidate): Quest | null {
  const record = holderRecord(s, holder.id), now = world.now;
  const existing = record.quests.find(q => q.key === c.key);
  if (existing) {
    if (existing.status !== 'open') return null;
    existing.seenAt = now;
    const before = JSON.stringify([existing.title, existing.summary, existing.objectives, existing.target ?? null]);
    for (const o of c.objectives) {
      const old = existing.objectives.find(x => x.id === o.id);
      if (o.done && old && !old.done && existing.watched) notice(world, s, holder.id, { kind: 'objective', title: existing.title, text: pick(world.seed, `objective:${existing.id}:${o.id}`, VOICE.objective(o.text)), ref: existing.id });
    }
    existing.title = c.title; existing.summary = c.summary; existing.objectives = c.objectives; existing.target = c.target; existing.basisKeys = c.basisKeys;
    if (existing.rewardTier !== c.rewardTier) { existing.rewardTier = c.rewardTier; bump(s); }
    if (before !== JSON.stringify([existing.title, existing.summary, existing.objectives, existing.target ?? null])) { existing.updatedAt = now; bump(s); }
    return null;
  }
  if (record.quests.filter(q => q.status === 'open').length >= MAX_OPEN_QUESTS) return null;
  const watched = c.autoWatch && record.quests.filter(q => q.status === 'open' && q.watched).length < AUTO_WATCH_LIMIT;
  const q: Quest = { id: `q-${++record.questSeq}`, key: c.key, kind: c.kind, status: 'open', title: c.title, summary: c.summary, source: c.source,
    ...(c.subjectId ? { subjectId: c.subjectId } : {}), ...(c.itemId ? { itemId: c.itemId } : {}), basisKeys: c.basisKeys, objectives: c.objectives,
    ...(c.target ? { target: c.target } : {}), recognizedAt: now, seenAt: now, updatedAt: now, rewardTier: c.rewardTier, watched, dismissed: false };
  record.quests.push(q); bump(s);
  return q;
}

const DAY = 86400;
/** Whether the reserve already paid this holder for this kind of matter within the last world day.
 * Trials are paced by altitude instead (see the trial recognizer). */
export function paidToday(world: World, s: JohnSmithState, holderId: string, kind: Quest['kind']): boolean {
  return kind !== 'trial' && s.caches.some(c => c.recipientId === holderId && c.reason.startsWith(`quest:${kind}:`) && c.grantedAt > world.now - DAY);
}

function close(world: World, s: JohnSmithState, holder: Person, q: Quest, v: Closing): void {
  const record = holderRecord(s, holder.id), credited = v.status === 'completed' && v.credit !== false;
  // Decided before the matter closes, so this quest's own payment cannot count against it.
  const pays = credited && q.rewardTier >= 0 && !paidToday(world, s, holder.id, q.kind);
  if (v.status === 'completed' && v.credit === false) v = { ...v, text: `${v.text} Not by your hand; the archive pays for deeds, not luck.` };
  else if (credited && q.rewardTier >= 0 && !pays) v = { ...v, text: `${v.text} The archive has already paid for a matter of this kind today.` };
  q.status = v.status; q.closedAt = world.now; q.updatedAt = world.now; q.watched = false;
  q.outcome = { code: v.code, text: v.text, ...(v.eventId ? { eventId: v.eventId } : {}) };
  if (v.status === 'completed') for (const o of q.objectives) o.done = true;
  const line = v.status === 'completed' ? VOICE.questCompleted(q.title) : v.status === 'failed' ? VOICE.questFailed(q.title) : v.status === 'moot' ? VOICE.questMoot(q.title) : VOICE.questFaded(q.title);
  notice(world, s, holder.id, { kind: 'quest', title: q.title, text: `${pick(world.seed, `closed:${q.key}`, line)} ${v.text}`, ref: q.id });
  archive(world, s, holder.id, { kind: `quest_${v.status}`, text: `${v.status === 'completed' ? 'Settled' : v.status === 'failed' ? 'Failed' : v.status === 'moot' ? 'Withdrawn' : 'Let fade'}: ${q.title}. ${v.text}`, eventId: v.eventId });
  if (v.status !== 'completed') return;
  if (q.kind === 'trial') record.bestTrial = Math.max(record.bestTrial ?? 0, Number(q.key.split(':')[2]) || 0);
  if (!credited) { bump(s); return; }
  // Emptying one's own coffer is housekeeping after a reward, not a matter of the world: counting it
  // would let the reserve pay for its own deliveries.
  const l = ledgerOf(s, holder.id, world.now);
  if (q.kind !== 'coffer') l.counts.questsCompleted = (l.counts.questsCompleted ?? 0) + 1;
  if (pays) q.cacheId = grantCache(world, s, holder, q.rewardTier, `quest:${q.key}`, { questId: q.id })?.id ?? null;
  evaluateFeats(world, s, holder.id);
  bump(s);
}

/** Interface preference: show or hide a quest in the HUD tracker. Not a canonical act. */
export function watchQuest(s: JohnSmithState, holderId: string, questId: string, watch: boolean): string {
  const q = holderRecord(s, holderId).quests.find(q => q.id === questId);
  if (!q) return 'unknown_quest';
  if (watch && q.status !== 'open') return 'closed';
  if (q.watched === watch) return 'accepted';
  if (watch && holderRecord(s, holderId).quests.filter(x => x.status === 'open' && x.watched).length >= MAX_WATCHED_QUESTS) return 'watch_limit';
  q.watched = watch; bump(s); return 'accepted';
}
/** Interface preference: hide a quest from the journal. The matter itself is untouched. */
export function dismissQuest(s: JohnSmithState, holderId: string, questId: string, dismiss: boolean): string {
  const q = holderRecord(s, holderId).quests.find(q => q.id === questId);
  if (!q) return 'unknown_quest';
  if (q.dismissed !== dismiss) { q.dismissed = dismiss; if (dismiss) q.watched = false; bump(s); }
  return 'accepted';
}
