import type { Body, Creature, ResourceNode, Vec3 } from '../core/types';
import type { World } from '../core/world';
import { SECONDS_PER_DAY as DAY } from '../core/time';
import { ENERGY_DRAIN_PER_HOUR, HYDRATION_DRAIN_PER_HOUR, stepEmbodiedPhysiology } from '../core/physiology';
import { travelPath } from '../physical/travel';
import { maintainResourceNodes } from '../world/resources';
import { consumeEcologicalResource, habitatAt } from '../world/ecologyResources';
import { ageDays, bodyScale, ecologyRng, naturalDeath } from './animals';
import { censusEcology, nurse, stepReproduction } from './lifecycle';
import { distance, ecologyQueries, senseResources, visible, type EcologyQueries } from './sensing';
import type { AnimalActivity, AnimalEmbodiment, SpeciesSpec } from './types';

export const ECOLOGY_QUANTUM_SECONDS = 15 * 60;
const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** Canonical coarse scheduler. Pending BOTH clocks persists: physical travel never borrows
 * calendar seconds. Fixed quanta preserve continuation across frame partition and save/load. */
export function stepWildlife(world: World, physicalSeconds: number, worldSeconds: number): void {
  const ecology = world.ecology;
  if (!ecology) return;
  if (![physicalSeconds, worldSeconds].every(Number.isFinite) || physicalSeconds < 0 || worldSeconds < 0) throw new Error('Invalid ecology time');
  ecology.pendingWorldSeconds += worldSeconds; ecology.pendingPhysicalSeconds += physicalSeconds;
  while (ecology.pendingWorldSeconds >= ECOLOGY_QUANTUM_SECONDS) {
    const physical = ecology.pendingPhysicalSeconds * ECOLOGY_QUANTUM_SECONDS / ecology.pendingWorldSeconds;
    ecology.pendingWorldSeconds -= ECOLOGY_QUANTUM_SECONDS; ecology.pendingPhysicalSeconds -= physical;
    ecology.processedAt += ECOLOGY_QUANTUM_SECONDS;
    const tick = ecology.processedAt;
    maintainResourceNodes(world, tick);
    const queries = ecologyQueries(world);
    // Snapshot: newborns begin their own elapsed life NEXT quantum.
    for (const animal of [...world.creatures()]) {
      if (!animal.wildlife) continue;
      const spec = ecology.species[animal.species]; if (!spec) throw new Error(`Missing ecology species ${animal.species}`);
      for (const id of animal.bodies) {
        const body = world.body(id), state = animal.wildlife.embodiments[id];
        if (!body || !state || body.dead || !body.present) continue;
        stepAnimal(world, animal, body, state, spec, queries, tick, physical);
        queries.bodies.point(body, body.dead ? null : body.pos);
      }
    }
    censusEcology(world, tick);
  }
}

