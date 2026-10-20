import type { EntityId, Person } from '../core/types';
import type { World } from '../core/world';
import { RNG } from '../core/rng';
import { isExternallyControlled } from '../runtime/controllers';
import { CACHE_TIERS, RESERVE_STOCK, type ArchiveEntry, type CacheRecord, type HolderRecord, type JohnSmithState, type Ledger, type Notice } from './types';

export const MAX_LEDGERS = 256;
export const MAX_ITEM_DEEDS = 256;
export const MAX_ATTENTION = 96;
export const MAX_NOTICES = 80;
export const MAX_ARCHIVE = 120;
export const MAX_QUESTS = 120;
export const MAX_OPEN_QUESTS = 40;
export const MAX_WATCHED_QUESTS = 4;
export const MAX_MARKS = 400;
export const MAX_LANDMARKS = 256;
/** Interface holders a world can ever have had. Their records and ledgers are never evicted. */
export const MAX_HOLDERS = 1024;

/** FNV-1a over the world seed and string keys. John Smith never draws from `world.rng`: a
 * stable hash cannot shift any other stream, and gives the same answer after any reload. */
export function stableSeed(seed: number, ...keys: (string | number)[]): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (const c of keys.join('\u001f')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
export const stableRng = (seed: number, ...keys: (string | number)[]) => new RNG(stableSeed(seed, ...keys));

/** `e_123` -> 123. Event ids come from one monotonic counter, so this orders history. */
export function eventSeq(id: string | undefined): number {
  if (!id || !id.startsWith('e_')) return -1;
  const n = Number(id.slice(2));
  return Number.isSafeInteger(n) ? n : -1;
}

export function cacheId(tier: number, index: number): string { return `veil-cache:${CACHE_TIERS[tier].toLowerCase()}:${index}`; }
export function parseCacheId(id: string): { tier: number; index: number } | null {
  const m = /^veil-cache:([a-z]+):(\d{1,4})$/.exec(id); if (!m) return null;
  const tier = CACHE_TIERS.findIndex(t => t.toLowerCase() === m[1]), index = Number(m[2]);
  return tier >= 0 && index >= 1 && index <= RESERVE_STOCK[tier] ? { tier, index } : null;
}

/** Interface holders: the persons John Smith speaks to. The Veil traveller(s) carry it;
 * ordinary residents earn recognitions by the same rules but have no channel to receive them. */
export function interfaceHolders(world: World): Person[] {
  return world.persons().filter(p => p.alive && (isExternallyControlled(p) || p.id === world.playerId));
}
export function isInterfaceHolder(world: World, id: EntityId | undefined): boolean {
  const p = world.person(id); return !!p && p.alive && (isExternallyControlled(p) || p.id === world.playerId);
}

/** A finite "long ago" for cadence timers, so records survive JSON exactly. */
export const NEVER = -1e9;

export function emptyHolder(): HolderRecord {
  return { quests: [], notices: [], archive: [], wards: [], seen: [], entered: [], marks: {}, bestTrial: 0, renown: 0, questSeq: 0, safety: '' };
}
export function holderRecord(s: JohnSmithState, id: EntityId): HolderRecord { return s.holders[id] ??= emptyHolder(); }
/** The least recently active key, ties broken by id: deterministic in one linear scan. */
export function stalest(record: Record<string, { lastAt: number }>, skip?: (id: string) => boolean): string | undefined {
  let best: string | undefined;
  for (const id of Object.keys(record)) {
    if (skip?.(id)) continue;
    if (best === undefined || record[id].lastAt < record[best].lastAt || (record[id].lastAt === record[best].lastAt && id < best)) best = id;
  }
  return best;
}

export function ledgerOf(s: JohnSmithState, id: EntityId, now: number): Ledger {
  const existing = s.ledgers[id]; if (existing) return existing;
  const ids = Object.keys(s.ledgers);
  if (ids.length >= MAX_LEDGERS) {
    // Forget the least recently active non-holder ledgers, an eighth of the cap at a time so a
    // crowd churning through it costs one sort per batch. Holders keep theirs for life.
    const victims = ids.filter(k => !s.holders[k]).sort((a, b) => s.ledgers[a].lastAt - s.ledgers[b].lastAt || (a < b ? -1 : 1));
    for (const k of victims.slice(0, MAX_LEDGERS >> 3)) delete s.ledgers[k];
  }
  return s.ledgers[id] = { counts: {}, feats: {}, lastAt: now };
}

/**
 * The record is created lazily, the first time the host's watch pass runs. Its cursor starts
 * at the current end of history: John Smith begins watching when he arrives and does not award
 * old deeds retroactively. Any reserve items already in the world (an earlier record that was
 * lost) are reconciled, so a cache id is never issued twice.
 */
export function ensureJohnSmith(world: World): JohnSmithState {
  if (world.johnSmith) return world.johnSmith;
  const last = world.events.length ? eventSeq(world.events[world.events.length - 1].id) : -1;
  const s: JohnSmithState = { version: 1, cursor: last, origin: last, passAt: NEVER, attentionAt: NEVER, renownAt: NEVER,
    revision: 1, noticeSeq: 0, attention: {}, ledgers: {}, items: {}, holders: {}, caches: [] };
  reconcileReserve(world, s);
  world.johnSmith = s;
  return s;
}

/** Canonical reserve items carry their cache id. Rebuild any missing cache records from them. */
export function reconcileReserve(world: World, s: JohnSmithState): void {
  const known = new Set(s.caches.map(c => c.id));
  const found = new Map<string, { owner: string | null; items: string[]; coffer?: string }>();
  for (const item of world.items()) for (const tag of item.tags) {
    if (!tag.startsWith('veil-cache:') || !parseCacheId(tag)) continue;
    const entry = found.get(tag) ?? { owner: item.ownerId, items: [] };
    entry.items.push(item.id); found.set(tag, entry);
  }
  for (const c of world.containers()) for (const tag of c.tags) {
    if (!tag.startsWith('veil-cache:') || !parseCacheId(tag)) continue;
    const entry = found.get(tag) ?? { owner: c.ownerId, items: [] };
    entry.coffer = c.id; found.set(tag, entry);
  }
  for (const [id, entry] of [...found].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
    if (known.has(id)) continue;
    const { tier } = parseCacheId(id)!;
    s.caches.push({ id, tier, requested: tier, recipientId: entry.owner ?? '', reason: 'reconciled from canonical reserve items',
      grantedAt: world.now, grantEventId: '', openedAt: world.now, cofferId: entry.coffer, itemIds: entry.items.sort() });
  }
}

export function bump(s: JohnSmithState): void { s.revision++; }

export function notice(world: World, s: JohnSmithState, holderId: EntityId, n: Omit<Notice, 'seq' | 'at'>): Notice {
  const record = holderRecord(s, holderId), full: Notice = { ...n, seq: ++s.noticeSeq, at: world.now };
  record.notices.push(full); if (record.notices.length > MAX_NOTICES) record.notices.splice(0, record.notices.length - MAX_NOTICES);
  bump(s); return full;
}
export function archive(world: World, s: JohnSmithState, holderId: EntityId, entry: Omit<ArchiveEntry, 'at'>): void {
  const record = holderRecord(s, holderId);
  record.archive.push({ ...entry, at: world.now }); if (record.archive.length > MAX_ARCHIVE) record.archive.splice(0, record.archive.length - MAX_ARCHIVE);
  bump(s);
}
export function mark(record: HolderRecord, key: string, eventId: string): void {
  if (record.marks[key]) return;
  const keys = Object.keys(record.marks);
  if (keys.length >= MAX_MARKS) {
    // Per-subject marks (`kill:<id>`, `returned:<id>`) give way oldest first; a once-in-a-life
    // deed such as `realm_crossed` is never forgotten.
    const victim = keys.find(k => k.includes(':'));
    if (!victim) return;
    delete record.marks[victim];
  }
  record.marks[key] = eventId;
}

export function cachesGrantedIn(s: JohnSmithState, tier: number): number { return s.caches.filter(c => c.tier === tier).length; }
export function reserveStatus(s: JohnSmithState) {
  return CACHE_TIERS.map((name, tier) => { const granted = cachesGrantedIn(s, tier); return { tier, name, total: RESERVE_STOCK[tier], granted, remaining: Math.max(0, RESERVE_STOCK[tier] - granted) }; });
}

// ---------------------------------------------------------------- save validation

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const str = (x: unknown, max = 400): x is string => typeof x === 'string' && x.length <= max;
const strs = (x: unknown, maxLen: number, max = 400): x is string[] => Array.isArray(x) && x.length <= maxLen && x.every(v => str(v, max));
const counts = (x: unknown): boolean => isObj(x) && Object.keys(x).length <= 200 && Object.values(x).every(finite);

/** Structural validation of a saved record. A malformed record refuses the save, as every other
 * canonical subsystem does, rather than guessing which part was meant. Dangling references to
 * entities are tolerated: the watch pass simply finds nothing to say about them. */
export function restoreJohnSmith(raw: unknown): JohnSmithState | null {
  if (!isObj(raw) || raw.version !== 1 || !Number.isSafeInteger(raw.cursor) || !Number.isSafeInteger(raw.origin) || raw.origin > raw.cursor || !finite(raw.revision) || !Number.isSafeInteger(raw.noticeSeq)
    || !finite(raw.passAt) || !finite(raw.attentionAt) || !finite(raw.renownAt)
    || !isObj(raw.attention) || !isObj(raw.ledgers) || !isObj(raw.items) || !isObj(raw.holders) || !Array.isArray(raw.caches)) return null;
  // Holders keep their attention and ledgers for life, so those bounds grow with them.
  if (Object.keys(raw.holders).length > MAX_HOLDERS || Object.keys(raw.attention).length > MAX_ATTENTION + MAX_HOLDERS
    || Object.keys(raw.ledgers).length > MAX_LEDGERS + MAX_HOLDERS || Object.keys(raw.items).length > MAX_ITEM_DEEDS) return null;
  for (const a of Object.values(raw.attention)) if (!isObj(a) || !Number.isInteger(a.tier) || a.tier < 0 || a.tier > 5 || !finite(a.since) || !finite(a.significance)) return null;
  for (const l of Object.values(raw.ledgers)) {
    if (!isObj(l) || !counts(l.counts) || !isObj(l.feats) || !finite(l.lastAt) || Object.keys(l.feats).length > 200) return null;
    for (const f of Object.values(l.feats)) if (!isObj(f) || !finite(f.at) || !Number.isInteger(f.tier) || (f.eventId !== undefined && !str(f.eventId)) || (f.cacheId !== undefined && f.cacheId !== null && !str(f.cacheId))) return null;
    if (l.floor !== undefined && (!isObj(l.floor) || !str(l.floor.runId) || !Number.isInteger(l.floor.floor) || !finite(l.floor.taken))) return null;
  }
  for (const d of Object.values(raw.items)) if (!isObj(d) || ![d.hits, d.downs, d.kills, d.damage, d.firstAt, d.lastAt].every(finite) || !strs(d.wielders, 16)) return null;
  for (const h of Object.values(raw.holders)) {
    if (!isObj(h) || !Array.isArray(h.quests) || h.quests.length > MAX_QUESTS || !Array.isArray(h.notices) || h.notices.length > MAX_NOTICES
      || !Array.isArray(h.archive) || h.archive.length > MAX_ARCHIVE || !strs(h.wards, MAX_LANDMARKS) || !strs(h.seen, MAX_LANDMARKS) || !strs(h.entered, MAX_LANDMARKS)
      || !isObj(h.marks) || Object.keys(h.marks).length > MAX_MARKS || !Object.values(h.marks).every(v => str(v)) || (h.bestTrial !== undefined && !Number.isInteger(h.bestTrial)) || !finite(h.renown) || !Number.isSafeInteger(h.questSeq) || !str(h.safety)) return null;
    for (const q of h.quests) if (!validQuest(q)) return null;
    for (const n of h.notices) if (!isObj(n) || !Number.isSafeInteger(n.seq) || !finite(n.at) || !str(n.kind, 20) || !str(n.title, 300) || !str(n.text, 1200)
      || (n.tier !== undefined && !tierIndex(n.tier)) || (n.ref !== undefined && !str(n.ref, 200))) return null;
    for (const a of h.archive) if (!isObj(a) || !finite(a.at) || !str(a.kind, 40) || !str(a.text, 600)) return null;
  }
  const ids = new Set<string>();
  for (const c of raw.caches as CacheRecord[]) {
    const parsed = isObj(c) && str(c.id, 60) ? parseCacheId(c.id) : null;
    if (!parsed || ids.has(c.id) || parsed.tier !== c.tier || !Number.isInteger(c.requested) || c.requested < c.tier || c.requested > 5
      || !str(c.recipientId) || !str(c.reason, 200) || !finite(c.grantedAt) || !str(c.grantEventId)
      || (c.openedAt !== undefined && !finite(c.openedAt)) || (c.itemIds !== undefined && !strs(c.itemIds, 16)) || (c.withdrawnAt !== undefined && !finite(c.withdrawnAt))
      || ![c.featId, c.questId, c.openEventId, c.cofferId].every(x => x === undefined || str(x, 200))) return null;
    ids.add(c.id);
  }
  for (let tier = 0; tier < RESERVE_STOCK.length; tier++) if ((raw.caches as CacheRecord[]).filter(c => c.tier === tier).length > RESERVE_STOCK[tier]) return null;
  return structuredClone(raw) as JohnSmithState;
}
const tierIndex = (x: unknown): boolean => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 5;
const optional = <T>(x: unknown, valid: (x: unknown) => x is T) => x === undefined || valid(x);
function validQuest(q: unknown): boolean {
  if (!isObj(q)) return false;
  return str(q.id, 40) && str(q.key, 200) && str(q.kind, 20) && ['open', 'completed', 'failed', 'moot', 'faded'].includes(q.status)
    && str(q.title, 300) && str(q.summary, 1200) && isObj(q.source) && str(q.source.kind, 40) && str(q.source.id, 200)
    && optional(q.subjectId, str) && optional(q.itemId, str)
    && strs(q.basisKeys, 32) && Array.isArray(q.objectives) && q.objectives.length <= 16
    && q.objectives.every((o: unknown) => isObj(o) && str(o.id, 80) && str(o.text, 300) && typeof o.done === 'boolean' && optional(o.have, finite) && optional(o.need, finite))
    && (q.target === undefined || (isObj(q.target) && isObj(q.target.pos) && [q.target.pos.x, q.target.pos.y, q.target.pos.z].every(finite) && str(q.target.label, 200)))
    && (q.outcome === undefined || (isObj(q.outcome) && str(q.outcome.code, 40) && str(q.outcome.text, 600) && optional(q.outcome.eventId, str)))
    && [q.recognizedAt, q.seenAt, q.updatedAt].every(finite) && optional(q.closedAt, finite)
    && (q.rewardTier === -1 || tierIndex(q.rewardTier)) && (q.cacheId === undefined || q.cacheId === null || str(q.cacheId, 60))
    && typeof q.watched === 'boolean' && typeof q.dismissed === 'boolean';
}
