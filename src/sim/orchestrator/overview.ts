import type { Body } from '../core/types';
import type { World } from '../core/world';
import { interiorSlot } from '../world/interiors/layout';
import { ITEM_REACH } from '../physical/hand';
import { realmAt } from '../world/realms/layout';
import { ATTENTION_THRESHOLDS, ATTENTION_TIERS, CACHE_TIERS, type ArchiveEntry, type Notice, type Quest, type QuestObjective } from './types';
import { FEATS, FEAT_BY_ID } from './feats';
import { holderRecord, reserveStatus } from './state';
import { cacheSafety, itemLegend, LEGEND_TIERS } from './reserve';
import { nameIfKnown } from './watch';
import { paidToday } from './quests';
import { pick, VOICE } from './voice';

/**
 * The interface John Smith presents to one holder. An explicit allowlist, rebuilt from his record
 * and the holder's own state: quests from their evidence, their own deeds and standing, coarse
 * attention on people they know by name, and the reserve. It never carries a canonical name the
 * holder lacks, another mind's beliefs, a hidden location or an event summary written for
 * developers. Detached copies only; nothing here can mutate the world.
 */
export interface QuestView {
  id: string; kind: Quest['kind']; status: Quest['status']; title: string; summary: string;
  /** `reach`: walkable from where the holder stands, behind the folded walls of an interior, or
   * across the Veil. A bearing is only meaningful for `here`. */
  objectives: QuestObjective[]; target: { x: number; y: number; z: number; label: string; reach: 'here' | 'walls' | 'veil' } | null;
  watched: boolean; dismissed: boolean; recognizedAt: number; closedAt: number | null;
  outcome: string | null; rewardTier: number; rewardTierName: string | null; cacheId: string | null;
}
export interface JohnSmithView {
  version: 1; revision: number; holderId: string; name: string;
  /** Identifies this John Smith record; notice sequence numbers are only comparable within it. */
  epoch: number;
  standing: { tier: number; tierName: string; significance: number; nextTierAt: number | null; nextTierName: string | null; renown: number; recognitions: number; opened: number; unopened: number };
  tracker: QuestView[];
  quests: QuestView[];
  dismissed: number;
  watch: { known: { name: string; tier: number; tierName: string; since: number; self: boolean }[]; beyond: number };
  feats: { earned: { id: string; name: string; line: string; tier: number; tierName: string; reward: boolean; group: string; at: number; cacheId: string | null }[]; total: number;
    next: { name: string; hint: string; have: number; need: number; tier: number; tierName: string; reward: boolean }[] };
  loot: {
    caches: { id: string; tier: number; tierName: string; reason: string; grantedAt: number; opened: boolean; openedAt: number | null; items: string[] }[];
    reserve: { tier: number; name: string; total: number; remaining: number }[];
    safety: string; safetyText: string;
    coffer: { id: string; name: string; tier: number; withinReach: boolean; items: { id: string; name: string; type: string; kind: string; quantity: number }[] } | null;
    appraisals: { itemId: string; name: string; legend: number; legendName: string; hits: number; downs: number; kills: number; wielders: number }[];
  };
  notices: Notice[];
  archive: ArchiveEntry[];
}

function reach(body: Body | undefined, pos: { x: number; z: number }): 'here' | 'walls' | 'veil' {
  if (!body) return 'here';
  if (interiorSlot(pos.x, pos.z) !== interiorSlot(body.pos.x, body.pos.z)) return 'walls';
  return realmAt(pos.x, pos.z) === realmAt(body.pos.x, body.pos.z) ? 'here' : 'veil';
}
/** `payable`: an open quest that would still be paid for, or a closed one that was. */
function questView(q: Quest, payable: boolean, body: Body | undefined): QuestView {
  const tier = payable ? q.rewardTier : -1;
  return { id: q.id, kind: q.kind, status: q.status, title: q.title, summary: q.summary, objectives: q.objectives.map(o => ({ ...o })),
    target: q.target ? { ...q.target.pos, label: q.target.label, reach: reach(body, q.target.pos) } : null, watched: q.watched, dismissed: q.dismissed,
    recognizedAt: q.recognizedAt, closedAt: q.closedAt ?? null, outcome: q.outcome?.text ?? null, rewardTier: tier,
    rewardTierName: tier >= 0 ? CACHE_TIERS[tier] : null, cacheId: q.cacheId ?? null };
}
function reasonText(world: World, holderId: string, reason: string): string {
  if (reason.startsWith('feat:')) return `Feat: ${FEAT_BY_ID.get(reason.slice(5))?.name ?? reason.slice(5)}`;
  if (reason.startsWith('quest:')) { const q = holderRecord(world.johnSmith!, holderId).quests.find(q => q.key === reason.slice(6)); return `Matter: ${q?.title ?? 'a closed matter'}`; }
  return reason;
}

