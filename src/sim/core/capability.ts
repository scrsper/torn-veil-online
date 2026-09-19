import type { EventId, Person, SkillId } from './types';
import type { PracticedSkillId } from './martialTypes';
import type { World } from './world';
import { practiceSkill } from './skills';

const DAY = 86400;
const MAX_DAILY_SECONDS = 8 * 3600;
const MAX_RECENT = 96;
const MAX_SOURCES = 16;
const MAX_CREDITED_EVENTS = 256;

export interface CapabilityPractice {
  skill: PracticedSkillId | SkillId;
  /** Canonical event that proves the action occurred. It must name this person as actor. */
  sourceEventId: EventId;
  /** Ignored compatibility hints; the canonical source determines paid work and outcome. */
  seconds?: number;
  outcome?: 'success' | 'partial' | 'failure';
  challenge?: number;
  actionKey?: string;
}

export interface CapabilityCredit {
  credited: boolean;
  effectiveSeconds: number;
  reason?: 'invalid' | 'unproven' | 'failed' | 'daily-limit' | 'no-novelty';
}

function ledger(p: Person) {
  return p.capability ??= { bySkill: {}, creditedEventIds: [], repetitionCounts: {}, recent: [], dailySeconds: 0, dailyRawSeconds: 0, day: -1 };
}

/** Credit one completed, causally grounded action. No event is emitted: frequent practice is
 * inspectable state, while the source event remains the authoritative causal record. */
export function recordCapabilityPractice(world: World, p: Person, input: CapabilityPractice): CapabilityCredit {
  const source = world.event(input.sourceEventId);
  if (!source || source.actor !== p.id) return { credited: false, effectiveSeconds: 0, reason: 'unproven' };
  // v0.1's reference adapter is paid fitting. Further producers need equally explicit
  // adapters; a work_shift label or a caller-supplied award is not proof of practice.
  if (!p.alive || input.skill !== 'crafting' || source.type !== 'mechanism_worked'
    || !['replace', 'connect', 'disconnect', 'dismantle'].includes(source.data.operation)
    || !['fitted', 'damaged'].includes(source.data.outcome)
    || source.data.practiced === false
    || !Number.isFinite(source.data.laborSeconds) || source.data.laborSeconds <= 0
    || source.tick > world.now || world.now - source.tick > 60) return { credited: false, effectiveSeconds: 0, reason: 'invalid' };
  const seconds = Math.min(3600, source.data.laborSeconds as number);
  const quality = source.data.outcome === 'damaged' ? 0.35 : 1;
  const challenge = source.data.operation === 'replace' ? 0.8 : 0.5;
  if (challenge <= 0) return { credited: false, effectiveSeconds: 0, reason: 'no-novelty' };
  const l = ledger(p);
  if (l.creditedEventIds.includes(input.sourceEventId) || source.data.capabilityCredits?.[p.id] !== undefined) return { credited: false, effectiveSeconds: 0, reason: 'no-novelty' };
  source.data.capabilityCredits = { ...(source.data.capabilityCredits ?? {}), [p.id]: 0 };
  const day = Math.floor(world.now / DAY);
  if (l.day !== day) { l.day = day; l.dailySeconds = 0; l.dailyRawSeconds = 0; }
  const available = Math.max(0, MAX_DAILY_SECONDS - (l.dailyRawSeconds ?? l.dailySeconds));
  if (available <= 0) return { credited: false, effectiveSeconds: 0, reason: 'daily-limit' };
  const key = source.data.operation as string;
  const fingerprint = `${input.skill}:${key}`;
  // This counter survives bounded recent-ledger eviction, so repetition never becomes fresh by
  // cycling more than MAX_RECENT source ids. It is bounded by retaining only the first 64 keys.
  const repeats = l.repetitionCounts[fingerprint] ?? 0;
  if (!(fingerprint in l.repetitionCounts) && Object.keys(l.repetitionCounts).length >= 64) return { credited: false, effectiveSeconds: 0, reason: 'no-novelty' };
  const repetition = Math.max(0.2, 1 / Math.sqrt(1 + repeats * 0.1));
  const effective = Math.min(seconds, available) * quality * Math.sqrt(challenge) * repetition;
  if (effective <= 1e-9) return { credited: false, effectiveSeconds: 0, reason: 'no-novelty' };
  l.dailyRawSeconds = (l.dailyRawSeconds ?? l.dailySeconds) + Math.min(seconds, available);
  l.dailySeconds += effective;
  l.repetitionCounts[fingerprint] = repeats + 1;
  l.recent = [...l.recent, { fingerprint, tick: world.now, eventId: input.sourceEventId }].slice(-MAX_RECENT);
  l.creditedEventIds = [...l.creditedEventIds, input.sourceEventId].slice(-MAX_CREDITED_EVENTS);
  source.data.capabilityCredits = { ...(source.data.capabilityCredits ?? {}), [p.id]: effective };
  const existing = l.bySkill[input.skill] ??= { effectiveSeconds: 0, actions: 0, lastTick: world.now, lastEventId: input.sourceEventId, sourceEventIds: [] };
  existing.effectiveSeconds += effective; existing.actions++; existing.lastTick = world.now; existing.lastEventId = input.sourceEventId;
  if (!existing.sourceEventIds.includes(input.sourceEventId)) {
    // Preserve a small cross-day sample as well as recency, without retaining every action.
    const combined = [...existing.sourceEventIds, input.sourceEventId];
    const days = new Map<number, string>();
    for (const id of combined) { const event = world.event(id); if (event && !days.has(Math.floor(event.tick / DAY))) days.set(Math.floor(event.tick / DAY), id); }
    const sampled = [...days.values()].slice(-3);
    existing.sourceEventIds = [...new Set([...sampled, ...combined.slice(-(MAX_SOURCES - sampled.length))])];
  }
  // Keep the existing shared skill and attribute curves authoritative. The ledger is evidence,
  // not a second proficiency or an XP-only advancement system.
  practiceSkill(p, input.skill, effective / 60, world);
  return { credited: true, effectiveSeconds: effective };
}


export function capabilityExperience(p: Person, skill: PracticedSkillId | SkillId): number {
  return p.capability?.bySkill[skill]?.effectiveSeconds ?? 0;
}

export function totalCapabilityExperience(p: Person): number {
  return Object.values(p.capability?.bySkill ?? {}).reduce((sum, r) => sum + r.effectiveSeconds, 0);
}
