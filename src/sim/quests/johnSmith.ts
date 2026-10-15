import type { Creature, EntityId, EventId, Person, WorldEvent } from '../core/types';
import type { World } from '../core/world';
import { RNG } from '../core/rng';
import { ONTOLOGY_BOUNDARY } from '../core/stages';
import { REALMS, realmAt } from '../world/realms/layout';
import { chainOrder, deriveObjectives, objectiveReceipts, requestTitle } from './derive';
import type { QuestLedger, QuestLedgerEntry, QuestState } from './ledger';
import { FIRST_HOUR_TOWER_FLOORS, type ChainStage, type Objective, type ObjectiveKind, type ObjectiveReceipt, type ObjectiveTarget } from './types';

/**
 * John Smith (Constitution §16–18): the orchestrator above the universe — scheduler, kernel,
 * archivist — standing past the simulation/ontology boundary. He is not a Person, Body or
 * Faction, holds no stage, and nothing in the world can advance to him. He is never added to
 * the World; inside it he is at most the name on a system quest and on a reserve payment.
 *
 * His quest layer is a fixed, authored catalogue. Each system quest names a world condition he
 * reads (the player has heard someone ask for help; a floor of their Tower run is clear; they
 * know a hostile thing has attacked someone). When it holds he issues the quest, with authored
 * text whose phrasing variant is chosen by a seeded RNG forked from the World seed and the
 * quest id. When the condition that meets it holds, he closes it and pays its reward once from
 * a finite reserve. He never creates a cause: no spawn, no request, no need, no drama
 * (Constitution §18). No LLM is consulted; the same World and the same calls give the same ledger.
 *
 * He also keeps the archive: emergent quests (quests/derive.ts) are copied into the same
 * ledger with their lifecycle and the payment the world itself made.
 */
export const JOHN_SMITH = Object.freeze({ id: 'john_smith' as const, name: 'John Smith', role: 'orchestrator' as const, beyond: ONTOLOGY_BOUNDARY });

/** Finite reserve per person, drawn down by system rewards and never refilled. */
export const SYSTEM_RESERVE = 60;

interface Ctx {
  w: World; player: Person; ledger: QuestLedger; byId: Map<string, QuestLedgerEntry>;
  /** The player's own floor-clear receipts, first per floor. */
  clears: Map<number, WorldEvent>;
}
interface Candidate {
  questId: string; kind: ObjectiveKind; stage: ChainStage; reward: number;
  facts: Record<string, string | number>; basis: EventId[];
  texts: readonly (readonly [title: string, detail: string])[];
}
interface Outcome { state: Exclude<QuestState, 'active' | 'lapsed'>; eventId: EventId | null }
interface SystemQuestFamily {
  candidates(ctx: Ctx): Candidate[];
  outcome(ctx: Ctx, entry: QuestLedgerEntry): Outcome | null;
  view?(ctx: Ctx, entry: QuestLedgerEntry): { target: ObjectiveTarget; progress: { current: number; required: number }; detail?: string };
}

const sys = (questId: string) => `system:${questId}`;
const has = (ctx: Ctx, questId: string, state?: QuestState) => { const e = ctx.byId.get(sys(questId)); return !!e && (!state || e.state === state); };
function emergentRequests(ctx: Ctx): QuestLedgerEntry[] { return ctx.ledger.entries.filter(e => e.origin === 'emergent' && e.source.type === 'request'); }
function townName(w: World, p: Person): string {
  const b = w.primaryBody(p.id), realm = b ? realmAt(b.pos.x, b.pos.z) : null;
  return (b && w.placeAt(b.pos)?.name) || (realm ? REALMS[realm].name : 'this place');
}

