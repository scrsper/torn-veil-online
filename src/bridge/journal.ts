import type { Person } from '../sim/core/types';
import type { World } from '../sim/core/world';
import { assessAdvancement, IRON_PRACTICE_SECONDS } from '../sim/core/advancement';
import { knownName } from '../sim/mind/people';
import { requestTypeLabel } from '../sim/core/requests';
import { ATTRIBUTE_IDS } from '../sim/core/human';
import { knowsVeil, veilStrain } from '../sim/physical/veil';

/** Qualitative reading of a 0..1 proficiency; a person knows roughly how good they are, not a number. */
function band(v: number): string {
  return v >= 0.8 ? 'masterful' : v >= 0.55 ? 'skilled' : v >= 0.3 ? 'competent' : v >= 0.1 ? 'novice' : 'untrained';
}

/**
 * The controlled person's own journal: only what that person has done, owes, feels or can
 * inspect about themselves. It never lists other people's private state, open world requests the
 * person has not learned of, or canonical truth the person lacks. Names go through `knownName`.
 */
export function playerJournal(world: World, p: Person) {
  const body = world.primaryBody(p.id);
  const commitments = world.requests.filter(r => r.acceptedBy === p.id && r.status === 'accepted').slice(-8).map(r => ({
    requestId: r.id, kind: requestTypeLabel(r.type), reward: r.reward, since: r.acceptedAt ?? r.createdAt,
    requester: r.requesterId ? knownName(p, r.requesterId) : null, cause: r.cause,
  }));
  const owed = (p.mind.obligations ?? []).filter(o => o.status === 'live').slice(-8).map(o => ({
    kind: o.kind, toward: knownName(p, o.towardId), weight: o.magnitude >= 0.6 ? 'heavy' : o.magnitude >= 0.3 ? 'moderate' : 'light',
  }));
  const injuries = Object.entries(body?.injuries ?? {}).filter(([, v]) => (v ?? 0) > 0.05)
    .map(([region, v]) => ({ region, severity: (v ?? 0) >= 0.6 ? 'severe' : (v ?? 0) >= 0.25 ? 'serious' : 'minor' }));
  const skills = Object.entries(p.skills).filter(([, v]) => (v ?? 0) >= 0.1).map(([skill, v]) => ({ skill, level: band(v ?? 0) }))
    .sort((a, b) => a.skill.localeCompare(b.skill));
  const advancement = assessAdvancement(world, p);
  // One's own body is self-knowledge: foundations and how far along the next point is.
  const foundations = ATTRIBUTE_IDS.map(id => ({ id, value: p.attributes[id], progress: Math.round((p.development?.progress[id] ?? 0) * 100) / 100 }));
  const knownTechniques = Object.values(p.knowledge).filter(k => k.kind === 'technique' && typeof (k.claim.skill ?? k.claim.family) === 'string');
  const techniques = [...new Set(knownTechniques.map(k => (k.claim.skill ?? k.claim.family) as string))].sort();
  const techniqueHistory = knownTechniques.map(k => ({ name: typeof k.claim.name === 'string' ? k.claim.name : (k.claim.skill ?? k.claim.family) as string,
    method: k.source.type, teacher: k.source.from ? knownName(p, k.source.from) : null }));
  const practice = Object.entries(p.capability?.bySkill ?? {}).map(([skill, record]) => ({ skill,
    hours: Math.round(record.effectiveSeconds / 36) / 100, level: band(p.skills[skill as keyof typeof p.skills] ?? 0),
    days: new Set(record.sourceEventIds.flatMap(id => { const e = world.event(id); return e ? [Math.floor(e.tick / 86400)] : []; })).size,
  })).sort((a, b) => a.skill.localeCompare(b.skill));
  return {
    commitments, obligations: owed, injuries, skills,
    condition: { fatigue: p.physiology.fatigue, energy: p.physiology.energy, hydration: p.physiology.hydration, sleepDebt: p.physiology.sleepDebt },
    stage: p.ontology.stage, foundations, techniques, techniqueHistory, practice, practiceHoursRequired: IRON_PRACTICE_SECONDS / 3600,
    veil: knowsVeil(p) ? { strain: Math.round(veilStrain(world, p) * 100) / 100 } : null,
    advancement: { eligible: advancement.eligible, path: advancement.path ?? null, remaining: advancement.reasons.slice(0, 8) },
  };
}
