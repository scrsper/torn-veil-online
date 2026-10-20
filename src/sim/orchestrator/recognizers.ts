import type { Body, EntityId, KnowledgeItem, Person, Situation } from '../core/types';
import type { World } from '../core/world';
import { knownName, perceivedName } from '../mind/people';
import { requestById, requestTypeLabel } from '../core/requests';
import { believesDead, believesStilled } from '../social/protection';
import { personalSituationView, situationById, type PersonalSituationView } from '../social/situation';
import { ARCANE_DEFINITIONS } from '../physical/arcana/definitions';
import { portalPoint, realmAt, REALMS, type RealmId } from '../world/realms/layout';
import { interiorSlot } from '../world/interiors/layout';
import type { HolderRecord, JohnSmithState, Quest, QuestKind, QuestObjective, QuestTarget } from './types';
import { eventSeq } from './state';

/**
 * Quest recognizers. Each one READS a kind of open matter that already exists in canonical state
 * and is known to the holder: a trial they agreed to, a source they carry, a desire they were
 * told about, a request they accepted, a concern or obligation they hold, a crime they suffered
 * or saw. None creates anything. `scan` lists matters open now; `judge` decides, from the
 * holder's own evidence only, whether an open quest has ended.
 */
export interface QuestContext { world: World; s: JohnSmithState; holder: Person; body: Body | undefined; record: HolderRecord; now: number }
export interface Candidate {
  key: string; kind: QuestKind; title: string; summary: string;
  source: { kind: string; id: string }; subjectId?: EntityId; itemId?: EntityId;
  basisKeys: string[]; objectives: QuestObjective[]; target?: QuestTarget;
  rewardTier: number; priority: number; autoWatch: boolean;
}
/** `credit: false` marks a matter that ended without the holder's hand in it: closed, but neither
 * counted among their deeds nor paid from the reserve. */
export interface Verdict { status: 'completed' | 'failed' | 'moot'; code: string; text: string; eventId?: string; credit?: false }
export interface Recognizer {
  kind: QuestKind;
  scan(ctx: QuestContext): Candidate[];
  judge(ctx: QuestContext, q: Quest): Verdict | null;
  /** World seconds an open quest may go unseen in the holder's evidence before it fades. */
  fadeAfter: number | null;
}
const DAY = 86400;
const done = (code: string, text: string, eventId?: string): Verdict => ({ status: 'completed', code, text, eventId });
const failed = (code: string, text: string, eventId?: string): Verdict => ({ status: 'failed', code, text, eventId });
const moot = (code: string, text: string, eventId?: string): Verdict => ({ status: 'moot', code, text, eventId });

// ---------------------------------------------------------------- shared readings of the holder's evidence

/** Does the holder believe this person or creature is dead: by their own hand, or from
 * something they saw or were told? Never from canonical `alive` alone. */
export function knowsDeath(holder: Person, record: HolderRecord, id: EntityId | undefined): boolean {
  if (!id) return false;
  if (record.marks[`kill:${id}`]) return true;
  return Object.values(holder.knowledge).some(k => k.kind === 'event' && (((k.claim.type === 'kill' || k.claim.type === 'death') && k.claim.target === id)
    || (k.claim.type === 'animal_died' && k.claim.actor === id)));
}
/** Where the holder believes something is, from their own location belief. */
export function believedAt(holder: Person, id: EntityId | undefined): KnowledgeItem | undefined {
  const k = id ? holder.knowledge[`loc:${id}`] : undefined;
  return k?.claim.pos && Number.isFinite(k.claim.pos.x) ? k : undefined;
}
const targetOf = (holder: Person, id: EntityId | undefined, label: string): QuestTarget | undefined => {
  const k = believedAt(holder, id); return k ? { pos: { ...k.claim.pos }, label } : undefined;
};
/** Two persons fighting inside one agreed combat trial: consented combat, not a grievance. */
export function sameTrial(world: World, a: EntityId | undefined, b: EntityId | undefined): boolean {
  const pa = world.person(a), pb = world.person(b);
  return !!pa?.combatTrial && pa.combatTrial.id === pb?.combatTrial?.id;
}
/** The holder's view of a situation. A person knows what they did themselves, so their own
 * resolving act counts as known even though no one perceives their own deeds as news. */
