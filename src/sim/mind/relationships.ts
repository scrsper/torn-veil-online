import type { Person, Relationship, EntityId, EventId } from '../core/types';
import { World } from '../core/world';

export function defaultRelationship(): Relationship { return { trust: 0, affection: 0, fear: 0, respect: 0, familiarity: 0, grudge: 0, tags: [], lastUpdated: 0 }; }
export function getRel(p: Person, other: EntityId): Relationship { return p.relationships[other] ?? (p.relationships[other] = defaultRelationship()); }
export function relOrNull(p: Person, other: EntityId): Relationship | null { return p.relationships[other] ?? null; }
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export type RelDelta = Partial<Pick<Relationship, 'trust' | 'affection' | 'fear' | 'respect' | 'familiarity' | 'grudge' | 'grievance'>>;

// ---------------------------------------------------------------- relationship evolution (v0.2.3)
/**
 * Deterministic, semantically-shaped temporal evolution of a relationship (Constitution §7
 * "Memory Is Not a Transcript", §11). The v0.2.2 audit found fear/grudge only ever rose — the
 * psychological drivers of a fight never faded short of a death, so conflicts never ended and
 * event workload grew without bound.
 *
 * This is NOT "subtract a fixed amount from every field every tick". The shape:
 *  - **fear** fades relatively quickly once the danger is actually gone (half-life ~16h), but
 *    does NOT fade at all while an active/disengaging conflict with that entity still exists
 *    (`activeThreat`) — you do not calm down mid-fight.
 *  - **grudge** fades much more slowly (half-life ~5 days) and only *toward the grievance floor*,
 *    never below it — and also not while an active threat remains, nor while fresh unresolved
 *    harm sits in memory (`unresolvedHarm`, e.g. a still-'handled':false crime by that actor).
 *  - **grievance** (the durable floor — murder of kin, a sustained assault campaign) erodes only
 *    on a scale of years, so a defining wrong stays defining.
 *  - **trust** recovers on its own timescale (slow, ~10 days) toward neutral from the negative
 *    side — distinct from fear; being no longer afraid of someone is not the same as trusting them.
 *  - **affection / respect / familiarity** are deliberately untouched here: they must not
 *    evaporate on a combat timescale (a wronged friend is still a friend who was wronged).
 */
export const FEAR_HALFLIFE_HOURS = 16;
export const GRUDGE_HALFLIFE_HOURS = 5 * 24;
export const GRIEVANCE_HALFLIFE_HOURS = 400 * 24; // effectively a lifetime; still finite
export const TRUST_RECOVERY_HALFLIFE_HOURS = 10 * 24;

const halfLifeDecay = (value: number, target: number, hours: number, halfLifeHours: number): number =>
  target + (value - target) * Math.pow(0.5, hours / halfLifeHours);

export interface RelationshipEvolutionContext {
  /** Entity ids this person currently has a live (active/disengaging) conflict with — fear and
   * grudge toward these do not cool. */
  activeThreatIds: Set<EntityId>;
  /** Entity ids this person still holds an unresolved grievance-worthy fact about (an
   * un-'handled' known crime by them). Grudge toward these cools far slower. */
  unresolvedHarmIds: Set<EntityId>;
}

/** Advance every one of a person's relationships by `hours` of world time. Deterministic. */
export function evolveRelationships(p: Person, hours: number, ctx: RelationshipEvolutionContext): void {
  if (hours <= 0) return;
  for (const id of Object.keys(p.relationships)) {
    const r = p.relationships[id];
    const activeThreat = ctx.activeThreatIds.has(id);
    const unresolved = ctx.unresolvedHarmIds.has(id);

    if (r.grievance && r.grievance > 0) {
      r.grievance = Math.max(0, halfLifeDecay(r.grievance, 0, hours, GRIEVANCE_HALFLIFE_HOURS));
      if (r.grievance < 0.01) r.grievance = 0;
    }
    const grudgeFloor = r.grievance ?? 0;

    if (!activeThreat) {
      if (r.fear > 0) r.fear = Math.max(0, halfLifeDecay(r.fear, 0, hours, FEAR_HALFLIFE_HOURS));
      if (r.grudge > grudgeFloor) {
        const halfLife = unresolved ? GRUDGE_HALFLIFE_HOURS * 3 : GRUDGE_HALFLIFE_HOURS;
        r.grudge = Math.max(grudgeFloor, halfLifeDecay(r.grudge, grudgeFloor, hours, halfLife));
      } else if (r.grudge < grudgeFloor) {
        r.grudge = grudgeFloor; // a newly-recorded grievance pulls grudge up to its floor
      }
      if (r.trust < 0) r.trust = Math.min(0, halfLifeDecay(r.trust, 0, hours, TRUST_RECOVERY_HALFLIFE_HOURS));
    }
    // affection / respect / familiarity: intentionally not decayed here.
  }
}

