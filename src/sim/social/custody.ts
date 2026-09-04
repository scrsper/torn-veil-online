import type { Conflict, EntityId, Person, Tick } from '../core/types';
import type { World } from '../core/world';
import { SECONDS_PER_DAY } from '../core/time';
import { resolveConflict, activeThreatIds } from './conflict';

/**
 * Surrender, subdual, and custody (Constitution §11, v0.2.3). These are the non-lethal
 * *endings* a conflict was missing. All canonical state on `Person`/`Body`; all deterministic.
 *
 *   overwhelming force / grievous wound  → surrender (voluntary) ─┐
 *   downed with subdue/arrest intent      → subdual   (imposed)  ─┤→ (if arrester is the watch)
 *                                                                 └→ arrest → custody → release
 */

/** Physical-time seconds a deliberate subdual holds a body incapacitated — long enough that the
 * target cannot spring back up and rejoin the fight (the plain knock-down `poseUntil` is ~45s),
 * short enough to be a "temporary state" not a sentence. ~120 physical s ≈ 2 world-hours. */
export const SUBDUAL_PHYS_SECONDS = 120;
/** World-time seconds a surrendered actor stays yielded with no fresh aggression before they
 * warily get back to their feet. */
export const SURRENDER_HOLD_SECONDS = 6 * 3600;

/** Deterministic detention length by the severity of the justifying crime. No courts, no
 * sentencing model (explicitly out of scope) — just "held for a while, longer for worse". */
export function custodyDurationFor(crimeType?: string): number {
  if (crimeType === 'kill') return 6 * SECONDS_PER_DAY;
  if (crimeType === 'attack') return 3 * SECONDS_PER_DAY;
  return 1.5 * SECONDS_PER_DAY; // theft / unspecified
}

/** Voluntary yield. The actor stops fighting; a non-lethal aggressor is expected to stop too
 * (enforced in Simulation.applyHit). Downs the body so it reads as out of the fight. */
export function beginSurrender(world: World, who: Person, toId: EntityId, reason: string, conflict?: Conflict): void {
  if (who.surrender || who.custody?.active || !who.alive) return;
  who.surrender = { toId, at: world.now, conflictId: conflict?.id, reason };
  who.mind.goal = null; who.mind.plan = [];
  who.mind.alarm = 0;
  const body = world.primaryBody(who.id);
  if (body && !body.dead) { body.pose = 'downed'; body.poseUntil = world.physicalTime + 6; body.path = null; body.attackTarget = null; }
  world.emit('entity_surrendered', {
    actor: who.id, target: toId, pos: body ? { ...body.pos } : undefined, placeId: body ? world.placeAt(body.pos)?.id : undefined,
    significance: 0.6, visibility: 16, loudness: 8, category: 'history',
    data: { toId, reason, conflictId: conflict?.id },
    summary: `${who.name} surrendered to ${world.nameOf(toId)}`,
  });
}

/** Clear a surrender once it has held long enough with no renewed aggression. */
export function endSurrender(world: World, who: Person, reason: string): void {
  if (!who.surrender) return;
  const toId = who.surrender.toId;
  who.surrender = null;
  const body = world.primaryBody(who.id);
  if (body && body.pose === 'downed' && body.subduedUntil <= world.physicalTime) { body.pose = 'stand'; }
  world.emit('conflict_disengaged', {
    actor: who.id, target: toId, significance: 0.15,
    data: { reason, afterSurrender: true },
    summary: `${who.name} got back to their feet (${reason})`,
  });
}

/** Impose incapacitation on a downed target (the subduer's intent was subdue/arrest). */
export function subdue(world: World, target: Person, byId: EntityId, conflict?: Conflict, physSeconds = SUBDUAL_PHYS_SECONDS): void {
  if (!target.alive || target.custody?.active) return;
  const body = world.primaryBody(target.id);
  if (!body || body.dead) return;
  const already = body.subduedUntil > world.physicalTime;
  body.subduedUntil = Math.max(body.subduedUntil, world.physicalTime + physSeconds);
  body.pose = 'downed'; body.poseUntil = Math.max(body.poseUntil, world.physicalTime + physSeconds); body.attackTarget = null; body.path = null;
  target.mind.goal = null; target.mind.plan = [];
  if (already) return; // don't re-emit for every follow-up blow
  world.emit('entity_subdued', {
    actor: byId, target: target.id, pos: { ...body.pos }, placeId: world.placeAt(body.pos)?.id,
    significance: 0.5, visibility: 16, loudness: 8,
    data: { byId, conflictId: conflict?.id },
    summary: `${world.nameOf(byId)} subdued ${target.name}`,
  });
}

export function isSubdued(world: World, p: Person): boolean {
  const b = world.primaryBody(p.id);
  return !!b && b.subduedUntil > world.physicalTime;
}