function holderSituationView(w: World, holder: Person, sit: Situation): PersonalSituationView {
  const view = personalSituationView(w, holder, sit);
  if (view.status !== 'unresolved' || !sit.resolvingEventId || w.event(sit.resolvingEventId)?.actor !== holder.id) return view;
  return { status: 'resolved', viaKey: `ev:${sit.resolvingEventId}`, resolution: sit.resolution, relevance: view.relevance };
}
const carried = (world: World, p: Person) => p.inventory.flatMap(id => { const i = world.item(id); return i && i.holderId === p.id && i.quantity > 0 ? [i] : []; });
/** Ordinary floors already carry their own sealed award; John Smith marks the milestones. */
export function trialRewardTier(floor: number): number { return floor >= 100 ? 4 : floor % 25 === 0 ? 3 : floor % 10 === 0 ? 2 : floor % 5 === 0 ? 1 : -1; }

// ---------------------------------------------------------------- the Tower

const trial: Recognizer = {
  kind: 'trial', fadeAfter: null,
  scan({ world: w, s, holder, body, record }) {
    const run = w.canonicalTower;
    if (!run || run.personId !== holder.id || run.status !== 'open') return [];
    const f = run.floors.find(f => f.floor === run.floor);
    // A floor cleared between two passes is still recognized (and then judged closed), but never
    // one cleared before John Smith arrived.
    if (!f || (f.clearEventId && eventSeq(f.clearEventId) <= s.origin)) return [];
    const n = f.enemyBodyIds.length, d = f.defeats.length;
    const outside = !run.active && body;
    return [{ key: `trial:${run.id}:${f.floor}`, kind: 'trial', title: `Trial of floor ${f.floor}`,
      summary: `You agreed to a nonlethal trial against ${n} warden${n === 1 ? '' : 's'}. Overcome every one and the stair to floor ${f.floor + 1} opens.`,
      // A milestone pays at new altitude only: climbing back to it on a later run earns the sealed award, not the reserve.
      source: { kind: 'trial', id: f.trialId }, basisKeys: [], rewardTier: f.floor > (record.bestTrial ?? 0) ? trialRewardTier(f.floor) : -1, priority: 100, autoWatch: true,
      objectives: [{ id: 'wardens', text: 'Overcome the wardens', done: d >= n, have: d, need: n },
        ...(outside ? [{ id: 'return', text: 'Return to the Tower to resume the trial', done: false }] : [])],
      target: outside ? { pos: { ...run.returnPos }, label: 'Tower of Chrysanthus' } : undefined }];
  },
  judge({ world: w }, q) {
    const [, runId, floorText] = q.key.split(':'), floor = Number(floorText), run = w.canonicalTower;
    if (!run || run.id !== runId) return moot('run_over', 'The climb this trial belonged to is over.');
    const f = run.floors.find(f => f.floor === floor);
    if (!f) return moot('run_over', 'The trial no longer exists.');
    if (f.clearEventId) return done('cleared', 'Every warden overcome. The stair is open.', f.clearEventId);
    if (run.status === 'fallen' && run.floor === floor) return failed('fallen', `The climb ended on floor ${floor}.`);
    return null;
  },
};

