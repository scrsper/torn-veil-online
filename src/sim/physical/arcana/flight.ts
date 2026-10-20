import type { Body, Person } from '../../core/types';
import type { World } from '../../core/world';
import { getPhysicalCapability } from '../../core/attributes';
import { RESOURCE_MASS_KG } from '../../world/factory';
import { EXERTION_POLICY } from '../exertion';
import { equippedItems } from '../equipment';
import { ARCANE_DEFINITIONS } from './definitions';
import { arcaneCapacity } from './growth';

/**
 * Authored continuous uses of existing learned gravity and ward forms. Those forms
 * previously supplied combat effects; they did not secretly grant flight. This is
 * the shared, deterministic capability law for the new application, not a rank
 * reward or a claim that these pacing constants are measured real-world physics.
 *
 * Reference: a rested 75 kg body with capacity 1/1/100 flies about 10 m/s for
 * under two minutes. Capacity 20/12/320 supports about 0.9 km/s, with a strong
 * learned ward costing about 2.3 mana/s. Actual reserves, load and condition
 * reduce those figures. Neither assessment nor elapsed time refills anything.
 */
export const MAGICAL_FLIGHT_POLICY = Object.freeze({
  version: 1,
  referenceBodyMassKg: 75,
  referenceGravity: 9.81,
  baseLiftAcceleration: 13,
  baseSpeed: 10,
  amplitudeSpeedExponent: .75,
  apertureSpeedExponent: .9,
  maximumSpeed: 2600,
  forwardSpeedMinimum: 6,
  forwardLiftMargin: .75,
  baseAltitude: 24,
  unprotectedAtmosphereFraction: .7,
  vacuumWardDemand: 8,
  spaceClearance: 50,
  landingReserveSeconds: 12,
  minimumHoverSeconds: 1,
  baseManaPerSecond: 1.1,
  amplitudeManaPerSecond: .015,
  apertureManaPerSecond: .025,
  wardManaPerSecond: .6,
  baseEffortPerSecond: .0004,
  maximumForecastSeconds: 3600,
});