const ONBOARDING_LISTEN: SystemQuestFamily = {
  candidates: ctx => [{ questId: 'onboarding:listen', kind: 'tend', stage: 'town', reward: 2, facts: { town: townName(ctx.w, ctx.player) }, basis: [],
    texts: [['Listen to the people of {town}', 'People here say aloud what they need. Stay among them and listen; what you hear is real.'],
      ['Hear what {town} needs', 'Nothing here is staged for you. Walk among the residents and listen for someone asking for help.']] }],
  outcome: ctx => { const heard = emergentRequests(ctx)[0]; return heard ? { state: 'completed', eventId: heard.basis[0] ?? null } : null; },
};
const ONBOARDING_ANSWER: SystemQuestFamily = {
  candidates: ctx => has(ctx, 'onboarding:listen', 'completed') ? [{ questId: 'onboarding:answer', kind: 'deliver', stage: 'town', reward: 3, facts: {}, basis: [],
    texts: [['Answer someone who asked', 'Someone asked for help within your hearing. Meet their need; they will pay what they offered, from their own purse.'],
      ['Help one who asked', 'Do what one of them asked of anyone in earshot. Their thanks, and their silver, are their own.']] }] : [],
  outcome: ctx => { const done = emergentRequests(ctx).find(e => e.state === 'completed'); return done ? { state: 'completed', eventId: done.endedBy } : null; },
};
const TOWER_FLOOR: SystemQuestFamily = {
  candidates: ctx => {
    const { w, player } = ctx, run = w.canonicalTower;
    if (!w.realmSpec || (run && run.personId !== player.id)) return [];
    let highest = 0; while (ctx.clears.has(highest + 1)) highest++;
    // Floor 1 once the town has been answered or the player has gone in on their own.
    if (!highest && !run && !has(ctx, 'onboarding:answer', 'completed')) return [];
    const out: Candidate[] = [];
    for (let floor = 1; floor <= Math.min(highest + 1, FIRST_HOUR_TOWER_FLOORS); floor++) out.push({
      questId: `tower:floor:${floor}`, kind: 'reach_floor', stage: 'tower', reward: 2 + floor, facts: { floor },
      basis: floor > 1 ? [ctx.clears.get(floor - 1)!.id] : run ? [run.openedEventId] : [],
      texts: floor === 1
        ? [['Enter the Tower of Chrysanthus', 'The Tower stands open to anyone who walks in and accepts its trial. Clear its first floor.'],
          ['Climb into the Tower', 'Walk into the Tower of Chrysanthus, accept its trial, and clear the first floor.']]
        : [['Clear Tower floor {floor}', 'Floor {prev} is cleared; the stair leads on. Clear floor {floor}.'],
          ['Take Tower floor {floor}', 'You stood through floor {prev}. Floor {floor} waits above it.']],
    });
    return out;
  },
  outcome: (ctx, e) => { const clear = ctx.clears.get(Number(e.facts.floor)); return clear ? { state: 'completed', eventId: clear.id } : null; },
  view: (ctx, e) => {
    const run = ctx.w.canonicalTower, floor = Number(e.facts.floor);
    const here = run?.active && run.personId === ctx.player.id && run.floor === floor ? run.floors.find(f => f.floor === floor) : undefined;
    return here ? { target: { floor, bodyIds: here.enemyBodyIds.filter(id => !here.defeats.some(d => d.bodyId === id)) },
      progress: { current: here.defeats.length, required: here.enemyBodyIds.length }, detail: `${here.defeats.length} of ${here.enemyBodyIds.length} wardens on this floor are beaten.` }
      : { target: { floor }, progress: { current: 0, required: 1 } };
  },
};
/** A thing the player knows has attacked someone: a wild animal, or a hostile person outside the Tower. */
function threatOf(w: World, e: WorldEvent, playerId: EntityId): Person | Creature | null {
  if (e.type !== 'attack' || !e.actor || e.actor === playerId) return null;
  const a = w.get<Person | Creature>(e.actor);
  if (a?.kind === 'creature') return a;
  if (a?.kind === 'person' && a.hostile && !a.tags.includes('tower-warden')) return a;
  return null;
}
function gone(w: World, a: Person | Creature | undefined): boolean {
  if (!a) return true;
  if (a.kind === 'person') return !a.alive;
  return a.bodies.every(id => w.body(id)?.dead ?? true);
}
const THREAT: SystemQuestFamily = {
  candidates: ctx => {
    const { w, player } = ctx, out: Candidate[] = [], seen = new Set<string>();
    for (const key of Object.keys(player.knowledge)) {
      if (!key.startsWith('ev:')) continue;
      const e = w.event(key.slice(3)); if (!e) continue;
      const a = threatOf(w, e, player.id); if (!a || seen.has(a.id) || gone(w, a)) continue;
      seen.add(a.id);
      const victim = e.target === player.id ? 'you' : e.target ? w.nameOf(e.target) : 'someone';
      out.push({ questId: `threat:${a.id}`, kind: 'hunt', stage: 'forest', reward: 4, basis: [e.id],
        facts: { threatId: a.id, name: a.kind === 'creature' ? `the ${a.name}` : a.name, victim, x: e.pos?.x ?? 0, z: e.pos?.z ?? 0 },
        texts: [['Answer the threat: {name}', '{name} attacked {victim}. While it lives, it can do so again.'],
          ['Put an end to {name}', 'You know {name} has drawn blood from {victim}. Deal with it.']] });
    }
    return out;
  },
  outcome: (ctx, e) => {
    const { w, player } = ctx, id = String(e.facts.threatId), a = w.get<Person | Creature>(id);
    if (!gone(w, a)) return null;
    // A kill names who did it; a wild animal's or person's death record follows it, so prefer the kill.
    let end: WorldEvent | undefined;
    for (let i = w.events.length - 1; i >= 0; i--) {
      const ev = w.events[i]; if (ev.tick < e.issuedAt) break;
      if (ev.type === 'kill' && ev.target === id) { end = ev; break; }
      if (!end && ((ev.type === 'animal_died' && ev.actor === id) || (ev.type === 'death' && ev.target === id))) end = ev;
    }
    return { state: end?.type === 'kill' && end.actor === player.id ? 'completed' : 'resolved', eventId: end?.id ?? null };
  },
  view: (ctx, e) => {
    const a = ctx.w.get<Person | Creature>(String(e.facts.threatId));
    const bodies = a ? (a.kind === 'person' ? ctx.w.primaryBody(a.id) ? [ctx.w.primaryBody(a.id)!.id] : [] : a.bodies) : [];
    return { target: { personId: a?.kind === 'person' ? a.id : undefined, species: a?.kind === 'creature' ? a.species : undefined, bodyIds: bodies,
      pos: { x: Number(e.facts.x), y: 1, z: Number(e.facts.z) } }, progress: { current: 0, required: 1 } };
  },
};