const award: Recognizer = {
  kind: 'award', fadeAfter: null,
  scan({ world: w, holder }) {
    const run = w.canonicalTower; if (!run || run.personId !== holder.id || run.status !== 'open') return [];
    const out: Candidate[] = [];
    for (const f of run.floors) {
      if (!f.clearEventId || f.floor !== run.floor) continue;
      const c = w.container(f.rewardContainerId); if (!c || c.ownerId !== holder.id) continue;
      const inside = f.rewardItemIds.filter(id => w.item(id)?.containerId === c.id);
      if (!inside.length) continue;
      const total = f.rewardItemIds.length, taken = total - inside.length;
      out.push({ key: `award:${run.id}:${f.floor}`, kind: 'award', title: `Sealed award of floor ${f.floor}`,
        summary: 'The trial is cleared and its finite award is now yours. It will not follow you up the stair.',
        source: { kind: 'award', id: c.id }, basisKeys: [], rewardTier: -1, priority: 95, autoWatch: true,
        objectives: [{ id: 'open', text: 'Open the sealed award', done: c.open || taken > 0 },
          { id: 'take', text: c.open ? `Take ${inside.map(id => w.item(id)!.name).join(', ')}` : 'Take what it holds', done: false, have: taken, need: total }],
        target: c.pos && run.active ? { pos: { ...c.pos }, label: c.name } : undefined });
    }
    return out;
  },
  judge({ world: w }, q) {
    const [, runId, floorText] = q.key.split(':'), floor = Number(floorText), run = w.canonicalTower;
    const f = run?.id === runId ? run.floors.find(f => f.floor === floor) : undefined, c = f && w.container(f.rewardContainerId);
    if (!run || !f || !c) return moot('gone', 'The award is no longer within reach.');
    if (!f.rewardItemIds.some(id => w.item(id)?.containerId === c.id)) return done('claimed', 'Everything it held is in your keeping.');
    if (run.floor > floor || run.status !== 'open') return moot('left_behind', `Left behind on floor ${floor}.`);
    return null;
  },
};

/** Whether the holder can still walk to a position: anywhere outside the folded Tower, or on the
 * Tower floor they are currently climbing. Earlier floors are not revisited. */
function reachableFor(w: World, holder: Person, pos: { x: number; z: number }): boolean {
  const slot = interiorSlot(pos.x, pos.z); if (slot === null) return true;
  const run = w.canonicalTower, f = run?.personId === holder.id && run.status === 'open' ? run.floors.find(f => f.floor === run.floor) : undefined;
  return !!f && w.interiors?.descriptors.find(d => d.id === f.interiorId)?.slot === slot;
}

/** The holder's own unfolded cache coffer, still holding things. John Smith made it; he may
 * remind its owner it is there. It never follows anyone up a stair. */
const coffer: Recognizer = {
  kind: 'coffer', fadeAfter: null,
  scan({ world: w, holder, s }) {
    return s.caches.filter(c => c.recipientId === holder.id && c.cofferId && c.withdrawnAt === undefined).flatMap(c => {
      const box = w.container(c.cofferId); if (!box?.pos || !box.itemIds.length || !reachableFor(w, holder, box.pos)) return [];
      return [{ key: `coffer:${c.id}`, kind: 'coffer' as const, title: `Empty the ${box.name}`, summary: 'It stays where it unfolded until you take what it holds.',
        source: { kind: 'cache', id: c.id }, basisKeys: [], rewardTier: -1, priority: 92, autoWatch: true,
        objectives: [{ id: 'take', text: 'Take what it holds', done: false, have: (c.itemIds?.length ?? 0) - box.itemIds.length, need: c.itemIds?.length ?? box.itemIds.length }],
        target: { pos: { ...box.pos }, label: box.name } }];
    });
  },
  judge({ world: w, holder, s }, q) {
    const c = s.caches.find(c => c.id === q.source.id), box = c?.cofferId ? w.container(c.cofferId) : undefined;
    if (!c || !box || !box.itemIds.length || c.withdrawnAt !== undefined) return done('emptied', 'Emptied.');
    if (!box.pos || !reachableFor(w, holder, box.pos)) return moot('left_behind', 'Left behind where it unfolded.');
    return null;
  },
};

// ---------------------------------------------------------------- arcana, the Veil and the world

