import type { Concern, Creature, Person, Request, Vec3 } from '../core/types';
import type { World } from '../core/world';
import { acceptRequest, cancelRequest, completeRequest, createRequest } from '../core/requests';
import { activeConcerns, concernsOf, resolveConcern } from '../mind/concern';
import { adjustRel, getRel } from '../mind/relationships';
import { learn } from '../mind/knowledge';
import { isExternallyControlled } from '../runtime/controllers';

/**
 * Protection requests (Living Alpha): someone a wild animal hurt or menaced, who has the means,
 * asks for it to be dealt with and puts up their own silver.
 *
 * Nothing here is a quest script. The request exists only while the requester holds a live
 * safety concern about a particular animal (formed from their own perception or from being told);
 * others learn of it only by talking to the requester; and whether it is settled is decided by what
 * the requester comes to BELIEVE — knowing of the animal's death, being shown its meat, or taking
 * the claimant's word if they trust them enough. A word taken falsely can be found out: if the same
 * animal strikes again after the requester paid on someone's word, that person's trust is lost.
 */
const MIN_INTENSITY = 0.35;
const EXPIRY_SECONDS = 10 * 86400;
const TRUST_FOR_WORD = 0.35;

function creatureOf(world: World, id: string | undefined): Creature | undefined {
  const c = id ? world.get<Creature>(id) : undefined; return c?.kind === 'creature' ? c : undefined;
}
const flat = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
/** The newest position among the claims this concern rests on — what the requester saw or was told. */
function lastKnownPosition(p: Person, c: Concern): Vec3 | undefined {
  const claims = c.basisKeys.map(key => p.knowledge[key]?.claim).filter(claim => claim?.pos && Number.isFinite(claim.pos.x));
  const newest = claims.sort((a, b) => (b.tick ?? 0) - (a.tick ?? 0))[0];
  return newest ? { x: newest.pos.x, y: newest.pos.y, z: newest.pos.z } : undefined;
}
/** "north of Pikewick", or "by Pikewick" when it was close in. */
function direction(from: Vec3, to: Vec3): string {
  const dx = to.x - from.x, dz = to.z - from.z;
  if (Math.hypot(dx, dz) < 60) return 'by';
  const angle = Math.atan2(dx, -dz) * 180 / Math.PI, i = Math.round(((angle + 360) % 360) / 45) % 8;
  return `${['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][i]} of`;
}
function dangerConcern(p: Person, creatureId: string): Concern | undefined {
  return activeConcerns(p).find(c => c.kind === 'safety' && c.aboutId === creatureId);
}
/** Does the requester believe this animal is dead (their own knowledge, whatever its source)? */
export function believesDead(p: Person, creatureId: string): boolean {
  return Object.values(p.knowledge).some(k => k.kind === 'event'
    && ((k.claim.type === 'kill' && k.claim.target === creatureId) || (k.claim.type === 'animal_died' && k.claim.actor === creatureId)));
}

/** A hushed animal keeps away from where it was stilled for about this long (physical/veil.ts). */
const STILLED_BELIEF_WORLD_SECONDS = 3 * 86400;
/** Does the requester believe this animal was recently stilled by the veil — having seen it go
 * quiet, or been told so by someone who did? Hearing a gesture is not seeing its effect. */
export function believesStilled(world: World, p: Person, creatureId: string): boolean {
  return Object.values(p.knowledge).some(k => k.kind === 'event' && k.claim.type === 'veil_hush' && k.claim.target === creatureId
    && k.claim.success === true && Number.isFinite(k.claim.tick) && world.now - k.claim.tick <= STILLED_BELIEF_WORLD_SECONDS);
}

/** Coarse-cadence upkeep: raise requests from live danger concerns, expire stale ones, and let a
 * repeat attack expose a word that was falsely given. */
