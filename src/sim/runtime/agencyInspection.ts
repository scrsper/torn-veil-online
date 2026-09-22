import type { World } from '../core/world';
import { personKnowledgeView } from './knowledgeView';
import { assessAdvancement } from '../core/advancement';
import { socialEvidence } from '../mind/socialEvidence';

/** Explicit developer inspection. Detached and read-only; never a cognition input. */
export function inspectAgency(world: World, personId: string, subjectId?: string) {
  const p = world.person(personId);
  if (!p) return null;
  return structuredClone({
    truth: { id: p.id, name: p.name, bodyIds: [...p.bodies], skills: p.skills, ontology: p.ontology },
    understoodIdentity: subjectId ? personKnowledgeView(p, subjectId) : null,
    knowledge: Object.values(p.knowledge).filter(k => k.claim.identity || k.claim.encounter || k.claim.social || k.kind === 'event').slice(-48),
    memories: [...p.memories].sort((a, b) => b.significance - a.significance || b.tick - a.tick).slice(0, 16),
    relationships: Object.entries(p.relationships).filter(([id]) => !subjectId || id === subjectId).map(([id, relation]) => ({
      subjectId: id, relation, evidence: socialEvidence(p, id, world.now),
      experiences: p.memories.filter(m => m.entities.includes(id)).slice(-8),
      changes: world.events.filter(e => e.type === 'relationship_changed' && e.actor === p.id && e.target === id).slice(-8)
        .map(e => ({ event: e.id, causes: e.causes, at: e.tick, reason: e.data.reason, delta: e.data.delta })),
    })),
    agency: { selected: p.mind.goal, considered: p.mind.decision, attention: p.mind.attention },
    capability: { experience: p.capability ?? null, advancement: assessAdvancement(world, p) },
  });
}