/** Apply a directional relationship change and record it as a cognition event (when significant). */
export function adjustRel(world: World, p: Person, other: EntityId, d: RelDelta, reason: string, cause?: EventId, quiet = false): void {
  const r = getRel(p, other);
  const before = { ...r };
  if (d.trust) r.trust = clamp(r.trust + d.trust, -1, 1);
  if (d.affection) r.affection = clamp(r.affection + d.affection, -1, 1);
  if (d.fear) r.fear = clamp(r.fear + d.fear, 0, 1);
  if (d.respect) r.respect = clamp(r.respect + d.respect, -1, 1);
  if (d.familiarity) r.familiarity = clamp(r.familiarity + d.familiarity, 0, 1);
  if (d.grudge) r.grudge = clamp(r.grudge + d.grudge, 0, 1);
  // grievance (v0.2.3): a durable floor under grudge, only ever ratcheted UP by a delta (a
  // defining wrong does not become less defining because a later, smaller delta arrives). It
  // decays only over years, in evolveRelationships. A positive grievance also pulls grudge up
  // to its floor immediately so the relationship reads as hostile straight away.
  if (d.grievance && d.grievance > 0) {
    r.grievance = clamp(Math.max(r.grievance ?? 0, (r.grievance ?? 0) + d.grievance), 0, 1);
    if (r.grudge < r.grievance) r.grudge = r.grievance;
  }
  r.lastUpdated = world.now;
  const mag = Math.abs(r.trust - before.trust) + Math.abs(r.affection - before.affection) + Math.abs(r.fear - before.fear) + Math.abs(r.grudge - before.grudge) + Math.abs(r.respect - before.respect) + Math.abs((r.grievance ?? 0) - (before.grievance ?? 0));
  if (!quiet && mag > 0.04) {
    const parts: string[] = [];
    const f = (k: keyof RelDelta) => { const dv = ((r as any)[k] ?? 0) - ((before as any)[k] ?? 0); if (Math.abs(dv) > 0.005) parts.push(`${k} ${dv > 0 ? '+' : ''}${dv.toFixed(2)}`); };
    f('fear'); f('trust'); f('affection'); f('grudge'); f('grievance'); f('respect');
    world.emit('relationship_changed', { actor: p.id, target: other, causes: cause ? [cause] : [], significance: Math.min(0.6, mag), data: { delta: d, reason, after: { trust: r.trust, affection: r.affection, fear: r.fear, grudge: r.grudge, respect: r.respect } }, summary: `${p.name} → ${world.nameOf(other)}: ${parts.join(', ')} (${reason})` });
  }
}
export function setRelTags(p: Person, other: EntityId, ...tags: string[]): void { const r = getRel(p, other); for (const t of tags) if (!r.tags.includes(t)) r.tags.push(t); }

/** Overall disposition toward another entity: -1 hostile .. +1 warm */
export function disposition(p: Person, other: EntityId): number {
  const r = p.relationships[other]; if (!r) return 0;
  return clamp(r.affection * 0.5 + r.trust * 0.3 + r.respect * 0.2 - r.grudge * 0.6 - r.fear * 0.2, -1, 1);
}
export function isFamily(p: Person, other: EntityId): boolean { const r = p.relationships[other]; return !!r && r.tags.some(t => ['spouse', 'child', 'parent', 'sibling', 'foster'].includes(t)); }
export function isClose(p: Person, other: EntityId): boolean { const r = p.relationships[other]; return !!r && (isFamily(p, other) || r.tags.includes('friend') || r.tags.includes('sweetheart') || r.affection > 0.5); }

export function describeRel(r: Relationship): string {
  const bits: string[] = [];
  if (r.tags.length) bits.push(r.tags.join('/'));
  if (r.fear > 0.6) bits.push('terrified'); else if (r.fear > 0.3) bits.push('wary');
  if (r.grudge > 0.6) bits.push('hates'); else if (r.grudge > 0.25) bits.push('resents');
  if (r.affection > 0.6) bits.push('loves'); else if (r.affection > 0.25) bits.push('likes'); else if (r.affection < -0.4) bits.push('dislikes');
  if (r.trust > 0.5) bits.push('trusts'); else if (r.trust < -0.4) bits.push('distrusts');
  if (r.respect > 0.5) bits.push('respects'); else if (r.respect < -0.4) bits.push('scorns');
  if (r.familiarity < 0.1) bits.push('stranger');
  return bits.length ? bits.join(', ') : 'neutral';
}