/** Catalogue order is evaluation order, so it is part of determinism. */
const CATALOGUE: readonly SystemQuestFamily[] = [ONBOARDING_LISTEN, ONBOARDING_ANSWER, TOWER_FLOOR, THREAT];
const FAMILY_OF = (questId: string): SystemQuestFamily =>
  questId.startsWith('onboarding:listen') ? ONBOARDING_LISTEN : questId.startsWith('onboarding:answer') ? ONBOARDING_ANSWER : questId.startsWith('tower:') ? TOWER_FLOOR : THREAT;

function hashString(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
/** Seeded phrasing: the World seed and the quest id pick the variant, nothing else. */
function phrase(w: World, c: Candidate): [string, string] {
  const [title, detail] = new RNG(w.seed >>> 0).fork(hashString(c.questId)).pick(c.texts);
  const facts = { ...c.facts, prev: Number(c.facts.floor) - 1 };
  const fill = (t: string) => t.replace(/\{(\w+)\}/g, (m, k: string) => k in facts ? String(facts[k as keyof typeof facts]) : m);
  const d = fill(detail);
  return [fill(title), d.charAt(0).toUpperCase() + d.slice(1)];
}

function context(w: World, player: Person, ledger: QuestLedger): Ctx {
  const clears = new Map<number, WorldEvent>();
  for (const e of w.events) if (e.type === 'tower_floor_cleared' && e.actor === player.id && Number.isInteger(e.data.floor) && !clears.has(e.data.floor)) clears.set(e.data.floor, e);
  return { w, player, ledger, byId: new Map(ledger.entries.map(e => [e.id, e])), clears };
}
function ensureLedger(w: World, personId: EntityId): QuestLedger {
  w.questLedgers ??= {};
  return w.questLedgers[personId] ??= { version: 1, personId, reserve: { initial: SYSTEM_RESERVE, remaining: SYSTEM_RESERVE }, entries: [] };
}
function end(e: QuestLedgerEntry, state: QuestState, at: number, by: EventId | null): void { e.state = state; e.endedAt = at; e.endedBy = by; }

/** Pay a completed system entry from the reserve, exactly once. */
function payOnce(w: World, ledger: QuestLedger, e: QuestLedgerEntry, player: Person): void {
  if (e.claim || e.state !== 'completed') return;
  const amount = Math.max(0, Math.min(e.reward.offered, ledger.reserve.remaining));
  let eventId: EventId | null = null;
  if (amount > 0) {
    ledger.reserve.remaining -= amount; player.wealth += amount;
    // No position and no actor: John Smith is not in the world, so nobody perceives this.
    eventId = w.emit('system_quest_reward', { target: player.id, causes: e.endedBy ? [e.endedBy] : [], significance: .3,
      data: { questId: e.id, amount, issuer: JOHN_SMITH.id }, summary: `${player.name} received ${amount} silver for "${e.title}"` }).id;
  }
  e.claim = { paid: amount, from: JOHN_SMITH.id, at: w.now, eventId };
}

export interface ReconcileResult { issued: string[]; completed: ObjectiveReceipt[]; ended: string[] }

/**
 * One deterministic pass of John Smith over one person: archive emergent quests, close system
 * quests whose condition is met (paying once), and issue system quests whose condition now holds.
 * Mutates the World (ledger, reserve, purse, a reward event), so hosts journal it as an operation.
 */
export function reconcileQuests(w: World, personId: EntityId): ReconcileResult {
  const out: ReconcileResult = { issued: [], completed: [], ended: [] };
  const player = w.person(personId); if (!player?.alive) return out;
  const ledger = ensureLedger(w, personId), ctx = context(w, player, ledger);
  const add = (e: QuestLedgerEntry) => { ledger.entries.push(e); ctx.byId.set(e.id, e); out.issued.push(e.id); };
  const close = (e: QuestLedgerEntry, state: QuestState, at: number, by: EventId | null) => {
    end(e, state, at, by);
    if (state === 'completed') out.completed.push({ objectiveId: e.id, eventId: by!, tick: at, silver: e.claim?.paid ?? 0, payerId: e.claim?.from ?? null });
    else out.ended.push(e.id);
  };

  // 1. Archive emergent quests.
  const live = deriveObjectives(w, personId), liveIds = new Set(live.map(o => o.id));
  const receipts = new Map(objectiveReceipts(w, personId).map(r => [r.objectiveId, r]));
  for (const o of live) {
    const e = ctx.byId.get(o.id);
    if (!e) add({ id: o.id, origin: 'emergent', source: o.source, kind: o.kind, stage: o.stage, title: o.title, detail: o.detail, state: 'active',
      issuedAt: w.now, endedAt: null, endedBy: null, basis: [...o.knownVia], facts: {}, reward: { offered: o.reward.silver, from: o.reward.from }, claim: null });
    else if (e.state === 'lapsed') { e.state = 'active'; e.endedAt = null; e.endedBy = null; }
    else if (e.state === 'active') { e.title = o.title; e.detail = o.detail; }
  }
  for (const [id, r] of receipts) if (!ctx.byId.has(id) && id.startsWith('request:')) {
    // Asked, met and settled between two passes: archive it as it ended.
    const req = w.requests.find(x => x.id === id.slice('request:'.length));
    add({ id, origin: 'emergent', source: { type: 'request', requestId: req?.id ?? id, requestType: req?.type ?? 'provision' }, kind: 'deliver', stage: 'town',
      title: req ? requestTitle(w, req) : 'A request answered', detail: req ? `“${req.cause}”` : '', state: 'active', issuedAt: r.tick, endedAt: null, endedBy: null,
      basis: [], facts: {}, reward: { offered: req?.reward ?? r.silver, from: req?.requesterId ?? r.payerId }, claim: null });
  }
  for (const e of ledger.entries) {
    if (e.origin !== 'emergent' || e.state !== 'active' || liveIds.has(e.id)) continue;
    const r = receipts.get(e.id);
    if (r) { e.claim = { paid: r.silver, from: r.payerId, at: r.tick, eventId: r.eventId }; close(e, 'completed', r.tick, r.eventId); continue; }
    const req = e.source.type === 'request' ? w.requests.find(x => x.id === (e.source as { requestId: string }).requestId) : undefined;
    close(e, req && (req.status === 'completed' || req.status === 'accepted') ? 'resolved' : 'lapsed', w.now, null);
  }

  // 2–3. Close met system quests, then issue those whose condition holds; repeat while issuing
  // unlocks more (listen → answer → floor 1 within one pass when the world already shows all three).
  for (let pass = 0; pass < 8; pass++) {
    for (const e of ledger.entries) {
      if (e.origin !== 'system' || e.state !== 'active') continue;
      const o = FAMILY_OF((e.source as { questId: string }).questId).outcome(ctx, e); if (!o) continue;
      end(e, o.state, w.now, o.eventId); payOnce(w, ledger, e, player);
      if (o.state === 'completed') out.completed.push({ objectiveId: e.id, eventId: o.eventId ?? '', tick: w.now, silver: e.claim?.paid ?? 0, payerId: JOHN_SMITH.id });
      else out.ended.push(e.id);
    }
    let fresh = 0;
    for (const family of CATALOGUE) for (const c of family.candidates(ctx)) {
      if (ctx.byId.has(sys(c.questId))) continue;
      const [title, detail] = phrase(w, c);
      add({ id: sys(c.questId), origin: 'system', source: { type: 'system', questId: c.questId, issuer: JOHN_SMITH.id }, kind: c.kind, stage: c.stage,
        title, detail, state: 'active', issuedAt: w.now, endedAt: null, endedBy: null, basis: c.basis, facts: c.facts,
        reward: { offered: c.reward, from: JOHN_SMITH.id }, claim: null });
      fresh++;
    }
    if (!fresh) break;
  }
  return out;
}

/** Active system quests as Objectives (read-only). */
export function systemObjectives(w: World, personId: EntityId): Objective[] {
  const player = w.person(personId), ledger = w.questLedgers?.[personId]; if (!player?.alive || !ledger) return [];
  const ctx = context(w, player, ledger);
  return ledger.entries.filter(e => e.origin === 'system' && e.state === 'active').map(e => {
    const v = FAMILY_OF((e.source as { questId: string }).questId).view?.(ctx, e);
    return { id: e.id, origin: 'system' as const, kind: e.kind, source: e.source, stage: e.stage, title: e.title, detail: v?.detail ?? e.detail,
      giverId: null, giverName: null, target: v?.target ?? {}, progress: v?.progress ?? { current: 0, required: 1 },
      knownVia: [...e.basis], reward: { silver: e.reward.offered, from: JOHN_SMITH.id }, tracked: false };
  });
}

/** Everything the player is working on: emergent and system, in first-hour chain order. Read-only. */
export function questObjectives(w: World, personId: EntityId): Objective[] {
  return chainOrder([...deriveObjectives(w, personId), ...systemObjectives(w, personId)]);
}

/** Every completion the player has: the ledger's, plus emergent completions not yet archived. */
export function questReceipts(w: World, personId: EntityId): ObjectiveReceipt[] {
  const ledger = w.questLedgers?.[personId], archived = new Set(ledger?.entries.map(e => e.id) ?? []);
  const fromLedger = (ledger?.entries ?? []).filter(e => e.state === 'completed').map(e => ({ objectiveId: e.id, eventId: e.endedBy ?? '', tick: e.endedAt ?? 0, silver: e.claim?.paid ?? 0, payerId: e.claim?.from ?? null }));
  return [...fromLedger, ...objectiveReceipts(w, personId).filter(r => !archived.has(r.objectiveId))].sort((a, b) => a.tick - b.tick);
}