const study: Recognizer = {
  kind: 'study', fadeAfter: null,
  scan({ world: w, holder }) {
    return carried(w, holder).flatMap(item => {
      const src = item.arcaneSource;
      if (!src || src.kind === 'scroll' || holder.arcana?.learned[src.abilityId]) return [];
      const def = ARCANE_DEFINITIONS.get(src.abilityId); if (!def) return [];
      return [{ key: `study:${item.id}`, kind: 'study' as const, title: `Study ${item.name}`,
        summary: `${item.name} holds ${def.name}. Studying it teaches the form${src.kind === 'essence' ? '; the essence is consumed as you absorb it' : '; the book remains yours'}.`,
        source: { kind: 'source', id: src.abilityId }, itemId: item.id, basisKeys: [], rewardTier: -1, priority: 60, autoWatch: true,
        objectives: [{ id: 'learn', text: `Learn ${def.name}`, done: false }] }];
    });
  },
  judge({ world: w, holder }, q) {
    const learned = holder.arcana?.learned[q.source.id];
    if (learned) return done('learned', 'The form is yours now.', learned.eventId);
    const item = w.item(q.itemId);
    if (!item || item.holderId !== holder.id || item.quantity <= 0) return moot('lost', 'It left your hands before you studied it.');
    return null;
  },
};

const veil: Recognizer = {
  kind: 'veil', fadeAfter: null,
  scan({ world: w, body, record }) {
    if (!w.realmSpec || !body || record.marks.realm_crossed) return [];
    const realm = realmAt(body.pos.x, body.pos.z); if (!realm || !record.seen.includes(`portal:${realm}`)) return [];
    const other: RealmId = realm === 'aether' ? 'brass' : 'aether';
    return [{ key: 'veil', kind: 'veil', title: 'Cross the Veil', basisKeys: [], rewardTier: -1, priority: 50, autoWatch: true,
      summary: `A luminous threshold stands in ${REALMS[realm].name}. Beyond it is ${REALMS[other].name}. Your body, belongings and history cross with you.`,
      source: { kind: 'landmark', id: `portal:${realm}` }, objectives: [{ id: 'cross', text: `Cross the threshold into ${REALMS[other].name}`, done: false }],
      target: { pos: portalPoint(realm), label: 'The Veil threshold' } }];
  },
  judge({ record }) { return record.marks.realm_crossed ? done('crossed', 'You crossed.', record.marks.realm_crossed) : null; },
};

const landmark: Recognizer = {
  kind: 'landmark', fadeAfter: DAY,
  scan({ world: w, body, record }) {
    if (!body) return [];
    return record.seen.filter(id => !id.startsWith('portal:') && !record.entered.includes(id)).flatMap(id => {
      const place = w.place(id); return place ? [{ place, distance: Math.hypot(place.inside.x - body.pos.x, place.inside.z - body.pos.z) }] : [];
    }).sort((a, b) => a.distance - b.distance || (a.place.id < b.place.id ? -1 : 1)).slice(0, 2).map(({ place, distance }) => ({
      key: `landmark:${place.id}`, kind: 'landmark' as const, title: `Visit ${place.name}`, basisKeys: [], rewardTier: -1, autoWatch: false,
      priority: 20 - Math.min(10, distance / 50), summary: `You have seen ${place.name}. You have not yet been inside.`,
      source: { kind: 'place', id: place.id }, objectives: [{ id: 'enter', text: `Step inside ${place.name}`, done: false }],
      target: { pos: { ...place.inside }, label: place.name } }));
  },
  judge({ record }, q) { return record.entered.includes(q.source.id) ? done('visited', 'Visited.') : null; },
};

// ---------------------------------------------------------------- other people's matters, as the holder knows them

