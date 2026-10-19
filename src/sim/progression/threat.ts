import type { Body, BodyRegion, Creature, Item, Person } from '../core/types';
import type { World } from '../core/world';
import { physicalAttribute, NORMAL_CEILING } from '../core/human';
import { ageCapabilityModifier } from '../core/species';
import { combatWeapon, UNARMED, weaponProperties, type WeaponProperties } from '../physical/combat';
import { equippedItems } from '../physical/equipment';
import { arcaneCapacity } from '../physical/arcana/growth';
import { ARCANE_DEFINITIONS, KERNEL_GEOMETRY } from '../physical/arcana/definitions';
import { WILDLIFE_SPECIES } from '../ecology/species';
import { gradeLabel, levelForPower, rankOfLevel, type LeveledRank } from './levels';

/**
 * Capability-derived threat: a classification of what an entity can actually do, never an input
 * to combat (Constitution §14: "Tier is classification. Capability is truth.").
 *
 * Power is a duel estimate against the ordinary reference adult (attributes 8, unarmed, 80 HP):
 * offense = damage it can deliver to an unarmored body over a ten-second exchange, including
 * the free time a longer reach buys while the reference closes; durability = its health over
 * the share of the reference's blows that gets through its armor. Their product is the Lanchester
 * duel strength, so power 1 is the reference and power 2 wins an even fight twice over.
 * Transient fatigue, hunger and wounds are excluded: a tired guard is not a lesser guard.
 * Only the threat *level* is derived here; earned levels belong to progression/experience.ts.
 */
export interface ThreatAssessment {
  power: number; level: number; rank: LeveledRank; grade: string;
  offense: number; durability: number;
  basis: { weapon: string | null; arcane: string | null; armor: string[]; maxHealth: number };
}
const REF_HP = 80, WINDOW = 10, MELEE_CYCLE = 1, CLOSE_SPEED = 4;
/** Where blows land, for averaging partial armor coverage. An estimate, not combat geometry. */
const REGION_SHARE: Record<BodyRegion, number> = { torso: 0.45, arm: 0.2, leg: 0.2, head: 0.15 };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function strikeImpact(weapon: WeaponProperties, strength: number, dexterity: number, age = 1, ceiling = NORMAL_CEILING, force = 1): number {
  const top = Math.max(2, ceiling / 16);
  const s = clamp(physicalAttribute(strength) * age, 0.005, top), d = clamp(physicalAttribute(dexterity) * age, 0.005, top);
  // The shared strike formula (physical/combat.ts) at its mean roll, without transient penalties.
  return weapon.impact * (0.5 + s) * (0.7 + Math.min(1, d) * 0.3) * (0.8 + weapon.handling * 0.2) * force;
}
const reachFactor = (range: number) => 1 + clamp((range - UNARMED.reach) / CLOSE_SPEED, 0, WINDOW) / WINDOW;
function referenceOffense(): number { return strikeImpact(UNARMED, 8, 8) * WINDOW / MELEE_CYCLE; }
function referenceImpact(): number { return strikeImpact(UNARMED, 8, 8); }

/** Damage over the exchange from the best learned damaging form, at a given capacity. */
function arcaneOffense(p: Pick<Person, 'arcana' | 'skills'>, capacity: { amplitude: number; aperture: number; reserve: number }, only?: string[]) {
  let best = { damage: 0, id: null as string | null };
  for (const id of only ?? Object.keys(p.arcana?.learned ?? {})) {
    const d = ARCANE_DEFINITIONS.get(id), g = d && KERNEL_GEOMETRY[d.kernel];
    if (!d || !g || g.damage <= 0) continue;
    const power = d.power * (1 + Math.min(1, p.skills?.veilcraft ?? 0) * 0.35) * capacity.amplitude;
    const cost = d.mana ?? (d.source === 'scroll' ? 0 : d.cost);
    const casts = d.source === 'scroll' ? 1 : Math.min(WINDOW / Math.max(d.cooldown, g.windup + g.recovery), cost > 0 ? capacity.reserve / cost : Infinity);
    const damage = g.damage * power * casts * reachFactor(g.range * capacity.aperture);
    if (damage > best.damage) best = { damage, id };
  }
  return best;
}
/** Share of a reference blow that reaches the body through its equipped armor. */
function armorThrough(armor: Item[]): number {
  const hit = referenceImpact();
  let through = 0;
  for (const [region, share] of Object.entries(REGION_SHARE) as [BodyRegion, number][]) {
    let damage = hit;
    // Same sequential reduction as physical/protection.ts absorbImpact.
    for (const i of armor) if (i.physicalArmor?.coverage.includes(region) && i.condition !== 0)
      damage -= Math.min(damage * 0.65, i.physicalArmor.absorption * (i.condition ?? 1));
    through += share * damage / hit;
  }
  return Math.max(0.05, through);
}
function assessment(offense: number, durability: number, basis: ThreatAssessment['basis']): ThreatAssessment {
  const power = offense * durability, level = levelForPower(power);
  return { power, level, rank: rankOfLevel(level), grade: gradeLabel(level), offense, durability, basis };
}