export function johnSmithView(world: World, holderId: string): JohnSmithView | null {
  const s = world.johnSmith, holder = world.person(holderId);
  if (!s || !holder) return null;
  const record = holderRecord(s, holderId), ledger = s.ledgers[holderId], body = world.primaryBody(holderId);
  const significance = world.historicalSignificance.get(holderId) ?? 0, tier = s.attention[holderId]?.tier ?? 1;
  const open = record.quests.filter(q => q.status === 'open' && !q.dismissed).sort((a, b) => Number(b.watched) - Number(a.watched) || b.updatedAt - a.updatedAt);
  const closed = record.quests.filter(q => q.status !== 'open').sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)).slice(0, 24);
  const known: JohnSmithView['watch']['known'] = [{ name: holder.name, tier, tierName: ATTENTION_TIERS[tier], since: s.attention[holderId]?.since ?? 0, self: true }];
  let beyond = 0;
  for (const [id, a] of Object.entries(s.attention).sort((x, y) => y[1].significance - x[1].significance || (x[0] < y[0] ? -1 : 1))) {
    if (id === holderId || a.tier < 2) continue;
    const name = nameIfKnown(world, holder, id);
    if (name) known.push({ name, tier: a.tier, tierName: ATTENTION_TIERS[a.tier], since: a.since, self: false }); else beyond++;
  }
  const earned = Object.entries(ledger?.feats ?? {}).flatMap(([id, f]) => { const feat = FEAT_BY_ID.get(id); return feat ? [{ id, name: feat.name, line: feat.line, tier: feat.tier, tierName: CACHE_TIERS[feat.tier], reward: feat.reward, group: feat.group, at: f.at, cacheId: f.cacheId ?? null }] : []; })
    .sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1));
  const next = FEATS.filter(f => !ledger?.feats[f.id]).map(f => ({ f, have: Math.max(0, Math.min(f.at, ledger?.counts[f.counter] ?? 0)) }))
    .filter(x => x.have > 0).sort((a, b) => b.have / b.f.at - a.have / a.f.at || a.f.at - b.f.at).slice(0, 4)
    .map(({ f, have }) => ({ name: f.name, hint: f.hint, have, need: f.at, tier: f.tier, tierName: CACHE_TIERS[f.tier], reward: f.reward }));
  const view = (q: Quest) => questView(q, q.status === 'open' ? !paidToday(world, s, holderId, q.kind) : !!q.cacheId, body);
  const mine = s.caches.filter(c => c.recipientId === holderId).sort((a, b) => Number(a.openedAt !== undefined) - Number(b.openedAt !== undefined) || b.grantedAt - a.grantedAt);
  const safety = cacheSafety(world, holder);
  const coffer = body ? world.containers().filter(c => c.tags.includes('veil-cache') && c.ownerId === holderId && c.pos && c.itemIds.length
    && Math.hypot(c.pos.x - body.pos.x, c.pos.y - body.pos.y, c.pos.z - body.pos.z) <= 6)
    .sort((a, b) => Math.hypot(a.pos!.x - body.pos.x, a.pos!.z - body.pos.z) - Math.hypot(b.pos!.x - body.pos.x, b.pos!.z - body.pos.z))[0] : undefined;
  const cofferTier = coffer ? CACHE_TIERS.findIndex(t => coffer.tags.includes(`loot:${t.toLowerCase()}`)) : -1;
  const appraisals = holder.inventory.flatMap(id => {
    const item = world.item(id), d = s.items[id]; if (!item || item.holderId !== holderId || !d) return [];
    const legend = itemLegend(s, id);
    return [{ itemId: id, name: item.name, legend: legend.tier, legendName: LEGEND_TIERS[legend.tier], hits: d.hits, downs: d.downs, kills: d.kills, wielders: d.wielders.length }];
  });
  return {
    version: 1, revision: s.revision, holderId, name: holder.name, epoch: s.origin,
    standing: { tier, tierName: ATTENTION_TIERS[tier], significance: Math.round(significance * 10) / 10,
      nextTierAt: tier + 1 < ATTENTION_THRESHOLDS.length ? ATTENTION_THRESHOLDS[tier + 1] : null, nextTierName: tier + 1 < ATTENTION_TIERS.length ? ATTENTION_TIERS[tier + 1] : null,
      renown: record.renown, recognitions: earned.length, opened: mine.filter(c => c.openedAt !== undefined).length, unopened: mine.filter(c => c.openedAt === undefined).length },
    tracker: open.filter(q => q.watched).map(view),
    quests: [...open, ...closed.filter(q => !q.dismissed)].map(view),
    dismissed: record.quests.filter(q => q.dismissed).length,
    watch: { known, beyond },
    feats: { earned, total: FEATS.length, next },
    loot: {
      caches: mine.map(c => ({ id: c.id, tier: c.tier, tierName: CACHE_TIERS[c.tier], reason: reasonText(world, holderId, c.reason), grantedAt: c.grantedAt,
        opened: c.openedAt !== undefined, openedAt: c.openedAt ?? null, items: (c.itemIds ?? []).map(id => world.item(id)?.name ?? 'an item') })),
      reserve: reserveStatus(s).map(r => ({ tier: r.tier, name: r.name, total: r.total, remaining: r.remaining })),
      safety, safetyText: safety === 'ok' ? 'A safe moment. Caches may be opened here.' : pick(world.seed, `safety:${safety}`, VOICE.unsafe(safety)),
      coffer: coffer ? { id: coffer.id, name: coffer.name, tier: Math.max(0, cofferTier),
        withinReach: Math.hypot(coffer.pos!.x - body!.pos.x, coffer.pos!.z - body!.pos.z) <= ITEM_REACH, items: coffer.itemIds.flatMap(id => {
        const i = world.item(id); return i ? [{ id: i.id, name: i.name, type: i.type, kind: i.tags.find(t => t.startsWith('loot-kind:'))?.slice(10) ?? i.type, quantity: i.quantity }] : []; }) } : null,
      appraisals,
    },
    notices: record.notices.slice(-30).map(n => ({ ...n })),
    archive: record.archive.slice(-40).map(a => ({ ...a })),
  };
}