const recover: Recognizer = {
  kind: 'recover', fadeAfter: 7 * DAY,
  scan({ world: w, holder, record }) {
    return Object.values(holder.knowledge).filter(k => k.key.startsWith('wanted:') && typeof k.claim.itemId === 'string').flatMap(k => {
      const itemId = k.claim.itemId as string, requester = k.claim.requesterId as string | undefined, item = w.item(itemId);
      if (!item || record.marks[`returned:${itemId}`] || knowsDeath(holder, record, requester)) return [];
      const name = knownName(holder, requester), holds = item.holderId === holder.id, loc = believedAt(holder, itemId);
      return [{ key: `recover:${itemId}`, kind: 'recover' as const, title: `Recover ${item.name} for ${name}`, itemId, subjectId: requester,
        summary: `${name} wants ${item.name} back${k.claim.reward ? ` and has offered ${k.claim.reward} silver` : ''}.`,
        source: { kind: 'desire', id: k.key }, basisKeys: [k.key, ...(loc ? [loc.key] : [])], rewardTier: 1, priority: 70, autoWatch: true,
        objectives: [{ id: 'find', text: `Learn where ${item.name} is`, done: holds || !!loc }, { id: 'take', text: `Recover ${item.name}`, done: holds },
          { id: 'return', text: `Return it to ${name}`, done: false }],
        target: holds ? targetOf(holder, requester, name) : loc ? { pos: { ...loc.claim.pos }, label: item.name } : undefined }];
    });
  },
  judge({ holder, record }, q) {
    const itemId = q.itemId!;
    if (record.marks[`returned:${itemId}`]) return done('returned', 'Returned to its owner.', record.marks[`returned:${itemId}`]);
    if (record.marks[`gift:${itemId}`]) return failed('given_away', 'You gave it to someone else.', record.marks[`gift:${itemId}`]);
    if (knowsDeath(holder, record, q.subjectId)) return moot('owner_dead', 'Its owner is dead, as far as you know.');
    const elsewhere = Object.values(holder.knowledge).find(k => k.kind === 'event' && k.claim.type === 'returned_item' && k.claim.item === itemId && k.claim.actor !== holder.id);
    if (elsewhere) return moot('returned_by_other', 'Someone else returned it.', elsewhere.claim.eventId);
    return null;
  },
};

const reclaim: Recognizer = {
  kind: 'reclaim', fadeAfter: 7 * DAY,
  scan({ world: w, holder }) {
    return Object.values(holder.knowledge).filter(k => k.kind === 'event' && k.claim.type === 'theft' && k.claim.target === holder.id && typeof k.claim.item === 'string').flatMap(k => {
      const item = w.item(k.claim.item); if (!item || item.holderId === holder.id) return [];
      const thief = k.claim.actor as string | undefined, loc = believedAt(holder, item.id);
      return [{ key: `reclaim:${item.id}`, kind: 'reclaim' as const, title: `Recover your ${item.name}`, itemId: item.id, subjectId: thief,
        summary: thief ? `${knownName(holder, thief)} took it from you.` : 'It was taken from you.',
        source: { kind: 'theft', id: k.key }, basisKeys: [k.key, ...(loc ? [loc.key] : [])], rewardTier: 0, priority: 65, autoWatch: true,
        objectives: [{ id: 'find', text: `Learn where your ${item.name} is`, done: !!loc }, { id: 'take', text: 'Take it back', done: false }],
        target: loc ? { pos: { ...loc.claim.pos }, label: item.name } : targetOf(holder, thief, thief ? knownName(holder, thief) : 'thief') }];
    });
  },
  judge({ world: w, holder }, q) { return w.item(q.itemId)?.holderId === holder.id ? done('reclaimed', 'Back in your hands.') : null; },
};

const protect: Recognizer = {
  kind: 'protect', fadeAfter: 10 * DAY,
  scan({ world: w, holder, record }) {
    return w.requests.filter(r => r.type === 'protection' && r.acceptedBy === holder.id && r.status === 'accepted').map(r => {
      const creature = r.payload.creatureId, species = r.payload.species ?? 'animal', name = knownName(holder, r.requesterId);
      const dealt = !!creature && (believesDead(holder, creature) || believesStilled(w, holder, creature) || !!record.marks[`kill:${creature}`]);
      return { key: `protect:${r.id}`, kind: 'protect' as const, title: `Deal with the ${species} for ${name}`, subjectId: r.requesterId ?? undefined,
        summary: `${name} asked you to deal with a ${species}${r.cause ? ` (${r.cause})` : ''} and offered ${r.reward} silver.`,
        source: { kind: 'request', id: r.id }, basisKeys: [], rewardTier: 1, priority: 75, autoWatch: true,
        objectives: [{ id: 'deal', text: `Deal with the ${species}`, done: dealt }, { id: 'claim', text: `Tell ${name} it is done`, done: false }],
        target: dealt ? targetOf(holder, r.requesterId ?? undefined, name) : r.payload.seenAt ? { pos: { ...r.payload.seenAt }, label: `Where the ${species} was seen` } : undefined };
    });
  },
  judge({ world: w, holder }, q) {
    const r = requestById(w, q.source.id);
    if (!r) return moot('gone', 'The commitment no longer exists.');
    if (r.status === 'completed' && r.acceptedBy === holder.id) return done('settled', `Settled${r.paid ? `, and ${r.paid} silver paid` : ''}.`);
    if (r.status === 'failed' && r.acceptedBy === holder.id) return failed('failed', 'The commitment failed.');
    return null;
  },
};

