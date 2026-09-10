import type { KnowledgeItem, Person, Source } from '../core/types';
import type { World } from '../core/world';
import { learn } from './knowledge';
import { remember } from './memory';

export type SocialFamily = 'disposition' | 'capability' | 'standing' | 'intent';
export interface SocialBelief {
  subject: string; family: SocialFamily; characteristic: string;
  /** Signed support for a qualitative interpretation, never a canonical personality/stat. */
  support: number; evidence: { key: string; event?: string; at: number; weight: number }[];
}
export const identityKey = (id: string) => `identity:${id}`;
/** Entity references identify perceived individuals internally; they do not reveal names. */
export function knownName(observer: Person, id?: string | null): string {
  if (!id) return 'someone';
  if (id === observer.id) return observer.name;
  return observer.knowledge[identityKey(id)]?.claim.identity?.name ?? 'an unfamiliar person';
}
export function perceivedName(world: World, observer: Person | undefined, id?: string | null): string {
  if (!id) return 'someone';
  if (world.person(id)) return observer ? knownName(observer, id) : 'an unfamiliar person';
  return world.nameOf(id);
}

/** A claim about identity, not a lookup of the named person's true name. False names survive. */
export function learnIdentity(world: World, observer: Person, subject: string, name: string, source: Source, confidence = 0.75): KnowledgeItem | null {
  if (!name.trim() || name.length > 100 || !source.viaEvent && source.type !== 'prior') return null;
  const key = identityKey(subject), prior = observer.knowledge[key];
  const evidence = [...(prior?.claim.evidence ?? []), { name, source: { ...source }, at: world.now }].slice(-12);
  const result = learn(world, observer, { key, kind: 'fact', claim: { identity: { subject, name }, evidence }, confidence,
    source, cause: source.viaEvent, summary: `I heard this person called ${name}` }, true);
  const item = result ?? prior;
  if (item) Object.assign(item, { claim: { identity: { subject, name }, evidence }, confidence, source: { ...source }, learnedAt: world.now, sharedWith: [] });
  return item ?? null;
}
export function introduce(world: World, speaker: Person, listener: Person, claimedName = speaker.name): boolean {
  if (!speaker.alive || !listener.alive || !claimedName.trim() || claimedName.length > 100) return false;
  const canConverse = speaker.bodies.some(id => {
    const a = world.body(id); if (!a?.present || a.dead || ['sleep', 'downed'].includes(a.pose)) return false;
    return listener.bodies.some(other => {
      const b = world.body(other); return b?.present && !b.dead && !['sleep', 'downed'].includes(b.pose)
        && Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z) <= 4;
    });
  });
  if (!canConverse) return false;
  const ev = world.emit('introduction', { actor: speaker.id, target: listener.id, pos: world.positionOf(speaker.id),
    visibility: 5, loudness: 4, significance: 0.25, data: { claimedName }, summary: `${speaker.name} introduced themself as ${claimedName}` });
  learnIdentity(world, listener, speaker.id, claimedName, { type: 'told', from: speaker.id, viaEvent: ev.id });
  remember(world, listener, { type: 'introduction', summary: `This person introduced themself as ${claimedName}`, entities: [speaker.id],
    significance: 0.3, valence: 0, eventId: ev.id, source: { type: 'told', from: speaker.id, viaEvent: ev.id } });
  return true;
}

export function socialBeliefs(p: Person, subject?: string): KnowledgeItem[] {
  return Object.values(p.knowledge).filter(k => k.claim.social && (!subject || k.claim.social.subject === subject));
}
/** Local, revisable interpretation. The target's mind, attributes, skills and traits are never
 * queried. Prior support, the observer's dispositions, relationships and testimony may bias it. */