/**
 * Take a subdued/surrendered suspect into custody (Constitution §11 'arrest' as a real outcome,
 * not another attack intent). Records the institutional reason on the arresting faction, resolves
 * the conflict as an arrest, and marks the justifying crime handled for the watch.
 */
export function takeIntoCustody(world: World, detainee: Person, by: Person, crimeKey: string | undefined, conflict?: Conflict): void {
  if (detainee.custody?.active || !detainee.alive) return;
  const faction = by.factionId ? world.faction(by.factionId) : null;
  const crime = crimeKey ? by.knowledge[crimeKey] : undefined;
  const crimeType = crime?.claim.type as string | undefined;
  const reason = crime ? `${crimeType} (${crime.source.type}${crime.source.from ? ' via ' + world.nameOf(crime.source.from) : ''})` : 'suspicion';
  const since = world.now;
  detainee.custody = {
    active: true, byFactionId: faction?.id ?? null, byId: by.id, reason, crimeKey,
    since, releaseAt: since + custodyDurationFor(crimeType), conflictId: conflict?.id,
  };
  detainee.surrender = null;
  detainee.mind.goal = null; detainee.mind.plan = [];
  const body = world.primaryBody(detainee.id);
  const place = body ? world.placeAt(body.pos) : undefined;
  const arrestEv = world.emit('entity_arrested', {
    actor: by.id, target: detainee.id, pos: body ? { ...body.pos } : undefined, placeId: place?.id,
    causes: [crime?.source.viaEvent, conflict?.startEventId].filter((id): id is string => !!id && !!world.event(id)),
    significance: 0.75, visibility: 18, loudness: 10, category: 'history',
    data: { byId: by.id, faction: faction?.id, reason, crimeKey },
    summary: `${by.name} arrested ${detainee.name}${crimeType ? ` for ${crimeType}` : ''}`,
  });
  world.emit('custody_started', {
    actor: by.id, target: detainee.id, placeId: place?.id, causes: [arrestEv.id],
    significance: 0.6, category: 'history',
    data: { faction: faction?.id, reason, releaseAt: detainee.custody.releaseAt },
    summary: `${detainee.name} was taken into ${faction ? faction.name + "'s" : by.name + "'s"} custody`,
  });
  // Institutional record (Constitution §37: the institution learns through a real process).
  if (faction) {
    faction.knowledge[`custody:${detainee.id}`] = {
      key: `custody:${detainee.id}`, kind: 'state',
      claim: { entityId: detainee.id, state: 'in custody', reason, since, crimeKey },
      confidence: 1, learnedAt: since, source: { type: 'witnessed', from: by.id, viaEvent: arrestEv.id }, hops: 0, sharedWith: [],
    };
  }
  // The crime that justified the arrest is now handled for the arresting officer and their peers.
  if (crime) {
    crime.handled = true;
    by.mind.investigated.add(crimeKey!);
    if (faction) for (const mId of faction.members) {
      const m = world.person(mId); const mk = m?.knowledge[crimeKey!];
      if (mk) { mk.handled = true; m!.mind.investigated.add(crimeKey!); }
    }
  }
  if (conflict) resolveConflict(world, conflict, 'arrest', arrestEv.id);
}

/** End a detention cleanly (Constitution §11 'release'). */
export function releaseFromCustody(world: World, detainee: Person, reason: string): void {
  const c = detainee.custody;
  if (!c || !c.active) return;
  c.active = false;
  const faction = c.byFactionId ? world.faction(c.byFactionId) : null;
  const body = world.primaryBody(detainee.id);
  if (body && body.pose === 'downed') { body.pose = 'stand'; body.subduedUntil = 0; }
  world.emit('custody_ended', {
    actor: c.byId ?? undefined, target: detainee.id, placeId: body ? world.placeAt(body.pos)?.id : undefined,
    significance: 0.4, category: 'history',
    data: { reason, heldWorldHours: Math.round((world.now - c.since) / 3600) },
    summary: `${detainee.name} was released from ${faction ? faction.name + "'s" : ''} custody (${reason})`,
  });
  if (faction) {
    const rec = faction.knowledge[`custody:${detainee.id}`];
    if (rec) { rec.claim = { ...rec.claim, state: 'released', releasedAt: world.now }; rec.learnedAt = world.now; }
  }
}

/**
 * Periodic custody/surrender upkeep — deterministic, called each world-minute from strategic()
 * and from the headless maintenance pass.
 */
export function maintainCustody(world: World): void {
  const now = world.now;
  for (const p of world.persons()) {
    if (p.custody?.active && now >= p.custody.releaseAt) {
      releaseFromCustody(world, p, 'detention served');
      continue;
    }
    if (p.surrender && !p.custody?.active) {
      const heldLongEnough = now - p.surrender.at >= SURRENDER_HOLD_SECONDS;
      const stillThreatened = activeThreatIds(world, p.id).size > 0;
      if (heldLongEnough && !stillThreatened) endSurrender(world, p, 'the danger has passed');
    }
  }
}