function stepAnimal(world: World, animal: Creature, body: Body, state: AnimalEmbodiment, spec: SpeciesSpec, queries: EcologyQueries, tick: number, physical: number): void {
  const seconds = ECOLOGY_QUANTUM_SECONDS, hours = seconds / 3600, p = state.physiology;
  const scale = bodyScale(spec, ageDays(animal, tick)), oldScale = bodyScale(spec, ageDays(animal, tick - seconds));
  // Increasing reserve capacity during growth cannot create food/water.
  p.energy *= oldScale / scale; p.hydration *= oldScale / scale;
  const resources = senseResources(world, queries, body, spec);
  const previousActivity = state.activity;
  const decision = decide(world, body, state, spec, resources, tick);
  state.activity = decision.activity; state.target = decision.target;
  let walked = 0;
  if (decision.target && distance(body.pos, decision.target.pos) > 1.3) {
    if (!body.path || !body.pathGoal || distance(body.pathGoal, decision.target.pos) > 0.5) {
      body.path = world.nav.findPath(body.pos, decision.target.pos, 512);
      body.pathIndex = 0; body.pathGoal = body.path ? { ...decision.target.pos } : null;
    }
    const speed = spec.locomotion.walk.speedMps * Math.max(0.2, Math.cbrt(scale)) * Math.max(0.2, 1 - p.fatigue * 0.65);
    walked = travelPath(world, body, physical, speed, spec.bodyPlan.radiusM * Math.cbrt(scale), spec.bodyPlan.heightM * Math.cbrt(scale));
    if (physical > 0 && walked === 0 && !body.path && decision.target.resourceId) {
      state.blockedSources = [...(state.blockedSources ?? []), { id: decision.target.resourceId, until: tick + 6 * 3600 }].slice(-8);
    }
    state.distanceM += walked;
    // Metabolic cost reflects time actually spent traversing, not a failed route request.
    integratePhysiology(world, p, spec, hours * Math.min(1, walked / Math.max(1e-9, speed * physical)), 'walk', tick, scale);
    integratePhysiology(world, p, spec, hours * (1 - Math.min(1, walked / Math.max(1e-9, speed * physical))), 'idle', tick, scale);
  } else {
    body.path = null; body.pathGoal = null; body.vel = { x: 0, y: 0, z: 0 };
    integratePhysiology(world, p, spec, hours, state.activity === 'sleep' ? 'sleep' : 'idle', tick, scale);
    const node = decision.target?.resourceId ? resources.find(n => n.id === decision.target!.resourceId) : undefined;
    if (node && node.kind === 'surface_water' && decision.activity === 'drink') {
      const litres = consumeEcologicalResource(world, body, node,
        Math.min((1 - p.hydration) * spec.metabolism.waterReserveLitres * scale, spec.metabolism.waterLitresPerDay * scale * hours / 2), tick);
      p.hydration = clamp(p.hydration + litres / (spec.metabolism.waterReserveLitres * scale)); state.waterLitres += litres;
      if (litres > 0 && previousActivity !== 'drink') intakeEvent(world, animal, body, node, 'water_consumed', litres, tick);
    } else if (node?.forage && decision.activity === 'eat') {
      const kjPerKg = spec.diet[node.forage] ?? 0;
      const juvenileRate = Math.min(1, 0.25 + ageDays(animal, tick) / spec.reproduction.weaningDays);
      const kg = consumeEcologicalResource(world, body, node,
        Math.min((1 - p.energy) * spec.metabolism.energyReserveKJ * scale / kjPerKg, spec.metabolism.foodKgPerDay * scale * hours / 4 * juvenileRate), tick);
      p.energy = clamp(p.energy + kg * kjPerKg / (spec.metabolism.energyReserveKJ * scale)); state.foodKg += kg;
      if (kg > 0 && previousActivity !== 'eat') intakeEvent(world, animal, body, node, 'food_consumed', kg, tick);
    }
  }
  if (nurse(world, animal, body, state, spec, tick)) state.activity = 'nurse';
  state.starvationHours = p.energy <= 1e-6 ? state.starvationHours + hours : Math.max(0, state.starvationHours - hours * 0.5);
  state.dehydrationHours = p.hydration <= 1e-6 ? state.dehydrationHours + hours : Math.max(0, state.dehydrationHours - hours);
  if (p.energy <= 1e-6) body.health = Math.max(0, body.health - body.maxHealth * hours / spec.metabolism.starvationHours);
  if (p.hydration <= 1e-6) body.health = Math.max(0, body.health - body.maxHealth * hours / spec.metabolism.dehydrationHours);
  if (p.energy > 0.4 && p.hydration > 0.4) body.health = Math.min(body.maxHealth, body.health + body.maxHealth * hours / (7 * 24));
  if (body.health <= 0 || state.dehydrationHours >= spec.metabolism.dehydrationHours || state.starvationHours >= spec.metabolism.starvationHours) {
    naturalDeath(world, animal, body, state, p.hydration <= 1e-6 ? 'dehydration' : 'starvation', tick);
  } else if (tick >= animal.wildlife!.senescenceAt) naturalDeath(world, animal, body, state, 'old_age', tick);
  if (!body.dead) body.pose = walked > 0 ? 'walk' : state.activity === 'sleep' ? 'sleep' : state.activity === 'eat' || state.activity === 'drink' ? state.activity : 'stand';
  stepReproduction(world, animal, body, state, spec, resources, queries, tick, seconds);
}

function integratePhysiology(world: World, p: AnimalEmbodiment['physiology'], spec: SpeciesSpec, hours: number, activity: 'walk' | 'idle' | 'sleep', tick: number, scale: number): void {
  const m = spec.metabolism, density = Math.max(...Object.values(spec.diet));
  const youngMetabolicLoad = Math.pow(scale, -0.15);
  const exposure = 1 + Math.max(0, p.wetness - m.exposureTolerance) * 0.3;
  stepEmbodiedPhysiology(world, p, hours, activity, {
    indoor: false, daylight: Math.max(0, Math.sin((tick % DAY / DAY - 0.25) * 2 * Math.PI)),
    profile: { energyDrainMultiplier: m.foodKgPerDay * density / (24 * m.energyReserveKJ * ENERGY_DRAIN_PER_HOUR) * youngMetabolicLoad * exposure,
      hydrationDrainMultiplier: m.waterLitresPerDay / (24 * m.waterReserveLitres * HYDRATION_DRAIN_PER_HOUR) * youngMetabolicLoad,
      fatigueMultiplier: 1, sleepNeedMultiplier: 1.1 * m.sleepHoursPerDay / (24 - m.sleepHoursPerDay), recoveryRateMultiplier: 1 },
  });
  if (activity === 'sleep') p.lastSleepAt = tick;
}

