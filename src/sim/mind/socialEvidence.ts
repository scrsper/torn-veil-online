import type { Body, GoalType, Person } from '../core/types';
import type { World } from '../core/world';
import type { SocialBelief } from './people';
import { hash2 } from '../core/rng';

/** Person/time/salt keyed variation: speech never advances combat or weather streams. */
export function socialChoice(world: World, person: Person, salt: string, count: number): number {
  let hash = 2166136261;
  for (const char of `${person.id}:${salt}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return Math.floor(hash2(hash, Math.floor(world.physicalTime * 1000), world.seed) * count);
}

/** A decision input derived only from this mind's evidence, never the subject's substrate.
 * Maxima avoid counting multiple interpretations of one deed as independent certainty. */
export function socialEvidence(person: Person, subject: string, now: number) {
  let caution = 0, cooperation = 0, esteem = 0;
  const inputs: { key: string; event?: string; confidence: number; learnedAt: number }[] = [];
  // The decision policy has a small vocabulary. Look up those existing keyed beliefs rather
  // than scanning up to 400 unrelated facts for every candidate and every nearby body.
  const interpretations = ['disposition:restrained', 'intent:attacking', 'disposition:honest', 'disposition:reliable',
    'disposition:generous', 'capability:competent fighter', 'capability:skilled craftsperson', 'capability:dexterous'];
  for (const interpretation of interpretations) {
    const item = person.knowledge[`social:${subject}:${interpretation}`];
    if (!item) continue;
    const belief = item.claim.social as SocialBelief | undefined;
    if (!belief || belief.subject !== subject) continue;
    const freshness = Math.exp(-Math.max(0, now - item.learnedAt) / (belief.family === 'intent' ? 120 : 30 * 86400));
    const weight = Math.sign(belief.support) * item.confidence * freshness;
    if (belief.characteristic === 'restrained') caution = Math.max(caution, -weight);
    else if (belief.characteristic === 'attacking') caution = Math.max(caution, weight);
    else if (['honest', 'reliable', 'generous'].includes(belief.characteristic)) {
      // Conflicting impressions temper willingness rather than deleting either belief.
      cooperation += weight / 3;
    } else if (belief.family === 'capability') esteem = Math.max(esteem, weight);
    else continue;
    inputs.push({ key: item.key, event: item.source.viaEvent, confidence: item.confidence, learnedAt: item.learnedAt });
  }
  return { caution, cooperation, esteem, inputs: inputs.slice(-12) };
}

/** Additional social motivation enters the existing shared cap with concerns/obligations. */
export function socialMotivation(person: Person, goal: GoalType, subject: string | undefined, now: number) {
  if (!subject) return { bonus: 0, reasons: [] as string[] };
  const helping = ['help', 'check_on', 'teach_method', 'share_family', 'visit', 'court', 'return_item'].includes(goal);
  if (!helping) return { bonus: 0, reasons: [] as string[] };
  const evidence = socialEvidence(person, subject, now);
  const bonus = Math.max(0, evidence.cooperation) * 0.16;
  return { bonus, reasons: bonus ? [`my evidence suggests cooperation (${evidence.inputs.map(i => i.key).join(', ')})`] : [] };
}

/** Communication is an embodied action. No remote delivery, sleeping recipients, or walls. */
export function conversationReachable(world: World, speaker: Person, listener: Person): boolean {
  return conversationBodies(world, speaker, listener) !== null;
}
export function conversationBodies(world: World, speaker: Person, listener: Person): { speaker: Body; listener: Body } | null {
  if (!speaker.alive || !listener.alive || speaker.id === listener.id) return null;
  for (const id of speaker.bodies) {
    const a = world.body(id);
    if (!a?.present || a.dead || a.health <= 0 || ['sleep', 'downed'].includes(a.pose)) continue;
    for (const other of listener.bodies) {
      const b = world.body(other);
      if (!!b?.present && !b.dead && b.health > 0 && !['sleep', 'downed'].includes(b.pose)
        && Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z) <= 4
        && world.grid.lineOfSight({ ...a.pos, y: a.pos.y + 1.2 }, { ...b.pos, y: b.pos.y + 1.2 }, 16)) return { speaker: a, listener: b };
    }
  }
  return null;
}