/** Developer truth for the Observatory: canonical names, every holder and the whole reserve.
 * Never sent to a player interface. */
export function johnSmithDeveloperView(world: World) {
  const s = world.johnSmith; if (!s) return null;
  return {
    cursor: s.cursor, revision: s.revision,
    attention: Object.entries(s.attention).sort((a, b) => b[1].significance - a[1].significance).slice(0, 40)
      .map(([id, a]) => ({ id, name: world.nameOf(id), tier: ATTENTION_TIERS[a.tier], significance: Math.round(a.significance * 100) / 100, since: a.since })),
    reserve: reserveStatus(s), caches: s.caches.map(c => ({ ...c })),
    holders: Object.fromEntries(Object.entries(s.holders).map(([id, h]) => [id, { name: world.nameOf(id), renown: h.renown, wards: h.wards, seen: h.seen.length, entered: h.entered.length,
      open: h.quests.filter(q => q.status === 'open').map(q => ({ id: q.id, key: q.key, title: q.title, objectives: q.objectives, basisKeys: q.basisKeys })),
      closed: h.quests.filter(q => q.status !== 'open').slice(-12).map(q => ({ id: q.id, key: q.key, status: q.status, outcome: q.outcome })) }])),
    ledgers: Object.entries(s.ledgers).sort((a, b) => b[1].lastAt - a[1].lastAt).slice(0, 24)
      .map(([id, l]) => ({ id, name: world.nameOf(id), counts: l.counts, feats: Object.keys(l.feats) })),
    items: Object.entries(s.items).map(([id, d]) => ({ id, name: world.nameOf(id), ...d, legend: LEGEND_TIERS[itemLegend(s, id).tier] }))
      .sort((a, b) => b.downs + b.kills * 3 - (a.downs + a.kills * 3)).slice(0, 20),
  };
}