function decide(world: World, body: Body, state: AnimalEmbodiment, spec: SpeciesSpec, resources: ResourceNode[], tick: number): { activity: AnimalActivity; target: AnimalEmbodiment['target'] } {
  const p = state.physiology;
  if (state.blockedSources) state.blockedSources = state.blockedSources.filter(s => s.until > tick);
  const reachableCandidates = resources.filter(n => !state.blockedSources?.some(s => s.id === n.id));
  const waterNeed = p.hydration < 0.48 || (state.activity === 'drink' && p.hydration < 0.85);
  const foodNeed = p.energy < 0.6 || (state.activity === 'eat' && p.energy < 0.85);
  const waterFirst = waterNeed && (!foodNeed || p.hydration < 0.3 || p.energy > 0.2);
  const select = (water: boolean) => reachableCandidates.filter(n => water ? n.kind === 'surface_water' : !!n.forage).sort((a, b) => {
    const score = (n: ResourceNode) => (water ? 1 : Math.min(2, n.remaining) * (spec.diet[n.forage!] ?? 0) / 2000) / (1 + distance(body.pos, n.pos));
    return score(b) - score(a) || a.id.localeCompare(b.id);
  })[0];
  if (waterNeed || foodNeed) {
    const resource = select(waterFirst);
    if (resource) return { activity: distance(body.pos, resource.pos) <= 1.3 ? waterFirst ? 'drink' : 'eat' : waterFirst ? 'seek_water' : 'seek_food', target: { pos: { ...resource.pos }, resourceId: resource.id } };
    // When a vital source is absent, explore only locally visible physical ground.
    return { activity: waterFirst ? 'seek_water' : 'seek_food', target: explore(world, body, spec, true) };
  }
  if (p.sleepDebt > 3 || (state.activity === 'sleep' && p.sleepDebt > 0.5)) return { activity: 'sleep', target: null };
  if (p.fatigue > 0.7 || (state.activity === 'rest' && p.fatigue > 0.25)) return { activity: 'rest', target: null };
  if ((spec.habitats[habitatAt(world, body.pos)] ?? 0) < 0.5) return { activity: 'seek_habitat', target: explore(world, body, spec, true) };
  const rng = ecologyRng(world), roam = rng.chance(0.12); world.ecology!.rngState = rng.state();
  return { activity: roam ? 'roam' : 'idle', target: roam ? explore(world, body, spec, false) : null };
}

function explore(world: World, body: Body, spec: SpeciesSpec, urgent: boolean): AnimalEmbodiment['target'] {
  const rng = ecologyRng(world), candidates: { pos: Vec3; score: number }[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = rng.range(0, Math.PI * 2), radius = rng.range(2, Math.min(spec.senses.localRadiusM, urgent ? 12 : 5));
    const x = Math.floor(body.pos.x + Math.cos(angle) * radius), z = Math.floor(body.pos.z + Math.sin(angle) * radius), y = world.nav.floorY(x, z);
    const pos = { x: x + 0.5, y, z: z + 0.5 };
    if (y < 0 || world.nav.walkCost(x, z) >= 3 || !visible(world, body.pos, pos, spec.senses.localRadiusM)) continue;
    candidates.push({ pos, score: (spec.habitats[habitatAt(world, pos)] ?? 0) + rng.next() * 0.25 });
  }
  world.ecology!.rngState = rng.state();
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ? { pos: candidates[0].pos } : null;
}

function intakeEvent(world: World, animal: Creature, body: Body, node: ResourceNode, type: 'food_consumed' | 'water_consumed', amount: number, tick: number): void {
  world.emit(type, { actor: animal.id, tick, pos: { ...body.pos }, category: 'world', significance: 0.01,
    visibility: 0.1, loudness: 0, data: { species: animal.species, nodeId: node.id, amount, unit: type === 'food_consumed' ? 'kg' : 'litres', scope: 'first_intake_of_bout' },
    summary: `A ${animal.name} ${type === 'food_consumed' ? 'fed' : 'drank'}` });
}
