import type { AttributeId, Attributes, AttributeDevelopment, Person } from './types';
import { RNG } from './rng';

export const ATTRIBUTE_IDS: readonly AttributeId[] = ['strength', 'dexterity', 'endurance', 'vitality', 'intellect', 'perception', 'will'];
export const HUMAN_BASELINE = 8;
export const NORMAL_CEILING = 20;
export const IRON_FOUNDATION = 15;
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export function attributeProfile(value: number): Attributes {
  return Object.fromEntries(ATTRIBUTE_IDS.map(id => [id, value])) as Attributes;
}
/** The sole adapter to pre-milestone physical units: ordinary 8 -> former 0.5. */
export function physicalAttribute(value: number): number { return value / 16; }
/** Continuous, bounded differences around the ordinary adult reference. No truth access. */
export function cognitiveCapability(p: Person): { reasoning: number; observation: number; persistence: number } {
  const condition = clamp(1 - p.physiology.fatigue * 0.25 - p.physiology.sleepDebt / 64, 0.4, 1);
  return { reasoning: clamp(0.5 + p.attributes.intellect / 16, 0.5, 1.8) * condition,
    observation: clamp(0.5 + p.attributes.perception / 16, 0.5, 1.8) * condition,
    persistence: clamp(0.5 + p.attributes.will / 16, 0.5, 1.8) * condition };
}
export function ironEligible(p: Person): boolean {
  return p.ontology.stage === 'Normal' && ATTRIBUTE_IDS.every(id => p.attributes[id] >= IRON_FOUNDATION);
}
/** Stable identity-local stream; new variation never consumes the world's behavior RNG. */
export function individualRng(seed: number, identity: string): RNG {
  let h = seed;
  for (const c of identity) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return new RNG(h);
}
/** Integer triangular law. Inclusive endpoints; weights 1,2,...,2,1, centered without rounding. */
export function inheritedInteger(rng: RNG, a: number, b: number): number {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi > 20) throw new Error('Invalid human potential');
  let total = 0;
  for (let i = lo; i <= hi; i++) total += Math.min(i - lo + 1, hi - i + 1);
  let draw = rng.next() * total;
  for (let i = lo; i <= hi; i++) { draw -= Math.min(i - lo + 1, hi - i + 1); if (draw < 0) return i; }
  return hi;
}
export function defaultDevelopment(): AttributeDevelopment {
  return { progress: attributeProfile(0), exposure: attributeProfile(0), day: -1, dailyExposure: 0, exceptional: {}, studied: [] };
}
export function generatedHuman(seed: number, identity: string, age: number): { attributes: Attributes; potential: Attributes } {
  const rng = individualRng(seed, identity), attributes = attributeProfile(8), potential = attributeProfile(10);
  for (const id of ATTRIBUTE_IDS) {
    // Starting-world backstory, not an age-tick award. Newborns start undeveloped.
    attributes[id] = clamp(inheritedInteger(rng, 7, 9) - (age < 16 ? Math.round((16 - age) / 4) : 0), 1, 20);
    potential[id] = inheritedInteger(rng, 8, 12);
  }
  return { attributes, potential };
}
/** Biological repair, distinct from stamina. Nothing here rewards damage with development. */
export function recoveryMultiplier(p: Person): number {
  const nutrition = clamp(0.7 + Math.min(p.physiology.energy, p.physiology.hydration) * 0.5, 0.7, 1);
  return clamp(0.55 + p.attributes.vitality * 0.05 + p.attributes.endurance * 0.00625, 0.5, 1.8)
    * nutrition * clamp(1 - p.physiology.sleepDebt / 64, 0.5, 1);
}