/** A person's threat. `equipped` includes carried weapons, worn armor and equipped foci (what an
 * opponent actually faces); intrinsic uses only the body, foundations and learned capacity. */
export function personThreat(w: World, p: Person, b = w.primaryBody(p.id), opts: { equipped?: boolean } = {}): ThreatAssessment {
  const equipped = opts.equipped ?? true, age = ageCapabilityModifier(p.species, p.age), ceiling = p.vessel?.ceiling ?? NORMAL_CEILING;
  const item = equipped && b ? combatWeapon(w, p, b.id) : null, weapon = item ? weaponProperties(item)! : UNARMED;
  const melee = strikeImpact(weapon, p.attributes.strength, p.attributes.dexterity, age, ceiling, p.vessel?.force ?? 1) * WINDOW / MELEE_CYCLE * reachFactor(weapon.reach);
  const capacity = equipped && b ? arcaneCapacity(p, w, b) : arcaneCapacity(p);
  const arcane = arcaneOffense(p, capacity);
  const armor = equipped && b ? equippedItems(w, p, b).filter(i => i.physicalArmor) : [];
  const maxHealth = b?.maxHealth ?? REF_HP;
  return assessment(Math.max(melee, arcane.damage) / referenceOffense(), maxHealth / REF_HP / armorThrough(armor),
    { weapon: item?.name ?? null, arcane: arcane.damage > melee ? arcane.id : null, armor: armor.map(i => i.name), maxHealth });
}

/** Wildlife threat from its species' real defensive strike and its body. Animals that only flee
 * have no offense and assess at level 1. Legacy decorative creatures are level 1. */
export function creatureThreat(w: World, c: Creature, b = c.bodies.map(id => w.body(id)).find(x => x && !x.dead) ?? w.body(c.bodies[0])): ThreatAssessment {
  const spec = w.ecology?.species[c.species] ?? WILDLIFE_SPECIES[c.species], d = c.wildlife ? spec?.defense : undefined;
  const maxHealth = b?.maxHealth ?? REF_HP;
  const offense = d ? d.impact * WINDOW / (d.windupSeconds + d.activeSeconds + d.recoverySeconds) * reachFactor(d.reachM) / referenceOffense() : 0;
  return assessment(offense, maxHealth / REF_HP, { weapon: d ? `${spec!.name} charge` : null, arcane: null, armor: [], maxHealth });
}
export function bodyThreat(w: World, b: Body, opts: { equipped?: boolean } = {}): ThreatAssessment | null {
  const owner = w.get<Person | Creature>(b.ownerId);
  if (owner?.kind === 'person') return personThreat(w, owner as Person, b, opts);
  if (owner?.kind === 'creature') return creatureThreat(w, owner as Creature, b);
  return null;
}

/** Item grade: how much the item multiplies the reference adult's power when wielded, worn or
 * learned. Grades borrow rank names (HWFWM item ranks) as classification only: nothing is gated
 * on them and a Normal person may carry a Gold-grade focus. Items with no combat function have
 * no grade. Wear counts: a degraded item grades lower, a broken one has none. */
export interface ItemGrade { level: number; rank: LeveledRank; grade: string; power: number; role: 'weapon' | 'armor' | 'focus' | 'source' }
export function itemGrade(item: Item): ItemGrade | null {
  if (item.quantity <= 0 || item.condition === 0) return null;
  const grade = (power: number, role: ItemGrade['role']): ItemGrade => {
    const level = levelForPower(power); return { level, rank: rankOfLevel(level), grade: gradeLabel(level), power, role };
  };
  const weapon = weaponProperties(item);
  if (weapon) return grade(strikeImpact(weapon, 8, 8) * reachFactor(weapon.reach) / referenceImpact(), 'weapon');
  if (item.physicalArmor) return grade(1 / armorThrough([item]), 'armor');
  if (item.arcaneFocus) {
    const reference = { arcana: { version: 1 as const, learned: {} }, skills: {} }, base = { amplitude: 1, aperture: 1, reserve: 100 };
    const without = arcaneOffense(reference, base, ['book-ember']).damage, focus = item.arcaneFocus;
    return grade(arcaneOffense(reference, { amplitude: focus.amplitude, aperture: focus.aperture, reserve: focus.reserve }, ['book-ember']).damage / without, 'focus');
  }
  if (item.arcaneSource) {
    const learned = arcaneOffense({ arcana: { version: 1, learned: {} }, skills: {} }, { amplitude: 1, aperture: 1, reserve: 100 }, [item.arcaneSource.abilityId]).damage;
    return grade(Math.max(1, learned / referenceOffense()), 'source');
  }
  return null;
}
