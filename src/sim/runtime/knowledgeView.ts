import type { Person } from '../core/types';
import type { World } from '../core/world';
import { knownName, socialBeliefs, type SocialBelief } from '../mind/people';

/** Explicit allowlist. Never serialize a Person, canonical event, private goal or raw claim
 * into normal gameplay. These copies cannot mutate canonical state. */
export function personKnowledgeView(observer: Person, subject: string) {
  const identity = observer.knowledge[`identity:${subject}`];
  return {
    entityId: subject, name: knownName(observer, subject), knownName: !!identity || subject === observer.id,
    identity: identity ? { name: identity.claim.identity.name as string, confidence: identity.confidence, source: { ...identity.source }, learnedAt: identity.learnedAt } : null,
    beliefs: socialBeliefs(observer, subject).map(k => {
      const b = k.claim.social as SocialBelief;
      return { family: b.family, interpretation: `${b.support < 0 ? 'may not be' : 'may be'} ${b.characteristic}`, confidence: k.confidence,
        learnedAt: k.learnedAt, source: { ...k.source }, evidence: b.evidence.map(e => ({ ...e })) };
    }),
    observations: Object.values(observer.knowledge).filter(k => k.kind === 'event' && (k.claim.actor === subject || k.claim.target === subject)).slice(-16)
      .map(k => ({ key: k.key, action: k.claim.type as string, at: k.learnedAt, confidence: k.confidence, source: { ...k.source } })),
  };
}
export function knowledgeView(world: World, observer: Person) {
  const seen = observer.mind.percepts.filter(p => p.how === 'saw');
  return {
    avatarId: observer.id,
    people: seen.flatMap(percept => {
      const p = world.person(percept.entityId), b = world.body(percept.bodyId);
      if (!p || !b) return [];
      return [{ ...personKnowledgeView(observer, p.id), bodyId: b.id, pos: { ...percept.pos },
        appearance: { ...p.appearance }, ageBand: p.lifeStage, visibleAction: b.pose,
        speech: p.speech && p.speech.until > world.physicalTime ? p.speech.text : '' }];
    }),
    mechanisms: Object.values(observer.knowledge).filter(k => k.claim.mechanicalEvidence || k.claim.mechanicalHypothesis || k.claim.inferredMethod)
      .map(k => ({ key: k.key, claim: structuredClone(k.claim), confidence: k.confidence, source: { ...k.source }, at: k.learnedAt })),
  };
}