export function interpretSocial(world: World, observer: Person, evidence: KnowledgeItem): void {
  if (observer.knowledge[evidence.key] !== evidence) return;
  const c = evidence.claim, subject = c.actor as string | undefined;
  if (!subject || subject === observer.id || !evidence.source.viaEvent) return;
  const rel = observer.relationships[subject];
  const sympathy = (rel?.affection ?? 0) * 0.3 + (rel?.trust ?? 0) * 0.15;
  const exploratory = observer.traits.curiosity - (1 - observer.traits.courage) * 0.5;
  const signals: [SocialFamily, string, number][] = [];
  switch (c.type) {
    case 'mechanism_trial':
      if (c.output > 0) signals.push(['capability', 'skilled craftsperson', 0.7], ['disposition', 'reliable', 0.35]);
      else { signals.push(['capability', 'skilled craftsperson', -0.45 + sympathy]); signals.push(['disposition', 'curious', exploratory + sympathy]); signals.push(['disposition', 'restrained', -0.45 + exploratory + sympathy]); }
      break;
    case 'mechanism_worked':
      signals.push(['intent', 'repairing the mechanism', 0.65]);
      if (c.outcome === 'fitted') signals.push(['capability', 'dexterous', 0.45]);
      if (c.outcome === 'damaged') signals.push(['capability', 'skilled craftsperson', -0.6], ['disposition', 'restrained', -0.55 + sympathy]);
      break;
    case 'mechanism_inspected': signals.push(['intent', 'examining the mechanism', 0.7], ['disposition', 'curious', 0.4]); break;
    case 'gift': case 'returned_item': case 'heal': signals.push(['disposition', 'generous', 0.6], ['disposition', 'reliable', 0.45], ['standing', 'valued by others', 0.3]); break;
    case 'theft': signals.push(['disposition', 'honest', -0.65], ['disposition', 'generous', -0.55]); break;
    case 'attack': signals.push(['disposition', 'restrained', -0.6 + sympathy], ['intent', 'attacking', 0.65], ['capability', 'competent fighter', c.hit ? 0.45 : 0.15]); break;
    case 'yield': signals.push(['disposition', 'restrained', 0.5], ['disposition', 'courageous', -0.3 + sympathy]); break;
    case 'assembly_changed': signals.push(['intent', 'altering the mechanism', 0.55]); break;
    default: return;
  }
  for (const [family, characteristic, direction] of signals) {
    const key = `social:${subject}:${family}:${characteristic}`;
    const prior = observer.knowledge[key], old = prior?.claim.social as SocialBelief | undefined;
    if (old?.evidence.some(e => e.key === evidence.key)) continue;
    const age = Math.max(0, world.now - (prior?.learnedAt ?? world.now));
    const decay = Math.exp(-age / (family === 'intent' ? 120 : 30 * 86400));
    const weight = direction * evidence.confidence;
    const support = Math.max(-3, Math.min(3, (old?.support ?? 0) * decay + weight));
    // A saturated impression does not acquire another causal revision on every identical
    // work stroke. Contradiction still revises it immediately; recency can be reconfirmed.
    if (old && Math.abs(support - old.support) < 0.02) { prior.lastConfirmedAt = world.now; continue; }
    const social: SocialBelief = { subject, family, characteristic, support,
      evidence: [...(old?.evidence ?? []), { key: evidence.key, event: evidence.source.viaEvent, at: world.now, weight }].slice(-12) };
    const causes = [evidence.source.viaEvent, prior?.source.viaEvent].filter((id): id is string => !!id);
    const ev = world.emit('social_inferred', { actor: observer.id, target: subject, causes, category: 'cognition', significance: 0.2,
      data: { key, premise: evidence.key, characteristic, support }, summary: `${observer.name} revised an impression of ${knownName(observer, subject)}` });
    const confidence = Math.min(0.92, Math.abs(support) / (Math.abs(support) + 1));
    const item = learn(world, observer, { key, kind: 'fact', claim: { social }, confidence, source: { type: 'inferred', viaEvent: ev.id } }, true) ?? prior;
    if (item) Object.assign(item, { claim: { social }, confidence, learnedAt: world.now, source: { type: 'inferred', viaEvent: ev.id }, sharedWith: [] });
  }
}