export function maintainProtectionRequests(world: World): void {
  for (const r of world.requests) {
    if (r.type !== 'protection' || (r.status !== 'open' && r.status !== 'accepted')) continue;
    const requester = r.requesterId ? world.person(r.requesterId) : undefined;
    if (!requester?.alive || world.now - r.createdAt > EXPIRY_SECONDS || !dangerConcern(requester, r.payload.creatureId!)) cancelRequest(world, r);
  }
  for (const p of world.livingPersons()) {
    if (isExternallyControlled(p) || p.wealth < 4) continue;
    for (const c of activeConcerns(p)) {
      if (c.kind !== 'safety' || c.intensity < MIN_INTENSITY || !c.aboutId) continue;
      const animal = creatureOf(world, c.aboutId); if (!animal || believesDead(p, animal.id) || believesStilled(world, p, animal.id)) continue;
      const mine = world.requests.filter(r => r.type === 'protection' && r.requesterId === p.id && r.payload.creatureId === animal.id);
      if (mine.some(r => r.status === 'open' || r.status === 'accepted')) continue;
      // Paid on someone's word, and it has come back: that word was false.
      const lied = mine.find(r => r.status === 'completed' && r.payload.settledBy === 'took_word' && c.lastReinforcedAt > (r.completedAt ?? 0) && r.acceptedBy);
      if (lied && !lied.payload.exposed) {
        lied.payload.exposed = true;
        adjustRel(world, p, lied.acceptedBy!, { trust: -0.5, affection: -0.2, grudge: 0.3 }, `said the ${animal.name} was dealt with; it was not`);
      }
      const recent = mine.filter(r => world.now - r.createdAt < 86400);
      if (recent.length) continue;
      const reward = Math.max(4, Math.min(30, Math.round(p.wealth * 0.3)));
      const place = c.placeId ? world.place(c.placeId) : undefined;
      // Out in the open there is no place to name; say where it was seen, as the requester knows it.
      const seenAt = lastKnownPosition(p, c);
      const near = !place && seenAt ? world.settlements().sort((a, b) => flat(a.location, seenAt) - flat(b.location, seenAt))[0] : undefined;
      createRequest(world, { type: 'protection', requesterId: p.id, requesterPlaceId: c.placeId, reward,
        cause: `a ${animal.name} ${c.subjectId === p.id ? 'went for me' : 'is menacing people'}${place ? ` near ${place.name}` : near && seenAt ? ` ${direction(near.location, seenAt)} ${near.name}` : ''}`,
        payload: { creatureId: animal.id, species: animal.species, placeId: c.placeId, seenAt } });
    }
  }
}

export function protectionOffersFrom(world: World, npc: Person): Request[] {
  return world.requests.filter(r => r.type === 'protection' && r.status === 'open' && r.requesterId === npc.id);
}
export function protectionCommitments(world: World, requester: Person, claimant: Person): Request[] {
  return world.requests.filter(r => r.type === 'protection' && r.status === 'accepted' && r.requesterId === requester.id && r.acceptedBy === claimant.id);
}
export function acceptProtection(world: World, r: Request, person: Person): boolean {
  if (r.status !== 'open') return false;
  acceptRequest(world, r, person); return r.acceptedBy === person.id;
}

export interface ClaimOutcome { settled: boolean; how?: NonNullable<Request['payload']['settledBy']>; paid: number; line: string }
/**
 * `claimant` tells the requester the animal has been dealt with. The requester's own beliefs
 * decide: knowledge of its death, then evidence shown (meat of that species carried by the
 * claimant), then trust in the claimant's word. Payment is the ordinary conserved request wage.
 */
export function claimProtection(world: World, requester: Person, claimant: Person, r: Request): ClaimOutcome {
  const animalId = r.payload.creatureId!, species = r.payload.species ?? '', name = world.nameOf(animalId);
  let how: ClaimOutcome['how'];
  if (believesDead(requester, animalId)) how = 'knew_of_death';
  // Stilled, not killed: settled on what they know, but the animal lives and may return.
  else if (believesStilled(world, requester, animalId)) how = 'knew_it_stilled';
  else {
    const meat = claimant.inventory.map(id => world.item(id)).find(i => i && i.holderId === claimant.id && i.type === 'meat' && i.tags.includes(`species:${species}`));
    if (meat) {
      how = 'shown_meat';
      // Being shown is a real, fallible belief: they cannot tell one boar's meat from another's.
      const ev = world.emit('perceived', { actor: requester.id, target: claimant.id, category: 'cognition', significance: 0.2,
        data: { shown: meat.id, about: animalId }, summary: `${claimant.name} showed ${requester.name} ${meat.name}` });
      learn(world, requester, { key: `event:shown-kill:${animalId}`, kind: 'event', claim: { type: 'kill', target: animalId, actor: claimant.id, eventId: ev.id, shownMeat: meat.id }, confidence: 0.7,
        source: { type: 'told', from: claimant.id, viaEvent: ev.id }, summary: `${claimant.name} showed me meat from the ${name}` }, true);
    } else if (getRel(requester, claimant.id).trust >= TRUST_FOR_WORD) how = 'took_word';
  }
  if (!how) return { settled: false, paid: 0, line: `I'll believe it when I see it. Bring me proof it's done — or I'll hear of it soon enough.` };
  if (r.acceptedBy !== claimant.id) acceptRequest(world, r, claimant, r.acceptedBy);
  r.payload.settledBy = how;
  const paid = completeRequest(world, r);
  const c = dangerConcern(requester, animalId); if (c) resolveConcern(world, requester, c, `the ${name} was dealt with`);
  adjustRel(world, requester, claimant.id, { trust: how === 'took_word' ? 0.05 : 0.2, affection: 0.15, respect: 0.1 }, `dealt with the ${name}`);
  const line = how === 'knew_of_death' ? `I heard it's dead. You have my thanks — and ${paid} silver, as promised.`
    : how === 'knew_it_stilled' ? `I know it went quiet and slunk off. Uncanny, but it's gone. ${paid} silver, as promised.`
    : how === 'shown_meat' ? `That's boar, sure enough. Here — ${paid} silver. I'll sleep easier.`
    : `If you say so, I'll trust you. ${paid} silver. Don't make a liar of yourself.`;
  return { settled: true, how, paid, line };
}
void concernsOf;
