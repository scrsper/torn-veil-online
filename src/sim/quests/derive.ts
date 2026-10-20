import type { Creature, EntityId, EventId, Person, Request, WorldEvent } from '../core/types';
import type { World } from '../core/world';
import { activeConcerns, describeConcern } from '../mind/concern';
import { CHAIN_STAGES, type ChainStage, type Objective, type ObjectiveKind, type ObjectiveReceipt } from './types';

/**
 * The player character's emergent agenda, read from the World. Nothing here decides that
 * anything should happen, picks a quest giver, spawns a target or pays anyone.
 *
 * An objective exists only because the simulation already holds something the player's
 * character knows of: a Request someone raised for their own reasons (heard asked aloud, or
 * taken on in conversation), or a concern the character's own mind formed from perception or
 * being told. When the request is settled by its requester or the concern is discharged, the
 * objective leaves the list and the canonical event that ended it is its receipt. Same World,
 * same list. System quests (John Smith, quests/johnSmith.ts) are issued separately.
 */
interface Index { announced: Map<EntityId, WorldEvent> }
function index(w: World): Index {
  const out: Index = { announced: new Map() };
  for (const e of w.events) if (e.type === 'request_created' && e.data.requestId && e.pos) out.announced.set(e.data.requestId, e);
  return out;
}
/** Did this character see or hear the ask? Their own perception record or their knowledge says so. */
function heard(p: Person, e: WorldEvent | undefined): boolean {
  return !!e && (e.perceivedBy.some(x => x.who === p.id) || !!p.knowledge[`ev:${e.id}`]);
}
const KIND: Record<Request['type'], ObjectiveKind> = { provision: 'deliver', protection: 'hunt', haul: 'deliver', production: 'work', construction_labor: 'work' };
const STAGE: Record<Request['type'], ChainStage> = { provision: 'town', protection: 'forest', haul: 'town', production: 'town', construction_labor: 'town' };

export function deriveObjectives(w: World, playerId: EntityId): Objective[] {
  const player = w.person(playerId); if (!player?.alive) return [];
  return chainOrder([...requestObjectives(w, player, index(w)), ...concernObjectives(w, player)]);
}

/** Sort into first-hour chain order and mark the first as tracked (presentation emphasis only). */
export function chainOrder(list: Objective[]): Objective[] {
  list.sort((a, b) => CHAIN_STAGES.indexOf(a.stage) - CHAIN_STAGES.indexOf(b.stage) || a.id.localeCompare(b.id));
  list.forEach((o, i) => { o.tracked = i === 0; });
  return list;
}

export function requestTitle(w: World, r: Request): string {
  const name = (r.requesterId ? w.person(r.requesterId)?.name : undefined) ?? 'Someone', creature = r.payload.creatureId ? w.get<Creature>(r.payload.creatureId) : undefined;
  return r.type === 'provision' ? `Bring food to ${name}` : r.type === 'protection' ? `Deal with the ${creature?.name ?? r.payload.species ?? 'animal'} for ${name}` : `Help ${name}: ${r.type.replace('_', ' ')}`;
}

function requestObjectives(w: World, player: Person, idx: Index): Objective[] {
  return w.requests.flatMap(r => {
    const mine = r.status === 'accepted' && r.acceptedBy === player.id, ask = idx.announced.get(r.id);
    if (r.requesterId === player.id || !(mine || (r.status === 'open' && heard(player, ask)))) return [];
    const requester = r.requesterId ? w.person(r.requesterId) : undefined, body = requester ? w.primaryBody(requester.id) : undefined;
    const creature = r.payload.creatureId ? w.get<Creature>(r.payload.creatureId) : undefined;
    const name = requester?.name ?? 'Someone', title = requestTitle(w, r);
    return [{ id: `request:${r.id}`, origin: 'emergent' as const, kind: KIND[r.type], source: { type: 'request' as const, requestId: r.id, requestType: r.type }, stage: STAGE[r.type],
      title, detail: `${name}: “${r.cause}”${r.reward ? ` (offered ${r.reward} silver)` : ''}.`,
      giverId: requester?.id ?? null, giverName: requester?.name ?? null,
      target: r.type === 'protection' ? { species: r.payload.species, bodyIds: creature?.bodies, pos: r.payload.seenAt ?? null }
        : { personId: requester?.id, bodyIds: body ? [body.id] : [], pos: body ? { ...body.pos } : r.payload.seenAt ?? null },
      progress: { current: 0, required: 1 }, knownVia: ask ? [ask.id] : [],
      reward: { silver: r.reward, from: r.requesterId }, tracked: false }];
  });
}

/** Safety, welfare and supply worries the character holds. Their basis keys are its own knowledge. */
function concernObjectives(w: World, player: Person): Objective[] {
  return activeConcerns(player).filter(c => c.kind === 'safety' || c.kind === 'welfare' || c.kind === 'supply').map(c => {
    const about = c.aboutId ? w.get<Person | Creature>(c.aboutId) : undefined, subject = c.subjectId ? w.person(c.subjectId) : undefined;
    const known = c.basisKeys.map(k => player.knowledge[k]).filter(Boolean);
    const lastSeen = known.map(k => k.claim?.pos).filter(Boolean).at(-1);
    const what = describeConcern(w, c);
    const title = c.kind === 'safety' && about ? `Deal with ${about.kind === 'creature' ? `the ${about.name}` : about.name}` : c.kind === 'welfare' && subject ? `Look in on ${subject.name}` : `Find ${c.resource ?? 'supplies'}`;
    return { id: `concern:${c.id}`, origin: 'emergent' as const, kind: (c.kind === 'safety' ? 'hunt' : c.kind === 'welfare' ? 'tend' : 'deliver') as ObjectiveKind,
      source: { type: 'concern' as const, concernId: c.id, concernKind: c.kind }, stage: (c.kind === 'safety' ? 'forest' : 'town') as ChainStage,
      title, detail: `You are ${what}${known.length ? `, from what you ${known.some(k => k.source?.type === 'witnessed') ? 'saw' : 'were told'}` : ''}.`,
      giverId: null, giverName: null,
      target: { personId: subject?.id ?? (about?.kind === 'person' ? about.id : undefined), species: about?.kind === 'creature' ? (about as Creature).species : undefined,
        bodyIds: about && 'bodies' in about ? about.bodies : [], pos: lastSeen ? { x: lastSeen.x, y: lastSeen.y, z: lastSeen.z } : null },
      progress: { current: 0, required: 1 }, knownVia: known.flatMap(k => k.source?.viaEvent ? [k.source.viaEvent as EventId] : []),
      reward: { silver: 0, from: null }, tracked: false };
  });
}

/** Emergent completions in canonical history, oldest first. Requests count when the player is the
 * one paid (or credited); concerns when the character's own worry was discharged. */
export function objectiveReceipts(w: World, playerId: EntityId): ObjectiveReceipt[] {
  const out: ObjectiveReceipt[] = [];
  for (const e of w.events) {
    if (e.type === 'request_completed' && e.actor === playerId && e.data.requestId) out.push({ objectiveId: `request:${e.data.requestId}`, eventId: e.id, tick: e.tick, silver: Number(e.data.paid) || 0, payerId: e.target ?? null });
    else if (e.type === 'concern_resolved' && e.actor === playerId && e.data.concernId && ['safety', 'welfare', 'supply'].includes(e.data.kind)) out.push({ objectiveId: `concern:${e.data.concernId}`, eventId: e.id, tick: e.tick, silver: 0, payerId: null });
  }
  return out;
}