const work: Recognizer = {
  kind: 'work', fadeAfter: 10 * DAY,
  scan({ world: w, holder }) {
    return w.requests.filter(r => r.acceptedBy === holder.id && r.status === 'accepted' && (r.type === 'haul' || r.type === 'construction_labor' || r.type === 'production')).map(r => {
      const who = r.requesterId ? knownName(holder, r.requesterId) : 'the settlement', label = requestTypeLabel(r.type);
      const task = r.type === 'haul' ? w.haulTasks.find(t => t.requestId === r.id || t.id === r.payload.haulTaskId) : undefined;
      const source = task ? w.place(task.sourcePlaceId) : undefined, dest = task ? w.place(task.destPlaceId) : undefined;
      const objectives: QuestObjective[] = task
        ? [{ id: 'load', text: `Load ${task.quantity} ${task.resource} at ${source?.name ?? 'the source'}`, done: task.carried > 0 || task.delivered > 0 },
           { id: 'deliver', text: `Deliver to ${dest?.name ?? 'the destination'}`, done: task.delivered >= task.quantity, have: task.delivered, need: task.quantity }]
        : r.type === 'production'
          ? [{ id: 'produce', text: `Produce ${r.payload.quantity ?? ''} ${r.payload.resource ?? 'goods'}`.replace('  ', ' '), done: false, have: r.fulfilledQuantity ?? 0, need: r.payload.quantity ?? 1 }]
          : [{ id: 'labour', text: 'Contribute the agreed labour', done: false }];
      const place = task ? (task.carried > 0 ? dest : source) : w.place(r.payload.placeId ?? r.requesterPlaceId);
      return { key: `work:${r.id}`, kind: 'work' as const, title: `${label[0].toUpperCase()}${label.slice(1)} for ${who}`, subjectId: r.requesterId ?? undefined,
        summary: `${r.cause}. Agreed wage: ${r.reward} silver.`, source: { kind: 'request', id: r.id }, basisKeys: [], rewardTier: 0, priority: 55, autoWatch: false,
        objectives, target: place ? { pos: { ...place.inside }, label: place.name } : undefined };
    });
  },
  judge({ world: w, holder }, q) {
    const r = requestById(w, q.source.id);
    if (!r) return moot('gone', 'The work no longer exists.');
    if (r.status === 'completed' && r.acceptedBy === holder.id) return done('done', `Done${r.paid ? `; ${r.paid} silver paid` : ''}.`);
    if (r.status === 'failed') return failed('failed', 'The work fell through.');
    if (r.status === 'cancelled') return moot('cancelled', 'The work was called off.');
    return null;
  },
};

