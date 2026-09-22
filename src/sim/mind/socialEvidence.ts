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
        && Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z) <= SPEECH_RANGE
        && speechCarries(world, a, b)) return { speaker: a, listener: b };
    }
  }
  return null;
}

/** Conversational range, and the longest path speech may take to get round something. */
const SPEECH_RANGE = 4;
const SPEECH_PATH = SPEECH_RANGE * 1.25;
/** Where a voice can bend round an obstacle: points beside the midpoint, either side of it. */
const DETOUR_OFFSETS = [0.5, -0.5, 1, -1, 1.5, -1.5];
/**
 * Whether a voice gets from one head to the other. The straight line is enough when nothing
 * opaque is on it. Otherwise speech bends round small obstacles, such as a doorframe or a
 * building's corner post, but only along a two-leg path no longer than `SPEECH_PATH`, both legs
 * clear. A wall between the two people leaves no path that short, so it still silences them.
 *
 * The straight line alone was too strict. At seed 918271 residents came to report to a guard
 * standing 0.3 m from the guardhouse's corner post. From 1.3 to 1.7 m away round that corner,
 * every straight line clipped the post, so each report was refused hundreds of times.
 */
function speechCarries(world: World, a: Body, b: Body): boolean {
  const from = { x: a.pos.x, y: a.pos.y + 1.2, z: a.pos.z }, to = { x: b.pos.x, y: b.pos.y + 1.2, z: b.pos.z };
  if (world.grid.lineOfSight(from, to, 16)) return true;
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  if (length < 1e-6) return false;
  const px = -(to.z - from.z) / length, pz = (to.x - from.x) / length;
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: (from.z + to.z) / 2 };
  for (const offset of DETOUR_OFFSETS) {
    const via = { x: mid.x + px * offset, y: mid.y, z: mid.z + pz * offset };
    const path = Math.hypot(via.x - from.x, via.y - from.y, via.z - from.z) + Math.hypot(to.x - via.x, to.y - via.y, to.z - via.z);
    // The cast does not test the cell it starts in, so a bend point on a wall's face would let
    // the second leg begin inside the wall. A voice cannot turn a corner inside a block.
    if (path > SPEECH_PATH || world.grid.isOpaqueAt(via.x, via.y, via.z)) continue;
    if (world.grid.lineOfSight(from, via, 16) && world.grid.lineOfSight(via, to, 16)) return true;
  }
  return false;
}
