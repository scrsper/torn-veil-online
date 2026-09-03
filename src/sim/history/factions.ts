import type { EntityId, Faction, Person } from '../core/types';
import { World } from '../core/world';
import { isCrime } from '../mind/knowledge';

/**
 * Promotes a faction leader's sufficiently confident knowledge into the faction's
 * institutional memory (Constitution §37: institutions form through real processes, not
 * telepathy). Only the LEADER's own knowledge is ever a candidate — an ordinary member's
 * private knowledge never leaks into `faction.knowledge` just because they belong to it.
 * This is deliberately narrow in v0.2: it tracks crime/threat knowledge, matching what the
 * watch and the bandits actually care about institutionally. Idempotent and safe to call
 * repeatedly (e.g. once per simulated hour from the headless runner).
 */
export function syncFactionInstitutionalKnowledge(world: World): number {
  let promoted = 0;
  for (const faction of world.ofKind<Faction>('faction')) {
    if (!faction.leaderId) continue;
    const leader = world.person(faction.leaderId);
    if (!leader || !leader.alive) continue;
    for (const k of Object.values(leader.knowledge)) {
      if (k.kind !== 'event' || !isCrime(k.claim.type, k.claim.intent)) continue;
      if (k.confidence < 0.5) continue;
      const existing = faction.knowledge[k.key];
      if (existing && existing.confidence >= k.confidence) continue;
      faction.knowledge[k.key] = { ...k, sharedWith: [] };
      promoted++;
      world.emit('institutional_report', {
        actor: leader.id, placeId: k.claim.placeId, significance: 0.1, category: 'social',
        data: { faction: faction.id, key: k.key },
        summary: `${faction.name}'s institutional record now includes: ${k.claim.type} (via ${leader.name})`,
      });
    }
  }
  return promoted;
}

/**
 * Promotes a replacement leader for any faction whose current leader is dead (Constitution
 * §13's own worked example: "leadership replacement after death"). The replacement is the
 * alive member with the highest historical significance (ties broken by age), not simply
 * "the next id" — a faction plausibly rallies behind whoever mattered most, not whoever
 * happened to be generated next. A faction with no alive members left becomes leaderless
 * (`leaderId = null`) rather than silently keeping a dead leader.
 */
export function checkLeadershipVacancies(world: World, significance: Map<EntityId, number>): EntityId[] {
  const changedFactions: EntityId[] = [];
  for (const faction of world.ofKind<Faction>('faction')) {
    if (!faction.leaderId) continue;
    const leader = world.person(faction.leaderId);
    if (leader && leader.alive) continue;
    const candidates = faction.members
      .map(id => world.person(id))
      .filter((p): p is Person => !!p && p.alive && p.id !== faction.leaderId);
    const prevId = faction.leaderId;
    if (!candidates.length) { faction.leaderId = null; changedFactions.push(faction.id); continue; }
    candidates.sort((a, b) => (significance.get(b.id) ?? 0) - (significance.get(a.id) ?? 0) || b.age - a.age);
    const next = candidates[0];
    faction.leaderId = next.id;
    changedFactions.push(faction.id);
    world.emit('leadership_changed', {
      actor: next.id, target: prevId ?? undefined, significance: 0.6, category: 'history',
      data: { faction: faction.id, from: prevId, to: next.id },
      summary: `${next.name} became leader of ${faction.name} after ${leader ? leader.name : world.nameOf(prevId)}'s death`,
    });
  }
  return changedFactions;
}