const tend: Recognizer = {
  kind: 'tend', fadeAfter: 2 * DAY,
  scan({ holder, record }) {
    return (holder.mind.concerns ?? []).filter(c => c.kind === 'welfare' && c.status === 'active' && c.subjectId && c.subjectId !== holder.id).flatMap(c => {
      if (knowsDeath(holder, record, c.subjectId)) return [];
      // One quest per worry; fresh evidence of new harm after a closed one opens another.
      const prior = record.quests.filter(q => q.key.startsWith(`tend:${c.id}:`) && q.status !== 'open').sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))[0];
      const epoch = prior && c.lastReinforcedAt > (prior.closedAt ?? 0) ? c.lastReinforcedAt : prior ? null : c.createdAt;
      if (epoch === null) return [];
      const name = knownName(holder, c.subjectId);
      return [{ key: `tend:${c.id}:${epoch}`, kind: 'tend' as const, title: `See that ${name} is all right`, subjectId: c.subjectId,
        summary: `You have reason to fear for ${name}. ${c.reasons[0] ?? ''}`.trim(), source: { kind: 'concern', id: c.id },
        basisKeys: [...c.basisKeys].slice(0, 8), rewardTier: 0, priority: 68, autoWatch: true,
        objectives: [{ id: 'see', text: `Find ${name} and see them well`, done: false }], target: targetOf(holder, c.subjectId, name) }];
    });
  },
  judge({ world: w, holder, record }, q) {
    const seen = holder.mind.percepts.find(p => p.entityId === q.subjectId && p.how === 'saw'), body = seen && w.body(seen.bodyId);
    if (body && !body.dead && body.pose !== 'downed' && body.health >= body.maxHealth * .6) {
      // Checking on someone you hurt yourself is not a kindness the archive pays for.
      const ownDoing = q.basisKeys.some(key => holder.knowledge[key]?.claim.actor === holder.id);
      return ownDoing ? { ...done('seen_well', 'You saw them up and about.'), credit: false } : done('seen_well', 'You saw them up and about.');
    }
    if (knowsDeath(holder, record, q.subjectId)) return moot('died', 'They are gone.');
    return null;
  },
};

const justice: Recognizer = {
  kind: 'justice', fadeAfter: 4 * DAY,
  scan({ world: w, holder }) {
    const out: Candidate[] = [];
    for (const sit of w.situations) {
      if ((sit.kind !== 'harm' && sit.kind !== 'property') || sit.severity < .35 || sit.status === 'dormant') continue;
      const k = sit.eventIds.map(id => holder.knowledge[`ev:${id}`]).find(Boolean); if (!k) continue;
      const culprit = k.claim.actor as string | undefined, victim = sit.subjectId;
      if (!victim || culprit === holder.id || !(victim === holder.id || k.source.type === 'witnessed')) continue;
      const root = w.event(sit.rootEventId);
      if (root && sameTrial(w, root.actor, root.target)) continue;
      if (holderSituationView(w, holder, sit).status !== 'unresolved') continue;
      const culpritName = culprit ? knownName(holder, culprit) : 'someone', victimName = victim === holder.id ? 'you' : knownName(holder, victim);
      const wrong = sit.kind === 'property' ? 'theft' : k.claim.type === 'kill' ? 'killing' : 'assault';
      out.push({ key: `justice:${sit.id}`, kind: 'justice', subjectId: culprit,
        title: victim === holder.id ? (culprit ? `${culpritName} wronged you` : 'Someone wronged you') : `Justice for ${victimName}`,
        summary: `You ${victim === holder.id ? 'suffered' : 'saw'} a ${wrong}${culprit ? ` by ${culpritName}` : ''}${victim === holder.id ? '' : ` against ${victimName}`}. As far as you know, nobody has answered for it.`,
        source: { kind: 'situation', id: sit.id }, basisKeys: [k.key], rewardTier: 1, priority: 62, autoWatch: false,
        objectives: [{ id: 'answered', text: 'Learn that it was answered for', done: false }], target: targetOf(holder, culprit, culpritName) });
    }
    return out;
  },
  judge({ world: w, holder, record }, q) {
    const sit = situationById(w, q.source.id);
    if (!sit) return moot('gone', 'The matter has passed out of memory.');
    const view = holderSituationView(w, holder, sit);
    if (view.status === 'resolved') {
      // Justice the holder had a hand in (their act, or amends made to them) is theirs; an arrest
      // by someone else closes the matter without paying for it.
      const answer = sit.resolvingEventId ? w.event(sit.resolvingEventId) : undefined;
      const verdict = done('answered', `It was answered for (${(view.resolution ?? 'settled').replace(/_/g, ' ')}).`, sit.resolvingEventId);
      return answer && (answer.actor === holder.id || answer.target === holder.id) ? verdict : { ...verdict, credit: false };
    }
    if (knowsDeath(holder, record, q.subjectId)) return moot('culprit_dead', 'The one responsible is dead, as far as you know.');
    return null;
  },
};

