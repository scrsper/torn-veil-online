import type { Person, Relationship, EntityId, EventId } from '../core/types';
import { World } from '../core/world';

export function defaultRelationship(): Relationship { return { trust: 0, affection: 0, fear: 0, respect: 0, familiarity: 0, grudge: 0, tags: [], lastUpdated: 0 }; }
export function getRel(p: Person, other: EntityId): Relationship { return p.relationships[other] ?? (p.relationships[other] = defaultRelationship()); }
export function relOrNull(p: Person, other: EntityId): Relationship | null { return p.relationships[other] ?? null; }
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export type RelDelta = Partial<Pick<Relationship, 'trust' | 'affection' | 'fear' | 'respect' | 'familiarity' | 'grudge'>>;

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
  r.lastUpdated = world.now;
  const mag = Math.abs(r.trust - before.trust) + Math.abs(r.affection - before.affection) + Math.abs(r.fear - before.fear) + Math.abs(r.grudge - before.grudge) + Math.abs(r.respect - before.respect);
  if (!quiet && mag > 0.04) {
    const parts: string[] = [];
    const f = (k: keyof RelDelta) => { const dv = (r as any)[k] - (before as any)[k]; if (Math.abs(dv) > 0.005) parts.push(`${k} ${dv > 0 ? '+' : ''}${dv.toFixed(2)}`); };
    f('fear'); f('trust'); f('affection'); f('grudge'); f('respect');
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
