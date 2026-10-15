import type { Creature, EntityId, EventId, Person, Request, WorldEvent } from '../core/types';
import type { World } from '../core/world';
import { activeConcerns, describeConcern } from '../mind/concern';
import { CHAIN_STAGES, FIRST_HOUR_TOWER_FLOORS, type ChainStage, type Objective, type ObjectiveKind, type ObjectiveReceipt } from './types';

/**
 * The player character's agenda, read from the World. Nothing here decides that anything
 * should happen, picks a quest giver, spawns a target or pays anyone.
 *
 * An objective exists only because the simulation already holds something the player's
 * character knows of: a Request someone raised for their own reasons (heard asked aloud, or
 * taken on in conversation), a concern the character's own mind formed from perception or
 * being told, or the character's own Tower run. When the request is settled by its requester,
 * the concern is discharged, or the floor-clear receipt is issued, the objective leaves the
 * list and the canonical event that ended it is its receipt. Same World, same list.
 */
interface Index { announced: Map<EntityId, WorldEvent>; clears: Map<number, WorldEvent> }
function index(w: World, playerId: EntityId): Index {
  const out: Index = { announced: new Map(), clears: new Map() };
  for (const e of w.events) {
    if (e.type === 'request_created' && e.data.requestId && e.pos) out.announced.set(e.data.requestId, e);
    else if (e.type === 'tower_floor_cleared' && e.actor === playerId && Number.isInteger(e.data.floor) && !out.clears.has(e.data.floor)) out.clears.set(e.data.floor, e);
  }
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
  const idx = index(w, playerId);
  const out: Objective[] = [...requestObjectives(w, player, idx), ...concernObjectives(w, player), ...towerObjectives(w, player, idx)];
  out.sort((a, b) => CHAIN_STAGES.indexOf(a.stage) - CHAIN_STAGES.indexOf(b.stage) || a.id.localeCompare(b.id));
  if (out.length) out[0].tracked = true;
  return out;
}

function requestObjectives(w: World, player: Person, idx: Index): Objective[] {
  return w.requests.flatMap(r => {
    const mine = r.status === 'accepted' && r.acceptedBy === player.id, ask = idx.announced.get(r.id);
    if (r.requesterId === player.id || !(mine || (r.status === 'open' && heard(player, ask)))) return [];
    const requester = r.requesterId ? w.person(r.requesterId) : undefined, body = requester ? w.primaryBody(requester.id) : undefined;
    const creature = r.payload.creatureId ? w.get<Creature>(r.payload.creatureId) : undefined;
    const name = requester?.name ?? 'Someone';
    const title = r.type === 'provision' ? `Bring food to ${name}` : r.type === 'protection' ? `Deal with the ${creature?.name ?? r.payload.species ?? 'animal'} for ${name}` : `Help ${name}: ${r.type.replace('_', ' ')}`;
    return [{ id: `request:${r.id}`, kind: KIND[r.type], source: { type: 'request' as const, requestId: r.id, requestType: r.type }, stage: STAGE[r.type],
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
    return { id: `concern:${c.id}`, kind: (c.kind === 'safety' ? 'hunt' : c.kind === 'welfare' ? 'tend' : 'deliver') as ObjectiveKind,
      source: { type: 'concern' as const, concernId: c.id, concernKind: c.kind }, stage: (c.kind === 'safety' ? 'forest' : 'town') as ChainStage,
      title, detail: `You are ${what}${known.length ? `, from what you ${known.some(k => k.source?.type === 'witnessed') ? 'saw' : 'were told'}` : ''}.`,
      giverId: null, giverName: null,
      target: { personId: subject?.id ?? (about?.kind === 'person' ? about.id : undefined), species: about?.kind === 'creature' ? (about as Creature).species : undefined,
        bodyIds: about && 'bodies' in about ? about.bodies : [], pos: lastSeen ? { x: lastSeen.x, y: lastSeen.y, z: lastSeen.z } : null },
      progress: { current: 0, required: 1 }, knownVia: known.flatMap(k => k.source?.viaEvent ? [k.source.viaEvent as EventId] : []),
      reward: { silver: 0, from: null }, tracked: false };
  });
}

/** The character's own run: the floor they stand on, or the next one after their last clear receipt. */
function towerObjectives(w: World, player: Person, idx: Index): Objective[] {
  const run = w.canonicalTower;
  if (!w.realmSpec || (run && run.personId !== player.id)) return [];
  let highest = 0; while (idx.clears.has(highest + 1)) highest++;
  const floor = highest + 1; if (floor > FIRST_HOUR_TOWER_FLOORS) return [];
  const here = run?.active ? run.floors.find(f => f.floor === floor && run.floor === floor) : undefined;
  return [{ id: `tower:floor:${floor}`, kind: 'reach_floor', source: { type: 'tower_run', floor, runId: run?.id ?? null }, stage: 'tower',
    title: floor === 1 && !run ? 'Enter the Tower of Chrysanthus' : `Clear Tower floor ${floor}`,
    detail: here ? `${here.defeats.length} of ${here.enemyBodyIds.length} wardens on this floor are beaten.`
      : floor === 1 ? 'The Tower stands open to anyone who walks in and accepts its trial.' : `Floor ${floor - 1} is cleared; the stair leads on.`,
    giverId: null, giverName: null, target: { floor, bodyIds: here?.enemyBodyIds.filter(id => !here.defeats.some(d => d.bodyId === id)) },
    progress: here ? { current: here.defeats.length, required: here.enemyBodyIds.length } : { current: 0, required: 1 },
    knownVia: run ? [run.openedEventId] : [], reward: { silver: 0, from: null }, tracked: false }];
}

/** Completions in canonical history, oldest first. Requests count when the player is the one paid
 * (or credited); concerns when the character's own worry was discharged; floors by their receipts. */
export function objectiveReceipts(w: World, playerId: EntityId): ObjectiveReceipt[] {
  const out: ObjectiveReceipt[] = [];
  for (const e of w.events) {
    if (e.type === 'request_completed' && e.actor === playerId && e.data.requestId) out.push({ objectiveId: `request:${e.data.requestId}`, eventId: e.id, tick: e.tick, silver: Number(e.data.paid) || 0, payerId: e.target ?? null });
    else if (e.type === 'concern_resolved' && e.actor === playerId && e.data.concernId && ['safety', 'welfare', 'supply'].includes(e.data.kind)) out.push({ objectiveId: `concern:${e.data.concernId}`, eventId: e.id, tick: e.tick, silver: 0, payerId: null });
    else if (e.type === 'tower_floor_cleared' && e.actor === playerId && e.data.floor <= FIRST_HOUR_TOWER_FLOORS) out.push({ objectiveId: `tower:floor:${e.data.floor}`, eventId: e.id, tick: e.tick, silver: 0, payerId: null });
  }
  return out;
}