export interface MagicalFlightEnvironment {
  /** Local acceleration in m/s²; zero is legitimate in open space. */
  gravity: number;
  /** Atmospheric envelope above the reference surface, in metres. */
  atmosphereHeight: number;
  altitude?: number;
  /** Actual planned path length, including avoidance legs, when admitting a route. */
  routeDistance?: number;
}
export interface MagicalFlightAssessment {
  canHover: boolean;
  canFly: boolean;
  canCrossSpace: boolean;
  /** Physical ward/lift envelope, independent of current route fuel allowance. */
  spaceEnvelope: boolean;
  speed: number;
  acceleration: number;
  maxAltitude: number;
  estimatedEndurance: number;
  manaPerSecond: number;
  effortPerSecond: number;
  protectionStrength: number;
  liftAcceleration: number;
  manaAvailable: number;
  routeManaRequired: number;
  routeEffortRequired: number;
  routeSeconds: number;
  capacity: { amplitude: number; aperture: number; reserve: number };
  /** Body mass is an authored estimate from the existing physiological size trait. */
  estimatedBodyMassKg: number;
  /** Only canonically weighed carried resources; unknown item mass is not invented. */
  knownLoadKg: number;
  unweighedStacks: number;
  safeCarryMassKg: number;
  gravityAbilityId: string | null;
  wardAbilityId: string | null;
  reasons: string[];
  /** Existing canonical learning/equipment/transformation receipts, never new events. */
  causes: string[];
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const finite = (n: number, fallback = 0) => Number.isFinite(n) ? n : fallback;

/** Learning survives giving away the book or consuming an essence. The retained
 * source and actor/ability/item/body receipt must agree; a learned-map label alone
 * is insufficient. World.event is indexed, so this does not scan event history. */
function learnedForm(w: World, p: Person, id: string) {
  const learned = p.arcana?.learned[id], def = ARCANE_DEFINITIONS.get(id);
  if (!learned || !def) return null;
  const event = w.event(learned.eventId), item = w.item(learned.itemId);
  const body = typeof event?.data.bodyId === 'string' ? w.body(event.data.bodyId) : undefined;
  if (!event || event.type !== 'arcane_learned' || event.actor !== p.id || event.item !== learned.itemId
    || event.data.abilityId !== id || !body || body.ownerId !== p.id || !p.bodies.includes(body.id)
    || !item?.arcaneSource || item.arcaneSource.abilityId !== id
    || !['book', 'essence'].includes(item.arcaneSource.kind) || event.data.source !== item.arcaneSource.kind) return null;
  return { def, event };
}

/**
 * Read-only projection. The host owns admission, resource spending, collision and
 * environmental consequences. No body/knowledge initialization, recovery, event,
 * inventory change, RNG consumption or world-clock advancement happens here.
 *
 * Endurance is a conservative constant-condition forecast: no mana/breath
 * recovery is assumed during sustained flight. It is recalculated as condition
 * changes. A route must also pass geometry and destination checks at the host.
 */
export function assessMagicalFlight(w: World, p: Person, b: Body, env: MagicalFlightEnvironment): MagicalFlightAssessment {
  const policy = MAGICAL_FLIGHT_POLICY, reasons: string[] = [], causes = new Set<string>();
  const gravityForm = ['ess-gravity', 'book-well'].map(id => learnedForm(w, p, id)).find(Boolean) ?? null;
  const wardForms = Object.keys(p.arcana?.learned ?? {}).sort().flatMap(id => {
    const form = learnedForm(w, p, id);
    return form?.def.kernel === 'ward' ? [form] : [];
  }).sort((a, z) => z.def.power - a.def.power || a.def.id.localeCompare(z.def.id));
  const wardForm = wardForms[0] ?? null;
  if (gravityForm) causes.add(gravityForm.event.id);
  if (wardForm) causes.add(wardForm.event.id);
  const transformation = p.arcana?.growth?.transformation;
  if (transformation && w.event(transformation.eventId)?.actor === p.id) causes.add(transformation.eventId);
  for (const item of equippedItems(w, p, b)) if (item.arcaneFocus && (item.condition ?? 1) > 0)
    for (const receipt of item.provenance) if (receipt.eventId && w.event(receipt.eventId)) causes.add(receipt.eventId);

  const rawCapacity = arcaneCapacity(p, w, b);
  const validCapacity = Object.values(rawCapacity).every(n => Number.isFinite(n) && n > 0);
  const capacity = {
    amplitude: Math.max(0, finite(rawCapacity.amplitude)),
    aperture: Math.max(0, finite(rawCapacity.aperture)),
    reserve: Math.max(0, finite(rawCapacity.reserve)),
  };
  const carried = [...new Set(p.inventory)].flatMap(id => {
    const item = w.item(id);
    return item && item.holderId === p.id && !item.containerId && item.quantity > 0 ? [item] : [];
  });
  const knownLoadKg = carried.reduce((mass, item) => mass + (RESOURCE_MASS_KG[item.type] ?? 0) * item.quantity, 0);
  const unweighedStacks = carried.filter(item => RESOURCE_MASS_KG[item.type] === undefined).length;
  const physical = getPhysicalCapability(p, w, { body: b });
  const traits = p.physiologyTraits, phys = p.physiology;
  const size = Math.max(.1, finite(traits.bodySizeFactor, 1));
  const conditioning = Math.max(.1, finite(traits.conditioning, 1));
  const estimatedBodyMassKg = policy.referenceBodyMassKg * size;
  const massRatio = (estimatedBodyMassKg + finite(knownLoadKg)) / policy.referenceBodyMassKg;
  const nutrition = clamp(Math.min(finite(phys.energy), finite(phys.hydration)) / .5, 0, 1);
  const exertion = clamp(finite(b.exertion?.load ?? 0, 1), 0, 1);
  const skill = clamp(finite(p.skills.veilcraft ?? 0), 0, 1);
  // Reuse the central wound/fatigue/heat/sleep capability calculation; hydration
  // and bodily mass then constrain this continuous application directly.
  const control = (1 + skill * .35) * clamp(finite(physical.currentExertionCapacity), 0, 1) * nutrition;
  const validEnvironment = [env.gravity, env.atmosphereHeight, env.altitude ?? 0, env.routeDistance ?? 0]
    .every(n => Number.isFinite(n) && n >= 0);
  const gravity = Math.max(0, finite(env.gravity)), atmosphere = Math.max(0, finite(env.atmosphereHeight));
  const altitude = Math.max(0, finite(env.altitude ?? 0)), routeDistance = Math.max(0, finite(env.routeDistance ?? 0));
  const binding = w.universeExpedition;
  const manifested = b.present || !!binding?.active && binding.authority === 'canonical'
    && binding.personId === p.id && binding.bodyId === b.id;
  const conscious = w.person(p.id) === p && w.body(b.id) === b && p.alive && !b.dead && b.health > 0
    && b.ownerId === p.id && p.bodies.includes(b.id) && manifested
    && !['sleep', 'downed'].includes(b.pose) && b.subduedUntil <= w.physicalTime && !p.surrender && !p.custody?.active;
  const freeAction = !(b.combatAction && b.combatAction.completeAt > w.physicalTime)
    && !(b.arcana?.cast && b.arcana.cast.completeAt > w.physicalTime);
  const nourished = phys.energy >= .1 && phys.hydration >= .1 && phys.fatigue < .97 && exertion < 1;
  const validPhysiology = [b.health, b.maxHealth, phys.energy, phys.hydration, phys.fatigue,
    traits.bodySizeFactor, traits.conditioning, knownLoadKg].every(Number.isFinite) && b.maxHealth > 0;
  const functional = conscious && freeAction && nourished && validEnvironment && validCapacity && validPhysiology && !!gravityForm;

  const liftAcceleration = functional ? policy.baseLiftAcceleration * capacity.amplitude * control / massRatio : 0;
  const speed = functional ? Math.min(policy.maximumSpeed, policy.baseSpeed * capacity.amplitude ** policy.amplitudeSpeedExponent
    * capacity.aperture ** policy.apertureSpeedExponent * control / Math.sqrt(massRatio)) : 0;
  const acceleration = functional ? Math.max(0, liftAcceleration - gravity) + speed * .12 : 0;
  const protectionStrength = wardForm ? finite(wardForm.def.power * Math.sqrt(capacity.amplitude * capacity.aperture) * control / Math.sqrt(massRatio)) : 0;
  const protectedForSpace = protectionStrength >= policy.vacuumWardDemand;
  const manaPerSecond = finite((policy.baseManaPerSecond + capacity.amplitude * policy.amplitudeManaPerSecond
    + capacity.aperture * policy.apertureManaPerSecond + (protectedForSpace ? policy.wardManaPerSecond : 0))
    * Math.sqrt(massRatio) / (1 + skill * .15));
  const effortPerSecond = policy.baseEffortPerSecond * Math.sqrt(massRatio) / conditioning
    * Math.max(.5, finite(physical.fatigueMultiplier, 1));
  // An uninitialized body has no spendable reserve here. Ordinary source learning
  // initializes its canonical arcane body; querying the UI cannot grant mana.
  const manaAvailable = clamp(finite(b.arcana?.mana ?? 0), 0, capacity.reserve);
  const breathSeconds = (1 - exertion) / (effortPerSecond * EXERTION_POLICY.burstScale);
  const estimatedEndurance = functional ? Math.max(0, Math.min(policy.maximumForecastSeconds,
    manaAvailable / Math.max(.001, manaPerSecond), breathSeconds)) : 0;
  const controlAltitude = functional ? policy.baseAltitude * capacity.aperture * Math.sqrt(capacity.amplitude) * control / massRatio : 0;
  const hasSpaceEnvelope = protectedForSpace && controlAltitude >= atmosphere + policy.spaceClearance;
  // The physical envelope uses full capacity, not the remaining fuel: spending
  // mana must not lower a geometric ceiling onto a body already in space.
  const fullReserveSeconds = Math.min(policy.maximumForecastSeconds, capacity.reserve / Math.max(.001, manaPerSecond));
  const maxAltitude = !functional ? 0 : hasSpaceEnvelope
    ? Math.max(controlAltitude, speed * Math.max(0, fullReserveSeconds - policy.landingReserveSeconds))
    : Math.min(controlAltitude, atmosphere * policy.unprotectedAtmosphereFraction);
  // Above the ceiling, available lift still permits a controlled descent. The
  // locomotion law must brake upward motion; losing all lift on a small numerical
  // overshoot would turn a bounded ascent into an avoidable uncontrolled fall.
  const canHover = functional && liftAcceleration >= gravity && estimatedEndurance >= policy.minimumHoverSeconds;
  const canFly = canHover && liftAcceleration >= gravity + policy.forwardLiftMargin
    && speed >= policy.forwardSpeedMinimum && altitude <= maxAltitude;
  // Includes acceleration/deceleration plus reserve for a controlled landing.
  // At speed v and acceleration a the added v/a covers both ramp phases compared
  // with distance/v; for short routes this deliberately overestimates the cost.
  const routeSeconds = finite(policy.landingReserveSeconds + (routeDistance > 0
    ? routeDistance / Math.max(.001, speed) + speed / Math.max(.001, acceleration) : 0), Number.MAX_VALUE);
  const routeManaRequired = finite(routeSeconds * manaPerSecond, Number.MAX_VALUE);
  const routeEffortRequired = finite(routeSeconds * effortPerSecond, Number.MAX_VALUE);
  const canCrossSpace = canFly && hasSpaceEnvelope && routeSeconds <= estimatedEndurance;

  if (!validEnvironment || !validCapacity || !validPhysiology) reasons.push('Flight inputs contain invalid physical values.');
  if (!conscious) reasons.push('A conscious living manifestation of this person is required.');
  if (!freeAction) reasons.push('Finish the committed physical or arcane action.');
  if (!gravityForm) reasons.push('Learn gravity control from a recorded gravity essence or Tome of Falling Stars.');
  if (!nourished) reasons.push('Food, water, rest or breath is insufficient for sustained flight.');
  if (functional && liftAcceleration < gravity) reasons.push('Available lift cannot support this body and its known carried mass here.');
  if (functional && estimatedEndurance < policy.minimumHoverSeconds) reasons.push('The body has insufficient mana or breath for sustained lift.');
  if (functional && !canFly && canHover) reasons.push('Lift permits hovering but lacks the margin for controlled forward flight.');
  if (altitude > maxAltitude) reasons.push('Current altitude exceeds the supported flight envelope.');
  if (!wardForm) reasons.push('Space crossing requires a learned protective ward.');
  else if (!protectedForSpace) reasons.push('The learned ward cannot sustain a protective envelope in space at this capacity.');
  if (protectedForSpace && !hasSpaceEnvelope) reasons.push('Gravity control cannot yet carry a protective envelope beyond the atmosphere.');
  if (hasSpaceEnvelope && routeSeconds > estimatedEndurance) reasons.push('The planned flight exceeds mana or breath reserves including landing allowance.');
  if (unweighedStacks) reasons.push(`${unweighedStacks} carried item stack${unweighedStacks === 1 ? ' has' : 's have'} no canonical mass; load accounting is incomplete.`);
  return { canHover, canFly, canCrossSpace, spaceEnvelope: functional && hasSpaceEnvelope, speed, acceleration, maxAltitude, estimatedEndurance,
    manaPerSecond, effortPerSecond, protectionStrength, liftAcceleration, manaAvailable, routeManaRequired,
    routeEffortRequired, routeSeconds, capacity, estimatedBodyMassKg, knownLoadKg: finite(knownLoadKg), unweighedStacks,
    safeCarryMassKg: finite(physical.safeCarryMassKg), gravityAbilityId: gravityForm?.def.id ?? null,
    wardAbilityId: wardForm?.def.id ?? null, reasons, causes: [...causes] };
}