const OBLIGATION_TEXT: Record<string, string> = { was_helped: 'helped you when it cost them something', was_given: 'gave you something of real value', was_tended: 'tended your wounds', was_protected: 'stood between you and harm', debt: 'is owed money by you' };
const repay: Recognizer = {
  kind: 'repay', fadeAfter: 14 * DAY,
  scan({ holder }) {
    return (holder.mind.obligations ?? []).filter(o => o.status === 'live' && OBLIGATION_TEXT[o.kind]).map(o => {
      const name = knownName(holder, o.towardId);
      return { key: `repay:${o.id}`, kind: 'repay' as const, title: o.kind === 'debt' ? `Settle your debt to ${name}` : `Repay ${name}`, subjectId: o.towardId,
        summary: `${name} ${OBLIGATION_TEXT[o.kind]}.`, source: { kind: 'obligation', id: o.id }, basisKeys: o.basisKey ? [o.basisKey] : [],
        rewardTier: 0, priority: 40, autoWatch: false, objectives: [{ id: 'repay', text: o.kind === 'debt' ? 'Pay what you owe' : 'Do right by them when the chance comes', done: false }],
        target: targetOf(holder, o.towardId, name) };
    });
  },
  judge({ holder }, q) {
    const o = (holder.mind.obligations ?? []).find(o => o.id === q.source.id);
    if (!o) return moot('gone', 'It no longer weighs on you.');
    if (o.status === 'fulfilled') return done('repaid', 'Square with them.');
    if (o.status === 'failed') return failed('broken', 'You broke it.');
    if (o.status === 'lapsed' || o.status === 'forgiven') return moot(o.status, o.status === 'forgiven' ? 'Forgiven.' : 'It lapsed.');
    return null;
  },
};

const OUTCOMES: Record<string, string> = { objective_completed: 'It ended.', robbery_completed: 'A robbery ended it.', target_fled: 'Someone fled.', aggressor_fled: 'Your attacker fled.',
  surrender: 'Someone yielded.', subdual: 'Someone was subdued.', arrest: 'An arrest ended it.', custody: 'It ended in custody.', withdrawal: 'Both sides broke off.',
  deterrence: 'It was deterred.', reconciliation: 'You reconciled.', death: 'It ended in a death.' };
const fight: Recognizer = {
  kind: 'fight', fadeAfter: DAY,
  scan({ world: w, holder }) {
    return w.conflicts.filter(c => c.participants.includes(holder.id) && c.status !== 'resolved' && c.attackCount >= 2).flatMap(c => {
      const other = c.participants.find(id => id !== holder.id); if (!other || sameTrial(w, holder.id, other)) return [];
      const name = perceivedName(w, holder, other);
      return [{ key: `fight:${c.id}`, kind: 'fight' as const, title: `Fight with ${name}`, subjectId: other, summary: c.initiator === holder.id ? 'You started this.' : `${name} came at you.`,
        source: { kind: 'conflict', id: c.id }, basisKeys: [], rewardTier: c.initiator === holder.id ? -1 : 0, priority: 85, autoWatch: true,
        objectives: [{ id: 'end', text: 'Bring the fight to an end', done: false }] }];
    });
  },
  judge({ world: w, holder }, q) {
    const c = w.conflicts.find(c => c.id === q.source.id);
    if (!c) return moot('gone', 'Over.');
    if (c.status !== 'resolved') return null;
    if ((c.outcome === 'arrest' || c.outcome === 'custody') && holder.custody?.active) return failed('custody', 'You were taken into custody.', c.resolveEventId);
    if (c.outcome === 'surrender' && holder.surrender) return failed('yielded', 'You yielded.', c.resolveEventId);
    return done(c.outcome ?? 'ended', OUTCOMES[c.outcome ?? ''] ?? 'It ended.', c.resolveEventId);
  },
};

export const RECOGNIZERS: readonly Recognizer[] = [trial, award, coffer, study, veil, landmark, recover, reclaim, protect, work, tend, justice, repay, fight];
export const RECOGNIZER_BY_KIND: ReadonlyMap<QuestKind, Recognizer> = new Map(RECOGNIZERS.map(r => [r.kind, r]));
